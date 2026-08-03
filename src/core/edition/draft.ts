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

function promptFor(story: Story, maxWords: number): string {
  return [
    'You are compressing news coverage for a research institute briefing.',
    '',
    'Below are headlines from several outlets reporting the same story. Write one paragraph',
    `of at most ${maxWords} words that states what these outlets are reporting.`,
    '',
    'Rules, without exception:',
    '- Use only what appears below. Add no fact, figure, name, date or cause that is not there.',
    '- Do not speculate about consequences, motives or what happens next.',
    '- Do not include links, citations or outlet names.',
    '- If the material is too thin to summarise, reply with exactly: INSUFFICIENT',
    '',
    'Coverage:',
    sourceTextFor(story),
  ].join('\n');
}

async function callGemini(
  prompt: string,
  config: BriefConfig,
  apiKey: string,
): Promise<string | undefined> {
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
          generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
        }),
      },
    );

    // 429 is the free quota running out. That is an expected, harmless end to the step.
    if (!response.ok) return undefined;

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
    return text?.trim() || undefined;
  } catch {
    return undefined;
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
    const draft = await callGemini(promptFor(story, config.ai.maxWords), config, apiKey);

    if (!draft) {
      // Quota, outage or timeout. Stop asking rather than hammering a spent key.
      return {
        summaries,
        attempted,
        rejected,
        skippedReason: 'the model returned nothing — quota, timeout or outage',
      };
    }

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
