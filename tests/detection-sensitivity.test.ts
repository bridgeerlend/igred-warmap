import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { detectAnomalies } from '../src/core/detect/anomaly.js';
import { countryNameFromPlace } from '../src/core/detect/baseline.js';
import { ARTIFACT_VERSION, type BaselineArtifact } from '../src/core/schema/artifact.js';
import { addDays } from '../src/core/util/misc.js';

/**
 * The thresholds shipped in config/detection.json produce zero candidates across 30 days of
 * real GDELT history — which is the intended behaviour, since no new war began in that
 * window, but on its own it is indistinguishable from a detector that never fires.
 *
 * These tests close that gap by running the REAL config, not a test fixture: a realistic
 * escalation must be caught, and the shapes that flooded earlier tuning rounds (protest
 * waves, single bad weeks) must not be.
 */
const TODAY = '2026-08-03';
const detection = loadConfig().detection;

function baselineFrom(dailyCounts: number[], publishers = 8): BaselineArtifact {
  const days = dailyCounts.map((count, index) => ({
    day: addDays(TODAY, -(dailyCounts.length - index)),
    eventCount: count,
    armedEventCount: count,
    distinctPublishers: count === 0 ? 0 : publishers,
  }));
  return {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: `${TODAY}T00:00:00.000Z`,
    countries: { XX: { countryName: 'Testland', days } },
  };
}

const run = (baseline: BaselineArtifact) =>
  detectAnomalies({
    baseline,
    config: detection,
    today: TODAY,
    knownConflictCountries: new Set(),
    suppressedCountries: new Set(),
  });

const quiet = (days: number, level: number) => new Array<number>(days).fill(level);

describe('shipped detection thresholds', () => {
  it('catch a conflict escalating and staying escalated', () => {
    const baseline = baselineFrom([...quiet(60, 2), 14, 18, 22, 25, 24, 27, 30]);
    const detections = run(baseline);
    expect(detections).toHaveLength(1);
    expect(detections[0]?.countryName).toBe('Testland');
  });

  it('catch an escalation that starts from complete silence', () => {
    expect(run(baselineFrom([...quiet(60, 0), 13, 16, 20, 24, 22, 26, 28]))).toHaveLength(1);
  });

  it('ignore a two-day spike that subsides', () => {
    expect(run(baselineFrom([...quiet(60, 2), 2, 30, 28, 3, 2, 2, 2]))).toHaveLength(0);
  });

  it('ignore a country that is simply busy at a steady high level', () => {
    expect(run(baselineFrom([...quiet(60, 40), 44, 42, 46, 45, 43, 44, 47]))).toHaveLength(0);
  });

  it('ignore an escalation reported by too few outlets', () => {
    expect(run(baselineFrom([...quiet(60, 2), 14, 18, 22, 25, 24, 27, 30], 1))).toHaveLength(0);
  });

  it('ignore a proportionally large rise that is still tiny in absolute terms', () => {
    expect(run(baselineFrom([...quiet(60, 0), 3, 4, 5, 4, 5, 3, 4]))).toHaveLength(0);
  });

  it('refuse to score a country without enough history to have a norm', () => {
    expect(run(baselineFrom([...quiet(10, 1), 20, 22, 24, 26, 25, 27, 30]))).toHaveLength(0);
  });
});

describe('country names taken from GDELT place strings', () => {
  it('handle the trailing-qualifier spellings that produced "The" and "Republic Of"', () => {
    expect(countryNameFromPlace('Nassau, Bahamas, The', 'BF')).toBe('Bahamas');
    expect(countryNameFromPlace('Hanoi, Hanoi, Vietnam, Republic Of', 'VM')).toBe('Vietnam');
    expect(countryNameFromPlace('Kyiv, Kyyiv, Misto, Ukraine', 'UP')).toBe('Ukraine');
    expect(countryNameFromPlace('', 'XX')).toBe('XX');
  });
});
