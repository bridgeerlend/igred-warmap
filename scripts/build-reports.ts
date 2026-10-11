/**
 * Reports for igred.org: the half-year report and the analysis, written in Decap CMS as
 * Markdown in www/content/reports/ and built here into www/reports/:
 *
 *   www/reports/index.html               the list, half-year reports first and larger
 *   www/reports/<slug>/index.html        one page per report, written for reading
 *   www/reports/<slug>/igred-<slug>.pdf  the same page printed to A4 (with --pdf)
 *
 * The building blocks are fenced in the Markdown as `::: name` … `:::` with YAML inside, the
 * form Decap's editor components write. Charts and small maps are drawn from the map's own
 * data in data/. The map keeps only a rolling window of days, so the figures a published
 * report shows are frozen: www/content/reports/frozen/<slug>.json keeps what each block
 * showed when it was first built, and is used ever after. `--freeze` writes the missing
 * entries; the Freeze reports workflow runs it after a report is published.
 *
 * Run: npx tsx scripts/build-reports.ts [--pdf] [--freeze]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import yaml from 'js-yaml';
import { marked } from 'marked';
import { toView } from '../www/projection.js';
import { repoRoot } from '../src/core/util/paths.js';

const WWW = path.join(repoRoot, 'www');
const CONTENT = path.join(WWW, 'content', 'reports');
const FROZEN = path.join(CONTENT, 'frozen');
const OUT = path.join(WWW, 'reports');
const SITE = 'https://igred.org';
const PDF = process.argv.includes('--pdf');
const FREEZE = process.argv.includes('--freeze');
const DAY = 86_400_000;

/* ---------- content -------------------------------------------------------- */

type Lang = 'nb' | 'en';
type Likelihood = 'very-unlikely' | 'unlikely' | 'even' | 'likely' | 'very-likely';
interface Source { author?: string; title: string; publisher?: string; date?: string; url?: string }
interface Risk { risk: string; likelihood: number; consequence: number; previous?: number | null; note?: string }
interface Region { name: string; happened?: string; drivers?: string; next?: string; watch?: string[] }
interface Report {
  slug: string;
  type: 'halvar' | 'analyse';
  title: string;
  period?: string;
  date: string;
  version: string;
  authors: string[];
  lang: Lang;
  ingress: string;
  // half-year report
  assessments?: { text: string; likelihood: Likelihood }[];
  risks?: Risk[];
  regions?: Region[];
  economy?: string;
  essay?: { title: string; body: string };
  misses?: string;
  method?: string;
  // analysis
  body?: string;
  sources?: Source[];
}

const load = (src: string) => yaml.load(src, { schema: yaml.CORE_SCHEMA }) as Record<string, unknown>;

