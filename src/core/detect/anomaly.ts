import type { BaselineArtifact, BaselineDay } from '../schema/artifact.js';
import type { AnomalyEvidence, ConflictCandidate } from '../schema/candidate.js';
import type { DetectionConfig } from '../schema/config.js';
import type { Provenance } from '../schema/common.js';
import type { ConflictEvent } from '../schema/event.js';
import { addDays, median, medianAbsoluteDeviation, stableId } from '../util/misc.js';
import { daysInRange } from './baseline.js';

/** 0.6745 rescales MAD so the score matches a standard deviation for normal data. */
const MAD_TO_SIGMA = 0.6745;

export function modifiedZScore(value: number, history: number[]): { z: number; centre: number; mad: number } {
  if (history.length === 0) return { z: 0, centre: 0, mad: 0 };
  const centre = median(history);
  const mad = medianAbsoluteDeviation(history, centre);

  if (mad > 0) return { z: (MAD_TO_SIGMA * (value - centre)) / mad, centre, mad };

  // A flat history (often all zeroes) has no spread to divide by. Fall back to mean
  // absolute deviation so a genuine jump from nothing still scores, instead of Infinity.
  const meanAbsoluteDeviation =
    history.reduce((sum, entry) => sum + Math.abs(entry - centre), 0) / history.length;
  if (meanAbsoluteDeviation > 0) {
    return { z: (value - centre) / (1.253314 * meanAbsoluteDeviation), centre, mad: 0 };
  }
  return { z: value > centre ? Number.POSITIVE_INFINITY : 0, centre, mad: 0 };
}

export interface DetectionInput {
  baseline: BaselineArtifact;
  config: DetectionConfig;
  today: string;
  /** FIPS codes already covered by a conflict in the register — not new, so not flagged. */
  knownConflictCountries: Set<string>;
  /** FIPS codes recently rejected or already pending, kept quiet for the cooldown period. */
  suppressedCountries: Set<string>;
}

export interface Detection {
  countryFips: string;
  countryName: string;
  evidence: AnomalyEvidence[];
}

function evaluateDay(day: BaselineDay, history: number[]): AnomalyEvidence {
  const { z, centre, mad } = modifiedZScore(day.armedEventCount, history);
  return {
    day: day.day,
    eventCount: day.armedEventCount,
    distinctPublishers: day.distinctPublishers,
    baselineMedian: centre,
    baselineMad: mad,
    modifiedZ: Number.isFinite(z) ? Number(z.toFixed(3)) : 999,
    ratioOverBaseline:
      centre > 0 ? Number((day.armedEventCount / centre).toFixed(3)) : day.armedEventCount,
  };
}

function isTriggered(evidence: AnomalyEvidence, config: DetectionConfig): boolean {
  const { trigger } = config;
  return (
    evidence.modifiedZ >= trigger.modifiedZThreshold &&
    evidence.eventCount >= trigger.minEventsInDay &&
    evidence.distinctPublishers >= trigger.minDistinctPublishers &&
    evidence.ratioOverBaseline >= trigger.minRatioOverBaseline
  );
}

/**
 * Flags countries whose incident volume is far above their own recent norm. This is a
 * statement about coverage, never a claim that a conflict exists — the output is a
 * candidate for human confirmation.
 */
export function detectAnomalies(input: DetectionInput): Detection[] {
  const { baseline, config, today, knownConflictCountries, suppressedCountries } = input;
  const detections: Detection[] = [];

  // The current day is still being ingested, so its count is always short. Evaluating it
  // would dilute the sustained-days test and make every genuine flare-up look weaker than
  // it is; the window therefore ends with yesterday, the last complete day.
  const recentTo = today;
  const recentFrom = addDays(recentTo, -config.trigger.sustainedWindowDays);
  const baselineTo = addDays(today, -config.baseline.excludeRecentDays);
  const baselineFrom = addDays(baselineTo, -config.baseline.windowDays);

  for (const [fips, country] of Object.entries(baseline.countries)) {
    if (knownConflictCountries.has(fips) || suppressedCountries.has(fips)) continue;

    const historyDays = daysInRange(country.days, baselineFrom, baselineTo);
    if (historyDays.length < config.baseline.minDaysRequired) continue;

    const history = historyDays.map((entry) => entry.armedEventCount);
    const recentDays = daysInRange(country.days, recentFrom, recentTo);
    if (recentDays.length === 0) continue;

    const evidence = recentDays.map((day) => evaluateDay(day, history));
    const triggered = evidence.filter((entry) => isTriggered(entry, config));

    if (triggered.length >= config.trigger.sustainedDaysRequired) {
      detections.push({ countryFips: fips, countryName: country.countryName, evidence });
    }
  }

  return detections.sort(
    (a, b) => maxZ(b.evidence) - maxZ(a.evidence) || a.countryName.localeCompare(b.countryName),
  );
}

const maxZ = (evidence: AnomalyEvidence[]): number =>
  evidence.reduce((best, entry) => Math.max(best, entry.modifiedZ), 0);

/**
 * Turns a detection into a pending candidate. `claim` is fixed so the wording can never
 * drift into asserting a conflict.
 *
 * `events` must be the UNGATED clusters. Passing the display-gated set leaves the candidate
 * citing nothing, because the country is not in the register yet — which is precisely why
 * it is a candidate. The reviewer needs the articles, so those are what it carries.
 */
export function toCandidate(
  detection: Detection,
  events: ConflictEvent[],
  now: string,
): ConflictCandidate {
  const relevant = events
    .filter((event) => event.location.countryFips === detection.countryFips)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 20);

  const provenance: Provenance[] = [];
  const seen = new Set<string>();
  for (const event of relevant) {
    for (const entry of event.provenance) {
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);
      provenance.push(entry);
      if (provenance.length >= 15) break;
    }
    if (provenance.length >= 15) break;
  }

  return {
    id: stableId('cand', detection.countryFips, detection.evidence[0]?.day ?? now.slice(0, 10)),
    countryFips: detection.countryFips,
    countryName: detection.countryName,
    detectedAt: now,
    status: 'pending_review',
    claim: 'abnormal_conflict_coverage_detected',
    evidence: detection.evidence,
    sampleIncidents: relevant.slice(0, 10).map((event) => ({
      label: event.label,
      occurredAt: event.occurredAt,
      locationName: event.location.name,
    })),
    provenance: provenance.length > 0 ? provenance : [fallbackProvenance(now)],
    lastSignalAt: now,
  };
}

/** A candidate must carry provenance; if no event survived, cite the feed itself. */
function fallbackProvenance(now: string): Provenance {
  return {
    sourceId: 'gdelt',
    sourceName: 'GDELT 2.0 Event Database',
    sourceTier: 1,
    url: 'https://www.gdeltproject.org/',
    retrievedAt: now,
  };
}
