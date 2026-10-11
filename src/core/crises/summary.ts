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
  /** An approved text is rewritten only when this many new sources have come in since it… */
  minNewSources: number;
  /** …or when it is this many hours old. */
  rewriteAfterHours: number;
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
  /** Null when the Norwegian step failed or was refused: the page then shows the English. */
  nb: string | null;
  model: string;
  writtenAt: string;
  sources: { title: string; url: string; publisher: string }[];
  /** Which brief to the model it was written under; text from an older brief is not shown. */
  promptVersion?: number;
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
  /** Names that belong to a neighbouring crisis, not this one (Sudan is not South Sudan). */
  notAbout?: string[];
}

/** Bumped when the brief to the model changes, so every crisis is rewritten once. */
export const PROMPT_VERSION = 6;

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

/* ---------- numbers written as words ---------------------------------- */

type NumberMention = { kind: 'exact'; value: number; word: string } | { kind: 'range'; min: number; max: number; family: string; word: string };

const EXACT_EN: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const EXACT_NB: Record<string, number> = {
  to: 2, tre: 3, fire: 4, fem: 5, seks: 6, sju: 7, syv: 7, åtte: 8, ni: 9, ti: 10, elleve: 11, tolv: 12,
  tretten: 13, fjorten: 14, femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19, tjue: 20,
  tretti: 30, førti: 40, femti: 50, seksti: 60, sytti: 70, åtti: 80, nitti: 90,
};
/** Vague quantities, longest first, each with the range of figures it stands for. */
const VAGUE: [RegExp, number, number, string][] = [
  [/\bhundreds of thousands\b|\bhundretusenvis\b/gi, 200_000, 999_999, 'hundreds-of-thousands'],
  [/\btens of thousands\b|\btitusenvis\b/gi, 20_000, 99_999, 'tens-of-thousands'],
  [/\bthousands\b|\btusenvis\b/gi, 2_000, 9_999_999, 'thousands'],
  [/\bhundreds\b|\bhundrevis\b/gi, 200, 999, 'hundreds'],
  [/\bdozens\b|\bdusinvis\b|\btitalls\b/gi, 24, 99, 'dozens'],
];

/**
 * No dashes in any language: a pair around an aside becomes commas, a single one a comma, and
 * a span of years keeps a plain hyphen.
 */
