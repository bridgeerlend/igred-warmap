/**
 * Reports for igred.org: the half-year report and the analysis, written in Decap CMS as
 * Markdown in www/content/reports/ and built here into www/reports/:
 *
 *   www/reports/index.html               the list, half-year reports first and larger
 *   www/reports/<slug>/index.html        one page per report, written for reading
 *   www/reports/<slug>/<prefix>-<slug>.pdf  the same page printed to A4 (with --pdf)
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
import { BRAND, brandLink, markSvg } from '../src/core/brand.js';
import { navHtml } from '../src/core/nav.js';

const WWW = path.join(repoRoot, 'www');
// The examples in docs/report-examples/ can be built elsewhere for a look or a test:
// REPORTS_CONTENT=docs/report-examples REPORTS_OUT=/tmp/x npx tsx scripts/build-reports.ts
const CONTENT = process.env.REPORTS_CONTENT ? path.resolve(repoRoot, process.env.REPORTS_CONTENT) : path.join(WWW, 'content', 'reports');
const FROZEN = path.join(CONTENT, 'frozen');
const OUT = process.env.REPORTS_OUT ? path.resolve(repoRoot, process.env.REPORTS_OUT) : path.join(WWW, 'reports');
const SITE = 'https://igred.org';
const PDF = process.argv.includes('--pdf');
const FREEZE = process.argv.includes('--freeze');
const DAY = 86_400_000;
/** The PDF's file name, from the brand's file prefix. */
const pdfName = (slug: string) => `${BRAND.filePrefix}-${slug}.pdf`;

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
    // A report starts with front matter; anything else (a README) is not one.
    .filter((f) => f.endsWith('.md') && readFileSync(path.join(CONTENT, f), 'utf-8').startsWith('---'))
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
    halvar: 'Halvårsrapport', analyse: 'Analyse', reports: 'Rapporter', map: 'Kart', brief: 'Brief', methodNav: 'Metode', tagline: BRAND.tagline.nb,
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
    chartSource: `Kilde: nyhetsstrømmen GDELT, slik ${BRAND.products.monitor} teller den (map.igred.org). Hver hendelse er meldt av minst ett medium.`,
    seriesStarts: (d: string) => `Kartets dataserie begynner ${d}.`,
    mapSource: 'Hendelser meldt i nyhetsstrømmen GDELT. Fylt merke: to eller flere uavhengige medier. Hult merke: én kilde. Grenser: Natural Earth.',
    noEvents: 'Kartets arkiv har ingen hendelser for denne perioden.',
    list: `Halvårsrapporter og analyser fra ${BRAND.name}. Hver rapport kan leses her og lastes ned som PDF.`,
    halvarPlural: 'Halvårsrapporter', analysePlural: 'Analyser', soon: 'Den første rapporten kommer snart.',
    page: 'Side',
    months: ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'],
  },
  en: {
    halvar: 'Half-year report', analyse: 'Analysis', reports: 'Reports', map: 'Map', brief: 'Brief', methodNav: 'Method', tagline: BRAND.tagline.en,
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
    chartSource: `Source: the GDELT news stream, as ${BRAND.products.monitor} counts it (map.igred.org). Each incident was reported by at least one outlet.`,
    seriesStarts: (d: string) => `The map's series begins on ${d}.`,
    mapSource: 'Incidents reported in the GDELT news stream. Filled: two or more independent outlets. Hollow: a single source. Borders: Natural Earth.',
    noEvents: 'The map archive holds no incidents for this period.',
    list: `Half-year reports and analyses from ${BRAND.name}. Each can be read here and downloaded as a PDF.`,
    halvarPlural: 'Half-year reports', analysePlural: 'Analyses', soon: 'The first report is coming soon.',
    page: 'Page',
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

/* ---------- both languages ---------------------------------------------------- */

/**
 * The page follows the reader's language (the same choice as the rest of the site), so every
 * fixed text is written in both: shown in Norwegian, swapped by reports.js. What a report
 * says stays in the language it was written in, marked with its own lang.
 */
type Both = (w: Words, lang: Lang) => string;
const both = (f: Both): [string, string] => [f(T.nb, 'nb'), f(T.en, 'en')];
/** A fixed text as an element of its own. */
const L = (f: Both, tag = 'span', attrs = ''): string => {
  const [nb, en] = both(f);
  return nb === en && !attrs && tag === 'span' ? esc(nb) : `<${tag}${attrs} data-nb="${esc(nb)}" data-en="${esc(en)}">${esc(nb)}</${tag}>`;
};
/** The attributes and text for an element that is itself the label (an SVG text, a heading). */
const LA = (f: Both): { attrs: string; text: string } => {
  const [nb, en] = both(f);
  return { attrs: ` data-nb="${esc(nb)}" data-en="${esc(en)}"`, text: esc(nb) };
};
const dayBoth = (iso: string) => L((_, l) => day(iso, l));

/* ---------- building blocks -------------------------------------------------- */

interface Ctx { lang: Lang; notes: Map<string, { n: number; text: string }>; order: string[] }

function chartSvg(data: ChartData): string {
  const W = 680; const H = 230; const L0 = 40; const R = 12; const Tp = 14; const B = 30;
  if (!data.weeks.length) return `<p class="r-empty">${L((w) => w.noEvents)}</p>`;
  const max = Math.max(...data.weeks.map(([, n]) => n), 1);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find((s) => max / s <= 4) ?? 10000;
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L0 + (data.weeks.length === 1 ? (W - L0 - R) / 2 : (i * (W - L0 - R)) / (data.weeks.length - 1));
  const y = (n: number) => Tp + (H - Tp - B) * (1 - n / top);
  const grid = Array.from({ length: Math.round(top / step) + 1 }, (_, k) => k * step)
    .map((v) => `<line class="r-grid" x1="${L0}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="r-axis" x="${L0 - 8}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`)
    .join('');
  // A month label under the first week that starts in it.
  let lastMonth = -1;
  const months = data.weeks.map(([d], i) => {
    const m = Number(d.slice(5, 7)) - 1;
    if (m === lastMonth) return '';
    lastMonth = m;
    const label = LA((_, l) => T[l].months[m]!.slice(0, 3));
    return `<text class="r-axis" x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle"${label.attrs}>${label.text}</text>`;
  }).join('');
  const line = data.weeks.map(([, n], i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(n).toFixed(1)}`).join('');
  const dots = data.weeks.map(([d, n], i) => {
    const tip = LA((w, l) => `${w.weekOf} ${day(d, l)}: ${n}`);
    return `<circle class="r-dot" cx="${x(i).toFixed(1)}" cy="${y(n).toFixed(1)}" r="2.2"><title${tip.attrs}>${tip.text}</title></circle>`;
  }).join('');
  return `<svg class="r-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(T.nb.eventsWeek)} / ${esc(T.en.eventsWeek)}">${grid}${months}<path class="r-line" d="${line}"/>${dots}</svg>`;
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

function changeCell(score: number, prev: number | null | undefined): string {
  if (prev === undefined || prev === null) return L((w) => w.isNew, 'span', ' class="r-new"');
  if (score === prev) return L((w) => `→ ${w.same}`, 'span', ' class="r-same"');
  return score > prev
    ? L((w) => `↑ ${w.upFrom} ${prev}`, 'span', ' class="r-up"')
    : L((w) => `↓ ${w.downFrom} ${prev}`, 'span', ' class="r-down"');
}

/** A five by five grid with each risk placed by its likelihood and consequence. */
function matrix(items: { label: string; likelihood: number; consequence: number }[]): string {
  const S = 34; const L0 = 22; const B = 22;
  const cells: string[] = [];
  for (let c = 1; c <= 5; c++) for (let l = 1; l <= 5; l++) {
    cells.push(`<rect class="r-cell" x="${L0 + (l - 1) * S}" y="${(5 - c) * S}" width="${S}" height="${S}"/>`);
  }
  const placed = new Map<string, string[]>();
  for (const it of items) {
    const key = `${it.likelihood}:${it.consequence}`;
    placed.set(key, [...(placed.get(key) ?? []), it.label]);
  }
  const marks = [...placed.entries()].map(([key, labels]) => {
    const [l, c] = key.split(':').map(Number);
    const cx = L0 + (l! - 0.5) * S; const cy = (5 - c! + 0.5) * S;
    return `<rect class="r-cell-on" x="${L0 + (l! - 1) * S + 1}" y="${(5 - c!) * S + 1}" width="${S - 2}" height="${S - 2}"/><text class="r-cell-label" x="${cx}" y="${cy + 3.5}" text-anchor="middle">${esc(labels.join(','))}</text>`;
  }).join('');
  const lk = LA((w) => `${w.likelihood} →`); const cq = LA((w) => `${w.consequence} →`);
  const axis = `<text class="r-axis" x="${L0 + 2.5 * S}" y="${5 * S + 16}" text-anchor="middle"${lk.attrs}>${lk.text}</text>`
    + `<text class="r-axis" transform="translate(12 ${2.5 * S}) rotate(-90)" text-anchor="middle"${cq.attrs}>${cq.text}</text>`;
  return `<svg class="r-matrix" viewBox="0 0 ${L0 + 5 * S + 2} ${5 * S + B}" role="img" aria-label="${esc(T.nb.risks)} / ${esc(T.en.risks)}">${cells.join('')}${marks}${axis}</svg>`;
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
  const { lang } = ctx;
  const s = (k: string) => (spec[k] === undefined || spec[k] === null ? '' : String(spec[k]));
  const own = (text: string) => `<span lang="${lang}">${esc(text)}</span>`;
  switch (name) {
    case 'figures': {
      const items = (spec.items as { value: string; label: string; source?: string }[] | undefined) ?? [];
      return `<dl class="r-figures" lang="${lang}">${items.map((it) => `<div><dt>${esc(it.label)}</dt><dd><span class="r-figure">${esc(it.value)}</span>${it.source ? `<span class="r-figure-source">${esc(it.source)}</span>` : ''}</dd></div>`).join('')}</dl>`;
    }
    case 'chart': {
      const scope = { ...(s('crisis') ? { crisis: s('crisis') } : { country: s('country') }) };
      const from = s('from'); const to = s('to');
      const data = frozenOr(`chart:${JSON.stringify({ ...scope, from, to })}`, () => chartData({ ...scope, from, to }));
      const place = (l: Lang) => scopeOf(scope, l).name;
      // Said only when the period asks for days before the map's series begins.
      const starts = (w: Words, l: Lang) => (data.seriesStart && data.seriesStart > from ? ` ${w.seriesStarts(day(data.seriesStart, l))}` : '');
      const span = (w: Words, l: Lang) => (data.first ? `${day(data.first, l)} ${w.to} ${day(data.last!, l)}` : `${day(from, l)} ${w.to} ${day(to, l)}`);
      return `<figure class="r-fig r-chart"><figcaption class="r-fig-title">${s('title') ? own(s('title')) : L((w, l) => `${w.eventsWeek}, ${place(l)}`)}</figcaption>`
        + chartSvg(data)
        + `<p class="r-fig-source">${L((w, l) => `${w.eventsWeek}, ${place(l)}, ${w.wholeWeeks} ${span(w, l)}. ${w.chartSource}${starts(w, l)}`)}${s('note') ? ` ${own(s('note'))}` : ''}</p></figure>`;
    }
    case 'table': {
      const rows = parseTable(s('data'));
      if (!rows.length) return '';
      const head = spec.header === false ? null : rows[0]!;
      const body = head ? rows.slice(1) : rows;
      const num = (v: string) => /^[−-]?[\d\s.,]+%?$/.test(v);
      return `<figure class="r-fig r-table" lang="${lang}">${s('caption') ? `<figcaption class="r-fig-title">${esc(s('caption'))}</figcaption>` : ''}<div class="r-table-wrap"><table>`
        + (head ? `<thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : '')
        + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td${num(c) ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        + (s('source') ? `<p class="r-fig-source">${esc(s('source'))}</p>` : '') + '</figure>';
    }
    case 'risk': {
      const l = Number(spec.likelihood) || 1; const c = Number(spec.consequence) || 1; const score = l * c;
      const prev = spec.previous === undefined || spec.previous === '' ? undefined : Number(spec.previous);
      return `<figure class="r-fig r-risk"><div class="r-risk-text">${L((w) => w.risk, 'p', ' class="meta"')}`
        + L((_, lg) => riskName(s('risk'), lg), 'p', ' class="r-risk-name"')
        + `<p class="r-risk-score"><span class="r-figure">${score}</span> ${L((w) => w.of25, 'span', ' class="meta"')}</p>`
        + `<p class="r-risk-parts">${L((w) => `${w.likelihood} ${l} · ${w.consequence} ${c}`)} · ${changeCell(score, prev)}</p>`
        + (s('note') ? `<p lang="${lang}">${esc(s('note'))}</p>` : '') + `</div>${matrix([{ label: '', likelihood: l, consequence: c }])}</figure>`;
    }
    case 'map': {
      const scope = { ...(s('crisis') ? { crisis: s('crisis') } : { country: s('country') }) };
      const data = frozenOr(`map:${JSON.stringify({ ...scope, from: s('from'), to: s('to') })}`, () => mapData({ ...scope, from: s('from') || undefined, to: s('to') || undefined }));
      const { fips } = scopeOf(scope, lang);
      const [vx, vy, vw] = data.viewBox;
      const r = (vw / 150).toFixed(2);
      const land = world.countries.map((c) => `<path class="${fips.includes(c.fips) ? 'r-land-on' : 'r-land'}" d="${c.path}"/>`).join('');
      const dots = data.dots.map(([x, y, n]) => `<circle class="${n >= 2 ? 'r-ev' : 'r-ev-single'}" cx="${x}" cy="${y}" r="${n >= 2 ? r : (Number(r) * 0.8).toFixed(2)}"/>`).join('');
      const period = (w: Words, l: Lang) => (data.first ? `${day(data.first, l)} ${w.to} ${day(data.last!, l)}. ` : '');
      return `<figure class="r-fig r-map"><figcaption class="r-fig-title">${s('caption') ? own(s('caption')) : L((_, l) => scopeOf(scope, l).name)}</figcaption>`
        + `<svg class="r-map-svg" viewBox="${data.viewBox.join(' ')}" role="img" aria-label="${esc(scopeOf(scope, 'nb').name)}"><clipPath id="clip-${esc(slug)}-${vx}-${vy}"><rect x="${vx}" y="${vy}" width="${vw}" height="${data.viewBox[3]}"/></clipPath><g clip-path="url(#clip-${esc(slug)}-${vx}-${vy})" style="--sw:${(vw / 500).toFixed(3)}">${land}${dots}</g></svg>`
        + `<p class="r-fig-source">${L((w, l) => `${period(w, l)}${data.dots.length ? w.mapSource : `${w.noEvents} ${w.mapSource.split('. ').at(-1)}`}`)}</p></figure>`;
    }
    case 'quote': {
      return `<figure class="r-quote" lang="${lang}"><blockquote><p>${esc(s('text'))}</p></blockquote>`
        + `<figcaption>${esc(s('who'))}${s('role') ? `, ${esc(s('role'))}` : ''}${s('url') ? ` · <a href="${esc(s('url'))}">${esc(s('source') || s('url').replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>` : s('source') ? ` · ${esc(s('source'))}` : ''}</figcaption></figure>`;
    }
    case 'sources':
      return `<section class="r-block-sources" lang="${lang}">${s('title') ? `<p class="meta">${esc(s('title'))}</p>` : ''}${sourcesList(spec.items as Source[] | undefined, lang)}</section>`;
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
  html = html.replace(/<div data-block="(\d+)"><\/div>/g, (_, i: string) => `</div>${blocks[Number(i)]!}<div class="r-text" lang="${ctx.lang}">`);
  html = html.replace(/\[\^([^\]\s]+)\]/g, (_, id: string) => {
    const note = ctx.notes.get(id) ?? (ctx.notes.set(id, { n: 0, text: '' }), ctx.notes.get(id)!);
    if (!note.n) { ctx.order.push(id); note.n = ctx.order.length; }
    return `<sup class="r-fn"><a href="#note-${note.n}" id="ref-${note.n}">${note.n}</a></sup>`;
  });
  // The written text carries its own language; the blocks inside it carry both.
  return `<div class="r-text" lang="${ctx.lang}">${html}</div>`.replace(/<div class="r-text" lang="[a-z]+"><\/div>/g, '');
}

/* ---------- pages ------------------------------------------------------------ */

function head(title: string, description: string, url: string, up: string, extra = ''): string {
  return `<!doctype html>
<html lang="nb" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="${up}favicon.ico" sizes="32x32">
<link rel="icon" href="${up}favicon.svg" type="image/svg+xml">
<link rel="icon" href="${up}favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="${up}favicon-16.png" type="image/png" sizes="16x16">
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
<link rel="stylesheet" href="${up}nav.css">
<link rel="stylesheet" href="${up}reports.css">
${extra}</head>`;
}

function masthead(up: string): string {
  return `<header class="masthead is-sticky r-masthead has-nav">
  ${brandLink(up)}
  ${navHtml('reports')}
</header>`;
}

const footer = (up: string) => `<footer class="colophon r-colophon">
  <p class="meta"><strong>${BRAND.name}</strong> · <a href="mailto:contact@igred.org">contact@igred.org</a></p>
</footer>
<script type="module" src="${up}reports.js"></script>
<script type="module" src="${up}nav.js"></script>`;

function citation(r: Report, w: Words, l: Lang): string {
  const names = r.authors.map(citeName);
  const who = names.length ? `${listJoin(names, w)} (${r.date.slice(0, 4)}). ` : '';
  return `${who}${r.title}. ${BRAND.products.reports}, ${r.type === 'halvar' ? w.halvar.toLowerCase() : w.analyse.toLowerCase()}, ${w.version.toLowerCase()} ${r.version}, ${day(r.date, l)}. ${SITE}/reports/${r.slug}/`;
}

function reportPage(r: Report, all: Report[]): string {
  const ctx: Ctx = { lang: r.lang, notes: new Map(), order: [] };
  const typeWord = (w: Words) => (r.type === 'halvar' ? w.halvar : w.analyse);
  const url = `${SITE}/reports/${r.slug}/`;
  const pdf = pdfName(r.slug);
  // The period is the report's own words: kept as written, in both languages of the label.
  const meta = L((w, l) => `${typeWord(w)}${r.period ? ` · ${r.period}` : ''} · ${day(r.date, l)} · ${w.version} ${r.version}`, 'p', ' class="meta r-label"');
  const authors = (w: Words) => (r.authors.length ? `${w.by} ${listJoin(r.authors, w)}` : '');
  const sections: { id: string; title: Both; html: string }[] = [];

  if (r.type === 'halvar') {
    const assessments = r.assessments ?? [];
    sections.push({
      id: 'vurderinger', title: (w) => w.assessments,
      html: `<ol class="r-judgements">${assessments.map((a) => {
        const k = LIKELIHOOD.includes(a.likelihood) ? a.likelihood : 'even';
        return `<li><p class="r-judgement-word">${L((w) => w.words[k], 'b')} ${L((w) => w.ranges[k], 'span', ' class="meta"')}</p>${md(a.text, ctx, r.slug)}</li>`;
      }).join('')}</ol>${L((w) => w.wordsNote, 'p', ' class="r-note"')}`,
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
      id: 'risiko', title: (w) => w.risks,
      html: `<div class="r-register"><div class="r-table-wrap"><table class="r-register-table"><thead><tr><th>#</th>${L((w) => w.risk, 'th')}${L((w) => w.likelihood, 'th', ' class="num"')}${L((w) => w.consequence, 'th', ' class="num"')}${L((w) => w.score, 'th', ' class="num"')}${L((w) => w.change, 'th')}</tr></thead><tbody>`
        + rows.map(({ i, k, score, prev }) => `<tr><td class="num">${i}</td><td>${L((_, l) => riskName(k.risk, l))}${k.note ? `<span class="r-risk-note" lang="${r.lang}">${esc(k.note)}</span>` : ''}</td><td class="num">${k.likelihood}</td><td class="num">${k.consequence}</td><td class="num"><b>${score}</b></td><td>${changeCell(score, prev)}</td></tr>`).join('')
        + `</tbody></table></div>${matrix(rows.map(({ i, k }) => ({ label: String(i), likelihood: k.likelihood, consequence: k.consequence })))}</div>${L((w) => w.scaleNote, 'p', ' class="r-note"')}`,
    });
    sections.push({
      id: 'regioner', title: (w) => w.regions,
      html: (r.regions ?? []).map((g) => `<section class="r-region"><h3 lang="${r.lang}">${esc(g.name)}</h3>`
        + (g.happened ? `${L((w) => w.happened, 'h4', ' class="meta"')}${md(g.happened, ctx, r.slug)}` : '')
        + (g.drivers ? `${L((w) => w.drivers, 'h4', ' class="meta"')}${md(g.drivers, ctx, r.slug)}` : '')
        + (g.next ? `${L((w) => w.next, 'h4', ' class="meta"')}${md(g.next, ctx, r.slug)}` : '')
        + (g.watch?.length ? `${L((w) => w.watch, 'h4', ' class="meta"')}<ul class="r-watch" lang="${r.lang}">${g.watch.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '')
        + '</section>').join(''),
    });
    sections.push({ id: 'okonomi', title: (w) => w.economy, html: md(r.economy, ctx, r.slug) });
    sections.push({ id: 'essay', title: (w) => `${w.essay}${r.essay?.title ? `: ${r.essay.title}` : ''}`, html: md(r.essay?.body, ctx, r.slug) });
    sections.push({ id: 'bom', title: (w) => w.misses, html: md(r.misses, ctx, r.slug) });
    sections.push({ id: 'metode', title: (w) => w.method, html: md(r.method, ctx, r.slug) + sourcesList(r.sources, r.lang) });
  } else {
    sections.push({ id: 'tekst', title: () => '', html: md(r.body, ctx, r.slug) });
    if (r.sources?.length) sections.push({ id: 'kilder', title: (w) => w.sources, html: sourcesList(r.sources, r.lang) });
  }

  const notes = ctx.order.map((id) => ({ ...ctx.notes.get(id)!, id }));
  const numbered = r.type === 'halvar';
  const contents = numbered
    ? `<nav class="r-contents" aria-label="${esc(T.nb.contents)}">${L((w) => w.contents, 'p', ' class="meta"')}<ol>${sections.map((s) => `<li><a href="#${s.id}">${L(s.title)}</a></li>`).join('')}</ol></nav>`
    : '';
  const body = sections.map((s, i) => `<section class="r-section" id="${s.id}">${s.title(T.nb, 'nb') ? `<h2 class="r-h2">${numbered ? `<span class="r-num">${i + 1}</span>` : ''}${L(s.title)}</h2>` : ''}${s.html}</section>`).join('');

  // The running header and the page numbers of the PDF, which is printed in the report's own
  // language: CSS page margin boxes, with the title written in because Chromium has no string-set.
  const w = T[r.lang];
  const printStyle = `<style>@page { @top-left { content: "${esc(BRAND.name)} · ${esc(typeWord(w))}"; } @top-right { content: "${esc(r.title).replace(/"/g, '\\"')}"; } @bottom-right { content: "${esc(w.page)} " counter(page); } } @page :first { @top-left { content: none; } @top-right { content: none; } @bottom-right { content: none; } }</style>\n`;

  return `${head(`${r.title} · ${BRAND.products.reports}`, r.ingress, url, '../../', printStyle)}
<body class="r-page r-${r.type}" data-report-lang="${r.lang}">
${masthead('../../')}
<section class="r-cover" aria-hidden="true">
  <p class="wordmark brand">${markSvg()}<strong>${esc(BRAND.name)}</strong> ${L((x) => x.tagline)}</p>
  <div class="r-cover-main">
    ${L((x) => typeWord(x), 'p', ' class="meta"').replace('</p>', r.period ? ` · <span lang="${r.lang}">${esc(r.period)}</span></p>` : '</p>')}
    <h1 class="title" lang="${r.lang}">${esc(r.title)}</h1>
    <p class="standfirst" lang="${r.lang}">${esc(r.ingress)}</p>
  </div>
  <p class="r-cover-foot">${L(authors)}<br>${L((x, l) => `${day(r.date, l)} · ${x.version} ${r.version}`)}<br>${esc(url)}</p>
</section>
<main class="r-main">
  <article class="r-article">
    <header class="r-head">
      ${meta}
      <h1 class="title r-title" lang="${r.lang}">${esc(r.title)}</h1>
      <p class="standfirst r-ingress" lang="${r.lang}">${esc(r.ingress)}</p>
      ${L(authors, 'p', ' class="r-byline"')}
      <p class="r-actions">${L((x) => x.pdf, 'a', ` class="link-button" href="${pdf}" download`)} ${L((x) => x.cite, 'a', ' class="link-button quiet" href="#sitering"')}</p>
    </header>
    ${contents}
    ${body}
    ${notes.length ? `<section class="r-notes">${L((x) => x.notes, 'h2', ' class="meta"')}<ol lang="${r.lang}">${notes.map((n) => `<li id="note-${n.n}">${marked.parseInline(n.text || n.id, { async: false })} <a href="#ref-${n.n}" class="r-back" aria-label="↑">↑</a></li>`).join('')}</ol></section>` : ''}
    <section class="r-cite" id="sitering">${L((x) => x.cite, 'h2', ' class="meta"')}${L((x, l) => citation(r, x, l), 'p')}</section>
  </article>
</main>
${footer('../../')}
</body>
</html>
`;
}

function listPage(reports: Report[]): string {
  const entry = (r: Report, big: boolean) => `<li class="${big ? 'r-entry r-entry-big' : 'r-entry'}"><a href="${r.slug}/">`
    + L((w, l) => `${r.type === 'halvar' ? w.halvar : w.analyse}${r.period ? ` · ${r.period}` : ''} · ${day(r.date, l)}`, 'p', ' class="meta"')
    + `<h2 class="${big ? 'r-entry-title-big' : 'r-entry-title'}" lang="${r.lang}">${esc(r.title)}</h2>`
    + `<p class="r-entry-ingress" lang="${r.lang}">${esc(r.ingress)}</p>`
    + L((w) => listJoin(r.authors, w), 'p', ' class="r-entry-by"') + '</a></li>';
  const halvar = reports.filter((r) => r.type === 'halvar');
  const analyser = reports.filter((r) => r.type === 'analyse');
  // A kind with no reports is left out; with none at all, one quiet line and nothing else.
  const group = (title: Both, list: Report[], big: boolean) => (list.length
    ? `<section class="r-group">${L(title, 'h2', ' class="meta"')}<ul class="r-entries">${list.map((r) => entry(r, big)).join('')}</ul></section>` : '');
  const body = reports.length
    ? `  ${L((w) => w.list, 'p', ' class="standfirst"')}
  ${group((w) => w.halvarPlural, halvar, true)}
  ${group((w) => w.analysePlural, analyser, false)}`
    : `  ${L((w) => w.soon, 'p', ' class="standfirst r-soon"')}`;
  return `${head(BRAND.products.reports, T.nb.list, `${SITE}/reports/`, '../')}
<body class="r-page r-list-page">
${masthead('../')}
<main class="r-list">
  <h1 class="title">${L((w) => w.reports)}</h1>
${body}
</main>
${footer('../')}
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
      // Printed in the language the report is written in.
      await page.addInitScript((lang) => { try { localStorage.setItem('igred-lang', lang); } catch { /* none */ } }, r.lang);
      await page.goto(`http://localhost:${port}/reports/${r.slug}/`, { waitUntil: 'networkidle' });
      await page.emulateMedia({ media: 'print' });
      await page.evaluate('document.fonts.ready');
      await page.pdf({ path: path.join(OUT, r.slug, pdfName(r.slug)), format: 'A4', printBackground: true, preferCSSPageSize: true });
      await page.close();
      console.log(`  pdf: reports/${r.slug}/${pdfName(r.slug)}`);
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
    if (existsSync(path.join(OUT, r.slug, pdfName(r.slug)))) continue;
    const file = path.join(OUT, r.slug, 'index.html');
    writeFileSync(file, readFileSync(file, 'utf-8').replace(new RegExp(`<a class="link-button" href="${BRAND.filePrefix}-[^"]+\\.pdf" download>[^<]*</a> `), ''));
  }
}
