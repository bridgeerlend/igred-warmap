import { describe, expect, it } from 'vitest';
import { detectAnomalies, modifiedZScore, toCandidate } from '../src/core/detect/anomaly.js';
import { updateBaseline, emptyBaseline, countryNameFromPlace } from '../src/core/detect/baseline.js';
import { ARTIFACT_VERSION, type BaselineArtifact } from '../src/core/schema/artifact.js';
import type { DetectionConfig } from '../src/core/schema/config.js';
import type { ConflictEvent } from '../src/core/schema/event.js';
import { addDays } from '../src/core/util/misc.js';

const TODAY = '2026-08-03';

const config: DetectionConfig = {
  schemaVersion: 1,
  countedCategories: ['armed_clash', 'armed_assault', 'aerial_strike', 'mass_violence', 'siege_blockade'],
  baseline: { windowDays: 60, minDaysRequired: 14, excludeRecentDays: 3 },
  trigger: {
    modifiedZThreshold: 3.5,
    minEventsInDay: 8,
    minDistinctPublishers: 3,
    minRatioOverBaseline: 2.5,
    sustainedWindowDays: 3,
    sustainedDaysRequired: 2,
  },
  candidate: { cooldownDays: 30, expireAfterDaysWithoutSignal: 14 },
};

/** Builds a country history: `quiet` background days, then the given recent day counts. */
function history(
  fips: string,
  name: string,
  quietLevel: number,
  recent: number[],
): BaselineArtifact {
  const days = [];
  for (let offset = 70; offset > recent.length; offset--) {
    days.push({
      day: addDays(TODAY, -offset),
      eventCount: quietLevel,
      armedEventCount: quietLevel,
      distinctPublishers: Math.min(quietLevel, 2),
    });
  }
  // The current day is deliberately excluded from scoring, so the recent run ends yesterday.
  recent.forEach((count, index) => {
    days.push({
      day: addDays(TODAY, -(recent.length - index)),
      eventCount: count,
      armedEventCount: count,
      distinctPublishers: Math.min(count, 6),
    });
  });
  return {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: `${TODAY}T00:00:00.000Z`,
    countries: { [fips]: { countryName: name, days } },
  };
}

const detect = (baseline: BaselineArtifact, overrides: Partial<DetectionConfig['trigger']> = {}) =>
  detectAnomalies({
    baseline,
    config: { ...config, trigger: { ...config.trigger, ...overrides } },
    today: TODAY,
    knownConflictCountries: new Set(),
    suppressedCountries: new Set(),
  });

describe('modifiedZScore', () => {
  it('is not dragged around by a single past spike', () => {
    const withSpike = [1, 1, 1, 1, 400, 1, 1, 1, 1];
    const withoutSpike = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(modifiedZScore(20, withSpike).centre).toBe(modifiedZScore(20, withoutSpike).centre);
  });

  it('still scores a jump when history is perfectly flat', () => {
    expect(modifiedZScore(30, [0, 0, 0, 0, 0, 0]).z).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns zero for a value at the historical centre', () => {
    expect(modifiedZScore(5, [4, 5, 5, 6, 5]).z).toBe(0);
  });
});

