import { loadConfig } from '../config.js';
import type { Provenance } from '../schema/common.js';
import type { Actor, ConflictEvent } from '../schema/event.js';
import {
  describe,
  meetsMinimumPrecision,
  passesDisplayGate,
  type Observation,
} from '../sources/gdelt/map.js';
import { stableId } from '../util/misc.js';

const MAX_PROVENANCE_PER_EVENT = 25;
const MAX_ACTORS_PER_EVENT = 6;

function cell(value: number, grid: number): number {
  return Math.floor(value / grid);
}

function clusterKey(observation: Observation, grid: number, mergeAcrossCategories: boolean): string {
  const day = observation.occurredAt.slice(0, 10);
  const lat = cell(observation.record.geo.lat, grid);
  const lon = cell(observation.record.geo.lon, grid);
  const category = mergeAcrossCategories ? 'any' : observation.category;
  return `${day}|${lat}|${lon}|${category}`;
}

function mostFrequent<T>(values: T[], keyOf: (value: T) => string): T | undefined {
  const counts = new Map<string, { count: number; value: T }>();
  for (const value of values) {
    const key = keyOf(value);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { count: 1, value });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value;
}

function collectActors(observations: Observation[]): Actor[] {
  const byName = new Map<string, Actor>();
  for (const observation of observations) {
    const entries: [string | undefined, Actor['role'], string | undefined, string | undefined][] = [
      [observation.record.actor1.name, 'initiator', observation.record.actor1.code, observation.record.actor1.countryCode],
      [observation.record.actor2.name, 'target', observation.record.actor2.code, observation.record.actor2.countryCode],
    ];
    for (const [name, role, code, countryCode] of entries) {
      if (!name) continue;
      const key = `${name}|${role}`;
      if (byName.has(key)) continue;
      byName.set(key, {
        name,
        role,
        ...(code ? { code } : {}),
        ...(countryCode && countryCode.length === 2 ? { countryFips: countryCode } : {}),
      });
    }
  }
  return [...byName.values()].slice(0, MAX_ACTORS_PER_EVENT);
}

/** Prefers whitelisted publishers, then the earliest report, so the top citations are the best ones. */
function collectProvenance(observations: Observation[]): Provenance[] {
  const byUrl = new Map<string, { provenance: Provenance; tier: number }>();
  for (const observation of observations) {
    if (byUrl.has(observation.provenance.url)) continue;
    byUrl.set(observation.provenance.url, {
      provenance: observation.provenance,
      tier: observation.publisher?.tier ?? 9,
    });
  }
  return [...byUrl.values()]
    .sort((a, b) => a.tier - b.tier || a.provenance.retrievedAt.localeCompare(b.provenance.retrievedAt))
    .slice(0, MAX_PROVENANCE_PER_EVENT)
    .map((entry) => entry.provenance);
}

export interface ClusterResult {
  clusters: ConflictEvent[];
  droppedForPrecision: number;
}

/**
 * Collapses many source records into one map point per incident. Grouping is purely
 * positional and temporal — no language model decides what counts as the same event.
 *
 * No relevance filtering happens here: the full set feeds the detection baseline, and the
 * caller applies the display gate separately.
 */