function readReports(): Report[] {
  if (!existsSync(CONTENT)) return [];
  return readdirSync(CONTENT)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = readFileSync(path.join(CONTENT, file), 'utf-8');
      const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
      if (!m) throw new Error(`${file}: no front matter`);
      const front = load(m[1]!) as unknown as Report;
      const slug = file.replace(/\.md$/, '');
      return {
        ...front,
        slug,
        date: String(front.date).slice(0, 10),
        version: String(front.version ?? '1.0'),
        authors: front.authors ?? [],
        lang: front.lang === 'en' ? 'en' : 'nb',
        body: front.body ?? m[2]!.trim(),
      } as Report;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

const register = (load(readFileSync(path.join(WWW, 'content', 'risk-register.yml'), 'utf-8')) as {
  risks: { id: string; nb: string; en: string }[];
}).risks;

/* ---------- words ----------------------------------------------------------- */

const LIKELIHOOD: Likelihood[] = ['very-unlikely', 'unlikely', 'even', 'likely', 'very-likely'];

const T = {
  nb: {
    halvar: 'Halvårsrapport', analyse: 'Analyse', reports: 'Rapporter', map: 'Kart', brief: 'Brief', methodNav: 'Metode',
    light: 'Lys', dark: 'Mørk', version: 'Versjon', by: 'Av', and: 'og', pdf: 'Last ned PDF',
    cite: 'Slik siterer du', contents: 'Innhold', assessments: 'Hovedvurderinger', risks: 'Risikoregister',
    regions: 'Regioner', economy: 'Økonomisk utvikling', essay: 'Temaessay', misses: 'Hva vi bommet på',
    method: 'Metode og kilder', sources: 'Kilder', notes: 'Fotnoter', happened: 'Hva skjedde',
    drivers: 'Drivere', next: 'Neste seks måneder', watch: 'Hva man bør følge med på', risk: 'Risiko',
    likelihood: 'Sannsynlighet', consequence: 'Konsekvens', score: 'Score', change: 'Endring',
    isNew: 'Ny', same: 'Uendret', upFrom: 'opp fra', downFrom: 'ned fra', of25: 'av 25',
    words: { 'very-unlikely': 'Svært usannsynlig', unlikely: 'Usannsynlig', even: 'Like sannsynlig', likely: 'Sannsynlig', 'very-likely': 'Svært sannsynlig' },
    ranges: { 'very-unlikely': 'under 10 %', unlikely: '10-35 %', even: '35-55 %', likely: '55-80 %', 'very-likely': 'over 80 %' },
    wordsNote: 'Sannsynlighetsordene har faste betydninger: svært usannsynlig, under 10 %; usannsynlig, 10-35 %; like sannsynlig, 35-55 %; sannsynlig, 55-80 %; svært sannsynlig, over 80 %.',
    scaleNote: 'Sannsynlighet og konsekvens er vurdert på en skala fra 1 til 5. Score er produktet av de to, høyst 25. Endringen er målt mot forrige halvårsrapport.',
    eventsWeek: 'Væpnede hendelser per uke', weekOf: 'uke fra', to: 'til', wholeWeeks: 'hele uker fra',
    chartSource: 'Kilde: nyhetsstrømmen GDELT, slik IGRED-kartet teller den (map.igred.org). Hver hendelse er meldt av minst ett medium.',
    seriesStarts: (d: string) => `Kartets dataserie begynner ${d}.`,
    mapSource: 'Hendelser meldt i nyhetsstrømmen GDELT. Fylt merke: to eller flere uavhengige medier. Hult merke: én kilde. Grenser: Natural Earth.',
    noEvents: 'Kartets arkiv har ingen hendelser for denne perioden.',
    list: 'Halvårsrapporter og analyser fra IGRED. Hver rapport kan leses her og lastes ned som PDF.',
    halvarPlural: 'Halvårsrapporter', analysePlural: 'Analyser', none: 'Ingen ennå.',
    page: 'Side', placeholder: 'IGRED',
    months: ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'],
  },
  en: {
    halvar: 'Half-year report', analyse: 'Analysis', reports: 'Reports', map: 'Map', brief: 'Brief', methodNav: 'Method',
    light: 'Light', dark: 'Dark', version: 'Version', by: 'By', and: 'and', pdf: 'Download PDF',
    cite: 'How to cite', contents: 'Contents', assessments: 'Key judgements', risks: 'Risk register',
    regions: 'Regions', economy: 'Economic developments', essay: 'Essay', misses: 'What we got wrong',
    method: 'Method and sources', sources: 'Sources', notes: 'Notes', happened: 'What happened',
    drivers: 'Drivers', next: 'The next six months', watch: 'What to watch', risk: 'Risk',
    likelihood: 'Likelihood', consequence: 'Consequence', score: 'Score', change: 'Change',
    isNew: 'New', same: 'Unchanged', upFrom: 'up from', downFrom: 'down from', of25: 'of 25',
    words: { 'very-unlikely': 'Highly unlikely', unlikely: 'Unlikely', even: 'Roughly even chance', likely: 'Likely', 'very-likely': 'Highly likely' },
    ranges: { 'very-unlikely': 'under 10%', unlikely: '10-35%', even: '35-55%', likely: '55-80%', 'very-likely': 'over 80%' },
    wordsNote: 'The probability words have fixed meanings: highly unlikely, under 10%; unlikely, 10-35%; roughly even chance, 35-55%; likely, 55-80%; highly likely, over 80%.',
    scaleNote: 'Likelihood and consequence are scored from 1 to 5. The score is their product, at most 25. The change is measured against the previous half-year report.',
    eventsWeek: 'Armed incidents per week', weekOf: 'week of', to: 'to', wholeWeeks: 'whole weeks from',
    chartSource: 'Source: the GDELT news stream, as the IGRED map counts it (map.igred.org). Each incident was reported by at least one outlet.',
    seriesStarts: (d: string) => `The map's series begins on ${d}.`,
    mapSource: 'Incidents reported in the GDELT news stream. Filled: two or more independent outlets. Hollow: a single source. Borders: Natural Earth.',
    noEvents: 'The map archive holds no incidents for this period.',
    list: 'Half-year reports and analyses from IGRED. Each can be read here and downloaded as a PDF.',
    halvarPlural: 'Half-year reports', analysePlural: 'Analyses', none: 'None yet.',
    page: 'Page', placeholder: 'IGRED',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};
type Words = (typeof T)['nb'];

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const day = (iso: string, lang: Lang) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return lang === 'nb' ? `${d}. ${T.nb.months[m! - 1]} ${y}` : `${d} ${T.en.months[m! - 1]} ${y}`;
};
const listJoin = (items: string[], w: Words) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${w.and} ${items.at(-1)}`);

/** "Erlend B. Moe" is "Moe, E. B." in a citation. */
function citeName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const last = parts.pop() ?? '';
  return `${last}, ${parts.map((p) => `${p[0]}.`).join(' ')}`.trim().replace(/,$/, '');
}

/* ---------- the map's data -------------------------------------------------- */

const readData = <T>(rel: string): T => JSON.parse(readFileSync(path.join(repoRoot, 'data', rel), 'utf-8')) as T;
const crisesConfig = (JSON.parse(readFileSync(path.join(repoRoot, 'config', 'crises.json'), 'utf-8')) as {
  crises: { id: string; name: string; nameNb: string; fips: string[] }[];
}).crises;
let baselineCache: Record<string, { countryName: string; days: { day: string; armedEventCount: number }[] }> | null = null;
const baseline = () => (baselineCache ??= readData<{ countries: NonNullable<typeof baselineCache> }>('baseline.json').countries);
const world = JSON.parse(readFileSync(path.join(WWW, 'world.json'), 'utf-8')) as { countries: { fips: string; name: string; path: string }[] };

interface Scope { crisis?: string; country?: string }
function scopeOf(spec: Scope, lang: Lang): { fips: string[]; name: string } {
  if (spec.crisis) {
    const c = crisesConfig.find((x) => x.id === spec.crisis);
    if (!c) throw new Error(`unknown crisis "${spec.crisis}"`);
    return { fips: c.fips, name: lang === 'nb' ? c.nameNb : c.name };
  }
  const fips = String(spec.country ?? '').toUpperCase();
  const name = baseline()[fips]?.countryName ?? world.countries.find((c) => c.fips === fips)?.name;
  if (!name) throw new Error(`unknown country "${spec.country}"`);
  return { fips: [fips], name };
}

interface ChartData { weeks: [string, number][]; first: string | null; last: string | null; seriesStart: string | null }
function chartData(spec: Scope & { from: string; to: string }): ChartData {
  const { fips } = scopeOf(spec, 'en');
  const byDay = new Map<string, number>();
  let seriesStart: string | null = null;
  for (const f of fips) for (const d of baseline()[f]?.days ?? []) {
    if (!seriesStart || d.day < seriesStart) seriesStart = d.day;
    if (d.day < spec.from || d.day > spec.to) continue;
    byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.armedEventCount);
  }
  const days = [...byDay.keys()].sort();
  // Whole weeks only, Monday to Sunday: a week the series covers in part would read as a dip.
  const weeks = new Map<string, { n: number; days: number }>();
  for (const d of days) {
    const t = Date.parse(`${d}T00:00:00Z`);
    const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    const wk = weeks.get(monday) ?? { n: 0, days: 0 };
    wk.n += byDay.get(d)!; wk.days += 1;
    weeks.set(monday, wk);
  }
  const whole = [...weeks.entries()].filter(([, wk]) => wk.days === 7).map(([m, wk]) => [m, wk.n] as [string, number]);
  return {
    seriesStart,
    weeks: whole,
    first: whole[0]?.[0] ?? null,
    last: whole.length ? new Date(Date.parse(`${whole.at(-1)![0]}T00:00:00Z`) + 6 * DAY).toISOString().slice(0, 10) : null,
  };
}

interface MapData { viewBox: [number, number, number, number]; dots: [number, number, number][]; first: string | null; last: string | null }
function mapData(spec: Scope & { from?: string | undefined; to?: string | undefined }): MapData {
  const { fips } = scopeOf(spec, 'en');
  // The frame: the crisis's own box when it has one, else the box of its countries' outlines.
  let box: number[] | null = null;
  if (spec.crisis && existsSync(path.join(repoRoot, 'data', 'crises', `${spec.crisis}.json`))) {
    box = readData<{ bbox: number[] }>(`crises/${spec.crisis}.json`).bbox;
  }
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  if (box) {
    for (const [lon, lat] of [[box[0]!, box[1]!], [box[2]!, box[3]!], [box[0]!, box[3]!], [box[2]!, box[1]!]] as [number, number][]) {
      const [x, y] = toView(lon, lat);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  } else {
    for (const c of world.countries.filter((c) => fips.includes(c.fips))) {
      for (const [, xs, ys] of c.path.matchAll(/([\d.]+)[ ,]([\d.]+)/g)) {
        const x = Number(xs); const y = Number(ys);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  // Padded, at least 40 units wide, and 16:10 so every small map has the same shape.
  let w = Math.max(40, (x1 - x0) * 1.5);
  let h = Math.max(25, (y1 - y0) * 1.5);
  if (w / h > 1.6) h = w / 1.6; else w = h * 1.6;
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2;
  const viewBox: [number, number, number, number] = [cx - w / 2, cy - h / 2, w, h].map((v) => Math.round(v * 10) / 10) as [number, number, number, number];

  const events = readData<{ crises: string[]; events: unknown[][] }>('map-events.json');
  const from = spec.from ? Date.parse(`${spec.from}T00:00:00Z`) : -Infinity;
  const to = spec.to ? Date.parse(`${spec.to}T23:59:59Z`) : Infinity;
  const fipsIndex = new Set(fips);
  const countries = readData<{ countries?: string[] }>('map-events.json').countries ?? [];
  const dots: [number, number, number][] = [];
  let first: number | null = null; let last: number | null = null;
  for (const e of events.events) {
    const at = (e[0] as number) * 60_000;
    if (at < from || at > to) continue;
    const inCrisis = spec.crisis ? events.crises[e[6] as number] === spec.crisis : fipsIndex.has(String(countries[e[12] as number] ?? ''));
    if (!inCrisis) continue;
    const [x, y] = toView((e[1] as number) / 100, (e[2] as number) / 100);
    dots.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, e[7] as number]);
    first = Math.min(first ?? at, at); last = Math.max(last ?? at, at);
  }
  return {
    viewBox, dots,
    first: first === null ? null : new Date(first).toISOString().slice(0, 10),
    last: last === null ? null : new Date(last).toISOString().slice(0, 10),
  };
}

/* ---------- frozen figures --------------------------------------------------- */

let frozen: Record<string, unknown> = {};
let frozenChanged = false;
function frozenOr<T>(key: string, compute: () => T): T {
  if (key in frozen) return frozen[key] as T;
  const value = compute();
  if (FREEZE) { frozen[key] = value; frozenChanged = true; }
  return value;
}

/* ---------- building blocks -------------------------------------------------- */

interface Ctx { lang: Lang; w: Words; notes: Map<string, { n: number; text: string }>; order: string[] }

function chartSvg(data: ChartData, w: Words, lang: Lang): string {
  const W = 680; const H = 230; const L = 40; const R = 12; const Tp = 14; const B = 30;
  if (!data.weeks.length) return `<p class="r-empty">${esc(w.noEvents)}</p>`;
  const max = Math.max(...data.weeks.map(([, n]) => n), 1);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => max / s <= 4) ?? 10000;
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + (data.weeks.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (data.weeks.length - 1));
  const y = (n: number) => Tp + (H - Tp - B) * (1 - n / top);
  const grid = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step)
    .map((v) => `<line class="r-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="r-axis" x="${L - 8}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`)
    .join('');
  // A month label under the first week that starts in it.
  let lastMonth = -1;
  const months = data.weeks.map(([d], i) => {
    const m = Number(d.slice(5, 7)) - 1;
    if (m === lastMonth) return '';
    lastMonth = m;
    return `<text class="r-axis" x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(T[lang].months[m]!.slice(0, 3))}</text>`;
  }).join('');
  const line = data.weeks.map(([, n], i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join('');
  const dots = data.weeks.map(([d, n], i) => `<circle class="r-dot" cx="${x(i).toFixed(1)}" cy="${y(n).toFixed(1)}" r="2.2"><title>${esc(w.weekOf)} ${esc(day(d, lang))}: ${n}</title></circle>`).join('');
  return `<svg class="r-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(w.eventsWeek)}">${grid}${months}<path class="r-line" d="${line}"/>${dots}</svg>`;
}

function parseTable(text: string): string[][] {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() && !/^\|?\s*:?-{3,}/.test(l));
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines.every((l) => l.includes('|')) ? '|' : lines.some((l) => l.includes(';')) ? ';' : ',';
  return lines.map((l) => {
    const cells = l.split(sep).map((c) => c.trim());
    return sep === '|' ? cells.filter((_, i, a) => !(i === 0 && a[0] === '') && !(i === a.length - 1 && a.at(-1) === '')) : cells;
  });
}

function riskName(id: string, lang: Lang): string {
  return register.find((r) => r.id === id)?.[lang] ?? id;
}

function changeCell(score: number, prev: number | null | undefined, w: Words): string {
  if (prev === undefined || prev === null) return `<span class="r-new">${esc(w.isNew)}</span>`;
  if (score === prev) return `<span class="r-same">→ ${esc(w.same)}</span>`;
  return score > prev
    ? `<span class="r-up">↑ ${esc(w.upFrom)} ${prev}</span>`
    : `<span class="r-down">↓ ${esc(w.downFrom)} ${prev}</span>`;
}

/** A five by five grid with each risk placed by its likelihood and consequence. */
function matrix(items: { label: string; likelihood: number; consequence: number }[], w: Words): string {
  const S = 34; const L = 22; const B = 22;
  const cells: string[] = [];
  for (let c = 1; c <= 5; c++) for (let l = 1; l <= 5; l++) {
    cells.push(`<rect class="r-cell" x="${L + (l - 1) * S}" y="${(5 - c) * S}" width="${S}" height="${S}"/>`);
  }
  const placed = new Map<string, string[]>();
  for (const it of items) {
    const key = `${it.likelihood}:${it.consequence}`;
    placed.set(key, [...(placed.get(key) ?? []), it.label]);
  }
  const marks = [...placed.entries()].map(([key, labels]) => {
    const [l, c] = key.split(':').map(Number);
    const cx = L + (l! - 0.5) * S; const cy = (5 - c! + 0.5) * S;
    return `<rect class="r-cell-on" x="${L + (l! - 1) * S + 1}" y="${(5 - c!) * S + 1}" width="${S - 2}" height="${S - 2}"/><text class="r-cell-label" x="${cx}" y="${cy + 3.5}" text-anchor="middle">${esc(labels.join(','))}</text>`;
  }).join('');
  const axis = `<text class="r-axis" x="${L + 2.5 * S}" y="${5 * S + 16}" text-anchor="middle">${esc(w.likelihood)} →</text>`
    + `<text class="r-axis" transform="translate(12 ${2.5 * S}) rotate(-90)" text-anchor="middle">${esc(w.consequence)} →</text>`;
  return `<svg class="r-matrix" viewBox="0 0 ${L + 5 * S + 2} ${5 * S + B}" role="img" aria-label="${esc(w.risks)}">${cells.join('')}${marks}${axis}</svg>`;
}

function sourcesList(sources: Source[] | undefined, lang: Lang): string {
  if (!sources?.length) return '';
  return `<ol class="r-sources">${sources.map((s) => {
    const parts = [
      s.author ? `${esc(s.author)}${s.date ? ` (${esc(s.date)})` : ''}.` : s.date ? `${esc(s.date)}.` : '',
      `<i>${esc(s.title)}</i>.`,
      s.publisher ? `${esc(s.publisher)}.` : '',
      s.url ? `<a href="${esc(s.url)}">${esc(s.url.replace(/^https?:\/\//, ''))}</a>` : '',
    ].filter(Boolean);
    return `<li lang="${lang}">${parts.join(' ')}</li>`;
  }).join('')}</ol>`;
}

function block(name: string, spec: Record<string, unknown>, ctx: Ctx, slug: string): string {
  const { lang, w } = ctx;
  const s = (k: string) => (spec[k] === undefined || spec[k] === null ? '' : String(spec[k]));
  switch (name) {
    case 'figures': {
      const items = (spec.items as { value: string; label: string; source?: string }[] | undefined) ?? [];
      return `<dl class="r-figures">${items.map((it) => `<div><dt>${esc(it.label)}</dt><dd><span class="r-figure">${esc(it.value)}</span>${it.source ? `<span class="r-figure-source">${esc(it.source)}</span>` : ''}</dd></div>`).join('')}</dl>`;
    }
    case 'chart': {
      const scope = { ...(s('crisis') ? { crisis: s('crisis') } : { country: s('country') }) };
      const from = s('from'); const to = s('to');
      const data = frozenOr(`chart:${JSON.stringify({ ...scope, from, to })}`, () => chartData({ ...scope, from, to }));
      const { name: place } = scopeOf(scope, lang);
      // Said only when the period asks for days before the map's series begins.
      const starts = data.seriesStart && data.seriesStart > from ? ` ${w.seriesStarts(day(data.seriesStart, lang))}` : '';
      const span = data.first ? `${day(data.first, lang)} ${w.to} ${day(data.last!, lang)}` : `${day(from, lang)} ${w.to} ${day(to, lang)}`;
      return `<figure class="r-fig r-chart"><figcaption class="r-fig-title">${esc(s('title') || `${w.eventsWeek}, ${place}`)}</figcaption>`
        + chartSvg(data, w, lang)
        + `<p class="r-fig-source">${esc(w.eventsWeek)}, ${esc(place)}, ${esc(w.wholeWeeks)} ${esc(span)}. ${esc(w.chartSource)}${esc(starts)}${s('note') ? ` ${esc(s('note'))}` : ''}</p></figure>`;
    }
    case 'table': {
      const rows = parseTable(s('data'));
      if (!rows.length) return '';
      const head = spec.header === false ? null : rows[0]!;
      const body = head ? rows.slice(1) : rows;
      const num = (v: string) => /^[−-]?[\d\s.,]+%?$/.test(v);
      return `<figure class="r-fig r-table">${s('caption') ? `<figcaption class="r-fig-title">${esc(s('caption'))}</figcaption>` : ''}<div class="r-table-wrap"><table>`
        + (head ? `<thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '')
        + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td${num(c) ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        + (s('source') ? `<p class="r-fig-source">${esc(s('source'))}</p>` : '') + '</figure>';
    }
    case 'risk': {
      const l = Number(spec.likelihood) || 1; const c = Number(spec.consequence) || 1; const score = l * c;
      const prev = spec.previous === undefined || spec.previous === '' ? undefined : Number(spec.previous);
      return `<figure class="r-fig r-risk"><div class="r-risk-text"><p class="meta">${esc(w.risk)}</p>`
        + `<p class="r-risk-name">${esc(riskName(s('risk'), lang))}</p>`
        + `<p class="r-risk-score"><span class="r-figure">${score}</span> <span class="meta">${esc(w.of25)}</span></p>`
        + `<p class="r-risk-parts">${esc(w.likelihood)} ${l} · ${esc(w.consequence)} ${c} · ${changeCell(score, prev, w)}</p>`
        + (s('note') ? `<p>${esc(s('note'))}</p>` : '') + `</div>${matrix([{ label: '', likelihood: l, consequence: c }], w)}</figure>`;
    }
    case 'map': {
      const scope = { ...(s('crisis') ? { crisis: s('crisis') } : { country: s('country') }) };
      const data = frozenOr(`map:${JSON.stringify({ ...scope, from: s('from'), to: s('to') })}`, () => mapData({ ...scope, from: s('from') || undefined, to: s('to') || undefined }));
      const { fips, name: place } = scopeOf(scope, lang);
      const [vx, vy, vw] = data.viewBox;
      const r = (vw / 150).toFixed(2);
      const land = world.countries.map((c) => `<path class="${fips.includes(c.fips) ? 'r-land-on' : 'r-land'}" d="${c.path}"/>`).join('');
      const dots = data.dots.map(([x, y, n]) => `<circle class="${n >= 2 ? 'r-ev' : 'r-ev-single'}" cx="${x}" cy="${y}" r="${n >= 2 ? r : (Number(r) * 0.8).toFixed(2)}"/>`).join('');
      const period = data.first ? `${day(data.first, lang)} ${w.to} ${day(data.last!, lang)}. ` : '';
      return `<figure class="r-fig r-map"><figcaption class="r-fig-title">${esc(s('caption') || place)}</figcaption>`
        + `<svg class="r-map-svg" viewBox="${data.viewBox.join(' ')}" role="img" aria-label="${esc(place)}"><clipPath id="clip-${esc(slug)}-${vx}-${vy}"><rect x="${vx}" y="${vy}" width="${vw}" height="${data.viewBox[3]}"/></clipPath><g clip-path="url(#clip-${esc(slug)}-${vx}-${vy})" style="--sw:${(vw / 500).toFixed(3)}">${land}${dots}</g></svg>`
        + `<p class="r-fig-source">${esc(period)}${esc(data.dots.length ? w.mapSource : `${w.noEvents} ${w.mapSource.split('. ').at(-1)}`)}</p></figure>`;
    }
    case 'quote': {
      return `<figure class="r-quote"><blockquote><p>${esc(s('text'))}</p></blockquote>`
        + `<figcaption>${esc(s('who'))}${s('role') ? `, ${esc(s('role'))}` : ''}${s('url') ? ` · <a href="${esc(s('url'))}">${esc(s('source') || s('url').replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>` : s('source') ? ` · ${esc(s('source'))}` : ''}</figcaption></figure>`;
    }
    case 'sources':
      return `<section class="r-block-sources">${s('title') ? `<p class="meta">${esc(s('title'))}</p>` : ''}${sourcesList(spec.items as Source[] | undefined, lang)}</section>`;
    default:
      return `<p class="r-empty">[${esc(name)}]</p>`;
  }
}

