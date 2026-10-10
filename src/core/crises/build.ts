import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { configDir, dataDir } from '../util/paths.js';
import { writeArtifact } from '../pipeline/store.js';
import {
  clean, commonsCredits, gdeltDoc, googleNews, googleNewsUrl, wikipedia, worldBank,
  WORLD_BANK_INDICATORS, type WikiSummary, type WorldBankData,
} from './fetchers.js';
import {
  countriesIndex, crisisDetail, homeSnapshot, wireFile, crisisIndex, mapEvents, MAP_EVENT_FIELDS,
  type CrisisArticle, type CrisisDetail, type CrisisImage, type CrisisIndexEntry, type CrisisIndicator,
} from './schema.js';
import { currentSummary, runSummaries, type SummaryInput, type SummarySettings, type SummaryState } from './summary.js';
import { CATEGORY, COUNTRY, countryName, joinNames } from './names.js';

/* ---------- inputs ----------------------------------------------------- */

interface CrisisDef {
  id: string; name: string; nameNb: string; short?: string; shortNb?: string; region: string; regionNb: string;
  fips: string[]; iso3: string[]; wikipedia?: string; query: string; terms: string;
}
interface CrisesConfig {
  settings: {
    autoCrisisMinReported7d: number; autoCrisisExclude?: string[]; newsPerCrisis: number; gdeltSpacingMs: number;
    wikipediaRefreshHours: number; worldBankRefreshHours: number;
    summary: SummarySettings;
  };
  crises: CrisisDef[];
}

interface Provenance { url: string; publisher?: string }
interface EventRec {
  id: string; occurredAt: string; category: string; label: string; confidence: string;
  severity: number; intensity: number; reportCount: number; distinctPublishers: number;
  location: { lat: number; lon: number; name: string; countryFips: string };
  provenance: Provenance[];
}
interface ConflictRec {
  name: string; type: string; status: string; startDate?: string;
  countries: { name: string; fips: string }[];
  parties?: { name: string }[];
  figures?: Record<string, { value: number; asOf?: string }>;
}
interface StoryRec {
  id: string;
  headline: string; headlineFrom: { publisher: string; url: string };
  countries: { fips: string }[]; lastSeenAt: string; articleCount: number; distinctPublishers: number;
  prominence: number;
  articles: { title: string; url: string; publisher: string; publishedAt: string; tier?: number }[];
}
interface MediaRec {
  posts: { author: string; authorHandle: string; text: string; url: string; postedAt: string; watchKey: string }[];
  videos: { title: string; channel: string; videoId: string; url: string; publishedAt: string; watchKey: string }[];
}

interface Cache {
  wikipedia: Record<string, { at: string; data: { en?: WikiSummary; nb?: WikiSummary } | null }>;
  worldBank: { at: string; data: WorldBankData } | null;
  gdelt: Record<string, { at: string; articles: CrisisArticle[] }>;
  gnews: Record<string, { at: string; articles: CrisisArticle[] }>;
  commons: Record<string, { author?: string; license?: string }>;
}

const readJson = <T>(file: string): T | undefined =>
  existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as T) : undefined;

const cacheFile = path.join(dataDir, 'internal', 'crisis-cache.json');

const summariesFile = path.join(dataDir, 'internal', 'crisis-summaries.json');

function writeInternal(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
}

function writeCache(cache: Cache): void {
  // News organisations' preview pictures are no longer used anywhere; old lookups go.
  delete (cache as Partial<Cache> & { og?: unknown }).og;
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(`${cacheFile}.tmp`, JSON.stringify(cache));
  renameSync(`${cacheFile}.tmp`, cacheFile);
}

/* ---------- verified incidents ----------------------------------------- */

interface VerifiedEntry { id: string; note: string; source: string; verifiedAt?: string }

/** config/verified-events.json plus one file per incident in config/verified-events/. */
export function readVerified(): Record<string, { note: string; source: string; verifiedAt?: string }> {
  const entries: VerifiedEntry[] = [];
  const main = readJson<{ events?: VerifiedEntry[] }>(path.join(configDir, 'verified-events.json'));
  entries.push(...(main?.events ?? []));
  const dir = path.join(configDir, 'verified-events');
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const entry = JSON.parse(readFileSync(path.join(dir, file), 'utf-8')) as VerifiedEntry;
        entries.push({ ...entry, id: entry.id || file.replace(/\.json$/, '') });
      } catch {
        // a half-typed file from a phone is skipped, not fatal
      }
    }
  }
  const out: Record<string, { note: string; source: string; verifiedAt?: string }> = {};
  for (const e of entries) {
    const id = String(e.id ?? '').replace(/^evt_/, '').trim();
    if (!/^[0-9a-f]{8,}$/.test(id) || !e.note?.trim() || !/^https?:\/\//.test(e.source ?? '')) continue;
    out[id] = { note: e.note.trim().slice(0, 280), source: e.source, ...(e.verifiedAt ? { verifiedAt: e.verifiedAt } : {}) };
  }
  return out;
}

/* ---------- helpers ---------------------------------------------------- */

const DAY = 86_400_000;

