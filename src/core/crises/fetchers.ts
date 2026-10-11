import { XMLParser } from 'fast-xml-parser';
import { fetchJson, fetchText, USER_AGENT } from '../util/http.js';
import type { CrisisArticle } from './schema.js';

/**
 * Outside sources for the crisis pages. Each one is best effort: a failure returns nothing
 * and the builder keeps the last good copy from its cache, so one bad hour never empties a
 * page.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function clean(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/* ---------- GDELT DOC 2.0 article index -------------------------------- */

interface GdeltDocArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
}

/** 20261010T153000Z -> ISO. */
function gdeltDate(value: string | undefined): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : undefined;
}

export async function gdeltDoc(query: string, max: number): Promise<CrisisArticle[] | undefined> {
  const params = new URLSearchParams({
    query: `${query} sourcelang:english`,
    mode: 'artlist',
    format: 'json',
    maxrecords: String(Math.min(max, 250)),
    timespan: '3d',
    sort: 'datedesc',
  });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;

  // GDELT asks for one request every five seconds and answers in plain text when it is
  // unhappy, so a non-JSON body is a refusal, not a parse bug. Two patient retries.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(7000);
    try {
      const body = await fetchText(url, { retries: 0, timeoutMs: 15_000, noRetryStatuses: [400, 404] });
      if (!body.trim().startsWith('{')) continue;
      const parsed = JSON.parse(body) as { articles?: GdeltDocArticle[] };
      const out: CrisisArticle[] = [];
      for (const a of parsed.articles ?? []) {
        const publishedAt = gdeltDate(a.seendate);
        if (!isHttpUrl(a.url) || !a.title || !publishedAt) continue;
        const domain = a.domain ?? hostOf(a.url);
        const item: CrisisArticle = {
          title: clean(a.title),
          url: a.url,
          publisher: domain ?? 'unknown',
          publishedAt,
          via: 'gdelt',
        };
        if (domain) item.domain = domain;
        if (item.title.length > 8) out.push(item);
      }
      return out;
    } catch {
      // fall through to the next attempt
    }
  }
  return undefined;
}

/* ---------- Google News search RSS ------------------------------------- */

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

export function googleNewsUrl(query: string): string {
  const q = `${query} when:3d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-GB&gl=GB&ceid=GB:en`;
}

export async function googleNews(query: string): Promise<CrisisArticle[] | undefined> {
  try {
    const body = await fetchText(googleNewsUrl(query), { retries: 2, timeoutMs: 20_000 });
    const doc = xml.parse(body) as { rss?: { channel?: { item?: unknown } } };
    const raw = doc.rss?.channel?.item;
    const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
    const out: CrisisArticle[] = [];
    for (const item of items) {
      const source = item.source as { '#text'?: string; '@_url'?: string } | string | undefined;
      const publisher = typeof source === 'string' ? source : source?.['#text'];
      const sourceUrl = typeof source === 'object' ? source?.['@_url'] : undefined;
      const link = item.link;
      const date = new Date(String(item.pubDate ?? ''));
      if (!publisher || !isHttpUrl(link) || Number.isNaN(date.getTime())) continue;
      let title = clean(String(item.title ?? ''));
      const suffix = ` - ${publisher}`;
      if (title.endsWith(suffix)) title = title.slice(0, -suffix.length);
      if (title.length < 8) continue;
      const entry: CrisisArticle = { title, url: link, publisher: clean(publisher), publishedAt: date.toISOString(), via: 'gnews' };
      const domain = sourceUrl ? hostOf(sourceUrl) : undefined;
      if (domain) entry.domain = domain;
      out.push(entry);
    }
    return out;
  } catch {
    return undefined;
  }
}

/* ---------- Wikipedia --------------------------------------------------- */

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
  image?: { src: string; width: number; height: number; file?: string };
  gallery?: { src: string; caption: string; file: string }[];
}

