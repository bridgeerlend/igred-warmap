import { z } from 'zod';
import { isoDate, isoDateTime, provenanceList } from './common.js';

export const anomalyEvidence = z.strictObject({
  day: isoDate,
  eventCount: z.number().int().min(0),
  distinctPublishers: z.number().int().min(0),
  baselineMedian: z.number().min(0),
  baselineMad: z.number().min(0),
  modifiedZ: z.number(),
  ratioOverBaseline: z.number().min(0),
});
export type AnomalyEvidence = z.infer<typeof anomalyEvidence>;

/**
 * A possible new conflict spotted as abnormal news volume. This is an observation
 * about coverage, never a claim that a conflict exists. It stays `pending_review`
 * until a human confirms it through the pull-request flow.
 */
export const conflictCandidate = z.strictObject({
  id: z.string().min(1),
  countryFips: z.string().length(2),
  countryName: z.string().min(1),
  detectedAt: isoDateTime,
  status: z.enum(['pending_review', 'confirmed', 'rejected', 'expired']),
  /** Explicit wording carried into the UI so the claim is never overstated. */
  claim: z.literal('abnormal_conflict_coverage_detected'),
  evidence: z.array(anomalyEvidence).min(1),
  /**
   * The incidents behind the numbers, embedded rather than referenced by id: the country
   * is by definition not in the register yet, so its events do not appear in the published
   * map window and an id would dangle.
   */
  sampleIncidents: z.array(
    z.strictObject({
      label: z.string().min(1),
      occurredAt: isoDateTime,
      locationName: z.string().min(1),
    }),
  ),
  provenance: provenanceList,
  lastSignalAt: isoDateTime,
  resolvedAt: isoDateTime.optional(),
  resolutionNote: z.string().min(1).optional(),
});
export type ConflictCandidate = z.infer<typeof conflictCandidate>;
