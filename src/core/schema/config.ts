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

export const themesConfig = z.object({
  schemaVersion: z.literal(1),
  /** An article scoring below this in every theme is out of the institute's field. */
  minimumScore: z.number().positive(),
  titleWeight: z.number().positive(),
  themes: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        field: z.enum(['geopolitical_risk', 'economic_development']),
        terms: z.array(z.string().min(2)).min(1),
        /** Decisive on their own when they appear in a headline. */
        strongTerms: z.array(z.string().min(2)),
      }),
    )
    .min(1),
});
export type ThemesConfig = z.infer<typeof themesConfig>;

export const briefConfig = z.object({
  schemaVersion: z.literal(1),
  leadCount: z.number().int().positive(),
  ai: z.strictObject({
    enabled: z.boolean(),
    credentialEnvVar: z.string().min(1),
    model: z.string().min(1),
    maxWords: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    $fallbackNote: z.string().optional(),
  }),
  citation: z.strictObject({
    publisher: z.string().min(1),
    title: z.string().min(1),
    baseUrl: z.url(),
  }),
});
export type BriefConfig = z.infer<typeof briefConfig>;

export const storiesConfig = z.object({
  schemaVersion: z.literal(1),
  harvest: z.strictObject({
    maxItemsPerFeed: z.number().int().positive(),
    concurrency: z.number().int().positive(),
    maxAgeDaysByTier: z.strictObject({
      '1': z.number().positive(),
      '2': z.number().positive(),
      '3': z.number().positive(),
    }),
  }),
  clustering: z.strictObject({
    windowHours: z.number().positive(),
    similarityThreshold: z.number().min(0).max(1),
    rareTokenMaxShare: z.number().min(0).max(1),
    maxArticlesPerStory: z.number().int().positive(),
  }),
  publish: z.strictObject({
    windowDays: z.number().int().positive(),
    maxStories: z.number().int().positive(),
  }),
});
export type StoriesConfig = z.infer<typeof storiesConfig>;

export const feedDefinition = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: sourceTier,
  beat: z.string().min(1),
  language: z.string().min(2).max(5),
  url: z.url(),
});
export type FeedDefinition = z.infer<typeof feedDefinition>;

export const feedsConfig = z.object({
  schemaVersion: z.literal(1),
  feeds: z.array(feedDefinition).min(1),
});

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