/** The article's own illustrations: freely licensed, captioned by Wikipedia's editors. */
async function wikiGallery(title: string): Promise<WikiSummary['gallery']> {
  const data = await fetchJson<{ items?: { type?: string; title?: string; caption?: { text?: string }; srcset?: { src?: string }[]; showInGallery?: boolean }[] }>(
    `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    { retries: 1, timeoutMs: 20_000, headers: { 'api-user-agent': USER_AGENT } },
  );
  const out: NonNullable<WikiSummary['gallery']> = [];
  for (const item of data.items ?? []) {
    const file = item.title?.replace(/^File:/, '');
    const raw = item.srcset?.[0]?.src;
    if (item.type !== 'image' || !file || !raw || /\.(pdf|tiff?|gif)$/i.test(file) || /flag|logo|icon|emblem|coat_of_arms|seal_of/i.test(file)) continue;
    const src = (raw.startsWith('//') ? `https:${raw}` : raw).replace(/\?.*$/, '');
    if (!isHttpUrl(src)) continue;
    const caption = clean(item.caption?.text ?? '').replace(/\[\d+\]/g, '').trim()
      || file.replace(/_/g, ' ').replace(/\.[a-z]+$/i, '').replace(/\s*\(cropped\)/i, '');
    out.push({ src, caption: caption.slice(0, 220), file });
    if (out.length >= 10) break;
  }
  return out;
}

async function wikiSummary(host: string, title: string): Promise<WikiSummary | undefined> {
  const url = `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const data = await fetchJson<{
    title?: string; extract?: string; type?: string;
    content_urls?: { desktop?: { page?: string } };
    originalimage?: { source?: string; width?: number; height?: number };
    thumbnail?: { source?: string; width?: number; height?: number };
  }>(url, { retries: 2, timeoutMs: 20_000, headers: { 'api-user-agent': USER_AGENT } });
  if (!data.title || !data.extract || data.type === 'disambiguation') return undefined;
  const page = data.content_urls?.desktop?.page;
  if (!isHttpUrl(page)) return undefined;
  const summary: WikiSummary = { title: data.title, extract: clean(data.extract), url: page };
  // A mid-sized rendition: the original can be a 20 MB TIFF.
  const thumb = data.thumbnail?.source;
  if (thumb && isHttpUrl(thumb)) {
    // Wikimedia will not scale a bitmap up, so a small original is used as it is.
    const originalWidth = data.originalimage?.width ?? 0;
    const src = originalWidth > 0 && originalWidth <= 960 && !/\.svg/i.test(thumb)
      ? (data.originalimage?.source ?? thumb)
      : thumb.replace(/\/(\d+)px-/, '/960px-');
    summary.image = { src, width: data.thumbnail?.width ?? 0, height: data.thumbnail?.height ?? 0 };
    const file = /\/([^/]+)\/\d+px-/.exec(thumb)?.[1];
    if (file) summary.image.file = decodeURIComponent(file);
  }
  return summary;
}

/**
 * Author and licence for Commons files, so every picture is credited as its licence asks.
 * One request for up to 50 files; a failure leaves the credit at "Wikimedia Commons" with
 * a link to the file page, which carries the full attribution.
 */
export async function commonsCredits(files: string[]): Promise<Record<string, { author?: string; license?: string }>> {
  const out: Record<string, { author?: string; license?: string }> = {};
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    try {
      const data = await fetchJson<{ query?: { pages?: Record<string, { title?: string; imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] }> } }>(
        `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|LicenseShortName&format=json&titles=${encodeURIComponent(batch.map((f) => `File:${f}`).join('|'))}`,
        { retries: 1, timeoutMs: 20_000, headers: { 'api-user-agent': USER_AGENT } },
      );
      for (const page of Object.values(data.query?.pages ?? {})) {
        const meta = page.imageinfo?.[0]?.extmetadata;
        const file = page.title?.replace(/^File:/, '').replace(/ /g, '_');
        if (!file || !meta) continue;
        const author = clean(meta.Artist?.value ?? '').slice(0, 120);
        const license = clean(meta.LicenseShortName?.value ?? '').slice(0, 40);
        out[file] = { ...(author ? { author } : {}), ...(license ? { license } : {}) };
      }
    } catch {
      // the file page still carries the attribution
    }
  }
  return out;
}

export async function wikipedia(title: string): Promise<{ en?: WikiSummary; nb?: WikiSummary } | undefined> {
  try {
    const en = await wikiSummary('en.wikipedia.org', title);
    if (!en) return undefined;
    try {
      const gallery = await wikiGallery(en.title);
      if (gallery && gallery.length) en.gallery = gallery;
    } catch {
      // the lead image alone is enough
    }
    let nb: WikiSummary | undefined;
    try {
      const links = await fetchJson<{ query?: { pages?: Record<string, { langlinks?: { '*': string }[] }> } }>(
        `https://en.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=nb&redirects=1&format=json&titles=${encodeURIComponent(en.title)}`,
        { retries: 1, timeoutMs: 15_000 },
      );
      const nbTitle = Object.values(links.query?.pages ?? {})[0]?.langlinks?.[0]?.['*'];
      if (nbTitle) nb = await wikiSummary('no.wikipedia.org', nbTitle);
    } catch {
      // A Norwegian article is a bonus, never a requirement.
    }
    return nb ? { en, nb } : { en };
  } catch {
    return undefined;
  }
}

/* ---------- World Bank -------------------------------------------------- */

