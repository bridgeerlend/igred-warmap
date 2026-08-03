import type { BaselineArtifact, BaselineDay } from '../schema/artifact.js';
import type { ConflictEvent, EventCategory } from '../schema/event.js';
import { ARTIFACT_VERSION } from '../schema/artifact.js';
import { addDays } from '../util/misc.js';

/**
 * Some GDELT place strings put a qualifier last ("Bahamas, The"; "Vietnam, Republic Of"),
 * which made the naive last-segment read produce countries called "The" and "Republic Of".
 * Directional qualifiers are deliberately absent from this list: stripping them would
 * collapse a hypothetical "Korea, North" and "Korea, South" into one name.
 */
const TRAILING_QUALIFIER =
  /^(the|republic of|democratic republic of|islamic republic of|people'?s republic of|federal republic of|united republic of|kingdom of|state of|commonwealth of)$/i;

/**
 * GDELT reports a place as "City, Region, Country", so the country name comes from the
 * source string itself rather than a hand-maintained code table that could drift.
 */
export function countryNameFromPlace(fullName: string, fallback: string): string {
  const segments = fullName
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const last = segments.at(-1);
  if (!last) return fallback;
  if (TRAILING_QUALIFIER.test(last)) return segments.at(-2) ?? fallback;
  return last;
}

export function emptyBaseline(generatedAt: string): BaselineArtifact {
  return { artifactVersion: ARTIFACT_VERSION, generatedAt, countries: {} };
}

/**
 * Folds a day's clustered events into the rolling per-country history. Counting distinct
 * incidents rather than articles keeps one viral story from looking like a new war.
 */
export function updateBaseline(
  baseline: BaselineArtifact,
  events: ConflictEvent[],
  generatedAt: string,
  retainDays: number,
  countedCategories: readonly EventCategory[],
): BaselineArtifact {
  const counted = new Set(countedCategories);
  const perCountryDay = new Map<
    string,
    { count: number; armedCount: number; publishers: Set<string>; name: string }
  >();

  for (const event of events) {
    const fips = event.location.countryFips;
    if (!fips) continue;
    const day = event.occurredAt.slice(0, 10);
    const key = `${fips}|${day}`;
    const entry = perCountryDay.get(key) ?? {
      count: 0,
      armedCount: 0,
      publishers: new Set<string>(),
      name: countryNameFromPlace(event.location.name, fips),
    };
    entry.count += 1;
    if (counted.has(event.category)) entry.armedCount += 1;
    for (const source of event.provenance) {
      if (source.publisher) entry.publishers.add(source.publisher);
    }
    perCountryDay.set(key, entry);
  }

  const countries: BaselineArtifact['countries'] = structuredClone(baseline.countries);
  const cutoff = addDays(generatedAt.slice(0, 10), -retainDays);

  for (const [key, entry] of perCountryDay) {
    const [fips, day] = key.split('|') as [string, string];
    const country = countries[fips] ?? { countryName: entry.name, days: [] };
    const existing = country.days.find((candidate) => candidate.day === day);

    if (existing) {
      // A day is re-observed across hourly runs; keep the highest count seen for it.
      existing.eventCount = Math.max(existing.eventCount, entry.count);
      existing.armedEventCount = Math.max(existing.armedEventCount, entry.armedCount);
      existing.distinctPublishers = Math.max(existing.distinctPublishers, entry.publishers.size);
    } else {
      country.days.push({
        day,
        eventCount: entry.count,
        armedEventCount: entry.armedCount,
        distinctPublishers: entry.publishers.size,
      });
    }
    country.countryName = entry.name;
    countries[fips] = country;
  }

  for (const country of Object.values(countries)) {
    country.days = country.days
      .filter((entry) => entry.day >= cutoff)
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  return { artifactVersion: ARTIFACT_VERSION, generatedAt, countries };
}

export function daysInRange(days: BaselineDay[], from: string, to: string): BaselineDay[] {
  return days.filter((entry) => entry.day >= from && entry.day < to);
}
