import type { Conflict } from '../schema/conflict.js';
import type { VerifiedConflictsConfig } from '../schema/config.js';

/**
 * Turns hand-confirmed entries into register conflicts.
 *
 * This is the other half of detection. Detection can only say that coverage is abnormal;
 * merging the pull request it generates is what turns that into a conflict the map will
 * display. Without this step the whole detection loop stops at a JSON file nobody reads.
 */
export function verifiedConflicts(
  config: VerifiedConflictsConfig,
  now: string,
): Conflict[] {
  return config.conflicts.map((entry) => {
    const provenance = entry.sources.map((url) => ({
      sourceId: 'igred',
      sourceName: 'IGRED — confirmed by hand',
      sourceTier: 3 as const,
      url,
      retrievedAt: now,
    }));

    return {
      id: entry.id,
      name: entry.name,
      // Confirmed from news coverage rather than from a verified dataset's typology, so the
      // narrowest honest claim is made: something armed is happening, not what kind.
      type: 'state_based' as const,
      status: 'active' as const,
      origin: 'igred_verified' as const,
      countries: entry.countries,
      startDate: entry.confirmedOn,
      parties: [],
      figures: {},
      lastUpdated: now,
      provenance,
    };
  });
}
