import { z } from 'zod';

/**
 * A crisis is an editorial grouping of countries (config/crises.json). Everything in its
 * file is either counted from the incident stream, taken verbatim from a named source, or
 * composed from those counts by a fixed template. No model writes any of it.
 */

const iso = z.string().min(10);

export const crisisArticle = z.object({
  title: z.string().min(1),
  url: z.url(),
  publisher: z.string().min(1),
  domain: z.string().optional(),
  publishedAt: iso,
  /** The publisher's own preview image, linked rather than copied. */
  image: z.url().optional(),
  /** Where we found it: GDELT's article index, Google News, a curated feed, or the incident stream. */
  via: z.enum(['gdelt', 'gnews', 'feed']),
  tier: z.number().int().min(1).max(3).optional(),
});
export type CrisisArticle = z.infer<typeof crisisArticle>;

export const crisisImage = z.object({
  src: z.url(),
  caption: z.string(),
  url: z.url(),
  credit: z.string(),
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
  /** 0-5, from the week's summed intensity relative to the busiest crisis. Display only. */
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
  situation: z.object({ en: z.string(), nb: z.string() }),
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
      image: z.url().optional(),
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
  level: z.number().int(),
  spark: z.array(z.number().int()),
  image: crisisImage.nullable(),
  lead: z.object({ title: z.string(), publisher: z.string(), url: z.url(), publishedAt: iso }).nullable(),
  sourceCount: z.number().int(),
});
export type CrisisIndexEntry = z.infer<typeof crisisIndexEntry>;

export const crisisIndex = z.object({
  artifactVersion: z.literal(1),
  generatedAt: iso,
  crises: z.array(crisisIndexEntry),
});

/**
 * The map's own copy of the incident stream: the same records, stripped to what a marker
 * and its popup need, in arrays rather than objects. The full events.json is 14 MB; a phone
 * should not have to fetch that to draw dots.
 */
export const mapEvents = z.object({
  artifactVersion: z.literal(1),
  generatedAt: iso,
  categories: z.array(z.string()),
  crises: z.array(z.string()),
  /** [minutesSinceEpoch, lon*100, lat*100, category, intensity, crisis(-1), reported(0/1), reports, place, url, publisher] */
  events: z.array(z.tuple([
    z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(),
    z.number().int(), z.number().int(), z.number().int(), z.string(), z.string(), z.string(),
  ])),
});
