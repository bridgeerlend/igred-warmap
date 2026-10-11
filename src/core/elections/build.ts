/**
 * Builds data/elections.json: national elections in the next twelve months (and the past
 * sixty days, with their results), each with a risk score from 0 to 100 and every indicator
 * behind it with its source and year.
 *
 * The calendar and the election articles are read from Wikipedia at most once a week; the
 * score is recomputed on every run from the files in data/elections/sources/, the World Bank
 * and our own GDELT counts in data/baseline.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COUNTRY } from '../crises/names.js';
import type { SummarySettings } from '../crises/summary.js';
import { configDir, dataDir, repoRoot } from '../util/paths.js';
import { closeness, lead, parseCalendar, previousFrom, wikitext, type CalendarEntry, type ElectionType } from './calendar.js';
import { combine, indicator, INDICATORS, percentile, risk, type Indicator, type IndicatorId, type Part, type Scales } from './score.js';
import { countries as readCountries, ensureSources, freedomHouse, pei, readManifest, rsf, vdem, WB, worldBankAll, type Country, type ManifestEntry, type SourceConfig } from './sources.js';
import { sentenceFor, writeSentences, type SentenceInput, type SentenceState } from './why.js';

interface ElectionsConfig {
  calendarPages: string[];
  horizonDays: number;
  keepHeldDays: number;
  calendarRefreshDays: number;
  mapLayerDays: number;
  unrest: { days: number; ratio: number; minEvents: number };
  weights: Record<IndicatorId, number>;
  levels: { elevated: number; high: number };
  scales: Scales;
  why: { maxWords: number; batch: number };
  sources: SourceConfig[];
}

const DAY = 86_400_000;
const internalDir = path.join(dataDir, 'elections', 'internal');
const calendarFile = path.join(internalDir, 'calendar.json');
const articlesFile = path.join(internalDir, 'articles.json');
const sentencesFile = path.join(internalDir, 'sentences.json');
const outFile = path.join(dataDir, 'elections.json');

const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) as T : fallback);
const writeJson = (file: string, value: unknown) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`); };
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------- countries ---------------------------------------------------------- */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the /, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Names Wikipedia, Freedom House and GeoNames spell differently, to ISO 3166 alpha-2. */
const ALIASES: Record<string, string> = {
  'czech republic': 'CZ', czechia: 'CZ', 'ivory coast': 'CI', 'cote d ivoire': 'CI', 'democratic republic of the congo': 'CD', 'dr congo': 'CD',
  'congo kinshasa': 'CD', 'republic of the congo': 'CG', 'congo brazzaville': 'CG', congo: 'CG', gambia: 'GM', 'east timor': 'TL', 'timor leste': 'TL',
  'cape verde': 'CV', 'cabo verde': 'CV', eswatini: 'SZ', swaziland: 'SZ', 'north macedonia': 'MK', 'south korea': 'KR', 'north korea': 'KP',
  russia: 'RU', iran: 'IR', syria: 'SY', laos: 'LA', vietnam: 'VN', micronesia: 'FM', 'federated states of micronesia': 'FM',
  'sao tome and principe': 'ST', 'united states': 'US', 'united kingdom': 'GB', palestine: 'PS', 'state of palestine': 'PS', brunei: 'BN',
  myanmar: 'MM', burma: 'MM', turkey: 'TR', turkiye: 'TR', 'bosnia and herzegovina': 'BA', moldova: 'MD', tanzania: 'TZ', bolivia: 'BO',
  venezuela: 'VE', kosovo: 'XK', taiwan: 'TW', 'saint kitts and nevis': 'KN', 'st kitts and nevis': 'KN', 'saint lucia': 'LC', 'st lucia': 'LC',
  'saint vincent and the grenadines': 'VC', 'st vincent and the grenadines': 'VC', 'antigua and barbuda': 'AG', 'trinidad and tobago': 'TT',
  bahamas: 'BS', netherlands: 'NL', philippines: 'PH', 'central african republic': 'CF', 'guinea bissau': 'GW', 'united arab emirates': 'AE',
  'vatican city': 'VA', 'hong kong': 'HK', macau: 'MO', 'isle of man': 'IM',
};

interface Place extends Country { nb: string; center: [number, number] | null }

