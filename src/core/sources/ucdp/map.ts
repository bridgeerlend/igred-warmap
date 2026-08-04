import { z } from 'zod';
import type { Provenance } from '../../schema/common.js';
import type { Conflict, ConflictType } from '../../schema/conflict.js';
import type { CountryResolver } from '../../util/country.js';
import { stableId } from '../../util/misc.js';

const SOURCE_NAME = 'UCDP — Uppsala Conflict Data Program';
const LICENSE = 'CC BY 4.0 (Uppsala Conflict Data Program)';

/** UCDP returns numbers as strings in places, so both are accepted and coerced. */
const numeric = z.union([z.number(), z.string()]).transform((value) => Number(value));
const textual = z.union([z.string(), z.number()]).transform((value) => String(value).trim());

const stateBasedRow = z.object({
  conflict_id: textual,
  location: textual,
  side_a: textual,
  side_b: textual,
  year: numeric,
  type_of_conflict: numeric.optional(),
  intensity_level: numeric.optional(),
  start_date: textual.optional(),
  ep_end: numeric.optional(),
  ep_end_date: textual.optional(),
  region: textual.optional(),
});

/**
 * The non-state dataset names its parties differently from the state-based one:
 * side_a_name / side_b_name rather than side_a / side_b. Expecting the state-based names
 * here silently discarded every non-state row — militia and cartel violence, which the
 * brief explicitly wants on the map — because the schema simply never matched.
 */
const nonStateRow = z.object({
  conflict_id: textual,
  location: textual,
  side_a_name: textual,
  side_b_name: textual,
  year: numeric,
  best_fatality_estimate: numeric.optional(),
  start_date: textual.optional(),
  ep_end: numeric.optional(),
  ep_end_date: textual.optional(),
  region: textual.optional(),
});

/** One-sided violence has a single actor and no episode end; status is year-based. */
const oneSidedRow = z.object({
  conflict_id: textual,
  location: textual,
  actor_name: textual,
  year: numeric,
  best_fatality_estimate: numeric.optional(),
  is_government_actor: numeric.optional(),
  region: textual.optional(),
});

const DATASET_SCHEMAS = {
  ucdpprioconflict: stateBasedRow,
  nonstate: nonStateRow,
  onesided: oneSidedRow,
} as const;

export type UcdpDataset = keyof typeof DATASET_SCHEMAS;

const DATASET_TYPE: Record<UcdpDataset, ConflictType> = {
  ucdpprioconflict: 'state_based',
  nonstate: 'non_state',
  onesided: 'one_sided',
};

export interface MapResult {
  conflicts: Conflict[];
  skippedRows: number;
  unresolvedCountries: string[];
}

function provenanceFor(requestUrl: string, retrievedAt: string): Provenance {
  return {
    sourceId: 'ucdp',
    sourceName: SOURCE_NAME,
    sourceTier: 3,
    url: requestUrl,
    retrievedAt,
    license: LICENSE,
  };
}

/**
 * UCDP rows are per conflict-year. They are folded into one record per conflict, keeping
 * the most recent year, so the register reflects current status without losing history
 * (which stays in git).
 */
export function mapUcdpRows(
  dataset: UcdpDataset,
  rows: Record<string, unknown>[],
  requestUrl: string,
  resolver: CountryResolver,
  retrievedAt: string,
  activeSinceYear: number,
): MapResult {
  const schema = DATASET_SCHEMAS[dataset];
  const type = DATASET_TYPE[dataset];
  const provenance = provenanceFor(requestUrl, retrievedAt);
  const unresolved = new Set<string>();
  const byConflict = new Map<string, { year: number; conflict: Conflict }>();
  let skippedRows = 0;

  for (const raw of rows) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      skippedRows += 1;
      continue;
    }
    const row = parsed.data;
    if (!Number.isFinite(row.year)) {
      skippedRows += 1;
      continue;
    }

    const countries = row.location
      .split(/,\s*/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .map((name) => {
        const fips = resolver.resolve(name);
        if (!fips) unresolved.add(name);
        return fips ? { name, fips } : { name };
      });

    // Each dataset names its parties differently, so they are read explicitly rather than
    // by guessing from which fields happen to be present.
    const sides = partiesFor(dataset, row, type, provenance);

    const id = stableId('conf', dataset, row.conflict_id);
    const existing = byConflict.get(id);
    if (existing && existing.year >= row.year) continue;

    const figures: Conflict['figures'] = {};
    const fatalities = (row as { best_fatality_estimate?: number }).best_fatality_estimate;
    if (typeof fatalities === 'number' && Number.isFinite(fatalities)) {
      figures.fatalitiesBestEstimate = {
        value: fatalities,
        unit: 'deaths',
        asOf: `${row.year}-12-31`,
        provenance: [provenance],
      };
    }
    const intensity = (row as { intensity_level?: number }).intensity_level;
    if (typeof intensity === 'number' && Number.isFinite(intensity)) {
      figures.ucdpIntensityLevel = {
        value: intensity,
        asOf: `${row.year}-12-31`,
        provenance: [provenance],
      };
    }

    const name =
      type === 'one_sided'
        ? `${sides[0]?.name ?? 'Unknown actor'} — violence against civilians (${row.location})`
        : `${sides[0]?.name ?? '?'} — ${sides[1]?.name ?? '?'}`;

    const region = (row as { region?: string }).region;
    const startDate = (row as { start_date?: string }).start_date;
    const endDate = (row as { ep_end_date?: string }).ep_end_date;
    const episodeEnded = (row as { ep_end?: number }).ep_end === 1;

    byConflict.set(id, {
      year: row.year,
      conflict: {
        id,
        name,
        type,
        status: row.year >= activeSinceYear && !episodeEnded ? 'active' : 'dormant',
        origin: 'ucdp',
        countries,
        ...(region ? { region } : {}),
        ...(isIsoDate(startDate) ? { startDate } : {}),
        ...(episodeEnded && isIsoDate(endDate) ? { endDate } : {}),
        parties: sides,
        figures,
        lastUpdated: retrievedAt,
        provenance: [provenance],
      },
    });
  }

  return {
    conflicts: [...byConflict.values()].map((entry) => entry.conflict),
    skippedRows,
    unresolvedCountries: [...unresolved].sort(),
  };
}

type AnyRow = z.infer<typeof stateBasedRow> | z.infer<typeof nonStateRow> | z.infer<typeof oneSidedRow>;

function partiesFor(
  dataset: UcdpDataset,
  row: AnyRow,
  type: ConflictType,
  provenance: Provenance,
): Conflict['parties'] {
  if (dataset === 'onesided') {
    const one = row as z.infer<typeof oneSidedRow>;
    return [
      { name: one.actor_name, side: 'a', isState: one.is_government_actor === 1, provenance: [provenance] },
      { name: 'Civilians', side: 'civilians', isState: false, provenance: [provenance] },
    ];
  }

  const [a, b] =
    dataset === 'nonstate'
      ? [(row as z.infer<typeof nonStateRow>).side_a_name, (row as z.infer<typeof nonStateRow>).side_b_name]
      : [(row as z.infer<typeof stateBasedRow>).side_a, (row as z.infer<typeof stateBasedRow>).side_b];

  return [
    // Only the state-based dataset has a government on side A by definition.
    { name: a, side: 'a', isState: type === 'state_based', provenance: [provenance] },
    { name: b, side: 'b', isState: false, provenance: [provenance] },
  ];
}

function isIsoDate(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
