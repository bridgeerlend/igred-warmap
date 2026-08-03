import { z } from 'zod';
import { isoDateTime, provenanceList, sourceTier } from './common.js';

/**
 * One item from one feed, normalised. Titles and summaries are the publisher's own words,
 * carried verbatim — nothing here is written by us or by a model.
 */
export const article = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  /** The publisher's own standfirst or excerpt, stripped of markup. Never rewritten. */
  summary: z.string().min(1).optional(),
  url: z.url(),
  publishedAt: isoDateTime,
  retrievedAt: isoDateTime,
  feedId: z.string().min(1),
  publisher: z.string().min(1),
  tier: sourceTier,
  beat: z.string().min(1),
  language: z.string().min(2).max(5),
});
export type Article = z.infer<typeof article>;

export const themeMatch = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  field: z.enum(['geopolitical_risk', 'economic_development']),
  /** The terms that actually matched, so a classification can be checked rather than trusted. */
  matchedTerms: z.array(z.string().min(1)).min(1),
  score: z.number().min(0),
});
export type ThemeMatch = z.infer<typeof themeMatch>;

/**
 * Several outlets reporting the same thing, grouped in code. The headline is not written:
 * it is the title of the most authoritative article in the group, attributed to that outlet.
 */
export const story = z.strictObject({
  id: z.string().min(1),
  headline: z.string().min(1),
  /** Which article the headline was taken from, so the wording is always traceable. */
  headlineFrom: z.strictObject({ publisher: z.string().min(1), url: z.url() }),
  themes: z.array(themeMatch),
  firstSeenAt: isoDateTime,
  lastSeenAt: isoDateTime,
  articleCount: z.number().int().min(1),
  distinctPublishers: z.number().int().min(1),
  /** Distinct tiers represented. A story carried by all three is broader than one on tier 1. */
  tiers: z.array(sourceTier).min(1),
  /** Ordinal 1-5 prominence, from breadth of coverage. Not an importance judgement. */
  prominence: z.number().int().min(1).max(5),
  articles: z
    .array(
      z.strictObject({
        title: z.string().min(1),
        url: z.url(),
        publisher: z.string().min(1),
        tier: sourceTier,
        publishedAt: isoDateTime,
      }),
    )
    .min(1),
  provenance: provenanceList,
});
export type Story = z.infer<typeof story>;
