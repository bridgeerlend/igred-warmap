import { describe, expect, it } from 'vitest';
import {
  GDELT_EXPORT_COLUMNS,
  GdeltSchemaError,
  gdeltDayToIso,
  gdeltStampToIso,
  parseGdeltExport,
} from '../src/core/sources/gdelt/parse.js';

function row(overrides: Record<number, string> = {}): string {
  const fields = new Array<string>(GDELT_EXPORT_COLUMNS).fill('');
  fields[0] = '1316537841';
  fields[1] = '20260803';
  fields[6] = 'BEIJING';
  fields[12] = 'MIL';
  fields[26] = '190';
  fields[28] = '19';
  fields[29] = '4';
  fields[32] = '3';
  fields[51] = '4';
  fields[52] = 'Kyiv, Kyyiv, Misto, Ukraine';
  fields[53] = 'UP';
  fields[54] = 'UP12';
  fields[56] = '50.4333';
  fields[57] = '30.5167';
  fields[59] = '20260803041500';
  fields[60] = 'https://example.org/story';
  for (const [index, value] of Object.entries(overrides)) fields[Number(index)] = value;
  return fields.join('\t');
}

describe('gdelt date parsing', () => {
  it('converts day and timestamp fields to UTC ISO strings', () => {
    expect(gdeltDayToIso('20260803')).toBe('2026-08-03T00:00:00.000Z');
    expect(gdeltStampToIso('20260803041500')).toBe('2026-08-03T04:15:00.000Z');
  });

  it('rejects malformed dates rather than coercing them', () => {
    expect(gdeltDayToIso('2026080')).toBeUndefined();
    expect(gdeltDayToIso('20261345')).toBeUndefined();
    expect(gdeltStampToIso('20260803')).toBeUndefined();
  });
});

describe('parseGdeltExport', () => {
  it('reads the verified column positions', () => {
    const { records } = parseGdeltExport(row());
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.globalEventId).toBe('1316537841');
    expect(record.eventCode).toBe('190');
    expect(record.eventRootCode).toBe('19');
    expect(record.geo.countryFips).toBe('UP');
    expect(record.geo.lat).toBeCloseTo(50.4333);
    expect(record.geo.lon).toBeCloseTo(30.5167);
    expect(record.sourceUrl).toBe('https://example.org/story');
    expect(record.actor1.types).toEqual(['MIL']);
  });

  it('fails loudly when the column count changes', () => {
    expect(() => parseGdeltExport('a\tb\tc')).toThrow(GdeltSchemaError);
  });

  it('skips rows missing the fields a map point needs, and says why', () => {
    const content = [
      row(),
      row({ 60: '' }),
      row({ 56: '', 57: '' }),
      row({ 53: '' }),
    ].join('\n');
    const { records, skipped } = parseGdeltExport(content);
    expect(records).toHaveLength(1);
    expect(skipped).toEqual({ no_source_url: 1, no_coordinates: 1, no_country: 1 });
  });

  it('ignores blank lines', () => {
    expect(parseGdeltExport(`${row()}\n\n`).records).toHaveLength(1);
  });
});
