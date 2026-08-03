import { z } from 'zod';

export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();

export const sourceTier = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type SourceTier = z.infer<typeof sourceTier>;

/**
 * Non-negotiable principle 1: nothing is displayed without source, timestamp and link.
 * Every schema that reaches the published artifacts embeds at least one of these.
 */
export const provenance = z.strictObject({
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  sourceTier: sourceTier,
  url: z.url(),
  archiveUrl: z.url().optional(),
  publisher: z.string().min(1).optional(),
  publishedAt: isoDateTime.optional(),
  retrievedAt: isoDateTime,
  license: z.string().min(1).optional(),
});
export type Provenance = z.infer<typeof provenance>;

export const provenanceList = z.array(provenance).min(1);

/** A number that cannot exist without the sources that back it. */
export const sourcedNumber = z.strictObject({
  value: z.number(),
  unit: z.string().min(1).optional(),
  asOf: isoDate,
  provenance: provenanceList,
});
export type SourcedNumber = z.infer<typeof sourcedNumber>;

export const geoPrecision = z.enum(['country', 'adm1', 'adm2', 'city', 'point']);
export type GeoPrecision = z.infer<typeof geoPrecision>;

export const geoPoint = z.strictObject({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().min(1),
  /** FIPS 10-4 country code as emitted by GDELT; ISO codes are resolved at render time. */
  countryFips: z.string().length(2).optional(),
  countryIso3: z.string().length(3).optional(),
  adm1: z.string().min(1).optional(),
  precision: geoPrecision,
});
export type GeoPoint = z.infer<typeof geoPoint>;

/**
 * verified    — from a verified dataset (UCDP) or manual IGRED verification
 * reported    — from a whitelisted publisher, single-sourced news reporting
 * unconfirmed — outside the curated whitelist; must be visually marked as such
 */
export const confidence = z.enum(['verified', 'reported', 'unconfirmed']);
export type Confidence = z.infer<typeof confidence>;