/** Markdown with building blocks and footnotes, to HTML. Footnotes are numbered across the report. */
function md(src: string | undefined, ctx: Ctx, slug: string): string {
  if (!src) return '';
  let text = String(src).replace(/\r\n/g, '\n');
  // Footnote definitions, written by the editor's Footnote block as "[^id]: text".
  text = text.replace(/^\[\^([^\]\s]+)\]:[ \t]*(.+)$/gm, (_, id: string, body: string) => {
    const existing = ctx.notes.get(id);
    if (existing) existing.text = body.trim();
    else ctx.notes.set(id, { n: 0, text: body.trim() });
    return '';
  });
  const blocks: string[] = [];
  text = text.replace(/^:::[ \t]*(\w+)[ \t]*\n([\s\S]*?)\n:::[ \t]*$/gm, (_, name: string, body: string) => {
    const spec = (load(body) ?? {}) as Record<string, unknown>;
    blocks.push(block(name, spec, ctx, slug));
    return `\n<div data-block="${blocks.length - 1}"></div>\n`;
  });
  let html = marked.parse(text, { async: false }) as string;
  html = html.replace(/<div data-block="(\d+)"><\/div>/g, (_, i: string) => blocks[Number(i)]!);
  html = html.replace(/\[\^([^\]\s]+)\]/g, (_, id: string) => {
    const note = ctx.notes.get(id) ?? (ctx.notes.set(id, { n: 0, text: '' }), ctx.notes.get(id)!);
    if (!note.n) { ctx.order.push(id); note.n = ctx.order.length; }
    return `<sup class="r-fn"><a href="#note-${note.n}" id="ref-${note.n}">${note.n}</a></sup>`;
  });
  return html;
}

