import { describe, expect, it } from 'vitest';
import { mapUcdpRows } from '../src/core/sources/ucdp/map.js';
import { CountryResolver } from '../src/core/util/country.js';

/**
 * Fixtures copied verbatim from the live API, not invented.
 *
 * This module was written before a token existed and shipped untested. The first contact
 * with the real service found that the non-state dataset names its parties side_a_name and
 * side_b_name rather than side_a and side_b — so every non-state row failed validation and
 * was silently discarded. These pin the real shapes so that cannot recur.
 */
const resolver = new CountryResolver({ IN: 'India', AF: 'Afghanistan', MX: 'Mexico' }, {});
const NOW = '2026-08-04T09:00:00.000Z';
const URL = 'https://ucdpapi.pcr.uu.se/api/x/24.1?pagesize=1&page=0';

const STATE_BASED = {
  conflict_id: '11342', location: 'India', side_a: 'Government of India', side_a_Id: '141',
  side_b: 'GNLA', side_b_Id: '1163', incompatibility: '1', territory_name: 'Garoland',
  year: '2012', intensity_level: '1', cumulative_intensity: '0', type_of_conflict: '3',
  start_date: '1997-05-29', ep_end: '1', ep_end_date: '2012-12-21',
  gwno_a: '750', gwno_loc: '750', region: '3', version: '24.1',
};

const NON_STATE = {
  conflict_id: '10066', dyad_id: '10676', org: '1',
  side_a_name: 'Hizb-i Wahdat', side_a_id: '300',
  side_b_name: 'Junbish-i Milli-yi Islami', side_b_id: '302',
  start_date: '1995-02-20', ep_end: '1', ep_end_date: '1998-03-19',
  year: '1998', best_fatality_estimate: '101', location: 'Afghanistan',
  gwno_location: '700', region: '3', version: '24.1',
};

const ONE_SIDED = {
  conflict_id: '641', dyad_id: '1108', actor_id: '10', actor_name: 'Government of Mexico',
  year: 2014, best_fatality_estimate: 32, is_government_actor: 1,
  location: 'Mexico', gwno_location: '70', gwnoa: '70', region: '5', version: '24.1',
};

describe('mapping the live UCDP shapes', () => {
  it('reads a state-based row', () => {
    const result = mapUcdpRows('ucdpprioconflict', [STATE_BASED], URL, resolver, NOW, 2020);
    expect(result.skippedRows).toBe(0);
    const conflict = result.conflicts[0]!;
    expect(conflict.parties.map((party) => party.name)).toEqual(['Government of India', 'GNLA']);
    expect(conflict.parties[0]?.isState).toBe(true);
    expect(conflict.countries[0]).toEqual({ name: 'India', fips: 'IN' });
  });

  it('reads a non-state row, whose parties are named differently', () => {
    const result = mapUcdpRows('nonstate', [NON_STATE], URL, resolver, NOW, 2020);
    expect(result.skippedRows).toBe(0);
    const conflict = result.conflicts[0]!;
    expect(conflict.parties.map((party) => party.name)).toEqual([
      'Hizb-i Wahdat',
      'Junbish-i Milli-yi Islami',
    ]);
    // Neither side is a government in a non-state conflict.
    expect(conflict.parties.every((party) => !party.isState)).toBe(true);
    expect(conflict.figures.fatalitiesBestEstimate?.value).toBe(101);
  });

  it('reads a one-sided row as an actor against civilians', () => {
    const result = mapUcdpRows('onesided', [ONE_SIDED], URL, resolver, NOW, 2020);
    expect(result.skippedRows).toBe(0);
    const conflict = result.conflicts[0]!;
    expect(conflict.parties[0]?.name).toBe('Government of Mexico');
    expect(conflict.parties[0]?.isState).toBe(true);
    expect(conflict.parties[1]?.side).toBe('civilians');
    expect(conflict.name).toContain('violence against civilians');
  });

  it('marks an ended episode dormant, whatever its year', () => {
    // Both of these ended; neither should read as an active conflict on the map.
    for (const [dataset, row] of [['ucdpprioconflict', STATE_BASED], ['nonstate', NON_STATE]] as const) {
      const result = mapUcdpRows(dataset, [{ ...row, year: '2024' }], URL, resolver, NOW, 2020);
      expect(result.conflicts[0]?.status).toBe('dormant');
      expect(result.conflicts[0]?.endDate).toBe(row.ep_end_date);
    }
  });

  it('marks a recent, unfinished episode active', () => {
    const result = mapUcdpRows(
      'ucdpprioconflict',
      [{ ...STATE_BASED, year: '2024', ep_end: '0', ep_end_date: '' }],
      URL, resolver, NOW, 2020,
    );
    expect(result.conflicts[0]?.status).toBe('active');
    expect(result.conflicts[0]?.endDate).toBeUndefined();
  });

  it('folds conflict-years into one record, keeping the latest', () => {
    const result = mapUcdpRows(
      'ucdpprioconflict',
      [
        { ...STATE_BASED, year: '2019', intensity_level: '1' },
        { ...STATE_BASED, year: '2024', intensity_level: '2' },
        { ...STATE_BASED, year: '2021', intensity_level: '1' },
      ],
      URL, resolver, NOW, 2020,
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.figures.ucdpIntensityLevel?.value).toBe(2);
  });

  it('reports a country it cannot resolve instead of guessing one', () => {
    const result = mapUcdpRows(
      'ucdpprioconflict',
      [{ ...STATE_BASED, location: 'Ruritania' }],
      URL, resolver, NOW, 2020,
    );
    expect(result.unresolvedCountries).toEqual(['Ruritania']);
    expect(result.conflicts[0]?.countries[0]).toEqual({ name: 'Ruritania' });
  });

  it('carries source, licence and retrieval time on every record', () => {
    const result = mapUcdpRows('ucdpprioconflict', [STATE_BASED], URL, resolver, NOW, 2020);
    const source = result.conflicts[0]!.provenance[0]!;
    expect(source.url).toBe(URL);
    expect(source.retrievedAt).toBe(NOW);
    expect(source.license).toContain('CC BY 4.0');
  });
});

describe('resolving the countries UCDP names', () => {
  it('takes a FIPS code straight from the alias table', () => {
    // The observed-name table only holds countries the news feed has mentioned, so a
    // register country it has never covered has no name to be aliased to.
    const sparse = new CountryResolver({}, { Togo: 'TO' });
    expect(sparse.resolve('Togo')).toBe('TO');
  });

  it('still resolves by observed name where one exists', () => {
    expect(new CountryResolver({ IN: 'India' }, {}).resolve('India')).toBe('IN');
  });

  it('ignores UCDP’s parenthetical spellings', () => {
    expect(new CountryResolver({ MM: 'Myanmar' }, {}).resolve('Myanmar (Burma)')).toBe('MM');
  });

  it('returns nothing rather than the wrong country', () => {
    // Prefix matching would happily turn Niger into Nigeria.
    expect(new CountryResolver({ NI: 'Nigeria' }, {}).resolve('Niger')).toBeUndefined();
  });
});
