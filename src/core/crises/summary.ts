import { createHash } from 'node:crypto';
import { guardDraft } from '../edition/draft.js';

/**
 * Three to five sentences on what is happening in a crisis now, in English and Norwegian.
 *
 * The model is given nothing but material the builder already fetched and already links:
 * the crisis's headlines, the counts behind its status line and the Wikipedia lead. It is
 * asked to compress, never to add. Both languages then go through `guardDraft`, the same
 * check the Brief uses: any figure that is not in that material rejects the text outright.
 *
 * Every failure ends the same way — no key, a spent free quota, a timeout, malformed output,
 * a rejected draft. The page keeps the last text that passed, or shows the status line
 * alone. Nothing here can cost money: only free tiers are configured, and a provider whose
 * key is absent is never called.
 *
 * GitHub Models, the first choice, was retired on 30 July 2026, so the providers are any
 * OpenAI-compatible endpoint with a free tier, tried in the order config lists them.
 */

export interface Provider {
  id: string; url: string; model: string; keyEnv: string;
  /** Extra request fields this provider needs, e.g. a reasoning model's effort level. */
  params?: Record<string, unknown>;
  /** Least time between two calls, for free tiers that cap tokens per minute. */
  minIntervalMs?: number;
}
export interface SummarySettings {
  enabled: boolean;
  minHoursBetween: number;
  maxAgeHours: number;
  maxPerRun: number;
  maxWords: number;
  timeoutMs: number;
  providers: Provider[];
  minPreferred?: number;
  preferredOutlets?: { names: string[]; domains: string[] };
}

export interface Summary {
  en: string;
  nb: string;
  model: string;
  writtenAt: string;
  sources: { title: string; url: string; publisher: string }[];
}

export interface SummaryState {
  approved: Summary | null;
  promptVersion?: number;
  inputHash?: string;
  attemptedAt?: string;
  lastOutcome?: string;
}

export interface SummaryInput {
  id: string;
  name: string;
  /** Dated reference figures (UCDP, World Bank), each with the year it applies to. */
  facts: string[];
  headlines: { title: string; url: string; publisher: string }[];
  background?: string;
  /** The last summary that passed, so the new one can say what has changed since. */
  previous?: { text: string; writtenAt: string };
  /** The status line's own figures: the summary must not repeat them. */
  avoid?: number[];
}

/** Bumped when the brief to the model changes, so every crisis is rewritten once. */
export const PROMPT_VERSION = 2;

/** Norwegian writes 1 200 and 4,5; the guard compares digits, so thousands spaces are closed up. */
export function normaliseNumbers(text: string): string {
  return text.replace(/(\d)[   ](?=\d{3}\b)/g, '$1');
}

export function sourceTextOf(input: SummaryInput): string {
  return [
    ...input.facts,
    ...input.headlines.map((h) => `${h.publisher}: ${h.title}`),
    input.background ?? '',
    // The previous summary passed this same guard against its own sources.
    input.previous?.text ?? '',
  ].join('\n');
}

export function inputHash(input: SummaryInput): string {
  return createHash('sha1').update(input.headlines.map((h) => h.url).sort().join('\n')).digest('hex').slice(0, 16);
}