export function clusterObservations(observations: Observation[]): ClusterResult {
  const { clustering } = loadConfig();
  const groups = new Map<string, Observation[]>();
  let droppedForPrecision = 0;

  for (const observation of observations) {
    if (!meetsMinimumPrecision(observation)) {
      droppedForPrecision += 1;
      continue;
    }
    const key = clusterKey(observation, clustering.gridDegrees, clustering.mergeAcrossCategories);
    const group = groups.get(key);
    if (group) {
      if (group.length < clustering.maxEventsPerCluster) group.push(observation);
    } else {
      groups.set(key, [observation]);
    }
  }

  const clusters: ConflictEvent[] = [];
  const { minDistinctPublishersForReported } = loadConfig().taxonomy.relevance;

  for (const [key, group] of groups) {
    const distinctUrls = new Set(group.map((observation) => observation.provenance.url));
    const distinctDomains = new Set(
      group.map((observation) => observation.domain).filter((domain): domain is string => !!domain),
    );

    const representative = group.reduce((best, current) =>
      current.severity > best.severity ? current : best,
    );

    const location = mostFrequent(group, (observation) => observation.record.geo.fullName) ?? representative;
    const cameo = mostFrequent(group, (observation) => observation.record.eventCode) ?? representative;
    const eventDateCount = group.filter((observation) => observation.dateBasis === 'event_date').length;
    const whitelisted = group.some((observation) => observation.publisher !== undefined);

    const occurredAt = group
      .map((observation) => observation.occurredAt)
      .sort()[0] as string;
    const ingestedAt = group
      .map((observation) => observation.record.dateAdded)
      .sort()
      .at(-1) as string;

    // Regional outlets, not the wire agencies, dominate this feed, so independent
    // corroboration counts alongside the whitelist when grading confidence.
    const corroborated = distinctDomains.size >= minDistinctPublishersForReported;

    const event: ConflictEvent = {
      id: stableId('evt', key),
      occurredAt,
      dateBasis: eventDateCount * 2 >= group.length ? 'event_date' : 'report_date',
      ingestedAt,
      category: representative.category,
      label: describe(representative),
      cameoCode: cameo.record.eventCode,
      location: {
        lat: location.record.geo.lat,
        lon: location.record.geo.lon,
        name: location.record.geo.fullName,
        countryFips: location.record.geo.countryFips,
        precision: location.precision,
        ...(location.record.geo.adm1 ? { adm1: location.record.geo.adm1 } : {}),
      },
      actors: collectActors(group),
      confidence: whitelisted || corroborated ? 'reported' : 'unconfirmed',
      severity: representative.severity,
      reportCount: distinctUrls.size,
      distinctPublishers: distinctDomains.size,
      provenance: collectProvenance(group),
    };

    clusters.push(event);
  }

  clusters.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.severity - a.severity);
  return { clusters, droppedForPrecision };
}

/** Applies the display gate. Detection intentionally sees the ungated set. */
export function selectDisplayEvents(
  clusters: ConflictEvent[],
  activeConflictCountries: Set<string>,
): ConflictEvent[] {
  return clusters.filter((event) =>
    passesDisplayGate({
      category: event.category,
      countryFips: event.location.countryFips,
      activeConflictCountries,
    }),
  );
}

/** Merges a fresh run into the retained window, newest record winning on id collision. */
export function mergeEventWindow(
  existing: ConflictEvent[],
  incoming: ConflictEvent[],
  windowDays: number,
  now: Date,
): ConflictEvent[] {
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  const byId = new Map<string, ConflictEvent>();
  for (const event of existing) byId.set(event.id, event);
  for (const event of incoming) {
    const previous = byId.get(event.id);
    byId.set(event.id, previous ? mergeEvent(previous, event) : event);
  }
  return [...byId.values()]
    .filter((event) => event.occurredAt >= cutoff)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function mergeEvent(previous: ConflictEvent, incoming: ConflictEvent): ConflictEvent {
  const provenance = [...previous.provenance];
  const seen = new Set(provenance.map((entry) => entry.url));
  for (const entry of incoming.provenance) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    provenance.push(entry);
  }
  return {
    ...incoming,
    reportCount: Math.max(previous.reportCount, incoming.reportCount),
    distinctPublishers: Math.max(previous.distinctPublishers, incoming.distinctPublishers),
    severity: Math.max(previous.severity, incoming.severity),
    confidence: previous.confidence === 'reported' ? 'reported' : incoming.confidence,
    provenance: provenance.slice(0, MAX_PROVENANCE_PER_EVENT),
  };
}