export function noDashes(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
    .replace(/\s*[–—]\s*([^–—]{1,120}?)\s*[–—]\s*/g, ', $1, ')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/,\s*([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Every quantity a text states in words; "a dozen" and "et dusin" are twelve. */
export function numberWords(text: string, lang: 'en' | 'nb'): NumberMention[] {
  let rest = text.toLowerCase();
  const out: NumberMention[] = [];
  for (const [re, min, max, family] of VAGUE) {
    rest = rest.replace(re, (word) => { out.push({ kind: 'range', min, max, family, word }); return ' '; });
  }
  rest = rest.replace(/\b(a|one|et|ett) (dozen|dusin)\b/g, (word) => { out.push({ kind: 'exact', value: 12, word }); return ' '; });
  const table = lang === 'en' ? EXACT_EN : EXACT_NB;
  for (const m of rest.matchAll(/[\p{L}]+(?:-[\p{L}]+)?/gu)) {
    const w = m[0];
    // "twenty-five", "thirty-two"
    const [tens, unit] = w.split('-');
    if (unit && table[tens!] && table[unit] && table[unit]! < 10) out.push({ kind: 'exact', value: table[tens!]! + table[unit]!, word: w });
    else if (table[w] !== undefined) out.push({ kind: 'exact', value: table[w]!, word: w });
  }
  return out;
}

function digitsIn(text: string): number[] {
  return [...normaliseNumbers(text).matchAll(/\d[\d.,]*/g)]
    .map((m) => Number(m[0].replace(/[.,]+$/, '').replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

/** A number written as a word must be in the sources, as a word or as a figure of that size. */
function wordsSupported(text: string, sourceText: string): { ok: boolean; reason?: string } {
  const figures = digitsIn(sourceText);
  const sourceWords = [...numberWords(sourceText, 'en'), ...numberWords(sourceText, 'nb')];
  for (const m of numberWords(text, 'en')) {
    const ok = m.kind === 'exact'
      ? figures.includes(m.value) || sourceWords.some((w) => w.kind === 'exact' && w.value === m.value)
      : figures.some((n) => n >= m.min && n <= m.max)
        || sourceWords.some((w) => (w.kind === 'range' && w.family === m.family) || (w.kind === 'exact' && w.value >= m.min && w.value <= m.max));
    if (!ok) return { ok: false, reason: `"${m.word}" is not in the sources` };
  }
  return { ok: true };
}

/** What a text says in numbers, as a comparable set: figures, exact words, vague quantities. */
function numberSignature(text: string, lang: 'en' | 'nb'): string[] {
  const sig = new Set<string>(digitsIn(text).map((n) => `n:${n}`));
  for (const m of numberWords(text, lang)) sig.add(m.kind === 'exact' ? `n:${m.value}` : `r:${m.family}`);
  return [...sig].sort();
}

/** The status line's own figures, when they appear as counts of incidents, per week, or as a percentage. */
function repeatsStatus(text: string, avoid: number[]): number | undefined {
  const plain = normaliseNumbers(text).replace(/(\d),(?=\d{3}\b)/g, '$1');
  return avoid.find((v) => v >= 2 && (
    new RegExp(`\\b${v}\\s?(%|percent|per cent|prosent)`, 'i').test(plain)
    || new RegExp(`\\b${v}\\b(?:\\s+\\S+){0,3}?\\s+(incidents?|hendelser?|weeks?|uke[nr]?)\\b`, 'i').test(plain)
    || new RegExp(`\\b(incidents?|hendelser?)\\b(?:\\s+\\S+){0,3}?\\s+${v}\\b`, 'i').test(plain)));
}

const METHOD = /\b(outlets?|medier|several sources|multiple sources|flere kilder|reported by|meldt av|incident monitor|hendelsesmonitor)\b/i;

/** Commentary instead of facts: the summary reports, it does not interpret or narrate itself. */
const COMMENTARY = /\b(highlight(s|ing|ed)?|underscor(e|es|ing|ed)|marks? a new phase|adds? a new dimension|since the (last|previous) (briefing|summary|update)|these developments|this development|signal(s|ling)? a|reflect(s|ing) a|represent(s|ing)? a|fremhever|understreker|siden forrige (orientering|oppdatering)|disse utviklingene|markerer en ny fase|tilfører en ny dimensjon)\b/i;

/** "Killed or injured" about a named person: say which, as the sources do, or leave them out. */
const VAGUE_FATE = /\b(killed or (injured|wounded)|(injured|wounded) or killed|drept eller såret|såret eller drept)\b/i;

/** Ordinary words that open sentences in a conflict summary. */
const STARTERS = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'after', 'before', 'as', 'while', 'meanwhile', 'this', 'these', 'those',
  'that', 'it', 'its', 'they', 'their', 'he', 'she', 'his', 'her', 'we', 'recent', 'fighting', 'clashes', 'violence', 'armed', 'rebels',
  'government', 'forces', 'troops', 'officials', 'authorities', 'attacks', 'air', 'drone', 'drones', 'military', 'humanitarian', 'aid',
  'talks', 'tensions', 'protests', 'several', 'many', 'dozens', 'hundreds', 'thousands', 'over', 'more', 'most', 'some', 'both',
  'another', 'other', 'elsewhere', 'separately', 'also', 'since', 'despite', 'following', 'according', 'across', 'near', 'during',
  'with', 'without', 'civilians', 'residents', 'people', 'shelling', 'strikes', 'airstrikes', 'militants', 'insurgents', 'security',
  'police', 'gunmen', 'there', 'former', 'earlier', 'later', 'last', 'latest', 'first', 'second', 'overall', 'further',
  'additionally', 'however', 'yet', 'still', 'nearly', 'almost', 'roughly', 'about', 'around', 'regional', 'foreign', 'western',
  'eastern', 'northern', 'southern', 'central', 'defense', 'defence', 'officials', 'witnesses', 'analysts', 'observers', 'critics', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'twelve', 'one', 'at', 'by',
  'from', 'for', 'to', 'of', 'no', 'not', 'all', 'each', 'new', 'heavy', 'deadly', 'renewed', 'state', 'local', 'international']);

const NOT_NAMES = new Set(['UCDP', 'UN', 'US', 'USA', 'EU', 'UK', 'World', 'Bank',
  // Generic institutional words, capitalised in titles but not themselves names.
  'Defense', 'Defence', 'Ministry', 'Minister', 'Prime', 'President', 'Army', 'Navy', 'Air', 'Force', 'Forces', 'Council',
  'Security', 'Court', 'Parliament', 'Government', 'General', 'Interior', 'Foreign', 'Affairs', 'Office', 'Commission', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

/**
 * Every name in the English text — a capitalised word inside a sentence, or a run of them —
 * must be in the material: a model that joins two stories puts a name where it does not
 * belong. Forms of the same word ("Ethiopia", "Ethiopian") count as the same name.
 */
/** Common organisations a summary may always name, in either language. */
const KNOWN_ORGS = new Set([
  'un', 'united nations', 'fn', 'de forente nasjoner', 'eu', 'european union', 'den europeiske union',
  'african union', 'den afrikanske union', 'au', 'nato', 'icrc', 'international committee of the red cross',
  'red cross', 'røde kors', 'unhcr', 'wfp', 'world food programme', 'ocha', 'un security council',
].map((x) => x.toLowerCase()));

export function namesSupported(text: string, sourceText: string): { ok: boolean; reason?: string } {
  const source = sourceText.toLowerCase();
  const sourceWords = new Set(source.match(/[\p{L}]+/gu) ?? []);
  const stem = (w: string) => w.toLowerCase().slice(0, Math.min(6, w.length));
  // "United Nations" is the UN the headlines name.
  const un = /\bUN\b|united nations/i.test(sourceText);
  const known = (w: string) => (un && /^(United|Nations)$/.test(w)) || source.includes(w.toLowerCase())
    || [...sourceWords].some((sw) => sw.length >= 4 && w.length >= 4 && (stem(sw) === stem(w)
      // A people named from its country: Iraqis from Iraq, Sudanese from Sudan.
      || (w.toLowerCase().startsWith(sw) && /^(?:i|is|ese|ian|ians|an|ans|i?s)$/.test(w.toLowerCase().slice(sw.length)))));
  const clean = (raw: string) => raw.replace(/['’]s$/, '').replace(/[.'’-]+$/, '');
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = (sentence.match(/[\p{L}][\p{L}'’.-]*/gu) ?? []).map(clean);
    // A name is a whole run of capitalised words ("African Union", "Democratic Republic of the
    // Congo"), checked as one: a run is fine if it is in the sources as written, is a common
    // organisation, or every word of it is in the sources.
    for (let i = 0; i < words.length; i++) {
      if (!/^\p{Lu}/u.test(words[i]!) || NOT_NAMES.has(words[i]!)) continue;
      let j = i + 1;
      while (j < words.length && (/^\p{Lu}/u.test(words[j]!) || (/^(of|the|and|de|al)$/.test(words[j]!) && /^\p{Lu}/u.test(words[j + 1] ?? '')))) j++;
      let run = words.slice(i, j);
      const start = i;
      i = j - 1;
      // "The African Union" is the name "African Union".
      if (run.length > 1 && /^(The|A|An|Den|Det|De)$/.test(run[0]!)) run = run.slice(1);
      const name = run.join(' ');
      // The first word of a sentence is capitalised anyway: alone, it is taken for a name only
      // when it is not an ordinary English word.
      if (start === 0 && run.length === 1 && (STARTERS.has(name.toLowerCase()) || /(ing|ed|ion|ions|ers|ies|ly|ment|ments|ity|ness|ence|ance|al|es)$/i.test(name))) continue;
      if (KNOWN_ORGS.has(name.toLowerCase()) || source.includes(name.toLowerCase())) continue;
      const parts = run.filter((w) => /^\p{Lu}/u.test(w) && !NOT_NAMES.has(w));
      if (parts.every(known)) continue;
      throw new Error(name);
    }
  }
  return { ok: true };
}

/** The English text: every figure and every number in words from the sources, and the house rules. */
export function checkEnglish(en: string, sourceText: string, maxWords: number, avoid: number[] = [], notAbout: string[] = []): { ok: boolean; reason?: string } {
  const offTopic = notAbout.find((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(en));
  if (offTopic) return { ok: false, reason: `about ${offTopic}, a neighbouring crisis` };
  const source = normaliseNumbers(sourceText);
  const plain = normaliseNumbers(en);
  const guard = guardDraft(plain, source, maxWords);
  if (!guard.ok) return guard;
  const words = wordsSupported(en, sourceText);
  if (!words.ok) return words;
  try { namesSupported(en, sourceText); } catch (name) { return { ok: false, reason: `the name "${(name as Error).message}" is not in the sources` }; }
  if (VAGUE_FATE.test(en)) return { ok: false, reason: '"killed or injured": say which' };
  if (COMMENTARY.test(en)) return { ok: false, reason: `commentary instead of facts ("${COMMENTARY.exec(en)![0]}")` };
  const n = sentences(en);
  if (n < 2 || n > 6) return { ok: false, reason: `${n} sentences` };
  if (/INSUFFICIENT|as an ai|language model/i.test(en)) return { ok: false, reason: 'not a summary' };
  const repeated = repeatsStatus(en, avoid);
  if (repeated !== undefined) return { ok: false, reason: `repeats the status line's figure ${repeated}` };
  // One figure with its source, never a span like "40-41"; a span of years is fine.
  const span = /\b(\d{1,3}(?:[.,]\d+)?)\s?[-–]\s?(\d{1,3}(?:[.,]\d+)?)\b(?!\s?(?:km|kilomet))/.exec(plain);
  if (span) return { ok: false, reason: `a range of figures (${span[0]})` };
  if (METHOD.test(en)) return { ok: false, reason: 'talks about method, not events' };
  for (const sentence of en.split(/(?<=[.!?])\s+/)) {
    if (/UCDP|World Bank/i.test(sentence) && /\d/.test(sentence) && !/\b(19|20)\d{2}\b/.test(sentence)) {
      return { ok: false, reason: 'a UCDP or World Bank figure without its year' };
    }
  }
  return { ok: true };
}

/** The Norwegian text: exactly the English text's numbers, and the same house rules. */
export function checkNorwegian(nb: string, en: string, maxWords: number): { ok: boolean; reason?: string } {
  if (!nb.trim() || /INSUFFICIENT/i.test(nb)) return { ok: false, reason: 'empty' };
  if (nb.split(/\s+/).length > maxWords * 1.5) return { ok: false, reason: 'too long' };
  if (/https?:\/\/|www\./i.test(nb)) return { ok: false, reason: 'contains a link' };
  const a = numberSignature(en, 'en').join(' ');
  const b = numberSignature(nb, 'nb').join(' ');
  if (a !== b) return { ok: false, reason: `numbers differ from the English (${b || 'none'} vs ${a || 'none'})` };
  if (METHOD.test(nb)) return { ok: false, reason: 'talks about method, not events' };
  if (VAGUE_FATE.test(nb)) return { ok: false, reason: '"drept eller såret": say which' };
  if (COMMENTARY.test(nb)) return { ok: false, reason: `commentary instead of facts ("${COMMENTARY.exec(nb)![0]}")` };
  const stiff = STIFF_NB.exec(nb);
  if (stiff) return { ok: false, reason: `stiff Norwegian ("${stiff[0]}"), write it as a Norwegian reporter would` };
  return { ok: true };
}

/** Translated-sounding Norwegian the examples in the prompt already rule out. */
const STIFF_NB = /\bproxy[\s\S]?aggres+jon|\bkamprelatert\w* handling\w*|\blanserte \w*angrep|\blovet (?:et stort svar|en stor respons)|\binterkommunal\w*|\bfordrivelsesleir\w*|\bintensifisert\b/i;

/** Both languages, for callers that have both at once. */
export function checkSummary(
  en: string, nb: string, sourceText: string, maxWords: number, avoid: number[] = [],
): { ok: boolean; reason?: string } {
  const e = checkEnglish(en, sourceText, maxWords, avoid);
  if (!e.ok) return { ok: false, reason: `en: ${e.reason}` };
  const n = checkNorwegian(nb, en, maxWords);
  if (!n.ok) return { ok: false, reason: `nb: ${n.reason}` };
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
    ...(input.background ? ['', 'Background (Wikipedia):', input.background] : []),
    '',
    `Write 3 to 5 sentences (at most ${maxWords} words) for an analyst: what is happening in this crisis now, where, and why, and what is new compared with what we wrote before.`,
    'Rules:',
    '- Use only the material above. Add no fact, name, date, cause or figure that is not in it.',
    '- Do not give counts of incidents or percentage changes; the page states those separately.',
    '- A figure from UCDP or the World Bank always names its source and its year, e.g. "4,680 battle-related deaths in 2024, according to UCDP".',
    '- Give one figure and name who reported it; never a range such as "40-41".',
    '- Write about events, not about reporting: no sentences about outlets, sources or how many reported something.',
    '- Make clear who did what to whom: name the attacker and the attacked, as the headlines do.',
    '- A named person: say exactly whether they were killed or wounded, as the headlines say. Never "killed or injured" about a named person; if the headlines disagree or are unclear, leave the person out.',
    '- Stay with this crisis. Events in a neighbouring country belong only if the headlines tie them directly to this crisis.',
    '- No dashes (— or –): use a comma or a full stop.',
    '- No commentary or interpretation: no "highlighting", "underscores", "marks a new phase", "adds a new dimension", "these developments", "since the last briefing". The last sentence states a fact.',
    '- Do not speculate. Do not name the outlets in the headlines.',
    'If the material is too thin, reply {"en":"INSUFFICIENT"}.',
    'Reply with JSON only: {"en": "..."}',
  ].join('\n');
}

/**
 * The Norwegian is translated from the approved English in a call of its own, so the model
 * can give the language its full attention and the guard can check it against one text.
 */
function translationPrompt(en: string): string {
  return [
    'Translate this English text into Norwegian bokmål for a sober news analysis.',
    '',
    en,
    '',
    'Rules:',
    '- Translate; do not interpret. Add nothing, change no meaning, and keep the same subject and object in every sentence: who did what to whom stays exactly as in the English.',
    '- Natural, plain Norwegian as a Norwegian newspaper would write it; no anglicisms and no word-for-word renderings. For example:',
    '  "droneangrep", not "dronstrike"; "glidebomber", not "glide-bombe";',
    '  "grensen mot Etiopia", not "Etiopi-grensen"; "drepte i kamper", not "dødsfall i kamprelaterte handlinger";',
    '  "vold mellom folkegrupper", not "interkommunal vold"; "fordrevne" and "leirer for internt fordrevne", not "fordrivelsesleirer";',
    '  "skjøt missiler mot", not "lanserte missilangrep"; "kamper", not "kamprelaterte handlinger";',
    '  "angrep gjennom stedfortredere", not "proxy-aggresjon"; "varslet gjengjeldelse", not "lovet et stort svar".',
    '- No dashes (— or –): use a comma or a full stop.',
    '- Use the established Norwegian form of place names where one exists (Jemen, Etiopia, Zaporizjzja, Kharkiv, Gaza, Khartoum, Darfur, Kordofan).',
    '- Keep every number exactly as in the English: the same figures, and a number written as a word stays a word. Write thousands with a space (75 767).',
    '- Add nothing and leave nothing out.',
    'Reply with JSON only: {"nb": "..."}',
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
      // The whole message, and when the provider says the limit resets, so the log answers
      // "until when" without a second look.
      const resets = ['retry-after', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']
        .map((h) => (response.headers.get(h) ? `${h}: ${response.headers.get(h)}` : ''))
        .filter(Boolean).join(', ');
      return {
        failure: `HTTP ${response.status} ${body.replace(/\s+/g, ' ').trim()}${resets ? ` (${resets})` : ''}`,
        quota: [402, 403, 404, 429].includes(response.status) || /quota|rate limit|resource_exhausted/i.test(body),
        ...(response.status === 429 && Number.isFinite(retry) && retry > 0 ? { retryAfterMs: retry * 1000 } : {}),
      };
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = payload.choices?.[0]?.message?.content?.trim();
    return text ? { text } : { failure: 'empty answer' };
  } catch (error) {
    return { failure: (error as Error).name === 'AbortError' ? 'timed out' : (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

function parseReply(text: string, key: 'en' | 'nb'): string | undefined {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return undefined;
  try {
    const value = (JSON.parse(json) as Record<string, unknown>)[key];
    return typeof value === 'string' ? noDashes(value.replace(/\s+/g, ' ').trim()) : undefined;
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

  /**
   * One question to the first provider still available. A provider that is out of quota or
   * no longer has the model hands over to the next; a short per-minute limit is waited out.
   */
  async function ask(prompt: string, prefer?: Provider): Promise<{ reply: Reply; provider: Provider } | undefined> {
    const order = prefer ? [prefer, ...providers.filter((p) => p !== prefer)] : providers;
    for (const provider of order) {
      if (exhausted.has(provider.id)) continue;
      const wait = (lastCall.get(provider.id) ?? -Infinity) + (provider.minIntervalMs ?? 0) - Date.now();
      if (wait > 0) await sleep(wait);
      let reply = await callProvider(provider, env[provider.keyEnv]!, prompt, settings.timeoutMs);
      lastCall.set(provider.id, Date.now());
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
      return { reply, provider };
    }
    return undefined;
  }

  let attempts = 0;
  for (const input of inputs) {
    if (attempts >= settings.maxPerRun) break;
    const state = (states[input.id] ??= { approved: null });
    const hash = inputHash(input);
    const since = state.attemptedAt ? (now - Date.parse(state.attemptedAt)) / 3_600_000 : Infinity;
    if (input.headlines.length < 3) continue;
    const rewrite = state.promptVersion !== PROMPT_VERSION;
    const current = state.approved?.promptVersion === PROMPT_VERSION ? state.approved : null;
    if (current) {
      // Approved under the current brief: rewritten only when the reporting has moved on by
      // enough new sources, or the text has grown old. That is where the free quota goes.
      const had = new Set((current.sources ?? []).map((s) => s.url));
      const fresh = input.headlines.filter((h) => !had.has(h.url)).length;
      const age = (now - Date.parse(current.writtenAt)) / 3_600_000;
      if (fresh < settings.minNewSources && age <= settings.rewriteAfterHours) continue;
      if (since < settings.minHoursBetween) continue;
    } else if (since < settings.minHoursBetween && !rewrite) continue;

    // 1. The English, from the sources; refused once, it is asked for again with the reason.
    const first = await ask(promptFor(input, settings.maxWords));
    if (!first) { log.push('summaries: every provider is out of free quota this run'); break; }
    attempts += 1;
    const { reply, provider } = first;
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
    let en = parseReply(reply.text, 'en');
    let check = en ? checkEnglish(en, sourceTextOf(input), settings.maxWords, input.avoid ?? [], input.notAbout ?? []) : { ok: false, reason: 'unreadable reply' };
    if (!check.ok) {
      const again = await ask(`${promptFor(input, settings.maxWords)}\n\nYour previous draft was refused: ${check.reason}. Write it again, keeping every rule above.`, provider);
      if (again && !('failure' in again.reply)) {
        en = parseReply(again.reply.text, 'en');
        check = en ? checkEnglish(en, sourceTextOf(input), settings.maxWords, input.avoid ?? [], input.notAbout ?? []) : { ok: false, reason: 'unreadable reply' };
      }
    }
    if (!en || !check.ok) { state.lastOutcome = `rejected — en: ${check.reason}`; log.push(`${input.id}: ${state.lastOutcome}`); continue; }

    // 2. The Norwegian, translated from the approved English and held to the same numbers.
    let nb: string | null = null;
    const second = await ask(translationPrompt(en), provider);
    if (second && !('failure' in second.reply)) {
      let text = parseReply(second.reply.text, 'nb');
      let nbCheck = text ? checkNorwegian(text, en, settings.maxWords) : { ok: false, reason: 'unreadable reply' };
      if (!nbCheck.ok) {
        // Refused once: asked again with the reason, then given up.
        const again = await ask(`${translationPrompt(en)}\n\nYour previous translation was refused: ${nbCheck.reason}. Translate it again, keeping every rule above.`, provider);
        if (again && !('failure' in again.reply)) {
          text = parseReply(again.reply.text, 'nb');
          nbCheck = text ? checkNorwegian(text, en, settings.maxWords) : { ok: false, reason: 'unreadable reply' };
        }
      }
      if (text && nbCheck.ok) nb = text;
      else log.push(`${input.id}: Norwegian refused (${nbCheck.reason}); the English stands alone`);
    } else {
      log.push(`${input.id}: Norwegian not written (${second && 'failure' in second.reply ? second.reply.failure : 'no provider'}); the English stands alone`);
    }

    state.approved = {
      en, nb, model: `${provider.id}/${provider.model}`,
      writtenAt: new Date(now).toISOString(), sources: input.headlines, promptVersion: PROMPT_VERSION,
    };
    state.lastOutcome = nb ? 'approved' : 'approved, English only';
    log.push(`${input.id}: summary ${state.lastOutcome} (${provider.id})`);
  }
  return log;
}

/** The approved text, unless it has grown too old to describe "now". */
export function currentSummary(state: SummaryState | undefined, maxAgeHours: number, now: number): Summary | null {
  const s = state?.approved;
  if (!s) return null;
  // Text written to an older brief is not shown once the current brief has had its turn:
  // a refusal under the new rules means the old text broke them too.
  if (state?.promptVersion === PROMPT_VERSION && s.promptVersion !== PROMPT_VERSION) return null;
  return (now - Date.parse(s.writtenAt)) / 3_600_000 <= maxAgeHours ? s : null;
}
