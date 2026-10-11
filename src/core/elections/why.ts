/**
 * One sentence per election: why it matters before it is held, and its result after. Written
 * by the same free models as the crisis summaries and held to the same guard: every figure,
 * number word and name must be in the material, which is the calendar line and the lead of
 * the election's Wikipedia article and nothing else. Elections go in batches, so a run costs
 * a handful of calls, and a sentence is written once and kept.
 */
import { createHash } from 'node:crypto';
import { checkEnglish, checkNorwegian, makeAsker, noDashes, type SummarySettings } from '../crises/summary.js';

export const WHY_PROMPT_VERSION = 1;

export interface SentenceInput { id: string; kind: 'why' | 'result'; title: string; material: string }
export interface SentenceState {
  en: string | null;
  nb: string | null;
  model?: string;
  writtenAt?: string;
  attemptedAt?: string;
  outcome?: string;
  promptVersion?: number;
  hash?: string;
}

/** Words that judge instead of report. */
const JUDGEMENT = /\b(pivotal|crucial|key test|landmark|high[- ]stakes|closely watched|critical juncture|bellwether|watershed|momentous)\b/i;

const keyOf = (i: SentenceInput) => `${i.id}:${i.kind}`;
const hashOf = (i: SentenceInput) => createHash('sha1').update(i.material).digest('hex').slice(0, 12);

function batchPrompt(items: SentenceInput[], kind: 'why' | 'result', maxWords: number, refused?: Map<string, string>): string {
  const task = kind === 'why'
    ? `For each election below, write ONE sentence (at most ${maxWords} words) for an analyst saying why it matters: what is decided or what makes it notable, as its material states.`
    : `For each election below, state its result in ONE sentence (at most ${maxWords} words) as its material states it: who won, or how the referendum went.`;
  return [
    task,
    '',
    ...items.flatMap((i) => [`### id: ${i.id}`, `Election: ${i.title}`, 'Material:', i.material, refused?.get(i.id) ? `(Your previous sentence for this id was refused: ${refused.get(i.id)}.)` : '', '']),
    'Rules:',
    '- Use only that election\'s material. Add no fact, name, date or figure that is not in it.',
    '- One sentence, no dashes (— or –), no commentary or judgement ("pivotal", "crucial", "key test", "highlighting", "underscores").',
    '- Do not speculate and do not predict.',
    kind === 'why'
      ? '- If the material does not say what is at stake, reply INSUFFICIENT for that id.'
      : '- If the material does not state a result, reply INSUFFICIENT for that id.',
    'Reply with JSON only: {"items": [{"id": "...", "en": "..."}]}',
  ].join('\n');
}

function translatePrompt(items: { id: string; en: string }[]): string {
  return [
    'Translate each sentence into Norwegian bokmål for a sober news analysis, as a Norwegian reporter would write it.',
    '- Keep every number exactly as in the English. Add nothing and leave nothing out. No dashes (— or –).',
    '- Country names in their Norwegian form (Brasil, Tsjekkia, Elfenbenskysten). "Parliamentary election" is "parlamentsvalg", "presidential election" "presidentvalg", "referendum" "folkeavstemning".',
    '- Armed groups and parties by their established Norwegian names where they exist ("den sudanske hæren (SAF)", "RSF-militsen", "houthiene").',
    '',
    ...items.map((i) => `${i.id}: ${i.en}`),
    '',
    'Reply with JSON only: {"items": [{"id": "...", "nb": "..."}]}',
  ].join('\n');
}

function parseItems(text: string, key: 'en' | 'nb'): Map<string, string> {
  const out = new Map<string, string>();
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return out;
  try {
    for (const it of (JSON.parse(json) as { items?: Record<string, unknown>[] }).items ?? []) {
      if (typeof it.id === 'string' && typeof it[key] === 'string') out.set(it.id, noDashes(String(it[key]).replace(/\s+/g, ' ').trim()));
    }
  } catch { /* an unreadable reply refuses the whole batch */ }
  return out;
}

export function checkSentence(en: string, material: string, maxWords: number): { ok: boolean; reason?: string } {
  if (/INSUFFICIENT/i.test(en)) return { ok: false, reason: 'the material is too thin' };
  if (JUDGEMENT.test(en)) return { ok: false, reason: `judgement instead of facts ("${JUDGEMENT.exec(en)![0]}")` };
  return checkEnglish(en, material, maxWords, [], [], [1, 1]);
}

