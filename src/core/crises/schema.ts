import { z } from 'zod';

/**
 * A crisis is an editorial grouping of countries (config/crises.json). Everything in its
 * file is either counted from the incident stream or taken verbatim from a named source.
 * The one exception is `summary`: three to five sentences a language model compressed from
 * headlines already in this file, which survive only if every figure in them appears in that
 * material (src/core/crises/summary.ts). Pictures come from Wikimedia Commons alone.
 */

const iso = z.string().min(10);

export const crisisArticle = z.object({
  title: z.string().min(1),
  url: z.url(),
  publisher: z.string().min(1),
  domain: z.string().optional(),
  publishedAt: iso,
  /** Where we found it: GDELT's article index, Google News, a curated feed, or the incident stream. */
  via: z.enum(['gdelt', 'gnews', 'feed']),
  tier: z.number().int().min(1).max(3).optional(),
});
export type CrisisArticle = z.infer<typeof crisisArticle>;

export const crisisImage = z.object({
  src: z.url(),
  caption: z.string(),
  url: z.url(),
  /** Always "Wikimedia Commons": news organisations' pictures are never used. */
  credit: z.literal('Wikimedia Commons'),
  /** map | place | person | other — decides which picture leads. */
  kind: z.enum(['map', 'place', 'person', 'other']),
  author: z.string().optional(),
  license: z.string().optional(),
});
export type CrisisImage = z.infer<typeof crisisImage>;

export const crisisIndicator = z.object({
  id: z.string(),
  label: z.string(),
  labelNb: z.string(),
  unit: z.enum(['people', 'usd', 'pct', 'count']),
  values: z.array(z.object({ iso3: z.string(), country: z.string(), value: z.number(), year: z.string() })),
  url: z.url(),
});
export type CrisisIndicator = z.infer<typeof crisisIndicator>;

export const crisisStats = z.object({
  last24h: z.number().int(),
  last7d: z.number().int(),
  prev7d: z.number().int(),
  last30d: z.number().int(),
  change7dPct: z.number().nullable(),
  reported7d: z.number().int(),
  outlets30d: z.number().int(),
  /** Incidents in the past seven days carried by two or more independent outlets. */
  corroborated7d: z.number().int(),
  /**
   * The ranking weight: severity summed over the week's corroborated incidents. Raw counts
   * measure media attention, which English-language coverage inflates; requiring two outlets
   * and weighting by what happened is the closer measure of the fighting itself.
   */
  score: z.number(),
  /** 0-5, the score relative to the highest-scoring crisis on a log scale. Display only. */
  level: z.number().int().min(0).max(5),
  daily: z.array(z.object({ date: z.string(), count: z.number().int() })),
  categories7d: z.record(z.string(), z.number().int()),
  categories30d: z.record(z.string(), z.number().int()),
  hotspots: z.array(z.object({ name: z.string(), lat: z.number(), lon: z.number(), count: z.number().int() })),
});

export const crisisDetail = z.object({
  artifactVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  nameNb: z.string(),
  region: z.string(),
  regionNb: z.string(),
  auto: z.boolean(),
  generatedAt: iso,
  countries: z.array(z.object({ fips: z.string(), name: z.string() })),
  center: z.tuple([z.number(), z.number()]),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  stats: crisisStats,
  /** The fixed-template status line, composed from the counts in code. */
  status: z.object({ en: z.string(), nb: z.string() }),
  /** Machine-written from the linked headlines, guarded in code. Null until one passes. */
  summary: z
    .object({
      en: z.string(),
      nb: z.string(),
      model: z.string(),
      writtenAt: iso,
      sources: z.array(z.object({ title: z.string(), url: z.url(), publisher: z.string() })).min(1),
    })
    .nullable(),
  /**
   * UCDP's fatality counts, as a contrast to counts of media reports. `battle` is UCDP's
   * battle-related deaths for the crisis's countries (published through the World Bank);
   * `other` is what the register itself records for non-state and one-sided violence. The
   * register carries no figure for state-based wars, so the two are never summed.
   */
  ucdpFatalities: z.object({
    battle: z.object({ total: z.number().int(), years: z.string(), url: z.url() }).nullable(),
    other: z.object({ total: z.number().int(), years: z.string(), conflicts: z.number().int() }).nullable(),
  }).nullable(),
  background: z
    .object({
      title: z.string(),
      extract: z.string(),
      url: z.url(),
      titleNb: z.string().optional(),
      extractNb: z.string().optional(),
      urlNb: z.url().optional(),
      retrievedAt: iso,
    })
    .nullable(),
  indicators: z.array(crisisIndicator),
  conflicts: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      startDate: z.string().optional(),
      intensityLevel: z.number().optional(),
      fatalities: z.number().optional(),
      fatalitiesAsOf: z.string().optional(),
      parties: z.array(z.string()),
    }),
  ),
  headlines: z.array(
    z.object({
      storyId: z.string(),
      /** The latest Brief edition that carried the story, YYYY-MM-DD. */
      edition: z.string().optional(),
      headline: z.string(),
      publisher: z.string(),
      url: z.url(),
      lastSeenAt: iso,
      articleCount: z.number().int(),
      outlets: z.array(z.string()),
      articles: z.array(z.object({ title: z.string(), url: z.url(), publisher: z.string(), publishedAt: iso })),
    }),
  ),
  news: z.array(crisisArticle),
  images: z.array(crisisImage),
  /** Only from the curated channels in config; thumbnails are YouTube's own, from i.ytimg.com. */
  videos: z.array(z.object({ title: z.string(), channel: z.string(), videoId: z.string(), url: z.url(), publishedAt: iso })),
  posts: z.array(z.object({ author: z.string(), handle: z.string(), text: z.string(), url: z.url(), postedAt: iso })),
  incidents: z.array(
    z.object({
      at: iso,
      category: z.string(),
      place: z.string(),
      lat: z.number(),
      lon: z.number(),
      intensity: z.number().int(),
      reports: z.number().int(),
      outlets: z.number().int(),
      id: z.string(),
      sources: z.array(z.object({ url: z.url(), publisher: z.string() })),
    }),
  ),
  sourceCount: z.number().int(),
  outlets: z.array(z.object({ name: z.string(), count: z.number().int() })),
  feeds: z.object({ gdelt: z.string(), gnews: z.string(), wikipedia: z.string(), worldBank: z.string() }),
});
export type CrisisDetail = z.infer<typeof crisisDetail>;

