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

export interface Provider { id: string; url: string; model: string; keyEnv: string }
export interface SummarySettings {
  enabled: boolean;
  minHoursBetween: number;
  maxAgeHours: number;
  maxPerRun: number;
  maxWords: number;
  timeoutMs: number;
  providers: Provider[];
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
  inputHash?: string;
  attemptedAt?: string;
  lastOutcome?: string;
}

export interface SummaryInput {
  id: string;
  name: string;
  facts: string[];
  headlines: { title: string; url: string; publisher: string }[];
  background?: string;
}

/** Norwegian writes 1 200 and 4,5; the guard compares digits, so thousands spaces are closed up. */
export function normaliseNumbers(text: string): string {
  return text.replace(/(\d)[   ](?=\d{3}\b)/g, '$1');
}

export function sourceTextOf(input: SummaryInput): string {
  return [
    ...input.facts,
    ...input.headlines.map((h) => `${h.publisher}: ${h.title}`),
    input.background ?? '',
  ].join('\n');
}

export function inputHash(input: SummaryInput): string {
  return createHash('sha1').update(input.headlines.map((h) => h.url).sort().join('\n')).digest('hex').slice(0, 16);
}

function sentences(text: string): number {
  return text.split(/(?<=[.!?…])\s+(?=[\p{Lu}«“"])/u).filter((s) => s.trim().length > 0).length;
}

/** The whole gate, both languages: the guard's figures rule, then length and shape. */
export function checkSummary(en: string, nb: string, sourceText: string, maxWords: number): { ok: boolean; reason?: string } {
  const source = normaliseNumbers(sourceText);
  for (const [lang, text] of [['en', en], ['nb', nb]] as const) {
    const guard = guardDraft(normaliseNumbers(text), source, maxWords);
    if (!guard.ok) return { ok: false, reason: `${lang}: ${guard.reason}` };
    const n = sentences(text);
    if (n < 2 || n > 6) return { ok: false, reason: `${lang}: ${n} sentences` };
    if (/INSUFFICIENT|as an ai|language model/i.test(text)) return { ok: false, reason: `${lang}: not a summary` };
  }
  return { ok: true };
}

function promptFor(input: SummaryInput, maxWords: number): string {
  return [
    `Crisis: ${input.name}`,
    '',
    'Counts from the incident monitor:',
    ...input.facts.map((f) => `- ${f}`),
    '',
    'Headlines from the past few days, each with its outlet:',
    ...input.headlines.map((h) => `- ${h.publisher}: ${h.title}`),
    ...(input.background ? ['', 'Background (Wikipedia):', input.background.slice(0, 1200)] : []),
    '',
    `Write 3 to 5 sentences (at most ${maxWords} words) on what is happening in this crisis now, using only the material above.`,
    'Add no fact, name, date, cause or figure that is not in it. Use a figure only if it appears above, written the same way. Do not speculate and do not name outlets.',
    'Then write the same text in Norwegian (bokmål).',
    'If the material is too thin, reply {"en":"INSUFFICIENT","nb":"INSUFFICIENT"}.',
    'Reply with JSON only: {"en": "...", "nb": "..."}',
  ].join('\n');
}

type Reply = { text: string } | { failure: string; quota?: boolean };

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
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { failure: `HTTP ${response.status} ${body.slice(0, 120)}`, quota: response.status === 429 || response.status === 402 || response.status === 403 };
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

  let attempts = 0;
  for (const input of inputs) {
    if (attempts >= settings.maxPerRun) break;
    const state = (states[input.id] ??= { approved: null });
    const hash = inputHash(input);
    const since = state.attemptedAt ? (now - Date.parse(state.attemptedAt)) / 3_600_000 : Infinity;
    if (input.headlines.length < 3) continue;
    if (state.inputHash === hash && state.approved) continue;
    if (since < settings.minHoursBetween) continue;

    const provider = providers.find((p) => !exhausted.has(p.id));
    if (!provider) { log.push('summaries: every provider is out of free quota this run'); break; }
    attempts += 1;
    state.attemptedAt = new Date(now).toISOString();
    state.inputHash = hash;

    const reply = await callProvider(provider, env[provider.keyEnv]!, promptFor(input, settings.maxWords), settings.timeoutMs);
    if ('failure' in reply) {
      if (reply.quota) exhausted.add(provider.id);
      state.lastOutcome = `${provider.id}: ${reply.failure}`;
      log.push(`${input.id}: no summary (${state.lastOutcome})`);
      continue;
    }
    const parsed = parseReply(reply.text);
    if (!parsed) { state.lastOutcome = `${provider.id}: unreadable reply`; log.push(`${input.id}: ${state.lastOutcome}`); continue; }
    const check = checkSummary(parsed.en, parsed.nb, sourceTextOf(input), settings.maxWords);
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
