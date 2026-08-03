import { XMLParser } from 'fast-xml-parser';

/**
 * Feeds in the registry arrive as RSS 2.0, Atom and RDF, and several mix conventions within
 * one document. Rather than guess per publisher, every shape is normalised here into the
 * same record, and anything missing a title, a link or a usable date is dropped and counted.
 */
export interface FeedItem {
  title: string;
  url: string;
  summary: string | undefined;
  publishedAt: string;
}

export interface FeedParseResult {
  items: FeedItem[];
  skipped: Record<string, number>;
}

export class FeedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedFormatError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  // Publishers wrap titles in CDATA constantly; without this they arrive as objects.
  parseTagValue: false,
  processEntities: true,
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Feed values arrive as strings, numbers, or `{ '#text': ... }` depending on attributes. */
function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    return text((value as Record<string, unknown>)['#text']);
  }
  return undefined;
}

/** Atom links are attributes, and a feed often carries several with different rel values. */
function atomLink(entry: Record<string, unknown>): string | undefined {
  const links = asArray(entry.link as unknown);
  for (const link of links) {
    if (typeof link === 'string') return link.trim();
    if (link && typeof link === 'object') {
      const record = link as Record<string, unknown>;
      const rel = text(record['@rel']);
      if (rel === undefined || rel === 'alternate') {
        const href = text(record['@href']);
        if (href) return href;
      }
    }
  }
  return undefined;
}

/** Strips markup and collapses whitespace. Publishers put full HTML in <description>. */
export function plainText(input: string | undefined, maxLength = 400): string | undefined {
  if (!input) return undefined;
  const stripped = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length === 0) return undefined;
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength - 1).trimEnd()}…` : stripped;
}

/** RSS uses RFC 822, Atom uses ISO 8601, and a few feeds use neither cleanly. */
function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  const date = new Date(parsed);
  // A date far in the future is a publisher error, not news; a very old one is a stale feed.
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return undefined;
  return date.toISOString();
}

/**
 * Some feeds carry datestamped stubs rather than articles — Crisis Group publishes items
 * titled "Tehran 30 July 2026 #1", which contain no reporting and, because they are all
 * shaped alike, clustered into one large phantom story. A headline needs enough real words
 * to be a headline.
 */
const MIN_TITLE_WORDS = 4;
const MONTHS =
  /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;

export function looksSubstantive(title: string): boolean {
  const words = title
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= 3 && !MONTHS.test(word));
  return words.length >= MIN_TITLE_WORDS;
}

export function parseFeed(xml: string): FeedParseResult {
  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml) as Record<string, unknown>;
  } catch (error) {
    throw new FeedFormatError(`Not parseable as XML: ${(error as Error).message}`);
  }

  const rss = document.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const rdf = (document['rdf:RDF'] ?? document.RDF) as Record<string, unknown> | undefined;
  const atom = document.feed as Record<string, unknown> | undefined;

  const raw = [
    ...asArray(channel?.item as unknown),
    ...asArray(rdf?.item as unknown),
    ...asArray(atom?.entry as unknown),
  ] as Record<string, unknown>[];

  if (raw.length === 0) {
    throw new FeedFormatError('No <item> or <entry> elements found');
  }

  const skipped: Record<string, number> = {};
  const drop = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  const items: FeedItem[] = [];
  for (const entry of raw) {
    const title = plainText(text(entry.title), 300);
    const url = text(entry.link) ?? atomLink(entry) ?? text(entry.id) ?? text(entry.guid);
    const publishedAt = toIso(
      text(entry.pubDate) ??
        text(entry.published) ??
        text(entry.updated) ??
        text(entry['dc:date']) ??
        text(entry.date),
    );

    if (!title) { drop('no_title'); continue; }
    if (!looksSubstantive(title)) { drop('title_not_substantive'); continue; }
    if (!url || !/^https?:\/\//i.test(url)) { drop('no_link'); continue; }
    if (!publishedAt) { drop('no_date'); continue; }

    items.push({
      title,
      url,
      summary: plainText(
        text(entry.description) ?? text(entry.summary) ?? text(entry['content:encoded']) ?? text(entry.content),
      ),
      publishedAt,
    });
  }

  return { items, skipped };
}
