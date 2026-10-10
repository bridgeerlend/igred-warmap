import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { configDir, dataDir } from '../util/paths.js';
import { writeArtifact } from '../pipeline/store.js';
import {
  clean, gdeltDoc, googleNews, googleNewsUrl, previewImage, wikipedia, worldBank,
  WORLD_BANK_INDICATORS, type WikiSummary, type WorldBankData,
} from './fetchers.js';
import {
  crisisDetail, crisisIndex, mapEvents,
  type CrisisArticle, type CrisisDetail, type CrisisImage, type CrisisIndexEntry, type CrisisIndicator,
} from './schema.js';
import { CATEGORY, COUNTRY, countryName, joinNames } from './names.js';

/* ---------- inputs ----------------------------------------------------- */

interface CrisisDef {
  id: string; name: string; nameNb: string; short?: string; shortNb?: string; region: string; regionNb: string;
  fips: string[]; iso3: string[]; wikipedia?: string; query: string; terms: string;
}
interface CrisesConfig {
  settings: {
    autoCrisisMinReported7d: number; autoCrisisExclude?: string[]; newsPerCrisis: number; gdeltSpacingMs: number;
    wikipediaRefreshHours: number; worldBankRefreshHours: number; imageFetchPerRun: number;
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
  og: Record<string, string | null>;
}

const readJson = <T>(file: string): T | undefined =>
  existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as T) : undefined;

const cacheFile = path.join(dataDir, 'internal', 'crisis-cache.json');

function writeCache(cache: Cache): void {
  // Old preview-image lookups are dropped once there are many: they only matter for news
  // that is still in the window.
  const og = Object.entries(cache.og);
  if (og.length > 4000) cache.og = Object.fromEntries(og.slice(-3000));
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(`${cacheFile}.tmp`, JSON.stringify(cache));
  renameSync(`${cacheFile}.tmp`, cacheFile);
}

/* ---------- helpers ---------------------------------------------------- */

const DAY = 86_400_000;
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

function fmtInt(n: number, lang: 'en' | 'nb'): string {
  return n.toLocaleString(lang === 'en' ? 'en-GB' : 'nb-NO').replace(/ /g, ' ');
}

/* ---------- the fixed-template situation text ------------------------ */