/* ---------- pages ------------------------------------------------------------ */

function head(title: string, description: string, url: string, up: string, lang: Lang, extra = ''): string {
  return `<!doctype html>
<html lang="${lang}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="${up}favicon.ico" sizes="32x32">
<link rel="icon" href="${up}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${up}apple-touch-icon.png">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0B0B0A">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<script>try{if(localStorage.getItem('igred-theme-v2')==='light')document.documentElement.dataset.theme='light'}catch(e){}</script>
<link rel="preload" href="${up}fonts/fraunces-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${up}fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${up}fonts/fonts.css">
<link rel="stylesheet" href="${up}atlas.css">
<link rel="stylesheet" href="${up}reports.css">
${extra}</head>`;
}

function masthead(up: string, w: Words, current: boolean): string {
  return `<header class="masthead is-sticky r-masthead">
  <a class="wordmark wordmark-link" href="${up}"><strong>IGRED</strong></a>
  <nav class="controls" aria-label="Menu">
    <a class="link-button" href="https://map.igred.org/">${esc(w.map)}</a>
    <a class="link-button" href="https://map.igred.org/brief/">${esc(w.brief)}</a>
    <a class="link-button" href="${up}reports/"${current ? ' aria-current="true"' : ''}>${esc(w.reports)}</a>
    <a class="link-button" href="https://map.igred.org/metode/">${esc(w.methodNav)}</a>
    <button type="button" class="link-button" id="theme" data-light="${esc(w.light)}" data-dark="${esc(w.dark)}">${esc(w.light)}</button>
  </nav>
</header>`;
}