/**
 * Writes what is missing. A sentence that passed is kept for good; one that was refused is
 * tried again after `retryDays`. Returns a log line per batch.
 */
export async function writeSentences(
  inputs: SentenceInput[],
  states: Record<string, SentenceState>,
  settings: SummarySettings,
  opts: { maxWords: number; batch: number; retryDays: number },
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const log: string[] = [];
  if (!settings.enabled) return ['election sentences: disabled with the summaries'];
  const { providers, ask } = makeAsker(settings, env, log);
  if (!providers.length) return ['election sentences: no provider key set; the page shows the calendar without them'];
  const due = inputs.filter((i) => {
    const s = states[keyOf(i)];
    if (s?.en && s.promptVersion === WHY_PROMPT_VERSION) return false;
    return !s?.attemptedAt || now - Date.parse(s.attemptedAt) > opts.retryDays * 86_400_000;
  });
  for (const kind of ['why', 'result'] as const) {
    const list = due.filter((i) => i.kind === kind);
    for (let k = 0; k < list.length; k += opts.batch) {
      const batch = list.slice(k, k + opts.batch);
      const first = await ask(batchPrompt(batch, kind, opts.maxWords));
      if (!first) { log.push('election sentences: every provider is out of free quota this run'); return log; }
      if ('failure' in first.reply) { log.push(`election sentences: ${first.provider.id}: ${first.reply.failure}`); continue; }
      let got = parseItems(first.reply.text, 'en');
      const refused = new Map<string, string>();
      const passed = new Map<string, string>();
      const judge = (items: SentenceInput[], answers: Map<string, string>) => {
        for (const i of items) {
          const en = answers.get(i.id);
          const check = en ? checkSentence(en, i.material, opts.maxWords) : { ok: false, reason: 'no sentence' };
          if (check.ok) { passed.set(i.id, en!); refused.delete(i.id); } else refused.set(i.id, check.reason ?? 'refused');
        }
      };
      judge(batch, got);
      // Refused once: the refused ones are asked again together, each with its reason.
      const again = batch.filter((i) => refused.has(i.id) && refused.get(i.id) !== 'the material is too thin');
      if (again.length) {
        const second = await ask(batchPrompt(again, kind, opts.maxWords, refused), first.provider);
        if (second && !('failure' in second.reply)) { got = parseItems(second.reply.text, 'en'); judge(again, got); }
      }
      // The Norwegian, translated from what passed and held to the same numbers.
      const nb = new Map<string, string>();
      if (passed.size) {
        const items = [...passed.entries()].map(([id, en]) => ({ id, en }));
        const tr = await ask(translatePrompt(items), first.provider);
        if (tr && !('failure' in tr.reply)) {
          for (const [id, text] of parseItems(tr.reply.text, 'nb')) {
            if (checkNorwegian(text, passed.get(id)!, opts.maxWords).ok) nb.set(id, text);
          }
        }
      }
      for (const i of batch) {
        const at = new Date(now).toISOString();
        const en = passed.get(i.id) ?? null;
        states[keyOf(i)] = en
          ? { en, nb: nb.get(i.id) ?? null, model: `${first.provider.id}/${first.provider.model}`, writtenAt: at, attemptedAt: at, outcome: nb.has(i.id) ? 'approved' : 'approved, English only', promptVersion: WHY_PROMPT_VERSION, hash: hashOf(i) }
          : { en: null, nb: null, attemptedAt: at, outcome: `refused: ${refused.get(i.id) ?? 'no sentence'}`, promptVersion: WHY_PROMPT_VERSION, hash: hashOf(i) };
      }
      log.push(`election sentences (${kind}): ${passed.size} of ${batch.length} approved${refused.size ? `; refused ${[...refused.entries()].map(([id, r]) => `${id} (${r})`).join(', ')}` : ''}`);
    }
  }
  return log;
}

export function sentenceFor(states: Record<string, SentenceState>, id: string, kind: 'why' | 'result'): { en: string; nb: string | null } | null {
  const s = states[`${id}:${kind}`];
  return s?.en ? { en: s.en, nb: s.nb } : null;
}