export const crisisIndexEntry = z.object({
  id: z.string(),
  name: z.string(),
  nameNb: z.string(),
  short: z.string(),
  shortNb: z.string(),
  region: z.string(),
  regionNb: z.string(),
  auto: z.boolean(),
  fips: z.array(z.string()),
  center: z.tuple([z.number(), z.number()]),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  last24h: z.number().int(),
  last7d: z.number().int(),
  prev7d: z.number().int(),
  last30d: z.number().int(),
  change7dPct: z.number().nullable(),
  corroborated7d: z.number().int(),
  score: z.number(),
  level: z.number().int(),
  /** Incidents per day, oldest first, for the home page's thirty-day playback. */
  daily: z.array(z.number().int()),
  image: crisisImage.nullable(),
  lead: z.object({ title: z.string(), publisher: z.string(), url: z.url(), publishedAt: iso }).nullable(),
  sourceCount: z.number().int(),
});
export type CrisisIndexEntry = z.infer<typeof crisisIndexEntry>;

export const crisisIndex = z.object({
  artifactVersion: z.literal(1),
  generatedAt: iso,
  /** When the incident stream this was counted from was published. */
  eventsGeneratedAt: iso,
  crises: z.array(crisisIndexEntry),
});

/**
 * The map's own copy of the incident stream: the same records, stripped to what a marker
 * and its popup need, in arrays rather than objects, with repeated strings interned. The
 * full events.json is 14 MB; a phone should not have to fetch that to draw dots.
 */
export const MAP_EVENT_FIELDS = [
  'minutesSinceEpoch', 'lon*100', 'lat*100', 'category', 'intensity', 'severity', 'crisis(-1)',
  'outlets', 'reports', 'place', 'url', 'publisher', 'country', 'id',
] as const;

export const mapEvents = z.object({
  artifactVersion: z.literal(2),
  generatedAt: iso,
  fields: z.array(z.string()),
  categories: z.array(z.string()),
  crises: z.array(z.string()),
  /** Interned: events refer to these by index. */
  publishers: z.array(z.string()),
  countries: z.array(z.string()),
  /** Incidents an IGRED analyst has checked, keyed by event id (config/verified-events*). */
  verified: z.record(z.string(), z.object({ note: z.string(), source: z.url(), verifiedAt: z.string().optional() })),
  events: z.array(z.tuple([
    z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(),
    z.number().int(), z.number().int(), z.number().int(), z.string(), z.string(), z.number().int(), z.number().int(), z.string(),
  ])),
});

/**
 * What the map needs to open any country, not only those in a crisis: its active UCDP
 * conflicts. Counts come from map-events.json in the browser, so this file only changes
 * when the register does.
 */
export const countriesIndex = z.object({
  artifactVersion: z.literal(1),
  generatedAt: iso,
  countries: z.record(z.string(), z.object({
    name: z.string(),
    nameNb: z.string(),
    crisis: z.string().nullable(),
    conflicts: z.array(z.object({
      name: z.string(),
      type: z.string(),
      startYear: z.string().optional(),
      fatalities: z.number().optional(),
      fatalitiesAsOf: z.string().optional(),
    })),
  })),
});

/**
 * What igred.org's front page animates: today's crises, a sample of real incident positions
 * for the thirty-day playback, and the Brief's top headlines. Small enough for a phone; every
 * point is a published incident, never a decorative one.
 */
export const homeSnapshot = z.object({
  artifactVersion: z.literal(1),
  generatedAt: iso,
  incidents7d: z.number().int(),
  crisesTracked: z.number().int(),
  days: z.array(z.string()),
  crises: z.array(z.object({
    id: z.string(), name: z.string(), nameNb: z.string(), short: z.string(), shortNb: z.string(),
    center: z.tuple([z.number(), z.number()]), last7d: z.number().int(), score: z.number(),
  })),
  /** [lon*10, lat*10, dayIndex, intensity, corroborated(0/1)] */
  points: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()])),
  brief: z.object({
    date: z.string(),
    headlines: z.array(z.object({ headline: z.string(), publisher: z.string(), url: z.url() })),
  }).nullable(),
});