export const WORLD_BANK_INDICATORS = [
  { id: 'SP.POP.TOTL', label: 'Population', labelNb: 'Befolkning', unit: 'people' },
  { id: 'NY.GDP.PCAP.CD', label: 'GDP per person (US$)', labelNb: 'BNP per innbygger (USD)', unit: 'usd' },
  { id: 'NY.GDP.MKTP.KD.ZG', label: 'GDP growth', labelNb: 'BNP-vekst', unit: 'pct' },
  { id: 'FP.CPI.TOTL.ZG', label: 'Inflation', labelNb: 'Inflasjon', unit: 'pct' },
  { id: 'SI.POV.DDAY', label: 'Extreme poverty (share of population)', labelNb: 'Ekstrem fattigdom (andel av befolkningen)', unit: 'pct' },
  { id: 'SM.POP.REFG.OR', label: 'Refugees from the country', labelNb: 'Flyktninger fra landet', unit: 'people' },
  { id: 'VC.IDP.TOCV', label: 'Internally displaced by conflict', labelNb: 'Internt fordrevne av konflikt', unit: 'people' },
  { id: 'VC.BTL.DETH', label: 'Battle-related deaths (latest year)', labelNb: 'Kamprelaterte dødsfall (siste år)', unit: 'count' },
] as const;

export type WorldBankData = Record<string, Record<string, { value: number; year: string; country: string }>>;

export async function worldBank(iso3: string[]): Promise<WorldBankData | undefined> {
  const out: WorldBankData = {};
  let anyOk = false;
  for (const indicator of WORLD_BANK_INDICATORS) {
    try {
      const url = `https://api.worldbank.org/v2/country/${iso3.join(';')}/indicator/${indicator.id}?format=json&mrnev=1&per_page=500`;
      const data = await fetchJson<[unknown, { countryiso3code?: string; country?: { value?: string }; date?: string; value?: number | null }[] | null]>(
        url, { retries: 2, timeoutMs: 40_000 },
      );
      const rows = data?.[1] ?? [];
      const byCountry: WorldBankData[string] = {};
      for (const row of rows) {
        if (row.value === null || row.value === undefined || !row.countryiso3code) continue;
        byCountry[row.countryiso3code] = { value: row.value, year: row.date ?? '', country: row.country?.value ?? row.countryiso3code };
      }
      out[indicator.id] = byCountry;
      anyOk = true;
    } catch {
      // keep going; the cache supplies what this run could not
    }
    await sleep(400);
  }
  return anyOk ? out : undefined;
}

/* ---------- archive pictures of who or what a story is about --------------- */

export interface SubjectImage {
  title: string;
  description: string;
  kind: 'person' | 'place' | 'other';
  src: string;
  thumb: string;
  file: string;
  page: string;
}

/**
 * A few names headlines use on their own that Wikipedia files under a fuller title, or
 * treats as ambiguous. Short and stable: heads of state and leaders the crises keep
 * returning to, not a list anyone has to maintain.
 */
const ALIASES: Record<string, string> = {
  Trump: 'Donald Trump', Putin: 'Vladimir Putin', Zelensky: 'Volodymyr Zelenskyy', Zelenskyy: 'Volodymyr Zelenskyy',
  Netanyahu: 'Benjamin Netanyahu', Xi: 'Xi Jinping', Modi: 'Narendra Modi', Erdogan: 'Recep Tayyip Erdoğan',
  Erdoğan: 'Recep Tayyip Erdoğan', Khamenei: 'Ali Khamenei', Starmer: 'Keir Starmer', Macron: 'Emmanuel Macron',
  Burhan: 'Abdel Fattah al-Burhan', Hemedti: 'Mohamed Hamdan Dagalo', Sisi: 'Abdel Fattah el-Sisi', Merz: 'Friedrich Merz',
  Lavrov: 'Sergey Lavrov', Rubio: 'Marco Rubio', Guterres: 'António Guterres', Pezeshkian: 'Masoud Pezeshkian',
  Sharaa: 'Ahmed al-Sharaa', Maduro: 'Nicolás Maduro', Sheinbaum: 'Claudia Sheinbaum', Tinubu: 'Bola Tinubu',
};

const LEADING = new Set([
  'The', 'A', 'An', 'In', 'On', 'At', 'Of', 'For', 'To', 'From', 'With', 'After', 'Before', 'As', 'How', 'Why', 'What',
  'Who', 'When', 'Where', 'Photos', 'Photo', 'Video', 'Watch', 'Live', 'Breaking', 'Exclusive', 'Analysis', 'Opinion',
  'Explainer', 'Update', 'Former', 'President', 'Prime', 'Minister', 'Foreign', 'Defence', 'Defense', 'Secretary',
  'General', 'Gen', 'Sen', 'Rep', 'Mr', 'Mrs', 'Ms', 'Dr', 'King', 'Queen', 'Prince', 'Pope', 'Supreme', 'Leader',
  'Chief', 'Top', 'New', 'Ex', 'Says', 'Said', 'Report', 'Reports', 'Security', 'Council', 'Day', 'Year', 'One', 'Two',
  'Three', 'Thousands', 'Hundreds', 'Dozens', 'Several', 'Many', 'More', 'Most', 'No', 'Not', 'Is', 'Are', 'Will',
  'Can', 'It', 'Its', 'This', 'That', 'These', 'Those', 'He', 'She', 'They', 'We', 'Our', 'His', 'Her', 'Their',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]);