describe('detectAnomalies', () => {
  it('flags a country whose incident volume jumps and stays up', () => {
    const detections = detect(history('SU', 'Sudan', 1, [2, 30, 34]));
    expect(detections).toHaveLength(1);
    expect(detections[0]?.countryFips).toBe('SU');
    expect(detections[0]?.countryName).toBe('Sudan');
  });

  it('ignores a one-day spike, because sustained coverage is required', () => {
    expect(detect(history('SU', 'Sudan', 1, [1, 1, 40]))).toHaveLength(0);
  });

  it('ignores small absolute counts even when the ratio is large', () => {
    expect(detect(history('IC', 'Iceland', 0, [0, 4, 5]))).toHaveLength(0);
  });

  it('ignores a rise that is normal for a country already at that level', () => {
    expect(detect(history('UP', 'Ukraine', 40, [44, 46, 48]))).toHaveLength(0);
  });

  it('will not flag on a history too short to have a norm', () => {
    const baseline = history('SU', 'Sudan', 1, [30, 32, 34]);
    baseline.countries.SU!.days = baseline.countries.SU!.days.slice(-8);
    expect(detect(baseline)).toHaveLength(0);
  });

  it('stays quiet for countries already in the register or under cooldown', () => {
    const baseline = history('SU', 'Sudan', 1, [2, 30, 34]);
    const known = detectAnomalies({
      baseline,
      config,
      today: TODAY,
      knownConflictCountries: new Set(['SU']),
      suppressedCountries: new Set(),
    });
    const suppressed = detectAnomalies({
      baseline,
      config,
      today: TODAY,
      knownConflictCountries: new Set(),
      suppressedCountries: new Set(['SU']),
    });
    expect(known).toHaveLength(0);
    expect(suppressed).toHaveLength(0);
  });

  it('requires several publishers, so one outlet cannot raise a candidate alone', () => {
    const baseline = history('SU', 'Sudan', 1, [2, 30, 34]);
    for (const day of baseline.countries.SU!.days) day.distinctPublishers = 1;
    expect(detect(baseline)).toHaveLength(0);
  });
});

const event: ConflictEvent = {
  id: 'evt_1',
  occurredAt: '2026-08-02T00:00:00.000Z',
  dateBasis: 'event_date',
  ingestedAt: '2026-08-02T01:00:00.000Z',
  category: 'armed_clash',
  label: 'Armed clash — Khartoum, Sudan',
  cameoCode: '190',
  location: { lat: 15.5, lon: 32.5, name: 'Khartoum, Sudan', countryFips: 'SU', precision: 'city' },
  actors: [],
  confidence: 'reported',
  severity: 4,
  reportCount: 5,
  distinctPublishers: 4,
  provenance: [
    {
      sourceId: 'gdelt',
      sourceName: 'GDELT',
      sourceTier: 1,
      url: 'https://example.org/a',
      retrievedAt: '2026-08-02T01:00:00.000Z',
    },
  ],
};

describe('toCandidate', () => {
  it('states only that coverage is abnormal, never that a conflict exists', () => {
    const detection = detect(history('SU', 'Sudan', 1, [2, 30, 34]))[0]!;
    const candidate = toCandidate(detection, [event], '2026-08-03T00:00:00.000Z');
    expect(candidate.claim).toBe('abnormal_conflict_coverage_detected');
    expect(candidate.status).toBe('pending_review');
    expect(candidate.provenance.length).toBeGreaterThan(0);
    expect(candidate.sampleIncidents[0]?.locationName).toBe("Khartoum, Sudan");
  });
});

describe('updateBaseline', () => {
  it('takes the country name from the source place string', () => {
    expect(countryNameFromPlace('Kyiv, Kyyiv, Misto, Ukraine', 'UP')).toBe('Ukraine');
    expect(countryNameFromPlace('Ukraine', 'UP')).toBe('Ukraine');
  });

  it('counts incidents per country-day and keeps the highest count seen for a day', () => {
    const first = updateBaseline(emptyBaseline('2026-08-03T00:00:00.000Z'), [event, event], '2026-08-03T00:00:00.000Z', 120, config.countedCategories);
    expect(first.countries.SU?.days[0]?.eventCount).toBe(2);

    const second = updateBaseline(first, [event], '2026-08-03T01:00:00.000Z', 120, config.countedCategories);
    expect(second.countries.SU?.days[0]?.eventCount).toBe(2);
  });

  it('drops days older than the retention window', () => {
    const old = emptyBaseline('2026-08-03T00:00:00.000Z');
    old.countries.SU = {
      countryName: 'Sudan',
      days: [{ day: '2025-01-01', eventCount: 5, armedEventCount: 5, distinctPublishers: 2 }],
    };
    const updated = updateBaseline(old, [event], '2026-08-03T00:00:00.000Z', 30, config.countedCategories);
    expect(updated.countries.SU?.days.some((day) => day.day === '2025-01-01')).toBe(false);
  });
});