const footer = `<footer class="colophon r-colophon">
  <p class="meta"><strong>IGRED</strong> · <a href="mailto:contact@igred.org">contact@igred.org</a></p>
</footer>
<script type="module" src="../../reports.js"></script>`;

function citation(r: Report, w: Words): string {
  const names = r.authors.map(citeName);
  const who = names.length ? `${listJoin(names, w)} (${r.date.slice(0, 4)}). ` : '';
  return `${who}${r.title}. IGRED ${r.type === 'halvar' ? w.halvar.toLowerCase() : w.analyse.toLowerCase()}, ${w.version.toLowerCase()} ${r.version}, ${day(r.date, r.lang)}. ${SITE}/reports/${r.slug}/`;
}

function reportPage(r: Report, all: Report[]): string {
  const w = T[r.lang];
  const ctx: Ctx = { lang: r.lang, w, notes: new Map(), order: [] };
  const typeLabel = r.type === 'halvar' ? w.halvar : w.analyse;
  const url = `${SITE}/reports/${r.slug}/`;
  const pdf = `igred-${r.slug}.pdf`;
  const meta = `${typeLabel}${r.period ? ` · ${r.period}` : ''} · ${day(r.date, r.lang)} · ${w.version} ${r.version}`;
  const authors = r.authors.length ? `${w.by} ${listJoin(r.authors, w)}` : '';
  const sections: { id: string; title: string; html: string }[] = [];

  if (r.type === 'halvar') {
    const assessments = r.assessments ?? [];
    sections.push({
      id: 'vurderinger', title: w.assessments,
      html: `<ol class="r-judgements">${assessments.map((a) => {
        const k = LIKELIHOOD.includes(a.likelihood) ? a.likelihood : 'even';
        return `<li><p class="r-judgement-word"><b>${esc(w.words[k])}</b> <span class="meta">${esc(w.ranges[k])}</span></p>${md(a.text, ctx, r.slug)}</li>`;
      }).join('')}</ol><p class="r-note">${esc(w.wordsNote)}</p>`,
    });
    // The previous half-year report, for the arrows.
    const previous = all.filter((x) => x.type === 'halvar' && x.date < r.date).sort((a, b) => b.date.localeCompare(a.date))[0];
    const risks = [...(r.risks ?? [])].sort((a, b) => register.findIndex((x) => x.id === a.risk) - register.findIndex((x) => x.id === b.risk));
    const rows = risks.map((k, i) => {
      const score = k.likelihood * k.consequence;
      const was = previous?.risks?.find((p) => p.risk === k.risk);
      const prev = was ? was.likelihood * was.consequence : previous ? null : (k.previous ?? null);
      return { i: i + 1, k, score, prev };
    });
    sections.push({
      id: 'risiko', title: w.risks,
      html: `<div class="r-register"><div class="r-table-wrap"><table class="r-register-table"><thead><tr><th>#</th><th>${esc(w.risk)}</th><th class="num">${esc(w.likelihood)}</th><th class="num">${esc(w.consequence)}</th><th class="num">${esc(w.score)}</th><th>${esc(w.change)}</th></tr></thead><tbody>`
        + rows.map(({ i, k, score, prev }) => `<tr><td class="num">${i}</td><td>${esc(riskName(k.risk, r.lang))}${k.note ? `<span class="r-risk-note">${esc(k.note)}</span>` : ''}</td><td class="num">${k.likelihood}</td><td class="num">${k.consequence}</td><td class="num"><b>${score}</b></td><td>${changeCell(score, prev, w)}</td></tr>`).join('')
        + `</tbody></table></div>${matrix(rows.map(({ i, k }) => ({ label: String(i), likelihood: k.likelihood, consequence: k.consequence })), w)}</div><p class="r-note">${esc(w.scaleNote)}</p>`,
    });
    sections.push({
      id: 'regioner', title: w.regions,
      html: (r.regions ?? []).map((g) => `<section class="r-region"><h3>${esc(g.name)}</h3>`
        + (g.happened ? `<h4 class="meta">${esc(w.happened)}</h4>${md(g.happened, ctx, r.slug)}` : '')
        + (g.drivers ? `<h4 class="meta">${esc(w.drivers)}</h4>${md(g.drivers, ctx, r.slug)}` : '')
        + (g.next ? `<h4 class="meta">${esc(w.next)}</h4>${md(g.next, ctx, r.slug)}` : '')
        + (g.watch?.length ? `<h4 class="meta">${esc(w.watch)}</h4><ul class="r-watch">${g.watch.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '')
        + '</section>').join(''),
    });
    sections.push({ id: 'okonomi', title: w.economy, html: md(r.economy, ctx, r.slug) });
    sections.push({ id: 'essay', title: `${w.essay}${r.essay?.title ? `: ${r.essay.title}` : ''}`, html: md(r.essay?.body, ctx, r.slug) });
    sections.push({ id: 'bom', title: w.misses, html: md(r.misses, ctx, r.slug) });
    sections.push({ id: 'metode', title: w.method, html: md(r.method, ctx, r.slug) + sourcesList(r.sources, r.lang) });
  } else {
    sections.push({ id: 'tekst', title: '', html: md(r.body, ctx, r.slug) });
    if (r.sources?.length) sections.push({ id: 'kilder', title: w.sources, html: sourcesList(r.sources, r.lang) });
  }

  const notes = ctx.order.map((id) => ({ ...ctx.notes.get(id)!, id }));
  const numbered = r.type === 'halvar';
  const contents = numbered
    ? `<nav class="r-contents" aria-label="${esc(w.contents)}"><p class="meta">${esc(w.contents)}</p><ol>${sections.map((s) => `<li><a href="#${s.id}">${esc(s.title)}</a></li>`).join('')}</ol></nav>`
    : '';
  const body = sections.map((s, i) => `<section class="r-section" id="${s.id}">${s.title ? `<h2 class="r-h2">${numbered ? `<span class="r-num">${i + 1}</span>` : ''}${esc(s.title)}</h2>` : ''}${s.html}</section>`).join('');

  // The running header and the page numbers of the PDF: CSS page margin boxes, with the title
  // written in here because Chromium has no string-set.
  const printStyle = `<style>@page { @top-left { content: "IGRED · ${esc(typeLabel)}"; } @top-right { content: "${esc(r.title).replace(/"/g, '\\"')}"; } @bottom-right { content: "${esc(w.page)} " counter(page); } } @page :first { @top-left { content: none; } @top-right { content: none; } @bottom-right { content: none; } }</style>\n`;

  return `${head(`${r.title} · IGRED`, r.ingress, url, '../../', r.lang, printStyle)}
<body class="r-page r-${r.type}">
${masthead('../../', w, true)}
<section class="r-cover" aria-hidden="true">
  <p class="wordmark"><strong>IGRED</strong> <span>Institute for Geopolitical Risk and Economic Development</span></p>
  <div class="r-cover-main">
    <p class="meta">${esc(typeLabel)}${r.period ? ` · ${esc(r.period)}` : ''}</p>
    <h1 class="title">${esc(r.title)}</h1>
    <p class="standfirst">${esc(r.ingress)}</p>
  </div>
  <p class="r-cover-foot">${esc(authors)}<br>${esc(day(r.date, r.lang))} · ${esc(w.version)} ${esc(r.version)}<br>${esc(url)}</p>
</section>
<main class="r-main">
  <article class="r-article">
    <header class="r-head">
      <p class="meta r-label">${esc(meta)}</p>
      <h1 class="title r-title">${esc(r.title)}</h1>
      <p class="standfirst r-ingress">${esc(r.ingress)}</p>
      <p class="r-byline">${esc(authors)}</p>
      <p class="r-actions"><a class="link-button" href="${pdf}" download>${esc(w.pdf)}</a> <a class="link-button quiet" href="#sitering">${esc(w.cite)}</a></p>
    </header>
    ${contents}
    ${body}
    ${notes.length ? `<section class="r-notes"><h2 class="meta">${esc(w.notes)}</h2><ol>${notes.map((n) => `<li id="note-${n.n}">${marked.parseInline(n.text || n.id, { async: false })} <a href="#ref-${n.n}" class="r-back" aria-label="↑">↑</a></li>`).join('')}</ol></section>` : ''}
    <section class="r-cite" id="sitering"><h2 class="meta">${esc(w.cite)}</h2><p>${esc(citation(r, w))}</p></section>
  </article>
</main>
${footer}
</body>
</html>
`;
}

function listPage(reports: Report[]): string {
  const w = T.nb;
  const entry = (r: Report, big: boolean) => {
    const label = r.type === 'halvar' ? T[r.lang].halvar : T[r.lang].analyse;
    return `<li class="${big ? 'r-entry r-entry-big' : 'r-entry'}"><a href="${r.slug}/" lang="${r.lang}">`
      + `<p class="meta">${esc(label)}${r.period ? ` · ${esc(r.period)}` : ''} · ${esc(day(r.date, r.lang))}</p>`
      + `<h2 class="${big ? 'r-entry-title-big' : 'r-entry-title'}">${esc(r.title)}</h2>`
      + `<p class="r-entry-ingress">${esc(r.ingress)}</p>`
      + `<p class="r-entry-by">${esc(listJoin(r.authors, T[r.lang]))}</p></a></li>`;
  };
  const halvar = reports.filter((r) => r.type === 'halvar');
  const analyser = reports.filter((r) => r.type === 'analyse');
  return `${head('Rapporter · IGRED', w.list, `${SITE}/reports/`, '../', 'nb')}
<body class="r-page r-list-page">
${masthead('../', w, true)}
<main class="r-list">
  <h1 class="title"><span>Rapporter</span></h1>
  <p class="standfirst">${esc(w.list)}</p>
  <section class="r-group"><h2 class="meta">${esc(w.halvarPlural)}</h2><ul class="r-entries">${halvar.map((r) => entry(r, true)).join('') || `<li class="r-entry"><p>${esc(w.none)}</p></li>`}</ul></section>
  <section class="r-group"><h2 class="meta">${esc(w.analysePlural)}</h2><ul class="r-entries">${analyser.map((r) => entry(r, false)).join('') || `<li class="r-entry"><p>${esc(w.none)}</p></li>`}</ul></section>
</main>
${footer.replace('../../reports.js', '../reports.js')}
</body>
</html>
`;
}

/* ---------- PDF -------------------------------------------------------------- */

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };

async function printPdfs(reports: Report[]): Promise<void> {
  const { chromium } = await import('playwright');
  const server = createServer((req, res) => {
    let file = path.join(WWW, decodeURIComponent((req.url ?? '/').split('?')[0]!));
    if (file.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(WWW) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch();
    for (const r of reports) {
      const page = await browser.newPage();
      await page.goto(`http://localhost:${port}/reports/${r.slug}/`, { waitUntil: 'networkidle' });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate('document.fonts.ready');
      await page.pdf({ path: path.join(OUT, r.slug, `igred-${r.slug}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true });
      await page.close();
      console.log(`  pdf: reports/${r.slug}/igred-${r.slug}.pdf`);
    }
  } finally {
    // Closed whatever happened, or the build would never exit.
    await browser?.close();
    server.close();
  }
}

/* ---------- build ------------------------------------------------------------ */

const reports = readReports();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const r of reports) {
  const frozenFile = path.join(FROZEN, `${r.slug}.json`);
  frozen = existsSync(frozenFile) ? JSON.parse(readFileSync(frozenFile, 'utf-8')) as Record<string, unknown> : {};
  frozenChanged = false;
  mkdirSync(path.join(OUT, r.slug), { recursive: true });
  writeFileSync(path.join(OUT, r.slug, 'index.html'), reportPage(r, reports));
  if (frozenChanged) {
    mkdirSync(FROZEN, { recursive: true });
    writeFileSync(frozenFile, `${JSON.stringify(frozen, null, 1)}\n`);
    console.log(`  frozen: content/reports/frozen/${r.slug}.json`);
  }
}
writeFileSync(path.join(OUT, 'index.html'), listPage(reports));
console.log(`reports: ${reports.length} built (${reports.filter((r) => r.type === 'halvar').length} half-year, ${reports.filter((r) => r.type === 'analyse').length} analyses)`);
if (PDF) {
  try {
    await printPdfs(reports);
  } catch (error) {
    console.log(`reports: no PDFs this build (${(error as Error).message.split('\n')[0]})`);
  }
  // A report without its PDF loses the button rather than offering a broken link.
  for (const r of reports) {
    if (existsSync(path.join(OUT, r.slug, `igred-${r.slug}.pdf`))) continue;
    const file = path.join(OUT, r.slug, 'index.html');
    writeFileSync(file, readFileSync(file, 'utf-8').replace(/<a class="link-button" href="igred-[^"]+\.pdf" download>[^<]*<\/a> /, ''));
  }
}
