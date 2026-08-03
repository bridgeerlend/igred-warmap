import { z } from 'zod';
import { confidence, geoPoint, isoDateTime, provenanceList } from './common.js';

export const eventCategory = z.enum([
  'armed_clash',
  'armed_assault',
  'aerial_strike',
  'mass_violence',
  'violent_repression',
  'violent_unrest',
  'siege_blockade',
]);
export type EventCategory = z.infer<typeof eventCategory>;

export const actorRole = z.enum(['initiator', 'target', 'unknown']);

export const actor = z.strictObject({
  name: z.string().min(1),
  role: actorRole,
  /** CAMEO actor code, kept so the raw claim stays inspectable. */
  code: z.string().min(1).optional(),
  countryFips: z.string().length(2).optional(),
});
export type Actor = z.infer<typeof actor>;

/**
 * One conflict event as displayed on the map. Always derived from source records —
 * never authored, inferred or embellished by a language model.
 */
export const conflictEvent = z.strictObject({
  id: z.string().min(1),
  occurredAt: isoDateTime,
  /**
   * Whether occurredAt is the date the source assigned to the event, or the date it was
   * reported. GDELT sometimes mis-extracts event dates, so the basis is stated rather
   * than quietly assumed.
   */
  dateBasis: z.enum(['event_date', 'report_date']),
  ingestedAt: isoDateTime,
  category: eventCategory,
  label: z.string().min(1),
  cameoCode: z.string().min(2).max(4),
  location: geoPoint,
  actors: z.array(actor),
  confidence: confidence,
  /** Ordinal 1-5 display weight from the taxonomy. Not a casualty estimate. */
  severity: z.number().int().min(1).max(5),
  /** How many raw source records collapsed into this single point. */
  reportCount: z.number().int().min(1),
  distinctPublishers: z.number().int().min(0),
  conflictId: z.string().min(1).optional(),
  provenance: provenanceList,
});
export type ConflictEvent = z.infer<typeof conflictEvent>;
