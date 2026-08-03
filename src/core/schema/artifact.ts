import { z } from 'zod';
import { isoDate, isoDateTime } from './common.js';
import { conflictEvent } from './event.js';
import { conflict } from './conflict.js';
import { conflictCandidate } from './candidate.js';
import { story } from './article.js';

/** Bumped whenever a published artifact changes shape, so the map can refuse stale formats. */
export const ARTIFACT_VERSION = 1;

const artifactVersion = z.literal(ARTIFACT_VERSION);

export const eventsArtifact = z.strictObject({
  artifactVersion,
  generatedAt: isoDateTime,
  windowDays: z.number().int().positive(),
  earliestEvent: isoDateTime.optional(),
  latestEvent: isoDateTime.optional(),
  events: z.array(conflictEvent),
});
export type EventsArtifact = z.infer<typeof eventsArtifact>;

export const conflictsArtifact = z.strictObject({
  artifactVersion,
  generatedAt: isoDateTime,
  conflicts: z.array(conflict),
});
export type ConflictsArtifact = z.infer<typeof conflictsArtifact>;

export const candidatesArtifact = z.strictObject({
  artifactVersion,
  generatedAt: isoDateTime,
  candidates: z.array(conflictCandidate),
});
export type CandidatesArtifact = z.infer<typeof candidatesArtifact>;

export const storiesArtifact = z.strictObject({
  artifactVersion,
  generatedAt: isoDateTime,
  windowDays: z.number().int().positive(),
  /** Articles seen before the field filter, so the reader can see how much was set aside. */
  articlesConsidered: z.number().int().min(0),
  storiesOutOfField: z.number().int().min(0),
  feedsOk: z.number().int().min(0),
  feedsTotal: z.number().int().min(0),
  stories: z.array(story),
});
export type StoriesArtifact = z.infer<typeof storiesArtifact>;

export const sourceHealth = z.strictObject({
  sourceId: z.string().min(1),
  status: z.enum(['ok', 'not_configured', 'degraded', 'failed']),
  lastSuccessAt: isoDateTime.optional(),
  lastAttemptAt: isoDateTime,
  consecutiveFailures: z.number().int().min(0),
  recordsLastRun: z.number().int().min(0),
  message: z.string().optional(),
  /** True when the pipeline republished the previous good data instead of new data. */
  servedFromLastGood: z.boolean(),
});
export type SourceHealth = z.infer<typeof sourceHealth>;

export const healthArtifact = z.strictObject({
  artifactVersion,
  generatedAt: isoDateTime,
  runId: z.string().min(1),
  overall: z.enum(['ok', 'degraded', 'failed']),
  sources: z.array(sourceHealth),
});
export type HealthArtifact = z.infer<typeof healthArtifact>;

export const baselineDay = z.strictObject({
  day: isoDate,
  /** All conflict-coded incidents, including riots and repression. Context for the UI. */
  eventCount: z.number().int().min(0),
  /**
   * The armed subset only. Detection scores this, because a new war shows up as armed
   * clashes; scoring total volume made protest waves look like emerging conflicts.
   */
  armedEventCount: z.number().int().min(0),
  distinctPublishers: z.number().int().min(0),
});
export type BaselineDay = z.infer<typeof baselineDay>;

export const baselineCountry = z.strictObject({
  countryName: z.string().min(1),
  days: z.array(baselineDay),
});

/** Daily per-country activity counts. Our own rolling baseline, accumulated in git. */
export const baselineArtifact = z.strictObject({
  artifactVersion,
  generatedAt: isoDateTime,
  countries: z.record(z.string().length(2), baselineCountry),
});
export type BaselineArtifact = z.infer<typeof baselineArtifact>;