/** The largest polygon's centre for each ISO numeric code, from the map's own Natural Earth file. */
function centres(): Map<string, [number, number]> {
  const topo = JSON.parse(readFileSync(path.join(repoRoot, 'site', 'vendor', 'countries-50m.json'), 'utf-8')) as {
    arcs: [number, number][][]; transform: { scale: [number, number]; translate: [number, number] };
    objects: { countries: { geometries: { type: string; id?: string; arcs: number[][] | number[][][] }[] } };
  };
  const { scale, translate } = topo.transform;
  const decoded = topo.arcs.map((arc) => {
    let x = 0; let y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number]; });
  });
  const ring = (idx: number[]) => idx.flatMap((i) => (i >= 0 ? decoded[i]! : [...decoded[~i]!].reverse()));
  const out = new Map<string, [number, number]>();
  for (const g of topo.objects.countries.geometries) {
    if (!g.id) continue;
    const polys = (g.type === 'Polygon' ? [g.arcs] : g.arcs) as number[][][];
    let best: { area: number; c: [number, number] } | null = null;
    for (const poly of polys) {
      let pts = ring(poly[0]!);
      // A ring across the 180th meridian (Fiji) is measured on 0 to 360 so it does not wrap.
      const lons = pts.map(([x]) => x);
      const wraps = Math.max(...lons) - Math.min(...lons) > 180;
      if (wraps) pts = pts.map(([x, y]) => [x < 0 ? x + 360 : x, y] as [number, number]);
      let a = 0; let cx = 0; let cy = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i]!; const [x1, y1] = pts[i + 1]!;
        const f = x0 * y1 - x1 * y0; a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
      }
      if (!a) continue;
      const lon = cx / (3 * a);
      const c: [number, number] = [lon > 180 ? lon - 360 : lon, cy / (3 * a)];
      if (!best || Math.abs(a) > best.area) best = { area: Math.abs(a), c };
    }
    if (best) out.set(g.id, [Math.round(best.c[0] * 100) / 100, Math.round(best.c[1] * 100) / 100]);
  }
  return out;
}

function placeIndex(list: Country[]): { byName: (name: string) => Place | null; byIso2: Map<string, Place> } {
  const nb = new Intl.DisplayNames(['nb'], { type: 'region' });
  const centre = centres();
  const byIso2 = new Map<string, Place>();
  for (const c of list) {
    const own = Object.entries(COUNTRY).find(([fips]) => fips === c.fips)?.[1];
    let nbName = c.name;
    try { nbName = nb.of(c.iso2) ?? c.name; } catch { /* a code Intl does not know keeps the English name */ }
    byIso2.set(c.iso2, { ...c, nb: nbName, center: own?.center ?? centre.get(c.isoNum) ?? null });
  }
  const byNorm = new Map<string, Place>();
  for (const p of byIso2.values()) byNorm.set(norm(p.name), p);
  return {
    byIso2,
    byName: (name) => { const n = norm(name); return byNorm.get(n) ?? (ALIASES[n] ? byIso2.get(ALIASES[n]!) ?? null : null); },
  };
}

/* ---------- the election list ---------------------------------------------------- */

export interface Election {
  id: string;
  date: string;
  dateEnd?: string;
  status: 'upcoming' | 'held';
  country: { iso2: string; iso3: string; fips: string; en: string; nb: string };
  center: [number, number] | null;
  types: ElectionType[];
  round?: number;
  label: string;
  wiki: { title: string; url: string };
  why: { en: string; nb: string | null } | null;
  result: { en: string; nb: string | null } | null;
  unrest: { days: number; complete: boolean; after: number; before: number; unrest: boolean } | null;
  score: number | null;
  level: 'low' | 'elevated' | 'high' | null;
  coverage: number;
  missing: IndicatorId[];
  indicators: Indicator[];
  crisis: { id: string; en: string; nb: string } | null;
}

interface ArticleInfo { lead: string | null; previous: string | null; prevYear: number | null; turnout: number | null; margin: number | null; fetchedAt: string }

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