/** The thirty days ending today (UTC), oldest first. */
function daysOf(nowRef: number): string[] {
  const out: string[] = [];
  for (let k = 29; k >= 0; k--) out.push(new Date(nowRef - k * DAY).toISOString().slice(0, 10));
  return out;
}
const hoursSince = (iso: string | undefined, now: number) => (iso ? (now - Date.parse(iso)) / 3_600_000 : Infinity);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function placeOf(name: string): string {
  const parts = clean(name).split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? name;
  const first = parts[0]!;
  const country = parts[parts.length - 1]!;
  return first === country ? first : `${first}, ${country}`;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

/** Place words from a query, for matching posts and videos by text. */
function placeTerms(query: string): RegExp | undefined {
  const words = [...query.matchAll(/"([^"]+)"|([a-z][a-z-]{2,})/gi)]
    .map((m) => (m[1] ?? m[2] ?? '').toLowerCase())
    .filter((w) => w && w !== 'or' && w !== 'and');
  if (words.length === 0) return undefined;
  return new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Some feeds give a homepage address where the outlet's name belongs; the host name reads better. */
export function outletName(publisher: string | undefined, url?: string): string {
  const raw = (publisher ?? '').trim();
  const fromUrl = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  if (/^https?:\/\//i.test(raw)) return fromUrl(raw) || raw;
  if (raw) return raw;
  return url ? fromUrl(url) || 'source' : 'source';
}

/**
 * Which kind of picture a Commons file is, from its name and caption. Maps and places lead;
 * portraits come last; flags, arms and logos are dropped before this is ever asked.
 */
export function imageKind(file: string, caption: string): CrisisImage['kind'] {
  const text = `${file} ${caption}`.replace(/_/g, ' ');
  if (/\bmaps?\b|karte|carte|locator|location map|situation map|\.svg|areas? of control|territorial control|front ?line/i.test(text)) return 'map';
  if (/city|town|village|street|market|river|nile|mountain|desert|camp|museum|mosque|church|skyline|landscape|aerial view|valley|harbou?r|bridge|square|building|ruins|damaged|destroyed/i.test(text)) return 'place';
  if (/\(cropped\)|portrait|president|minister|general\b|governor|leader|commander|\bmeets?\b|speech|speaking|visit|summit|king\b|emir|sheikh|\b(19|20)\d\d\b/i.test(text)) return 'person';
  return 'other';
}

const KIND_ORDER: Record<CrisisImage['kind'], number> = { map: 0, place: 1, other: 2, person: 3 };

function fmtInt(n: number, lang: 'en' | 'nb'): string {
  return n.toLocaleString(lang === 'en' ? 'en-GB' : 'nb-NO').replace(/ /g, ' ');
}

/* ---------- the fixed-template status line --------------------------- */

/**
 * One sentence over the counts, composed in code. It is what the page shows when no
 * machine-written summary has passed the guard, and the frame above one when it has.
 */
export function statusLine(
  lang: 'en' | 'nb',
  stats: Pick<CrisisDetail['stats'], 'last7d' | 'prev7d' | 'change7dPct' | 'last30d' | 'hotspots'>,
): string {
  const en = lang === 'en';
  const n7 = stats.last7d;
  if (n7 === 0) {
    return en
      ? `No armed incidents reported in the past seven days; ${fmtInt(stats.last30d, lang)} in the past 30.`
      : `Ingen væpnede hendelser meldt de siste sju dagene; ${fmtInt(stats.last30d, lang)} de siste 30.`;
  }
  let change = '';
  if (stats.prev7d >= 5 && stats.change7dPct !== null && Math.abs(stats.change7dPct) >= 15) {
    const pct = Math.round(Math.abs(stats.change7dPct));
    change = stats.change7dPct > 0
      ? (en ? `, ${pct}% more than the week before` : `, ${pct} prosent flere enn uken før`)
      : (en ? `, ${pct}% fewer than the week before` : `, ${pct} prosent færre enn uken før`);
  }
  const spots = stats.hotspots.slice(0, 3).map((h) => h.name.split(',')[0]!);
  const where = spots.length ? (en ? `, most of them in ${joinNames(spots, lang)}` : `, flest i ${joinNames(spots, lang)}`) : '';
  return en
    ? `${fmtInt(n7, lang)} armed ${n7 === 1 ? 'incident' : 'incidents'} reported in the past seven days${change}${where}.`
    : `${fmtInt(n7, lang)} ${n7 === 1 ? 'væpnet hendelse' : 'væpnede hendelser'} meldt de siste sju dagene${change}${where}.`;
}

/* ---------- build ------------------------------------------------------ */

export interface BuildOptions { offline?: boolean; log?: (line: string) => void }

export async function buildCrises(options: BuildOptions = {}): Promise<{ crises: number; mapEvents: number }> {
  const log = options.log ?? (() => {});
  const config = JSON.parse(readFileSync(path.join(configDir, 'crises.json'), 'utf-8')) as CrisesConfig;
  const settings = config.settings;

  const eventsArtifact = readJson<{ generatedAt: string; events: EventRec[] }>(path.join(dataDir, 'events.json'));
  if (!eventsArtifact) throw new Error('events.json is missing; run the ingest first.');
  const conflicts = readJson<{ conflicts: ConflictRec[] }>(path.join(dataDir, 'conflicts.json'))?.conflicts ?? [];
  const stories = readJson<{ stories: StoryRec[] }>(path.join(dataDir, 'stories.json'))?.stories ?? [];
  const media = readJson<MediaRec>(path.join(dataDir, 'media.json')) ?? { posts: [], videos: [] };
  // Which Brief edition carried a story most recently, so the crisis can link to it there.
  const editionOf = new Map<string, string>();
  const editionsDir = path.join(dataDir, 'editions');
  if (existsSync(editionsDir)) {
    const dated = readdirSync(editionsDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-14);
    for (const file of dated) {
      const edition = readJson<{ date: string; stories: { id: string }[] }>(path.join(editionsDir, file));
      for (const st of edition?.stories ?? []) editionOf.set(st.id, edition!.date);
    }
  }
  const cache: Cache = {
    wikipedia: {}, worldBank: null, gdelt: {}, gnews: {}, commons: {},
    ...(readJson<Partial<Cache>>(cacheFile) ?? {}),
  } as Cache;
  const summaryStates = readJson<Record<string, SummaryState>>(summariesFile) ?? {};
  const verified = readVerified();

  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const events = eventsArtifact.events;
  const nowRef = Math.max(now, Date.parse(eventsArtifact.generatedAt));

  /* Automatic crises: a country on the register with an active conflict and sustained,
     corroborated reporting that no editorial crisis already covers. */
  const covered = new Set(config.crises.flatMap((c) => c.fips));
  const activeByFips = new Map<string, ConflictRec[]>();
  for (const c of conflicts) {
    if (c.status !== 'active') continue;
    for (const k of c.countries) activeByFips.set(k.fips, [...(activeByFips.get(k.fips) ?? []), c]);
  }
  const reported7dByFips = new Map<string, number>();
  for (const e of events) {
    if (e.confidence === 'reported' && nowRef - Date.parse(e.occurredAt) < 7 * DAY) {
      reported7dByFips.set(e.location.countryFips, (reported7dByFips.get(e.location.countryFips) ?? 0) + 1);
    }
  }
  const defs: (CrisisDef & { auto: boolean })[] = config.crises.map((c) => ({ ...c, auto: false }));
  for (const [fips, n] of reported7dByFips) {
    if (covered.has(fips) || (settings.autoCrisisExclude ?? []).includes(fips) || !activeByFips.has(fips) || n < settings.autoCrisisMinReported7d) continue;
    const names = COUNTRY[fips];
    const en = names?.en ?? events.find((e) => e.location.countryFips === fips)?.location.name.split(',').pop()?.trim() ?? fips;
    defs.push({
      id: `auto-${fips.toLowerCase()}`, name: en, nameNb: names?.nb ?? en, region: '', regionNb: '',
      fips: [fips], iso3: names?.iso3 ? [names.iso3] : [], query: `("${en.toLowerCase()}")`,
      terms: '(attack OR killed OR clashes OR violence)', auto: true,
    });
    log(`auto crisis: ${en} (${n} corroborated incidents in 7 days)`);
  }

  const crisisOfFips = new Map<string, number>();
  defs.forEach((d, i) => d.fips.forEach((f) => { if (!crisisOfFips.has(f)) crisisOfFips.set(f, i); }));

  /* ---- outside sources, refreshed on their own clocks ---- */
  if (!options.offline) {
    if (hoursSince(cache.worldBank?.at, now) > settings.worldBankRefreshHours) {
      const iso3 = [...new Set(defs.flatMap((d) => d.iso3))];
      const wb = await worldBank(iso3);
      if (wb) cache.worldBank = { at: generatedAt, data: wb };
      log(`world bank: ${wb ? 'refreshed' : 'kept last good'}`);
    }
    for (const d of defs) {
      if (!d.wikipedia) continue;
      const hit = cache.wikipedia[d.id];
      if (hit && hit.data && hoursSince(hit.at, now) < settings.wikipediaRefreshHours) continue;
      const w = await wikipedia(d.wikipedia);
      if (w) cache.wikipedia[d.id] = { at: generatedAt, data: w };
      await sleep(600);
    }
    // GDELT's article index throttles hard and sometimes stops answering for a while. After
    // three refusals in a row the rest of this run keeps last hour's articles instead of
    // queuing up timeouts.
    let gdeltFailures = 0;
    for (const [i, d] of defs.entries()) {
      let g: CrisisArticle[] | undefined;
      if (gdeltFailures < 3) {
        if (i > 0) await sleep(settings.gdeltSpacingMs);
        g = await gdeltDoc(`${d.query} ${d.terms}`, 75);
        gdeltFailures = g ? 0 : gdeltFailures + 1;
      }
      if (g) cache.gdelt[d.id] = { at: generatedAt, articles: g };
      const n = await googleNews(`${d.query.replace(/[()]/g, '')} ${d.terms.replace(/[()]/g, '')}`);
      if (n) cache.gnews[d.id] = { at: generatedAt, articles: n };
      log(`${d.id}: gdelt ${g ? g.length : 'kept'} · google news ${n ? n.length : 'kept'}`);
    }
    // Credits for every Commons picture the pages may show, looked up once per file.
    const files = new Set<string>();
    for (const w of Object.values(cache.wikipedia)) {
      if (w.data?.en?.image?.file) files.add(w.data.en.image.file.replace(/ /g, '_'));
      for (const g of w.data?.en?.gallery ?? []) files.add(g.file.replace(/ /g, '_'));
    }
    const missing = [...files].filter((f) => !(f in cache.commons));
    if (missing.length) {
      const found = await commonsCredits(missing);
      for (const f of missing) cache.commons[f] = found[f] ?? {};
      log(`commons credits: looked up ${missing.length}`);
    }
  }

  /* ---- per crisis ---- */
  const details: CrisisDetail[] = [];
  const summaryInputs: SummaryInput[] = [];

  for (const d of defs) {
    const fipsSet = new Set(d.fips);
    const evs = events.filter((e) => fipsSet.has(e.location.countryFips));
    const age = (e: EventRec) => nowRef - Date.parse(e.occurredAt);
    const in7 = evs.filter((e) => age(e) < 7 * DAY);
    const prev7 = evs.filter((e) => age(e) >= 7 * DAY && age(e) < 14 * DAY);
    const in30 = evs.filter((e) => age(e) < 30 * DAY);

    const daily: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(nowRef - i * DAY).toISOString().slice(0, 10);
      daily.push({ date: day, count: 0 });
    }
    const dayIndex = new Map(daily.map((x, i) => [x.date, i]));
    for (const e of in30) {
      const i = dayIndex.get(e.occurredAt.slice(0, 10));
      if (i !== undefined) daily[i]!.count += 1;
    }

    const countCats = (list: EventRec[]) => {
      const out: Record<string, number> = {};
      for (const e of list) out[e.category] = (out[e.category] ?? 0) + 1;
      return out;
    };

    const spots = new Map<string, { name: string; lat: number; lon: number; count: number }>();
    for (const e of in30) {
      const name = placeOf(e.location.name);
      const s = spots.get(name) ?? { name, lat: e.location.lat, lon: e.location.lon, count: 0 };
      s.count += 1;
      spots.set(name, s);
    }
    // Country-level geocodes ("Ukraine") say nothing about where; they are left out of hotspots.
    const countryNames = new Set(d.fips.map((f) => countryName(f, 'en')));
    const hotspots = [...spots.values()]
      .filter((s) => !countryNames.has(s.name) && !/\(general\)/i.test(s.name))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const lats = in30.map((e) => e.location.lat).sort((a, b) => a - b);
    const lons = in30.map((e) => e.location.lon).sort((a, b) => a - b);
    const fallback = COUNTRY[d.fips[0]!]?.center ?? [0, 0];
    const center: [number, number] = lats.length ? [quantile(lons, 0.5), quantile(lats, 0.5)] : [fallback[0], fallback[1]];
    let bbox: [number, number, number, number] = lats.length
      ? [quantile(lons, 0.05), quantile(lats, 0.05), quantile(lons, 0.95), quantile(lats, 0.95)]
      : [center[0] - 5, center[1] - 4, center[0] + 5, center[1] + 4];
    if (bbox[2] - bbox[0] < 4) bbox = [center[0] - 3, bbox[1], center[0] + 3, bbox[3]];
    if (bbox[3] - bbox[1] < 3) bbox = [bbox[0], center[1] - 2, bbox[2], center[1] + 2];
    bbox = bbox.map((v) => Math.round(v * 100) / 100) as typeof bbox;

    const corroborated = in7.filter((e) => e.distinctPublishers >= 2);
    const stats: CrisisDetail['stats'] = {
      last24h: evs.filter((e) => age(e) < DAY).length,
      last7d: in7.length,
      prev7d: prev7.length,
      last30d: in30.length,
      change7dPct: prev7.length > 0 ? Math.round(((in7.length - prev7.length) / prev7.length) * 1000) / 10 : null,
      reported7d: in7.filter((e) => e.confidence === 'reported' || e.distinctPublishers > 1).length,
      outlets30d: new Set(in30.flatMap((e) => e.provenance.map((p) => p.publisher ?? ''))).size,
      corroborated7d: corroborated.length,
      score: corroborated.reduce((sum, e) => sum + e.severity, 0),
      level: 0,
      daily,
      categories7d: countCats(in7),
      categories30d: countCats(in30),
      hotspots,
    };

    /* register */
    const active = [...new Set(d.fips.flatMap((f) => activeByFips.get(f) ?? []))];
    const conflictsOut = active.slice(0, 14).map((c) => {
      const out: CrisisDetail['conflicts'][number] = {
        name: c.name, type: c.type, parties: (c.parties ?? []).map((p) => p.name),
      };
      if (c.startDate) out.startDate = c.startDate;
      const lvl = c.figures?.ucdpIntensityLevel?.value;
      if (typeof lvl === 'number') out.intensityLevel = lvl;
      const fat = c.figures?.fatalitiesBestEstimate;
      if (fat && typeof fat.value === 'number') {
        out.fatalities = fat.value;
        if (fat.asOf) out.fatalitiesAsOf = fat.asOf;
      }
      return out;
    });

    /* clustered stories from the curated feeds */
    const storyHits = stories
      .filter((s) => s.countries.some((c) => fipsSet.has(c.fips)))
      .sort((a, b) => b.distinctPublishers - a.distinctPublishers || b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 12);
    const headlines: CrisisDetail['headlines'] = storyHits.map((s) => ({
      storyId: s.id,
      ...(editionOf.has(s.id) ? { edition: editionOf.get(s.id)! } : {}),
      headline: s.headline,
      publisher: s.headlineFrom.publisher,
      url: s.headlineFrom.url,
      lastSeenAt: s.lastSeenAt,
      articleCount: s.articleCount,
      outlets: [...new Set(s.articles.map((a) => a.publisher))],
      articles: s.articles.slice(0, 30).map((a) => ({ title: a.title, url: a.url, publisher: a.publisher, publishedAt: a.publishedAt })),
    }));

    /* news: every source pooled, deduplicated by headline, newest first */
    const pool: CrisisArticle[] = [];
    for (const s of storyHits) for (const a of s.articles) {
      const item: CrisisArticle = { title: a.title, url: a.url, publisher: a.publisher, publishedAt: a.publishedAt, via: 'feed' };
      if (a.tier) item.tier = a.tier;
      pool.push(item);
    }
    // Older caches carried publishers' preview pictures; they are stripped on the way through.
    pool.push(...[...(cache.gdelt[d.id]?.articles ?? []), ...(cache.gnews[d.id]?.articles ?? [])]
      .map(({ image: _image, ...a }: CrisisArticle & { image?: string }) => a));
    for (const a of pool) a.publisher = outletName(a.publisher, a.url);
    const seen = new Set<string>();
    const news = pool
      .filter((a) => now - Date.parse(a.publishedAt) < 4 * DAY)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .filter((a) => {
        const key = normTitle(a.title);
        if (seen.has(key) || seen.has(a.url)) return false;
        seen.add(key); seen.add(a.url);
        return true;
      })
      .slice(0, settings.newsPerCrisis * 2);
    const newsOut = news.slice(0, settings.newsPerCrisis);

    /* images: Wikimedia Commons only — the article's lead picture and its gallery, maps and
       places before portraits. News organisations' pictures are never used. */
    const wiki = cache.wikipedia[d.id]?.data ?? null;
    const images: CrisisImage[] = [];
    const commonsImage = (src: string, file: string | undefined, caption: string, fallbackUrl: string): CrisisImage => {
      const key = file?.replace(/ /g, '_');
      const credit = key ? cache.commons[key] : undefined;
      const img: CrisisImage = {
        src, caption,
        url: file ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(key!)}` : fallbackUrl,
        credit: 'Wikimedia Commons',
        kind: imageKind(file ?? src, caption),
      };
      if (credit?.author) img.author = credit.author;
      if (credit?.license) img.license = credit.license;
      return img;
    };
    if (wiki?.en?.image && !/flag|logo|coat.of.arms|emblem|seal/i.test(wiki.en.image.src)) {
      images.push(commonsImage(wiki.en.image.src, wiki.en.image.file, wiki.en.title, wiki.en.url));
    }
    for (const g of wiki?.en?.gallery ?? []) {
      if (images.some((im) => im.src === g.src || (wiki?.en?.image?.file && g.file === wiki.en.image.file))) continue;
      images.push(commonsImage(g.src, g.file, g.caption, wiki!.en!.url));
    }
    images.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

    /* curated posts and videos, matched by watch list or by place name */
    const re = placeTerms(d.query);
    const watchKeys = new Set([d.id]);
    const posts = media.posts
      .filter((p) => watchKeys.has(p.watchKey) || (re?.test(p.text) ?? false))
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
      .slice(0, 12)
      .map((p) => ({ author: p.author, handle: p.authorHandle, text: p.text, url: p.url, postedAt: p.postedAt }));
    const videos = media.videos
      .filter((v) => watchKeys.has(v.watchKey) || (re?.test(v.title) ?? false))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, 8)
      .map((v) => ({ title: v.title, channel: v.channel, videoId: v.videoId, url: v.url, publishedAt: v.publishedAt }));

    /* the incident record */
    const incidents = [...in7]
      .sort((a, b) => b.intensity - a.intensity || b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 40)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .map((e) => {
        const item: CrisisDetail['incidents'][number] = {
          at: e.occurredAt, category: e.category, place: placeOf(e.location.name),
          lat: e.location.lat, lon: e.location.lon, intensity: e.intensity, reports: e.reportCount,
          outlets: e.distinctPublishers, id: e.id,
          sources: e.provenance.map((p) => ({ url: p.url, publisher: outletName(p.publisher, p.url) })),
        };
        return item;
      });

    /* every outlet behind the page, counted */
    const outletCount = new Map<string, number>();
    const bump = (name: string | undefined) => { if (name) outletCount.set(name, (outletCount.get(name) ?? 0) + 1); };
    for (const e of in30) for (const p of e.provenance) bump(outletName(p.publisher, p.url));
    for (const a of newsOut) bump(a.publisher);
    for (const h of headlines) for (const a of h.articles) bump(a.publisher);
    const sourceUrls = new Set<string>([
      ...in30.flatMap((e) => e.provenance.map((p) => p.url)),
      ...newsOut.map((a) => a.url),
      ...headlines.flatMap((h) => h.articles.map((a) => a.url)),
      ...posts.map((p) => p.url), ...videos.map((v) => v.url),
    ]);

    /* indicators */
    const indicators: CrisisIndicator[] = [];
    const wb = cache.worldBank?.data;
    if (wb) {
      for (const ind of WORLD_BANK_INDICATORS) {
        const values = d.iso3
          .map((iso3) => {
            const v = wb[ind.id]?.[iso3];
            return v ? { iso3, country: v.country, value: v.value, year: v.year } : undefined;
          })
          .filter((v): v is NonNullable<typeof v> => !!v);
        if (values.length === 0) continue;
        indicators.push({
          id: ind.id, label: ind.label, labelNb: ind.labelNb, unit: ind.unit, values,
          // The query the figures came from, by ISO3 code: the site's own ?locations= wants ISO2,
          // which slicing ISO3 does not give (UKR is UA, not UK).
          url: `https://api.worldbank.org/v2/country/${d.iso3.join(';')}/indicator/${ind.id}?format=json&mrnev=1`,
        });
      }
    }

    /* UCDP's own fatality counts, a contrast to counts of media reports */
    const span = (years: string[]) => {
      const sorted = [...new Set(years)].sort();
      return sorted.length > 1 ? `${sorted[0]}–${sorted[sorted.length - 1]}` : (sorted[0] ?? '');
    };
    const battleInd = indicators.find((ind) => ind.id === 'VC.BTL.DETH');
    const battle = battleInd && battleInd.values.length
      ? { total: Math.round(battleInd.values.reduce((sum, v) => sum + v.value, 0)), years: span(battleInd.values.map((v) => v.year)), url: battleInd.url }
      : null;
    const withFatalities = conflictsOut.filter((c) => typeof c.fatalities === 'number');
    const other = withFatalities.length
      ? {
          total: Math.round(withFatalities.reduce((sum, c) => sum + (c.fatalities ?? 0), 0)),
          years: span(withFatalities.map((c) => c.fatalitiesAsOf?.slice(0, 4)).filter((y): y is string => !!y)),
          conflicts: withFatalities.length,
        }
      : null;
    const ucdpFatalities = battle || other ? { battle, other } : null;

    let background: CrisisDetail['background'] = null;
    if (wiki?.en) {
      background = { title: wiki.en.title, extract: wiki.en.extract, url: wiki.en.url, retrievedAt: cache.wikipedia[d.id]!.at };
      if (wiki.nb) {
        background.titleNb = wiki.nb.title;
        background.extractNb = wiki.nb.extract;
        background.urlNb = wiki.nb.url;
      }
    }

    const status = { en: statusLine('en', stats), nb: statusLine('nb', stats) };

    /* material for the machine-written summary: nothing the page does not already link */
    const seenTitles = new Set<string>();
    const summaryHeadlines = [
      ...headlines.map((h) => ({ title: h.headline, url: h.url, publisher: h.publisher })),
      ...newsOut.map((a) => ({ title: a.title, url: a.url, publisher: a.publisher })),
    ].filter((h) => {
      const key = normTitle(h.title);
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    }).slice(0, 18);
    summaryInputs.push({
      id: d.id,
      name: d.name,
      facts: [
        status.en,
        `${stats.corroborated7d} of the incidents this week were carried by two or more outlets.`,
        ...(battle ? [`UCDP counted ${battle.total} battle-related deaths in ${battle.years}.`] : []),
      ],
      headlines: summaryHeadlines,
      ...(background?.extract ? { background: background.extract } : {}),
    });

    details.push({
      artifactVersion: 1,
      id: d.id, name: d.name, nameNb: d.nameNb, region: d.region, regionNb: d.regionNb, auto: d.auto,
      generatedAt,
      countries: d.fips.map((f) => ({ fips: f, name: countryName(f, 'en') })),
      center: [Math.round(center[0] * 100) / 100, Math.round(center[1] * 100) / 100],
      bbox,
      stats,
      status,
      summary: null,
      ucdpFatalities,
      background,
      indicators,
      conflicts: conflictsOut,
      headlines,
      news: newsOut,
      images,
      videos,
      posts,
      incidents,
      sourceCount: sourceUrls.size,
      outlets: [...outletCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([name, count]) => ({ name, count })),
      feeds: {
        gdelt: `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${d.query} ${d.terms} sourcelang:english`)}&mode=artlist&timespan=3d&sort=datedesc`,
        gnews: googleNewsUrl(`${d.query.replace(/[()]/g, '')} ${d.terms.replace(/[()]/g, '')}`),
        wikipedia: background?.url ?? 'https://en.wikipedia.org/',
        worldBank: `https://data.worldbank.org/country/${(d.iso3[0] ?? 'WLD').toLowerCase()}`,
      },
    });
  }

  /* level: the score relative to the highest-scoring crisis, on a log scale */
  const maxScore = Math.max(1, ...details.map((d) => d.stats.score));
  for (const d of details) {
    const w = d.stats.score;
    d.stats.level = w === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((5 * Math.log1p(w)) / Math.log1p(maxScore))));
  }

  /* machine-written summaries, on their own slower clock; failures keep the last good text */
  if (!options.offline) {
    // Highest-ranked first, so a free tier that runs dry leaves the quiet crises waiting, not the worst.
    const rank = new Map(details.map((d) => [d.id, d.stats.score * 1000 + d.stats.last7d]));
    const ordered = [...summaryInputs].sort((a, b) => (rank.get(b.id) ?? 0) - (rank.get(a.id) ?? 0));
    for (const line of await runSummaries(ordered, summaryStates, settings.summary, now)) log(line);
    writeInternal(summariesFile, summaryStates);
  }
  for (const d of details) d.summary = currentSummary(summaryStates[d.id], settings.summary.maxAgeHours, now);

  /* write */
  const dir = path.join(dataDir, 'crises');
  for (const d of details) writeArtifact(path.join(dir, `${d.id}.json`), crisisDetail, d);
  // A crisis that is no longer listed (an automatic one that went quiet) loses its page.
  const keep = new Set(details.map((d) => `${d.id}.json`));
  for (const file of readdirSync(dir)) if (file.endsWith('.json') && !keep.has(file)) unlinkSync(path.join(dir, file));

  const index: CrisisIndexEntry[] = details
    .map((d) => {
      const lead = d.headlines[0] ?? undefined;
      const news0 = d.news[0];
      return {
        id: d.id, name: d.name, nameNb: d.nameNb, region: d.region, regionNb: d.regionNb, auto: d.auto,
        short: defs.find((x) => x.id === d.id)?.short ?? d.name, shortNb: defs.find((x) => x.id === d.id)?.shortNb ?? d.nameNb,
        fips: d.countries.map((c) => c.fips), center: d.center, bbox: d.bbox,
        last24h: d.stats.last24h, last7d: d.stats.last7d, prev7d: d.stats.prev7d, last30d: d.stats.last30d,
        change7dPct: d.stats.change7dPct, corroborated7d: d.stats.corroborated7d, score: d.stats.score, level: d.stats.level,
        daily: d.stats.daily.map((x) => x.count),
        // For sharing previews: the first map or place picture, never a portrait if avoidable.
        image: d.images.find((im) => im.kind === 'map' || im.kind === 'place') ?? d.images.find((im) => im.kind !== 'person') ?? null,
        lead: lead
          ? { title: lead.headline, publisher: lead.publisher, url: lead.url, publishedAt: lead.lastSeenAt }
          : news0 ? { title: news0.title, publisher: news0.publisher, url: news0.url, publishedAt: news0.publishedAt } : null,
        sourceCount: d.sourceCount,
      };
    })
    .sort((a, b) => b.score - a.score || b.last7d - a.last7d);
  writeArtifact(path.join(dataDir, 'crises.json'), crisisIndex, {
    artifactVersion: 1, generatedAt, eventsGeneratedAt: eventsArtifact.generatedAt, crises: index,
  });

  /* compact incident stream for the map */
  const categories = [...new Set(events.map((e) => e.category))];
  const catIndex = new Map(categories.map((c, k) => [c, k]));
  const intern = () => {
    const list: string[] = [];
    const at = new Map<string, number>();
    return { list, id: (v: string) => { let k = at.get(v); if (k === undefined) { k = list.length; list.push(v); at.set(v, k); } return k; } };
  };
  const publishers = intern();
  const countryCodes = intern();
  const compact = events
    .map((e) => {
      const p = e.provenance[0];
      return [
        Math.round(Date.parse(e.occurredAt) / 60_000),
        Math.round(e.location.lon * 100), Math.round(e.location.lat * 100),
        catIndex.get(e.category) ?? 0, e.intensity, e.severity,
        crisisOfFips.get(e.location.countryFips) ?? -1,
        e.distinctPublishers, e.reportCount,
        placeOf(e.location.name), p?.url ?? '', publishers.id(outletName(p?.publisher, p?.url)),
        countryCodes.id(e.location.countryFips), e.id.replace(/^evt_/, ''),
      ] as [number, number, number, number, number, number, number, number, number, string, string, number, number, string];
    })
    .sort((a, b) => b[0] - a[0]);
  const present = new Set(events.map((e) => e.id.replace(/^evt_/, '')));
  const verifiedOut = Object.fromEntries(Object.entries(verified).filter(([id]) => present.has(id)));
  // Validated like every artifact, but written without indentation: it is the one file a
  // phone fetches before it can draw anything.
  const mapPayload = mapEvents.parse({
    artifactVersion: 2, generatedAt, fields: [...MAP_EVENT_FIELDS], categories, crises: defs.map((d) => d.id),
    publishers: publishers.list, countries: countryCodes.list, verified: verifiedOut, events: compact,
  });
  const mapFile = path.join(dataDir, 'map-events.json');
  writeFileSync(`${mapFile}.tmp`, JSON.stringify(mapPayload));
  renameSync(`${mapFile}.tmp`, mapFile);

  /* the Wire: every source behind every incident, compact */
  const wirePublishers = intern();
  const wirePlaces = intern();
  const wireItems = events
    .flatMap((e) => e.provenance.map((p) => {
      const ext = p as Provenance & { sourceId?: string; publishedAt?: string; retrievedAt?: string; sourceName?: string };
      return [
        Math.round(Date.parse(ext.publishedAt ?? ext.retrievedAt ?? e.occurredAt) / 60_000),
        p.url,
        wirePublishers.id(outletName(p.publisher ?? ext.sourceName, p.url)),
        wirePlaces.id(e.location.name),
        ext.sourceId === 'gdelt' ? 1 : 0,
      ] as [number, string, number, number, number];
    }))
    .filter((row) => /^https?:\/\//.test(row[1]))
    .sort((a, b) => b[0] - a[0]);
  const wirePayload = wireFile.parse({ artifactVersion: 1, generatedAt, publishers: wirePublishers.list, places: wirePlaces.list, items: wireItems });
  const wirePath = path.join(dataDir, 'wire.json');
  writeFileSync(`${wirePath}.tmp`, JSON.stringify(wirePayload));
  renameSync(`${wirePath}.tmp`, wirePath);

  /* every country the map can open: its active conflicts on the register */
  const countriesOut: Record<string, { name: string; nameNb: string; crisis: string | null; conflicts: { name: string; type: string; startYear?: string; fatalities?: number; fatalitiesAsOf?: string }[] }> = {};
  const fipsSeen = new Set<string>([...activeByFips.keys(), ...events.map((e) => e.location.countryFips)]);
  for (const fips of [...fipsSeen].sort()) {
    if (!fips) continue;
    const fromRegister = conflicts.flatMap((c) => c.countries).find((k) => k.fips === fips)?.name;
    const en = COUNTRY[fips]?.en ?? fromRegister ?? events.find((e) => e.location.countryFips === fips)?.location.name.split(',').pop()?.trim() ?? fips;
    const crisisIdx = crisisOfFips.get(fips);
    countriesOut[fips] = {
      name: en.replace(/^the /, ''),
      nameNb: COUNTRY[fips]?.nb ?? en.replace(/^the /, ''),
      crisis: crisisIdx === undefined ? null : defs[crisisIdx]!.id,
      conflicts: (activeByFips.get(fips) ?? []).map((c) => {
        const out: { name: string; type: string; startYear?: string; fatalities?: number; fatalitiesAsOf?: string } = { name: c.name, type: c.type };
        if (c.startDate) out.startYear = c.startDate.slice(0, 4);
        const fat = c.figures?.fatalitiesBestEstimate;
        if (fat && typeof fat.value === 'number') {
          out.fatalities = fat.value;
          if (fat.asOf) out.fatalitiesAsOf = fat.asOf;
        }
        return out;
      }),
    };
  }
  // Written only when the register's picture of a country changes, so this file is quiet.
  const countriesFile = path.join(dataDir, 'countries.json');
  const previousCountries = readJson<{ countries: unknown }>(countriesFile);
  if (JSON.stringify(previousCountries?.countries) !== JSON.stringify(countriesOut)) {
    writeArtifact(countriesFile, countriesIndex, { artifactVersion: 1, generatedAt, countries: countriesOut });
  }

  /* the front page's snapshot */
  const days = daysOf(nowRef);
  const dayIdx = new Map(days.map((d, k) => [d, k]));
  const recent = events.filter((e) => dayIdx.has(e.occurredAt.slice(0, 10)));
  // Every corroborated incident, then single-source ones evenly, up to a phone-sized sample.
  const corroboratedPts = recent.filter((e) => e.distinctPublishers >= 2);
  const single = recent.filter((e) => e.distinctPublishers < 2);
  const room = Math.max(0, 1400 - corroboratedPts.length);
  const stride = Math.max(1, Math.ceil(single.length / Math.max(1, room)));
  const sample = [...corroboratedPts.slice(0, 1400), ...single.filter((_, k) => k % stride === 0).slice(0, room)];
  let briefOut: { date: string; headlines: { headline: string; publisher: string; url: string }[] } | null = null;
  if (existsSync(editionsDir)) {
    const latest = readdirSync(editionsDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
    const edition = latest ? readJson<{ date: string; leadStoryIds?: string[]; stories: { id: string; headline: string; headlineFrom: { publisher: string; url: string } }[] }>(path.join(editionsDir, latest)) : undefined;
    if (edition) {
      const lead = new Set(edition.leadStoryIds ?? []);
      const ordered = [...edition.stories.filter((st) => lead.has(st.id)), ...edition.stories.filter((st) => !lead.has(st.id))];
      briefOut = { date: edition.date, headlines: ordered.slice(0, 6).map((st) => ({ headline: st.headline, publisher: outletName(st.headlineFrom.publisher, st.headlineFrom.url), url: st.headlineFrom.url })) };
    }
  }
  writeArtifact(path.join(dataDir, 'home.json'), homeSnapshot, {
    artifactVersion: 1, generatedAt,
    incidents7d: events.filter((e) => nowRef - Date.parse(e.occurredAt) < 7 * DAY).length,
    crisesTracked: index.length,
    days,
    crises: index.slice(0, 12).map((c) => ({ id: c.id, name: c.name, nameNb: c.nameNb, short: c.short, shortNb: c.shortNb, center: c.center, last7d: c.last7d, score: c.score })),
    points: sample.map((e) => [Math.round(e.location.lon * 10), Math.round(e.location.lat * 10), dayIdx.get(e.occurredAt.slice(0, 10))!, e.intensity, e.distinctPublishers >= 2 ? 1 : 0] as [number, number, number, number, number]),
    brief: briefOut,
  });

  if (!options.offline) writeCache(cache);
  return { crises: details.length, mapEvents: compact.length };
}
