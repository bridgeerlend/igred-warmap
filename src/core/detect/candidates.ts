import type { ConflictCandidate } from '../schema/candidate.js';
import type { DetectionConfig } from '../schema/config.js';
import { addDays } from '../util/misc.js';

/**
 * Countries that should not produce a fresh candidate: one is already awaiting review,
 * or a recent decision is still inside its cooldown. Prevents the same flare-up from
 * reopening a pull request every hour.
 */
export function suppressedCountries(
  candidates: ConflictCandidate[],
  config: DetectionConfig,
  today: string,
): Set<string> {
  const cooldownStart = addDays(today, -config.candidate.cooldownDays);
  const suppressed = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.status === 'pending_review' || candidate.status === 'confirmed') {
      suppressed.add(candidate.countryFips);
      continue;
    }
    const decidedAt = (candidate.resolvedAt ?? candidate.detectedAt).slice(0, 10);
    if (candidate.status === 'rejected' && decidedAt >= cooldownStart) {
      suppressed.add(candidate.countryFips);
    }
  }
  return suppressed;
}

/**
 * Folds new detections into the existing list. A human decision is never overwritten —
 * only evidence and the last-signal timestamp are refreshed.
 */
export function mergeCandidates(
  existing: ConflictCandidate[],
  detected: ConflictCandidate[],
  config: DetectionConfig,
  now: string,
): ConflictCandidate[] {
  const byId = new Map(existing.map((candidate) => [candidate.id, candidate]));

  for (const candidate of detected) {
    const previous = byId.get(candidate.id);
    if (!previous) {
      byId.set(candidate.id, candidate);
      continue;
    }
    // An hourly run with no new files still re-derives the candidate from the unchanged
    // baseline, but with nothing to cite. Refreshing citations from that would wipe the
    // evidence a reviewer needs, so thinner citations never replace richer ones.
    byId.set(candidate.id, {
      ...previous,
      evidence: candidate.evidence,
      sampleIncidents:
        candidate.sampleIncidents.length > previous.sampleIncidents.length
          ? candidate.sampleIncidents
          : previous.sampleIncidents,
      provenance:
        candidate.provenance.length > previous.provenance.length
          ? candidate.provenance
          : previous.provenance,
      lastSignalAt: now,
    });
  }

  const expiryCutoff = addDays(now.slice(0, 10), -config.candidate.expireAfterDaysWithoutSignal);
  return [...byId.values()]
    .map((candidate) =>
      candidate.status === 'pending_review' && candidate.lastSignalAt.slice(0, 10) < expiryCutoff
        ? { ...candidate, status: 'expired' as const, resolvedAt: now, resolutionNote: 'No further abnormal coverage.' }
        : candidate,
    )
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}
