import { z } from 'zod';
import { isoDate, isoDateTime, provenanceList, sourcedNumber } from './common.js';

export const conflictType = z.enum(['state_based', 'non_state', 'one_sided']);
export type ConflictType = z.infer<typeof conflictType>;

export const conflictStatus = z.enum(['active', 'dormant', 'ended', 'candidate']);
export type ConflictStatus = z.infer<typeof conflictStatus>;

export const conflictParty = z.strictObject({
  name: z.string().min(1),
  side: z.union([z.literal('a'), z.literal('b'), z.literal('civilians')]),
  isState: z.boolean(),
  provenance: provenanceList,
});

/**
 * Background prose is the only field a language model may draft, and only via the
 * pull-request approval flow. `approved: false` must never be published to the map.
 */
export const conflictBackground = z.strictObject({
  text: z.string().min(1),
  language: z.enum(['en', 'nb']),
  origin: z.enum(['human', 'ai_draft']),
  approved: z.boolean(),
  approvedAt: isoDateTime.optional(),
  /** Sources the drafter was given. Required so the prose stays checkable. */
  provenance: provenanceList,
});

/**
 * A conflict in the register. Identity and verified figures come from UCDP or from
 * manual IGRED verification — never from a model, and never from news volume alone.
 */
export const conflict = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  type: conflictType,
  status: conflictStatus,
  origin: z.enum(['ucdp', 'igred_verified']),
  /**
   * UCDP names countries; GDELT codes them as FIPS. The name is the authoritative source
   * value and `fips` is our best-effort join key, absent when it could not be resolved.
   */
  countries: z.array(
    z.strictObject({ name: z.string().min(1), fips: z.string().length(2).optional() }),
  ),
  region: z.string().min(1).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  parties: z.array(conflictParty),
  background: conflictBackground.optional(),
  figures: z.record(z.string(), sourcedNumber),
  lastUpdated: isoDateTime,
  provenance: provenanceList,
});
export type Conflict = z.infer<typeof conflict>;