function sentences(text: string): number {
  return text.split(/(?<=[.!?…])\s+(?=[\p{Lu}«“"])/u).filter((s) => s.trim().length > 0).length;
}

/** The whole gate, both languages: the guard's figures rule, then length and shape. */
export function checkSummary(
  en: string, nb: string, sourceText: string, maxWords: number, avoid: number[] = [],
): { ok: boolean; reason?: string } {
  const source = normaliseNumbers(sourceText);
  for (const [lang, text] of [['en', en], ['nb', nb]] as const) {
    const plain = normaliseNumbers(text);
    const guard = guardDraft(plain, source, maxWords);
    if (!guard.ok) return { ok: false, reason: `${lang}: ${guard.reason}` };
    const n = sentences(text);
    if (n < 2 || n > 6) return { ok: false, reason: `${lang}: ${n} sentences` };
    if (/INSUFFICIENT|as an ai|language model/i.test(text)) return { ok: false, reason: `${lang}: not a summary` };
    // The status line above already gives the counts and the change; the summary explains.
    const figures = new Set([...plain.matchAll(/\d[\d.,]*/g)].map((m) => m[0].replace(/[.,]+$/, '').replace(/,/g, '')));
    const repeated = avoid.find((v) => v >= 2 && figures.has(String(v)));
    if (repeated !== undefined) return { ok: false, reason: `${lang}: repeats the status line's figure ${repeated}` };
    // One figure with its source, never a span like "40-41"; a span of years is fine.
    const span = /\b(\d{1,3}(?:[.,]\d+)?)\s?[-–]\s?(\d{1,3}(?:[.,]\d+)?)\b(?!\s?(?:km|kilomet))/.exec(plain);
    if (span) return { ok: false, reason: `${lang}: a range of figures (${span[0]})` };
    // No sentences about how the monitor works.
    if (/\b(outlets?|medier|several sources|multiple sources|flere kilder|reported by|meldt av|incident monitor|hendelsesmonitor)\b/i.test(text)) {
      return { ok: false, reason: `${lang}: talks about method, not events` };
    }
    // A UCDP or World Bank figure always says which year it is for.
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (/UCDP|World Bank|Verdensbanken/i.test(sentence) && /\d/.test(sentence) && !/\b(19|20)\d{2}\b/.test(sentence)) {
        return { ok: false, reason: `${lang}: a UCDP or World Bank figure without its year` };
      }
    }
  }
  return { ok: true };
}

function promptFor(input: SummaryInput, maxWords: number): string {
  return [
    `Crisis: ${input.name}`,
    '',
    'Headlines from the past few days, each with its outlet:',
    ...input.headlines.map((h) => `- ${h.publisher}: ${h.title}`),
    ...(input.facts.length ? ['', 'Reference figures, each with the year it applies to:', ...input.facts.map((f) => `- ${f}`)] : []),
    ...(input.previous ? ['', `What we wrote on ${input.previous.writtenAt.slice(0, 10)}:`, input.previous.text] : []),
    ...(input.background ? ['', 'Background (Wikipedia):', input.background.slice(0, 1200)] : []),
    '',
    `Write 3 to 5 sentences (at most ${maxWords} words) for an analyst: what is happening in this crisis now, where, and why, and what is new compared with what we wrote before.`,
    'Rules:',
    '- Use only the material above. Add no fact, name, date, cause or figure that is not in it.',
    '- Do not give counts of incidents or percentage changes; the page states those separately.',
    '- A figure from UCDP or the World Bank always names its source and its year, e.g. "4,680 battle-related deaths in 2024, according to UCDP".',
    '- Give one figure and name who reported it; never a range such as "40-41".',
    '- Write about events, not about reporting: no sentences about outlets, sources or how many reported something.',
    '- Do not speculate. Do not name the outlets in the headlines.',
    'Then write the same text in natural Norwegian (bokmål), not a word-for-word translation.',
    'If the material is too thin, reply {"en":"INSUFFICIENT","nb":"INSUFFICIENT"}.',
    'Reply with JSON only: {"en": "...", "nb": "..."}',
  ].join('\n');
}

type Reply = { text: string } | { failure: string; quota?: boolean; retryAfterMs?: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callProvider(provider: Provider, key: string, prompt: string, timeoutMs: number): Promise<Reply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        // Reasoning models spend this budget thinking before they answer; too small a budget
        // returns an empty reply rather than a short one.
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
        ...(provider.params ?? {}),
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // 404 is a retired or unknown model: no crisis will fare better with this provider, so
      // like a spent quota it moves the run on to the next one.
      const retry = Number(response.headers.get('retry-after'));
      return {
        failure: `HTTP ${response.status} ${body.slice(0, 120)}`,
        quota: [402, 403, 404, 429].includes(response.status),
        ...(response.status === 429 && Number.isFinite(retry) && retry > 0 ? { retryAfterMs: retry * 1000 } : {}),
      };
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = payload.choices?.[0]?.message?.content?.trim();
    return text ? { text } : { failure: 'empty answer' };
  } catch (error) {
    return { failure: (error as Error).name === 'AbortError' ? 'timed out' : (error as Error).message.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function parseReply(text: string): { en: string; nb: string } | undefined {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as { en?: unknown; nb?: unknown };
    if (typeof parsed.en !== 'string' || typeof parsed.nb !== 'string') return undefined;
    return { en: parsed.en.replace(/\s+/g, ' ').trim(), nb: parsed.nb.replace(/\s+/g, ' ').trim() };
  } catch {
    return undefined;
  }
}

/**
 * Runs the summaries for one build. Mutates `states` in place and returns a log line per
 * crisis attempted. Crises whose headlines have not changed, or that were tried within
 * `minHoursBetween`, are skipped: the free tiers are small and the text only needs to move
 * when the reporting does.
 */
export async function runSummaries(
  inputs: SummaryInput[],
  states: Record<string, SummaryState>,
  settings: SummarySettings,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const log: string[] = [];
  if (!settings.enabled) return ['summaries: disabled in config'];
  const providers = settings.providers.filter((p) => !!env[p.keyEnv]);
  if (providers.length === 0) return ['summaries: no provider key set; pages keep their last approved text'];
  const exhausted = new Set<string>();
  const lastCall = new Map<string, number>();

  let attempts = 0;
  for (const input of inputs) {
    if (attempts >= settings.maxPerRun) break;
    const state = (states[input.id] ??= { approved: null });
    const hash = inputHash(input);
    const since = state.attemptedAt ? (now - Date.parse(state.attemptedAt)) / 3_600_000 : Infinity;
    if (input.headlines.length < 3) continue;
    const rewrite = state.promptVersion !== PROMPT_VERSION;
    if (state.inputHash === hash && state.approved && !rewrite) continue;
    if (since < settings.minHoursBetween && !rewrite) continue;

    const prompt = promptFor(input, settings.maxWords);
    let reply: Reply | undefined;
    let provider: Provider | undefined;
    // A provider that is out of quota or no longer has the model hands over to the next one
    // for this same crisis, rather than costing the crisis its turn.
    for (provider of providers) {
      if (exhausted.has(provider.id)) continue;
      const wait = (lastCall.get(provider.id) ?? -Infinity) + (provider.minIntervalMs ?? 0) - Date.now();
      if (wait > 0) await sleep(wait);
      reply = await callProvider(provider, env[provider.keyEnv]!, prompt, settings.timeoutMs);
      lastCall.set(provider.id, Date.now());
      // A per-minute cap says how long to wait; a short wait is worth it, a long one is not.
      if ('failure' in reply && reply.retryAfterMs !== undefined && reply.retryAfterMs <= 90_000) {
        await sleep(reply.retryAfterMs);
        reply = await callProvider(provider, env[provider.keyEnv]!, prompt, settings.timeoutMs);
        lastCall.set(provider.id, Date.now());
      }
      if ('failure' in reply && reply.quota) {
        exhausted.add(provider.id);
        log.push(`summaries: ${provider.id} unavailable this run (${reply.failure})`);
        continue;
      }
      break;
    }
    if (!reply || !provider || ('failure' in reply && reply.quota)) { log.push('summaries: every provider is out of free quota this run'); break; }
    attempts += 1;
    if ('failure' in reply) {
      // A timeout or a server error: try this crisis again next run, not in three hours.
      state.lastOutcome = `${provider.id}: ${reply.failure}`;
      log.push(`${input.id}: no summary (${state.lastOutcome})`);
      continue;
    }
    // Only an answer counts as a turn: it is what the three-hour spacing protects.
    state.attemptedAt = new Date(now).toISOString();
    state.inputHash = hash;
    state.promptVersion = PROMPT_VERSION;
    const parsed = parseReply(reply.text);
    if (!parsed) { state.lastOutcome = `${provider.id}: unreadable reply`; log.push(`${input.id}: ${state.lastOutcome}`); continue; }
    const check = checkSummary(parsed.en, parsed.nb, sourceTextOf(input), settings.maxWords, input.avoid ?? []);
    if (!check.ok) { state.lastOutcome = `rejected — ${check.reason}`; log.push(`${input.id}: ${state.lastOutcome}`); continue; }

    state.approved = {
      en: parsed.en, nb: parsed.nb, model: `${provider.id}/${provider.model}`,
      writtenAt: new Date(now).toISOString(), sources: input.headlines,
    };
    state.lastOutcome = 'approved';
    log.push(`${input.id}: summary approved (${provider.id})`);
  }
  return log;
}

/** The approved text, unless it has grown too old to describe "now". */
export function currentSummary(state: SummaryState | undefined, maxAgeHours: number, now: number): Summary | null {
  const s = state?.approved;
  if (!s) return null;
  return (now - Date.parse(s.writtenAt)) / 3_600_000 <= maxAgeHours ? s : null;
}