export async function buildElections(options: { offline?: boolean; log?: (line: string) => void; now?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ elections: number; scored: number }> {
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now();
  const today = dayOf(now);
  const cfg = JSON.parse(readFileSync(path.join(configDir, 'elections.json'), 'utf-8')) as ElectionsConfig;
  const crisesCfg = JSON.parse(readFileSync(path.join(configDir, 'crises.json'), 'utf-8')) as {
    settings: { summary: SummarySettings }; crises: { id: string; name: string; nameNb: string; fips: string[] }[];
  };

  /* sources */
  const manifest: Record<string, ManifestEntry> = options.offline ? readManifest() : await ensureSources(cfg.sources, log);
  const places = placeIndex(readCountries(manifest));
  if (!places.byIso2.size) throw new Error('no country table: data/elections/sources/geonames-countryInfo.txt is missing');
  const VDEM = vdem(manifest); const PEI = pei(manifest); const RSF = rsf(manifest);
  const FH = new Map<string, number>();
  for (const [name, v] of freedomHouse(manifest)) { const p = places.byName(name); if (p) FH.set(p.iso3, v); }
  const wb = await worldBankAll(log, options.offline);

  /* the calendar, at most weekly */
  const cal = readJson<{ fetchedAt: string | null; entries: CalendarEntry[] }>(calendarFile, { fetchedAt: null, entries: [] });
  const stale = !cal.fetchedAt || now - Date.parse(cal.fetchedAt) > cfg.calendarRefreshDays * DAY;
  if (stale && !options.offline) {
    const entries: CalendarEntry[] = [];
    let ok = 0;
    for (const page of cfg.calendarPages) {
      const text = await wikitext(page);
      const year = Number(/^(\d{4})/.exec(page)?.[1]);
      if (text && year) { entries.push(...parseCalendar(text, year)); ok += 1; }
      await sleep(300);
    }
    if (ok) { cal.entries = entries; cal.fetchedAt = new Date(now).toISOString(); writeJson(calendarFile, cal); log(`elections: calendar read, ${entries.length} entries from ${ok} pages`); }
  }

  const from = dayOf(now - cfg.keepHeldDays * DAY);
  const to = dayOf(now + cfg.horizonDays * DAY);
  const unmatched = new Set<string>();
  const merged = new Map<string, { entry: CalendarEntry; place: Place }>();
  for (const e of cal.entries) {
    if (e.date < from || e.date > to) continue;
    const place = places.byName(e.countryName);
    if (!place) { unmatched.add(e.countryName); continue; }
    const id = `${e.date}-${place.iso3.toLowerCase()}-${slug(e.article)}${e.round ? `-r${e.round}` : ''}`;
    const prev = merged.get(id);
    if (prev) prev.entry = { ...prev.entry, types: [...new Set([...prev.entry.types, ...e.types])], label: `${prev.entry.label}; ${e.label}` };
    else merged.set(id, { entry: e, place });
  }
  if (unmatched.size) log(`elections: not national states or not matched, left out: ${[...unmatched].join(', ')}`);

  /* each election's article: its lead, and the previous election's turnout and margin */
  const articles = readJson<Record<string, ArticleInfo>>(articlesFile, {});
  if (!options.offline) {
    for (const [, { entry }] of merged) {
      const have = articles[entry.article];
      const held = (entry.dateEnd ?? entry.date) < today;
      // Weekly, and for a held election daily until the article states a result.
      const due = !have || now - Date.parse(have.fetchedAt) > cfg.calendarRefreshDays * DAY || (held && now - Date.parse(have.fetchedAt) > DAY);
      if (!due) continue;
      const text = await wikitext(entry.article);
      const info: ArticleInfo = { lead: await lead(entry.article), previous: null, prevYear: null, turnout: null, margin: null, fetchedAt: new Date(now).toISOString() };
      const previous = text ? previousFrom(text) : null;
      if (previous && !entry.types.every((t) => t === 'referendum')) {
        const prevText = await wikitext(previous);
        if (prevText) Object.assign(info, closeness(prevText), { previous, prevYear: Number(/\b(19|20)\d{2}\b/.exec(previous)?.[0]) || null });
      }
      articles[entry.article] = info;
      await sleep(250);
    }
    writeJson(articlesFile, articles);
  }

  /* our own counts: incidents per country per day */
  const baseline = readJson<{ countries: Record<string, { days: { day: string; eventCount: number }[] }> }>(path.join(dataDir, 'baseline.json'), { countries: {} }).countries;
  const lastDay = Object.values(baseline).flatMap((c) => c.days.map((d) => d.day)).sort().at(-1) ?? today;
  const count = (fips: string, fromDay: string, toDay: string) => (baseline[fips]?.days ?? []).filter((d) => d.day >= fromDay && d.day <= toDay).reduce((a, d) => a + d.eventCount, 0);
  const shift = (d: string, n: number) => dayOf(Date.parse(`${d}T00:00:00Z`) + n * DAY);
  const last30From = shift(lastDay, -29); const prev30From = shift(lastDay, -59); const prev30To = shift(lastDay, -30);
  const latest = (id: string, iso3: string) => wb.series[id]?.[iso3]?.at(-1);
  // Incidents per million people in the past 30 days, for every country with a population figure.
  const perMillion = new Map<string, number>();
  for (const p of places.byIso2.values()) {
    const pop = latest(WB.population, p.iso3)?.value;
    if (pop && pop > 100_000) perMillion.set(p.fips, count(p.fips, last30From, lastDay) / (pop / 1e6));
  }
  const allRates = [...perMillion.values()];

  const crisisOf = (fips: string) => crisesCfg.crises.find((c) => c.fips.includes(fips)) ?? null;
  const vdemPage = cfg.sources.find((s) => s.id === 'vdem')!.page; const peiPage = cfg.sources.find((s) => s.id === 'pei')!.page;
  const rsfPage = cfg.sources.find((s) => s.id === 'rsf')!.page; const fhPage = cfg.sources.find((s) => s.id === 'fh')!.page;
  const wbUrl = (id: string, iso2: string) => `https://data.worldbank.org/indicator/${id}?locations=${iso2}`;
  const s = cfg.scales;

  function indicatorsFor(place: Place, info: ArticleInfo | undefined): Indicator[] {
    const out: Indicator[] = [];
    const v = VDEM.get(place.iso3);
    const p = PEI.filter((e) => e.iso3 === place.iso3).sort((a, b) => b.date.localeCompare(a.date))[0];
    out.push(indicator('quality', [
      ...(v ? [{ key: 'vdem', source: 'V-Dem, clean elections index', url: vdemPage, year: String(v.year), raw: v.value, unit: 'index', risk: risk.vdem(v.value) }] : []),
      ...(p ? [{ key: 'pei', source: `Electoral Integrity Project (PEI), ${p.office.toLowerCase()} election ${p.date}`, url: peiPage, year: String(p.year), raw: p.index, unit: 'of100', risk: risk.inverse100(p.index), meta: { office: p.office.toLowerCase(), date: p.date } }] : []),
    ]));
    // Unrest at the previous election: NELDA and ECAV need registration (see the manifest).
    out.push(indicator('unrest', []));
    const r = RSF.get(place.iso3); const f = FH.get(place.iso3);
    out.push(indicator('press', [
      ...(r !== undefined ? [{ key: 'rsf', source: 'RSF, World Press Freedom Index', url: rsfPage, year: '2026', raw: r, unit: 'of100', risk: risk.inverse100(r) }] : []),
      ...(f !== undefined ? [{ key: 'fh', source: 'Freedom House, Freedom in the World', url: fhPage, year: '2026', raw: f, unit: 'of100', risk: risk.inverse100(f) }] : []),
    ]));
    const c30 = count(place.fips, last30From, lastDay); const p30 = count(place.fips, prev30From, prev30To);
    const rate = perMillion.get(place.fips);
    const span = `${last30From}/${lastDay}`;
    out.push(indicator('now', [
      ...(rate !== undefined ? [{ key: 'events', source: 'GDELT, as IGRED counts it (violent protest, repression and armed violence)', url: 'https://map.igred.org/metode/', year: span, raw: c30, unit: 'incidents', risk: percentile(rate, allRates) }] : []),
      { key: 'trend', source: 'GDELT, as IGRED counts it: the past 30 days against the 30 before', url: 'https://map.igred.org/metode/', year: span, raw: p30 ? ((c30 - p30) / p30) * 100 : c30 ? 100 : 0, unit: 'pct', risk: risk.trend(c30, p30) },
    ], (parts) => {
      const ev = parts.find((x) => x.key === 'events'); const tr = parts.find((x) => x.key === 'trend')!;
      return ev ? 0.6 * ev.risk + 0.4 * tr.risk : tr.risk;
    }));
    out.push(indicator('close', info?.previous ? [
      ...(info.margin !== null ? [{ key: 'margin', source: `Wikipedia: ${info.previous}`, url: wikiUrl(info.previous), year: String(info.prevYear ?? ''), raw: info.margin, unit: 'points', risk: risk.margin(info.margin, s), meta: { article: info.previous } }] : []),
      ...(info.turnout !== null ? [{ key: 'turnout', source: `Wikipedia: ${info.previous}`, url: wikiUrl(info.previous), year: String(info.prevYear ?? ''), raw: info.turnout, unit: 'pct', risk: risk.turnout(info.turnout, s), meta: { article: info.previous } }] : []),
    ] : []));
    const gdp = latest(WB.gdpPerPerson, place.iso3); const debt = latest(WB.debt, place.iso3);
    const fx = wb.series[WB.exchangeRate]?.[place.iso3] ?? [];
    const fxNow = fx.at(-1); const fxThen = fxNow ? fx.find((x) => x.year === fxNow.year - s.depreciationYears) : undefined;
    const dep = fxNow && fxThen && fxThen.value > 0 ? (fxNow.value / fxThen.value - 1) * 100 : null;
    out.push(indicator('economy', [
      ...(gdp ? [{ key: 'gdp', source: 'World Bank, GDP per person (current US$)', url: wbUrl(WB.gdpPerPerson, place.iso2), year: String(gdp.year), raw: gdp.value, unit: 'usd', risk: risk.gdp(gdp.value, s) }] : []),
      ...(debt ? [{ key: 'debt', source: 'World Bank, central government debt (share of GDP)', url: wbUrl(WB.debt, place.iso2), year: String(debt.year), raw: debt.value, unit: 'pct', risk: risk.debt(debt.value, s) }] : []),
      ...(dep !== null ? [{ key: 'currency', source: `World Bank, official exchange rate against the US dollar, ${fxThen!.year} to ${fxNow!.year}`, url: wbUrl(WB.exchangeRate, place.iso2), year: String(fxNow!.year), raw: dep, unit: 'pct', risk: risk.depreciation(dep, s), meta: { from: String(fxThen!.year), to: String(fxNow!.year) } }] : []),
    ]));
    return out;
  }

  /* the sentences: why it matters before, the result after */
  const sentences = readJson<Record<string, SentenceState>>(sentencesFile, {});
  const inputs: SentenceInput[] = [];
  for (const [id, { entry, place }] of merged) {
    const info = articles[entry.article];
    const held = (entry.dateEnd ?? entry.date) < today;
    if (!info?.lead) continue;
    const title = `${place.name}, ${entry.label}, ${entry.date}`;
    const material = `Calendar: ${entry.date}: ${place.name}, ${entry.line}.\nWikipedia, "${entry.article}": ${info.lead}`.slice(0, 1500);
    inputs.push({ id, kind: held ? 'result' : 'why', title, material });
  }
  if (!options.offline) {
    for (const line of await writeSentences(inputs, sentences, crisesCfg.settings.summary, { ...cfg.why, retryDays: 3 }, now, options.env)) log(line);
    writeJson(sentencesFile, sentences);
  }

  /* the elections */
  const elections: Election[] = [];
  for (const [id, { entry, place }] of merged) {
    const info = articles[entry.article];
    const held = (entry.dateEnd ?? entry.date) < today;
    const indicators = indicatorsFor(place, info);
    const sc = combine(indicators, cfg.weights, cfg.levels);
    const crisis = crisisOf(place.fips);
    let unrest: Election['unrest'] = null;
    if (held) {
      const d = cfg.unrest.days;
      const afterTo = shift(entry.date, d - 1);
      const complete = afterTo <= lastDay;
      const after = count(place.fips, entry.date, complete ? afterTo : lastDay);
      const before = count(place.fips, shift(entry.date, -d), shift(entry.date, -1));
      unrest = { days: d, complete, after, before, unrest: after >= cfg.unrest.minEvents && after >= before * cfg.unrest.ratio };
    }
    elections.push({
      id, date: entry.date, ...(entry.dateEnd ? { dateEnd: entry.dateEnd } : {}),
      status: held ? 'held' : 'upcoming',
      country: { iso2: place.iso2, iso3: place.iso3, fips: place.fips, en: place.name, nb: place.nb },
      center: place.center,
      types: entry.types, ...(entry.round ? { round: entry.round } : {}),
      label: entry.label,
      wiki: { title: entry.article, url: wikiUrl(entry.article) },
      why: held ? null : sentenceFor(sentences, id, 'why'),
      result: held ? sentenceFor(sentences, id, 'result') : null,
      unrest,
      ...sc,
      indicators,
      crisis: crisis ? { id: crisis.id, en: crisis.name, nb: crisis.nameNb } : null,
    });
  }
  elections.sort((a, b) => a.date.localeCompare(b.date) || a.country.en.localeCompare(b.country.en));

  const out = {
    artifactVersion: 1,
    generatedAt: new Date(now).toISOString(),
    calendar: { fetchedAt: cal.fetchedAt, pages: cfg.calendarPages.map((p) => ({ title: p.replace(/_/g, ' '), url: wikiUrl(p) })) },
    countsThrough: lastDay,
    method: { weights: cfg.weights, levels: cfg.levels, scales: cfg.scales, unrest: cfg.unrest, mapLayerDays: cfg.mapLayerDays, indicators: INDICATORS },
    sources: Object.values(manifest).map(({ sha256: _s, bytes: _b, ...m }) => m),
    worldBank: { fetchedAt: wb.fetchedAt, url: 'https://data.worldbank.org/' },
    elections,
  };
  writeJson(outFile, out);
  return { elections: elections.length, scored: elections.filter((e) => e.score !== null).length };
}

export type { Part };
