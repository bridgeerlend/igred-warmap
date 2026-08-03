/**
 * GDELT 2.0 export files are headerless, tab-separated and exactly 61 columns wide.
 * Column positions were verified against a live export file rather than taken from docs.
 * A width change means GDELT changed its schema, and that must fail loudly, not silently.
 */
export const GDELT_EXPORT_COLUMNS = 61;

const COL = {
  globalEventId: 0,
  day: 1,
  actor1Code: 5,
  actor1Name: 6,
  actor1CountryCode: 7,
  actor1Type1: 12,
  actor1Type2: 13,
  actor1Type3: 14,
  actor2Code: 15,
  actor2Name: 16,
  actor2CountryCode: 17,
  actor2Type1: 22,
  actor2Type2: 23,
  actor2Type3: 24,
  eventCode: 26,
  eventRootCode: 28,
  quadClass: 29,
  goldstein: 30,
  numMentions: 31,
  numSources: 32,
  numArticles: 33,
  avgTone: 34,
  actionGeoType: 51,
  actionGeoFullName: 52,
  actionGeoCountryCode: 53,
  actionGeoAdm1: 54,
  actionGeoLat: 56,
  actionGeoLong: 57,
  dateAdded: 59,
  sourceUrl: 60,
} as const;

export interface GdeltActor {
  code?: string | undefined;
  name?: string | undefined;
  countryCode?: string | undefined;
  types: string[];
}

export interface GdeltRecord {
  globalEventId: string;
  eventDay: string;
  actor1: GdeltActor;
  actor2: GdeltActor;
  eventCode: string;
  eventRootCode: string;
  quadClass: number;
  goldstein: number;
  numSources: number;
  numArticles: number;
  avgTone: number;
  geo: {
    type: number;
    fullName: string;
    countryFips: string;
    adm1?: string | undefined;
    lat: number;
    lon: number;
  };
  dateAdded: string;
  sourceUrl: string;
}

export class GdeltSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GdeltSchemaError';
  }
}

const text = (fields: string[], index: number): string => (fields[index] ?? '').trim();

const numberOrNaN = (value: string): number => (value.length > 0 ? Number(value) : Number.NaN);

/** Drops keys whose value is undefined, so optional schema fields stay absent rather than null. */
function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function optional(fields: string[], index: number): string | undefined {
  const value = text(fields, index);
  return value.length > 0 ? value : undefined;
}

function readActor(
  fields: string[],
  codeIndex: number,
  nameIndex: number,
  countryIndex: number,
  typeIndices: readonly number[],
): GdeltActor {
  return compact({
    code: optional(fields, codeIndex),
    name: optional(fields, nameIndex),
    countryCode: optional(fields, countryIndex),
    types: typeIndices.map((index) => text(fields, index)).filter((value) => value.length > 0),
  });
}

/** GDELT dates are YYYYMMDD; DATEADDED is YYYYMMDDHHMMSS. Both are UTC. */
export function gdeltDayToIso(day: string): string | undefined {
  if (!/^\d{8}$/.test(day)) return undefined;
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

export function gdeltStampToIso(stamp: string): string | undefined {
  if (!/^\d{14}$/.test(stamp)) return undefined;
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}.000Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

export interface ParseResult {
  records: GdeltRecord[];
  /** Rows dropped because a required field was missing or unusable, by reason. */
  skipped: Record<string, number>;
}

export function parseGdeltExport(content: string): ParseResult {
  const skipped: Record<string, number> = {};
  const drop = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  const records: GdeltRecord[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const fields = line.split('\t');

    if (fields.length !== GDELT_EXPORT_COLUMNS) {
      throw new GdeltSchemaError(
        `Expected ${GDELT_EXPORT_COLUMNS} columns, got ${fields.length}. GDELT changed its export format.`,
      );
    }

    const globalEventId = text(fields, COL.globalEventId);
    const sourceUrl = text(fields, COL.sourceUrl);
    // Number('') is 0, which would silently place ungeocoded events at Null Island.
    const lat = numberOrNaN(text(fields, COL.actionGeoLat));
    const lon = numberOrNaN(text(fields, COL.actionGeoLong));
    const countryFips = text(fields, COL.actionGeoCountryCode);
    const eventCode = text(fields, COL.eventCode);
    const dateAdded = text(fields, COL.dateAdded);

    if (globalEventId.length === 0) { drop('no_event_id'); continue; }
    if (sourceUrl.length === 0) { drop('no_source_url'); continue; }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { drop('no_coordinates'); continue; }
    if (countryFips.length !== 2) { drop('no_country'); continue; }
    if (eventCode.length === 0) { drop('no_event_code'); continue; }

    const eventDay = gdeltDayToIso(text(fields, COL.day));
    const addedIso = gdeltStampToIso(dateAdded);
    if (!eventDay || !addedIso) { drop('bad_date'); continue; }

    records.push({
      globalEventId,
      eventDay,
      actor1: readActor(fields, COL.actor1Code, COL.actor1Name, COL.actor1CountryCode, [
        COL.actor1Type1,
        COL.actor1Type2,
        COL.actor1Type3,
      ]),
      actor2: readActor(fields, COL.actor2Code, COL.actor2Name, COL.actor2CountryCode, [
        COL.actor2Type1,
        COL.actor2Type2,
        COL.actor2Type3,
      ]),
      eventCode,
      eventRootCode: text(fields, COL.eventRootCode),
      quadClass: Number(text(fields, COL.quadClass)) || 0,
      goldstein: Number(text(fields, COL.goldstein)) || 0,
      numSources: Number(text(fields, COL.numSources)) || 0,
      numArticles: Number(text(fields, COL.numArticles)) || 0,
      avgTone: Number(text(fields, COL.avgTone)) || 0,
      geo: compact({
        type: Number(text(fields, COL.actionGeoType)) || 0,
        fullName: text(fields, COL.actionGeoFullName),
        countryFips,
        adm1: optional(fields, COL.actionGeoAdm1),
        lat,
        lon,
      }),
      dateAdded: addedIso,
      sourceUrl,
    });
  }

  return { records, skipped };
}