/** Proper names in a headline, longest first within each run of capitals. */
export function subjectsIn(headline: string): string[] {
  const text = headline.replace(/[‘’]/g, "'").replace(/[“”"]/g, ' ').replace(/'s\b/g, '');
  const out: string[] = [];
  const runs = text.match(/\p{Lu}[\p{L}'.-]*(?:\s+(?:al-|el-|bin|ibn|de|da|van|von|der|la)?\s*\p{Lu}[\p{L}'.-]*){0,3}/gu) ?? [];
  for (const run of runs) {
    let words = run.split(/\s+/).filter(Boolean);
    while (words.length && LEADING.has(words[0]!.replace(/\.$/, ''))) words = words.slice(1);
    if (!words.length) continue;
    const name = words.join(' ').replace(/[.'-]+$/, '');
    // Acronyms (UN, US, RSF) resolve to logos and flags, which are dropped anyway.
    if (/^\p{Lu}{1,4}$/u.test(name) || name.length < 3) continue;
    // A known leader anywhere in the run counts first: title-case headlines ("Trump Calls On
    // Ukraine") run names and verbs together.
    for (const w of words) if (ALIASES[w.replace(/[.'-]+$/, '')]) out.push(ALIASES[w.replace(/[.'-]+$/, '')]!);
    if (words.length <= 3) out.push(ALIASES[name] ?? name);
  }
  return [...new Set(out)].slice(0, 5);
}

const PERSON = /\b(born|politician|president|prime minister|minister|leader|commander|general|militant|activist|journalist|king|queen|prince|emir|sheikh|diplomat|businessman|businesswoman|lawyer|judge|cleric|ayatollah|officer|warlord|rebel|secretary|monarch|chancellor|senator|official|spokesperson|envoy)\b/i;
const PLACE = /\b(city|capital|town|village|province|region|governorate|oblast|district|airport|strait|river|island|desert|port|county|municipality|neighbourhood|neighborhood|camp|peninsula|mountain|country|sovereign state|territory|state in|area)\b/i;

/**
 * The Wikipedia lead picture of a person or place, only if it is a freely licensed file on
 * Wikimedia Commons. English Wikipedia also hosts non-free pictures under fair use (film
 * posters, logos, some portraits); those live under /wikipedia/en/ and are refused here.
 */
export async function subjectImage(name: string): Promise<SubjectImage | null | undefined> {
  try {
    const data = await fetchJson<{
      title?: string; type?: string; description?: string;
      content_urls?: { desktop?: { page?: string } };
      originalimage?: { source?: string; width?: number };
      thumbnail?: { source?: string };
    }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`,
      { retries: 1, timeoutMs: 15_000, headers: { 'api-user-agent': USER_AGENT }, noRetryStatuses: [404] });
    const thumb = data.thumbnail?.source;
    const page = data.content_urls?.desktop?.page;
    if (!data.title || data.type !== 'standard' || !thumb || !isHttpUrl(page)) return null;
    if (!/\/wikipedia\/commons\//.test(thumb)) return null;
    const file = /\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//.exec(thumb)?.[1] ?? /\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/.exec(thumb)?.[1];
    if (!file || /flag|logo|coat_of_arms|emblem|seal_of|icon|symbol|insignia|signature|locator|\.svg/i.test(file)) return null;
    const description = clean(data.description ?? '');
    const kind: SubjectImage['kind'] = PERSON.test(description) ? 'person' : PLACE.test(description) ? 'place' : 'other';
    const originalWidth = data.originalimage?.width ?? 0;
    const src = originalWidth > 0 && originalWidth <= 960 ? (data.originalimage?.source ?? thumb) : thumb.replace(/\/(\d+)px-/, '/960px-');
    // Wikimedia serves thumbnails only at its standard widths (250, 330, 500, 960…); 400 is refused.
    const small = originalWidth > 0 && originalWidth <= 330 ? (data.originalimage?.source ?? thumb) : thumb.replace(/\/(\d+)px-/, '/330px-');
    return { title: data.title, description, kind, src: src.replace(/\?.*$/, ''), thumb: small.replace(/\?.*$/, ''), file: decodeURIComponent(file), page };
  } catch (error) {
    // A 404 is a firm "no such page"; anything else is worth asking again another day.
    return /404/.test(String((error as Error).message)) ? null : undefined;
  }
}
