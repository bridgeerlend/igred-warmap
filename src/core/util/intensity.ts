/**
 * How strongly an incident should read on the map, 1–5.
 *
 * Event category alone renders almost flat: on a real day roughly 88% of incidents are
 * armed clashes carrying one severity value. Intensity therefore blends the category with
 * how widely the incident was reported, log-scaled so a single enormous story cannot
 * dominate the field.
 *
 * The result is deliberately bottom-heavy, because the data is — around 71% of incidents
 * have a single source. That gives a quiet field of small embers with genuinely rare bright
 * ones, which is the honest shape rather than a spread manufactured to look busy.
 *
 * This is a display weight derived from source data. It is not a casualty estimate, and no
 * model is involved in producing it.
 */
export function intensityOf(severity: number, reportCount: number): number {
  const corroboration = 1 + Math.log2(Math.max(1, reportCount));
  return Math.max(1, Math.min(5, Math.round(0.4 * severity + 0.7 * corroboration - 0.6)));
}
