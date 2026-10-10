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
  socialimage?: string;
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
        if (isHttpUrl(a.socialimage) && a.socialimage.startsWith('https://')) item.image = a.socialimage;
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

/* ---------- a publisher's own preview image ---------------------------- */

/**
 * Reads only the page head for its og:image. The picture stays on the publisher's server
 * and is shown linked to the article it illustrates.
 */
export async function previewImage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    });
    clearTimeout(timer);
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    let html = '';
    while (html.length < 250_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += new TextDecoder().decode(value);
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    const m =
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i.exec(html);
    const src = m?.[1]?.replace(/&amp;/g, '&');
    if (!src) return null;
    const absolute = new URL(src, response.url).toString();
    return absolute.startsWith('https://') ? absolute : null;
  } catch {
    return null;
  }
}
