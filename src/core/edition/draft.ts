import type { Story } from '../schema/article.js';
import type { BriefConfig } from '../schema/config.js';
import type { Edition, EditionSummaries } from '../schema/edition.js';

/**
 * Drafts a short paragraph for the edition's lead stories.
 *
 * The model is given nothing but material already fetched and already sourced: the
 * publishers' own headlines and standfirsts. It is asked to compress, never to add. Every
 * candidate paragraph is then checked in code before it is allowed anywhere near the
 * repository, and anything that fails is dropped rather than repaired.
 *
 * Any failure — no key, exhausted quota, a timeout, a rejected draft — ends with no text.
 * The edition still publishes; it simply publishes without prose.
 */

export interface DraftOutcome {
  summaries: EditionSummaries['summaries'];
  attempted: number;
  rejected: { headline: string; reason: string }[];
  skippedReason?: string;
}

/** Digits as they appear in prose: 35, 1,200, 19-year, 4.5%. */
function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/\d[\d.,]*/g)) {
    const normalised = match[0].replace(/[.,]+$/, '').replace(/,/g, '');
    if (normalised.length > 0) found.add(normalised);
  }
  return found;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * The hard rule from the brief, enforced rather than trusted: a language model may compress
 * sourced material, never introduce a fact. A figure that is not in the source text is the
 * clearest possible signal that it did.
 */
export function guardDraft(draft: string, sourceText: string, maxWords: number): GuardResult {
  const text = draft.trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };

  const words = text.split(/\s+/).length;
  if (words > maxWords * 1.35) return { ok: false, reason: `too long (${words} words)` };

  if (/https?:\/\/|www\./i.test(text)) return { ok: false, reason: 'contains a link' };

  const allowed = numbersIn(sourceText);
  for (const number of numbersIn(text)) {
    if (!allowed.has(number)) return { ok: false, reason: `figure "${number}" is not in the sources` };
  }

  return { ok: true };
}

function sourceTextFor(story: Story): string {
  return story.articles.map((article) => `${article.publisher}: ${article.title}`).join('\n');
}

/**
 * Kept short and concrete. A longer, rule-listing prompt made the model reason at length
 * about the rules themselves and exhaust its budget before writing anything.
 */
function promptFor(story: Story, maxWords: number): string {
  return [
    'Below are headlines from several outlets reporting the same story.',
    '',
    sourceTextFor(story),
    '',
    `Write one paragraph of at most ${maxWords} words stating what these outlets report.`,
    'Use only what appears above; add no fact, figure, name, date or cause that is not there.',
    'Do not speculate. Do not name outlets.',
    'If the material is too thin to summarise, reply with exactly: INSUFFICIENT',
    '',
    'Output the paragraph and nothing else. No preamble, no reasoning, no bullet points.',
  ].join('\n');
}

/** Either the answer, or why there isn't one — the caller reports the reason verbatim. */
type ModelReply = { text: string } | { failure: string };

async function callGemini(
  prompt: string,
  config: BriefConfig,
  apiKey: string,
): Promise<ModelReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.model)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            // Generous, because thinking is billed against this budget before the answer
            // begins. At 400 the model spent all of it reasoning and returned nothing.
            maxOutputTokens: config.ai.maxOutputTokens,
          },
        }),
      },
    );

    if (!response.ok) {
      // Reported rather than flattened into "something went wrong": a spent quota, a retired
      // model and a malformed request need different responses from a human.
      const body = await response.text().catch(() => '');
      const message = /"message":\s*"([^"]{0,160})/.exec(body)?.[1];
      return { failure: `HTTP ${response.status}${message ? ` — ${message}` : ''}` };
    }

    const payload = (await response.json()) as {
      candidates?: {
        finishReason?: string;
        content?: { parts?: { text?: string; thought?: boolean }[] };
      }[];
    };

    const candidate = payload.candidates?.[0];

    /*
     * Reasoning models return their scratchpad and their answer as separate parts, the
     * scratchpad flagged `thought: true`. Joining every part yielded pages of bullet-point
     * planning instead of a paragraph, so only the unflagged parts are the answer.
     */
    const answer = (candidate?.content?.parts ?? [])
      .filter((part) => part.thought !== true)
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    // Truncated mid-thought: the model never reached its answer, so there is nothing to use.
    if (candidate?.finishReason === 'MAX_TOKENS' && answer.length === 0) {
      return { failure: 'ran out of output tokens while reasoning — raise ai.maxOutputTokens' };
    }

    return answer ? { text: answer } : { failure: `empty answer (finish: ${candidate?.finishReason ?? 'unknown'})` };
  } catch (error) {
    const name = (error as Error).name;
    return { failure: name === 'AbortError' ? `timed out after ${config.ai.timeoutMs} ms` : (error as Error).message.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

export async function draftSummaries(
  edition: Edition,
  config: BriefConfig,
  now: string,
): Promise<DraftOutcome> {
  const byId = new Map(edition.stories.map((story) => [story.id, story]));
  const leads = edition.leadStoryIds
    .map((id) => byId.get(id))
    .filter((story): story is Story => story !== undefined);

  if (!config.ai.enabled) return { summaries: [], attempted: 0, rejected: [], skippedReason: 'disabled in config' };

  const apiKey = process.env[config.ai.credentialEnvVar]?.trim();
  if (!apiKey) {
    return { summaries: [], attempted: 0, rejected: [], skippedReason: `${config.ai.credentialEnvVar} is not set` };
  }

  const summaries: EditionSummaries['summaries'] = [];
  const rejected: { headline: string; reason: string }[] = [];
  let attempted = 0;

  for (const story of leads) {
    attempted += 1;
    const sourceText = sourceTextFor(story);
    const reply = await callGemini(promptFor(story, config.ai.maxWords), config, apiKey);

    if ('failure' in reply) {
      // Stop rather than hammer a key that just refused; the reason travels to the log.
      return { summaries, attempted, rejected, skippedReason: reply.failure };
    }

    const draft = reply.text;
    if (draft.toUpperCase().includes('INSUFFICIENT')) {
      rejected.push({ headline: story.headline, reason: 'model judged the material too thin' });
      continue;
    }

    const guard = guardDraft(draft, sourceText, config.ai.maxWords);
    if (!guard.ok) {
      rejected.push({ headline: story.headline, reason: guard.reason ?? 'failed the guard' });
      continue;
    }

    summaries.push({
      storyId: story.id,
      headline: story.headline,
      text: draft,
      sourcesGiven: story.articles.map((article) => article.url),
    });
  }

  void now;
  return { summaries, attempted, rejected };
}
