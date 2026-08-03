import { z } from 'zod';
import { geoPrecision, sourceTier } from './common.js';
import { eventCategory } from './event.js';

export const sourceDefinition = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: sourceTier,
  role: z.enum(['pulse', 'corroboration', 'verified-backbone', 'activity', 'context']),
  enabled: z.boolean(),
  requiresCredential: z.boolean(),
  credentialEnvVar: z.string().min(1).optional(),
  homepage: z.url(),
  staleAfterHours: z.number().positive(),
  options: z.record(z.string(), z.unknown()).default({}),
});
export type SourceDefinition = z.infer<typeof sourceDefinition>;

export const sourcesConfig = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(sourceDefinition).min(1),
});
export type SourcesConfig = z.infer<typeof sourcesConfig>;

export const publisherEntry = z.strictObject({
  domain: z.string().min(3),
  name: z.string().min(1),
  tier: sourceTier,
  kind: z.enum(['agency', 'newspaper', 'broadcaster', 'magazine', 'institute', 'humanitarian']),
});
export type PublisherEntry = z.infer<typeof publisherEntry>;

export const publishersConfig = z.object({
  schemaVersion: z.literal(1),
  publishers: z.array(publisherEntry).min(1),
});
export type PublishersConfig = z.infer<typeof publishersConfig>;

export const detectionConfig = z.object({
  schemaVersion: z.literal(1),
  countedCategories: z.array(eventCategory).min(1),
  baseline: z.strictObject({
    windowDays: z.number().int().positive(),
    minDaysRequired: z.number().int().positive(),
    excludeRecentDays: z.number().int().min(0),
  }),
  trigger: z.strictObject({
    modifiedZThreshold: z.number().positive(),
    minEventsInDay: z.number().int().positive(),
    minDistinctPublishers: z.number().int().min(0),
    minRatioOverBaseline: z.number().positive(),
    sustainedWindowDays: z.number().int().positive(),
    sustainedDaysRequired: z.number().int().positive(),
  }),
  candidate: z.strictObject({
    cooldownDays: z.number().int().positive(),
    expireAfterDaysWithoutSignal: z.number().int().positive(),
  }),
}).refine((value) => value.baseline.excludeRecentDays >= value.trigger.sustainedWindowDays, {
  message:
    'baseline.excludeRecentDays must be >= trigger.sustainedWindowDays, or the days being scored also sit inside the baseline they are scored against, and a sustained flare-up raises its own median until it looks normal.',
});
export type DetectionConfig = z.infer<typeof detectionConfig>;

export const publishConfig = z.object({
  schemaVersion: z.literal(1),
  eventWindowDays: z.number().int().positive(),
  baselineRetainDays: z.number().int().positive(),
});
export type PublishConfig = z.infer<typeof publishConfig>;

export const countryAliasesConfig = z.object({
  schemaVersion: z.literal(1),
  aliases: z.record(z.string(), z.string()),
});

export const clusteringConfig = z.object({
  schemaVersion: z.literal(1),
  gridDegrees: z.number().positive(),
  sameDayOnly: z.boolean(),
  mergeAcrossCategories: z.boolean(),
  maxEventsPerCluster: z.number().int().positive(),
});
export type ClusteringConfig = z.infer<typeof clusteringConfig>;

export const taxonomyConfig = z.object({
  schemaVersion: z.literal(1),
  categories: z.record(
    eventCategory,
    z.strictObject({ label: z.string().min(1), severity: z.number().int().min(1).max(5) }),
  ),
  eventCodes: z.record(z.string(), eventCategory),
  rootCodeFallback: z.record(z.string(), eventCategory),
  relevance: z.strictObject({
    alwaysRelevantCategories: z.array(eventCategory),
    minDistinctPublishersForReported: z.number().int().positive(),
    minGeoPrecision: geoPrecision,
  }),
});
export type TaxonomyConfig = z.infer<typeof taxonomyConfig>;
