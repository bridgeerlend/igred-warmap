import { lookupPublisher, loadConfig } from '../../config.js';
import type { Provenance, GeoPrecision } from '../../schema/common.js';
import type { EventCategory } from '../../schema/event.js';
import type { PublisherEntry } from '../../schema/config.js';
import { registrableDomain } from '../../util/misc.js';
import type { GdeltRecord } from './parse.js';

const SOURCE_ID = 'gdelt';
const SOURCE_NAME = 'GDELT 2.0 Event Database';

/** GDELT geo types: 1 country, 2 US state, 3 US city, 4 world city, 5 world state. */
const GEO_PRECISION: Record<number, GeoPrecision> = {
  1: 'country',
  2: 'adm1',
  3: 'city',
  4: 'city',
  5: 'adm1',
};

const PRECISION_RANK: Record<GeoPrecision, number> = {
  country: 0,
  adm1: 1,
  adm2: 2,
  city: 3,
  point: 4,
};

/**
 * One source record, classified and gated. Several observations usually describe the
 * same real-world incident; clustering merges them afterwards.
 */
export interface Observation {
  record: GdeltRecord;
  category: EventCategory;
  severity: number;
  precision: GeoPrecision;
  domain: string | undefined;
  publisher: PublisherEntry | undefined;
  occurredAt: string;
  dateBasis: 'event_date' | 'report_date';
  provenance: Provenance;
}

export function classify(record: GdeltRecord): { category: EventCategory; severity: number } | undefined {
  const { taxonomy } = loadConfig();
  const category =
    taxonomy.eventCodes[record.eventCode] ?? taxonomy.rootCodeFallback[record.eventRootCode];
  if (!category) return undefined;
  const severity = taxonomy.categories[category]?.severity;
  if (severity === undefined) return undefined;
  return { category, severity };
}

/**
 * GDELT occasionally assigns an event a date far from when it was reported. Rather than
 * trusting or discarding it silently, fall back to the report date and say which was used.
 */
function resolveDate(
  record: GdeltRecord,
  maxEventAgeDays: number,
): { occurredAt: string; dateBasis: 'event_date' | 'report_date' } {
  const eventTime = Date.parse(record.eventDay);
  const addedTime = Date.parse(record.dateAdded);
  const ageDays = (addedTime - eventTime) / 86_400_000;
  if (ageDays < 0 || ageDays > maxEventAgeDays) {
    return { occurredAt: record.dateAdded, dateBasis: 'report_date' };
  }
  return { occurredAt: record.eventDay, dateBasis: 'event_date' };
}

export function toObservation(
  record: GdeltRecord,
  retrievedAt: string,
  maxEventAgeDays: number,
): Observation | undefined {
  const classified = classify(record);
  if (!classified) return undefined;

  const precision = GEO_PRECISION[record.geo.type];
  if (!precision) return undefined;

  const domain = registrableDomain(record.sourceUrl);
  const publisher = lookupPublisher(domain);
  const { occurredAt, dateBasis } = resolveDate(record, maxEventAgeDays);

  const provenance: Provenance = {
    sourceId: SOURCE_ID,
    sourceName: SOURCE_NAME,
    sourceTier: 1,
    url: record.sourceUrl,
    retrievedAt,
    publishedAt: record.dateAdded,
    ...(publisher ? { publisher: publisher.name } : domain ? { publisher: domain } : {}),
  };

  return {
    record,
    category: classified.category,
    severity: classified.severity,
    precision,
    domain,
    publisher,
    occurredAt,
    dateBasis,
    provenance,
  };
}

export function meetsMinimumPrecision(observation: Observation): boolean {
  const { relevance } = loadConfig().taxonomy;
  return PRECISION_RANK[observation.precision] >= PRECISION_RANK[relevance.minGeoPrecision];
}

export interface GateInput {
  category: EventCategory;
  countryFips: string | undefined;
  /** FIPS codes of countries with an active conflict in the register. */
  activeConflictCountries: Set<string>;
}

/**
 * Decides what reaches the map. The verified register is the gate: an event shows if its
 * country is listed as actively at war, or if the event type is inherently military.
 *
 * Two cheaper gates were tried against live data and failed. Corroboration count let
 * routine US police shootings through. CAMEO actor-type codes are assigned by word
 * matching, so an article about a labour strike scored actor type REB on the word
 * "rebellion". Neither can separate war from crime, so neither is used.
 *
 * This gates DISPLAY ONLY. Detection runs on the ungated set, because a new conflict by
 * definition appears in a country the register does not know about yet.
 */
export function passesDisplayGate(input: GateInput): boolean {
  const { relevance } = loadConfig().taxonomy;
  if (relevance.alwaysRelevantCategories.includes(input.category)) return true;
  return input.countryFips !== undefined && input.activeConflictCountries.has(input.countryFips);
}

/**
 * CAMEO actor names are generic role words ("PRESIDENT", "NAVY"), so splicing them into a
 * sentence produces confident-sounding nonsense. The label states only what the source
 * actually establishes: what kind of event, and where. Actors travel as structured data.
 */
export function describe(observation: Observation): string {
  const { taxonomy } = loadConfig();
  const label = taxonomy.categories[observation.category]?.label ?? observation.category;
  return `${label} — ${observation.record.geo.fullName}`;
}