function situation(
  lang: 'en' | 'nb',
  places: string,
  stats: CrisisDetail['stats'],
  activeConflicts: { startDate?: string }[],
  lead: CrisisDetail['headlines'][number] | undefined,
): string {
  const s: string[] = [];
  const n7 = stats.last7d;
  const en = lang === 'en';

  if (n7 === 0) {
    s.push(en
      ? `No armed incidents were reported in ${places} in the past seven days. The past 30 days hold ${fmtInt(stats.last30d, lang)}.`
      : `Ingen væpnede hendelser ble meldt i ${places} de siste sju dagene. De siste 30 dagene er det registrert ${fmtInt(stats.last30d, lang)}.`);
  } else {
    let change = '';
    if (stats.prev7d >= 5 && stats.change7dPct !== null) {
      const pct = Math.round(Math.abs(stats.change7dPct));
      if (stats.change7dPct >= 15) change = en ? `, ${pct}% more than the week before` : `, ${pct} prosent flere enn uken før`;
      else if (stats.change7dPct <= -15) change = en ? `, ${pct}% fewer than the week before` : `, ${pct} prosent færre enn uken før`;
      else change = en ? ', roughly as many as the week before' : ', omtrent like mange som uken før';
    }
    s.push(en
      ? `${fmtInt(n7, lang)} armed ${n7 === 1 ? 'incident was' : 'incidents were'} reported in ${places} in the past seven days${change}.`
      : `${fmtInt(n7, lang)} ${n7 === 1 ? 'væpnet hendelse ble' : 'væpnede hendelser ble'} meldt i ${places} de siste sju dagene${change}.`);

    const cats = Object.entries(stats.categories7d).sort((a, b) => b[1] - a[1]);
    const [c1, c2] = cats;
    if (c1) {
      const share = (n: number) => Math.round((100 * n) / n7);
      const label = (c: string) => (CATEGORY[lang][c] ?? c).toLowerCase();
      const plural = (c: string) => (en ? `${label(c)}s`.replace(/strikes?s$/, 'strikes').replace(/violences$/, 'violence').replace(/unrests$/, 'unrest').replace(/repressions$/, 'repression').replace(/blockades?s$/, 'blockades') : label(c));
      s.push(en
        ? `Most were ${plural(c1[0])} (${share(c1[1])}%)${c2 ? `, followed by ${plural(c2[0])} (${share(c2[1])}%)` : ''}.`
        : `Flest gjaldt ${label(c1[0])} (${share(c1[1])} prosent)${c2 ? `, deretter ${label(c2[0])} (${share(c2[1])} prosent)` : ''}.`);
    }
    if (stats.reported7d > 0) {
      s.push(en
        ? `${fmtInt(stats.reported7d, lang)} of them were carried by two or more outlets.`
        : `${fmtInt(stats.reported7d, lang)} av dem ble omtalt av to eller flere medier.`);
    }
  }

  const spots = stats.hotspots.slice(0, 3).map((h) => h.name.split(',')[0]!);
  if (spots.length > 0) {
    const list = joinNames(spots, lang);
    s.push(en ? `The most reported locations over the past month were ${list}.` : `De mest omtalte stedene den siste måneden var ${list}.`);
  }

  if (activeConflicts.length > 0) {
    const years = activeConflicts.map((c) => c.startDate?.slice(0, 4)).filter((y): y is string => !!y).sort();
    const k = activeConflicts.length;
    s.push(en
      ? `UCDP lists ${k} active armed ${k === 1 ? 'conflict' : 'conflicts'} here${years[0] ? `, the oldest dating from ${years[0]}` : ''}.`
      : `UCDP fører ${k} ${k === 1 ? 'aktiv væpnet konflikt' : 'aktive væpnede konflikter'} her${years[0] ? `, den eldste fra ${years[0]}` : ''}.`);
  }

  if (lead) {
    s.push(en
      ? `The most widely covered story this week: “${lead.headline}” (${lead.publisher}, ${lead.outlets.length} ${lead.outlets.length === 1 ? 'outlet' : 'outlets'}).`
      : `Mest omtalte sak denne uken: «${lead.headline}» (${lead.publisher}, ${lead.outlets.length} ${lead.outlets.length === 1 ? 'medium' : 'medier'}).`);
  }
  return s.join(' ');
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
  const cache: Cache = {
    wikipedia: {}, worldBank: null, gdelt: {}, gnews: {}, og: {},
    ...(readJson<Partial<Cache>>(cacheFile) ?? {}),
  } as Cache;

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
  }

  /* ---- per crisis ---- */
  const details: CrisisDetail[] = [];
  const ogQueue: string[] = [];

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

    const stats: CrisisDetail['stats'] = {
      last24h: evs.filter((e) => age(e) < DAY).length,
      last7d: in7.length,
      prev7d: prev7.length,
      last30d: in30.length,
      change7dPct: prev7.length > 0 ? Math.round(((in7.length - prev7.length) / prev7.length) * 1000) / 10 : null,
      reported7d: in7.filter((e) => e.confidence === 'reported' || e.distinctPublishers > 1).length,
      outlets30d: new Set(in30.flatMap((e) => e.provenance.map((p) => p.publisher ?? ''))).size,
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
      const img = cache.og[a.url];
      if (img) item.image = img;
      else if (img === undefined) ogQueue.push(a.url);
      pool.push(item);
    }
    pool.push(...(cache.gdelt[d.id]?.articles ?? []), ...(cache.gnews[d.id]?.articles ?? []));
    // Some feeds give a homepage address where the outlet's name belongs.
    for (const a of pool) {
      if (/^https?:\/\//i.test(a.publisher)) {
        try { a.publisher = new URL(a.publisher).hostname.replace(/^www\./, ''); } catch { /* keep as is */ }
      }
    }
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
    // Pictures first in the cut: a feed that is mostly text with a few images reads badly.
    const newsOut = news.slice(0, settings.newsPerCrisis);

    /* images: the background article's own, then publishers' previews, one per outlet */
    const images: CrisisImage[] = [];
    const wiki = cache.wikipedia[d.id]?.data ?? null;
    if (wiki?.en?.image) {
      images.push({
        src: wiki.en.image.src,
        caption: wiki.en.title,
        url: wiki.en.image.file ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(wiki.en.image.file)}` : wiki.en.url,
        credit: 'Wikimedia Commons',
      });
    }
    const imgOutlets = new Set<string>();
    for (const a of news) {
      if (!a.image || imgOutlets.has(a.publisher) || images.length >= 13) continue;
      if (/logo|placeholder|default|sprite|icon/i.test(a.image)) continue;
      imgOutlets.add(a.publisher);
      images.push({ src: a.image, caption: a.title, url: a.url, credit: a.publisher });
    }

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
          sources: e.provenance.slice(0, 6).map((p) => ({ url: p.url, publisher: p.publisher ?? (() => { try { return new URL(p.url).hostname.replace(/^www\./, ''); } catch { return 'source'; } })() })),
        };
        // The reporting outlet's own preview picture, when its page offers one.
        const first = item.sources[0]?.url;
        if (first) {
          const img = cache.og[first];
          if (img) item.image = img;
          else if (img === undefined && e.intensity >= 2) ogQueue.push(first);
        }
        return item;
      });

    for (const g of wiki?.en?.gallery ?? []) {
      if (images.length >= 22 || images.some((im) => im.src === g.src || (wiki?.en?.image?.file && g.file === wiki.en.image.file))) continue;
      images.push({ src: g.src, caption: g.caption, url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(g.file)}`, credit: 'Wikimedia Commons' });
    }
    for (const inc of incidents) {
      const src = inc.image;
      const credit = inc.sources[0]?.publisher;
      if (!src || !credit || imgOutlets.has(credit) || images.length >= 30) continue;
      imgOutlets.add(credit);
      images.push({ src, caption: `${CATEGORY.en[inc.category] ?? inc.category}, ${inc.place}`, url: inc.sources[0]!.url, credit });
    }

    /* every outlet behind the page, counted */
    const outletCount = new Map<string, number>();
    const bump = (name: string | undefined) => { if (name) outletCount.set(name, (outletCount.get(name) ?? 0) + 1); };
    for (const e of in30) for (const p of e.provenance) bump(p.publisher);
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
          url: `https://data.worldbank.org/indicator/${ind.id}?locations=${d.iso3.map((x) => x.slice(0, 2)).join('-')}`,
        });
      }
    }

    let background: CrisisDetail['background'] = null;
    if (wiki?.en) {
      background = { title: wiki.en.title, extract: wiki.en.extract, url: wiki.en.url, retrievedAt: cache.wikipedia[d.id]!.at };
      if (wiki.nb) {
        background.titleNb = wiki.nb.title;
        background.extractNb = wiki.nb.extract;
        background.urlNb = wiki.nb.url;
      }
    }

    const placesEn = joinNames(d.fips.map((f) => countryName(f, 'en')), 'en');
    const placesNb = joinNames(d.fips.map((f) => countryName(f, 'nb')), 'nb');

    details.push({
      artifactVersion: 1,
      id: d.id, name: d.name, nameNb: d.nameNb, region: d.region, regionNb: d.regionNb, auto: d.auto,
      generatedAt,
      countries: d.fips.map((f) => ({ fips: f, name: countryName(f, 'en') })),
      center: [Math.round(center[0] * 100) / 100, Math.round(center[1] * 100) / 100],
      bbox,
      stats,
      situation: {
        en: situation('en', placesEn, stats, active, headlines[0]),
        nb: situation('nb', placesNb, stats, active, headlines[0]),
      },
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

  /* level: the week's summed intensity, relative to the busiest crisis, on a log scale */
  const weight = (d: CrisisDetail) =>
    events
      .filter((e) => d.countries.some((c) => c.fips === e.location.countryFips) && nowRef - Date.parse(e.occurredAt) < 7 * DAY)
      .reduce((sum, e) => sum + e.intensity, 0);
  const weights = new Map(details.map((d) => [d.id, weight(d)]));
  const maxW = Math.max(1, ...weights.values());
  for (const d of details) {
    const w = weights.get(d.id) ?? 0;
    d.stats.level = w === 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((5 * Math.log1p(w)) / Math.log1p(maxW))));
  }

  /* preview images for curated-feed articles, a few per run, cached by URL */
  if (!options.offline) {
    const queue = [...new Set(ogQueue)].slice(0, settings.imageFetchPerRun);
    for (let i = 0; i < queue.length; i += 8) {
      const batch = queue.slice(i, i + 8);
      const found = await Promise.all(batch.map((u) => previewImage(u)));
      batch.forEach((u, j) => { cache.og[u] = found[j] ?? null; });
    }
    log(`preview images: looked up ${queue.length}`);
  }

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
        change7dPct: d.stats.change7dPct, level: d.stats.level,
        spark: d.stats.daily.slice(-14).map((x) => x.count),
        // For the card, a picture from conflict reporting first, then a Commons photograph,
        // and only then whatever a news story carried: feed images are often off-topic.
        image: d.images.find((im) => d.incidents.some((inc) => inc.image === im.src))
          ?? d.images.find((im) => im.credit === 'Wikimedia Commons' && /\.jpe?g/i.test(im.src))
          ?? d.images[0] ?? null,
        lead: lead
          ? { title: lead.headline, publisher: lead.publisher, url: lead.url, publishedAt: lead.lastSeenAt }
          : news0 ? { title: news0.title, publisher: news0.publisher, url: news0.url, publishedAt: news0.publishedAt } : null,
        sourceCount: d.sourceCount,
      };
    })
    .sort((a, b) => b.level - a.level || b.last7d - a.last7d);
  writeArtifact(path.join(dataDir, 'crises.json'), crisisIndex, { artifactVersion: 1, generatedAt, crises: index });

  /* compact incident stream for the map */
  const categories = [...new Set(events.map((e) => e.category))];
  const catIndex = new Map(categories.map((c, i) => [c, i]));
  const compact = events
    .map((e) => {
      const p = e.provenance[0];
      const publisher = p?.publisher ?? (p ? (() => { try { return new URL(p.url).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '');
      return [
        Math.round(Date.parse(e.occurredAt) / 60_000),
        Math.round(e.location.lon * 100), Math.round(e.location.lat * 100),
        catIndex.get(e.category) ?? 0, e.intensity,
        crisisOfFips.get(e.location.countryFips) ?? -1,
        e.confidence === 'reported' ? 1 : 0, e.reportCount,
        placeOf(e.location.name), p?.url ?? '', publisher,
      ] as [number, number, number, number, number, number, number, number, string, string, string];
    })
    .sort((a, b) => b[0] - a[0]);
  // Validated like every artifact, but written without indentation: it is the one file a
  // phone fetches before it can draw anything.
  const mapPayload = mapEvents.parse({ artifactVersion: 1, generatedAt, categories, crises: defs.map((d) => d.id), events: compact });
  const mapFile = path.join(dataDir, 'map-events.json');
  writeFileSync(`${mapFile}.tmp`, JSON.stringify(mapPayload));
  renameSync(`${mapFile}.tmp`, mapFile);

  if (!options.offline) writeCache(cache);
  return { crises: details.length, mapEvents: compact.length };
}
