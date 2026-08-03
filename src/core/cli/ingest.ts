import { loadConfig, getSource } from '../config.js';
import {
  ARTIFACT_VERSION,
  baselineArtifact,
  candidatesArtifact,
  conflictsArtifact,
  eventsArtifact,
  healthArtifact,
  storiesArtifact,
  pendingClustersArtifact,
  type SourceHealth,
} from '../schema/artifact.js';
import { clusterObservations, mergeEventWindow, selectDisplayEvents } from '../cluster/dedupe.js';
import { detectAnomalies, toCandidate } from '../detect/anomaly.js';
import { mergeCandidates, suppressedCountries } from '../detect/candidates.js';
import { verifiedConflicts } from '../detect/verified.js';
import { emptyBaseline, updateBaseline } from '../detect/baseline.js';
import { overallStatus, runSource, type PreviousHealth } from '../pipeline/runner.js';
import { readArtifact, writeArtifact } from '../pipeline/store.js';
import { gdeltCursor, harvestGdelt, type GdeltHarvest } from '../sources/gdelt/index.js';
import { harvestUcdp, type UcdpHarvest } from '../sources/ucdp/index.js';
import { synthesise, type SynthesisResult } from '../synthesize/index.js';
import { harvestMedia, type MediaResult } from '../synthesize/media.js';
import { harvestFirms, type FirmsHarvest, type FirmsProduct } from '../sources/firms/index.js';
import { heatArtifact } from '../schema/heat.js';
import { mediaArtifact } from '../schema/media.js';
import type { UcdpDataset } from '../sources/ucdp/map.js';
import { CountryResolver } from '../util/country.js';
import { dataPaths } from '../util/paths.js';
import { stableId } from '../util/misc.js';

/** Long enough to cover a weekend before a candidate is reviewed. */
const PENDING_RETAIN_DAYS = 4;

function previousHealthFor(entries: SourceHealth[], sourceId: string): PreviousHealth {
  const entry = entries.find((candidate) => candidate.sourceId === sourceId);
  return {
    lastSuccessAt: entry?.lastSuccessAt,
    consecutiveFailures: entry?.consecutiveFailures ?? 0,
  };
}

/**
 * Always completes successfully when the run itself worked. Source health lives in
 * data/health.json and is judged separately, so a single struggling source still gets its
 * good data committed instead of the whole run being thrown away.
 */
export async function ingest(): Promise<void> {
  const config = loadConfig();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const runId = stableId('run', now);

  const previousHealth = readArtifact(dataPaths.health, healthArtifact).value?.sources ?? [];
  const previousEvents = readArtifact(dataPaths.events, eventsArtifact).value?.events ?? [];
  const previousConflicts = readArtifact(dataPaths.conflicts, conflictsArtifact).value?.conflicts ?? [];
  const previousCandidates = readArtifact(dataPaths.candidates, candidatesArtifact).value?.candidates ?? [];
  const previousBaseline = readArtifact(dataPaths.baseline, baselineArtifact).value ?? emptyBaseline(now);
  const previousCursor = readArtifact(dataPaths.cursor, gdeltCursor).value;

  const gdeltDefinition = getSource('gdelt');
  const gdeltOutcome = await runSource<GdeltHarvest>(
    gdeltDefinition,
    previousHealthFor(previousHealth, 'gdelt'),
    async () => {
      const harvest = await harvestGdelt(
        {
          filesPerRun: Number(gdeltDefinition.options.filesPerRun ?? 8),
          maxEventAgeDays: Number(gdeltDefinition.options.maxEventAgeDays ?? 3),
        },
        previousCursor,
        now,
      );
      return { data: harvest, recordCount: harvest.observations.length };
    },
    now,
  );

  // Country names come from the feed itself, so the UCDP join key improves as coverage grows.
  const observedNames = Object.fromEntries(
    Object.entries(previousBaseline.countries).map(([fips, country]) => [fips, country.countryName]),
  );
  const resolver = new CountryResolver(observedNames, config.countryAliases);

  const ucdpDefinition = getSource('ucdp');
  const ucdpOutcome = await runSource<UcdpHarvest>(
    ucdpDefinition,
    previousHealthFor(previousHealth, 'ucdp'),
    async () => {
      const harvest = await harvestUcdp(
        {
          apiVersion: String(ucdpDefinition.options.apiVersion ?? '24.1'),
          pageSize: Number(ucdpDefinition.options.pageSize ?? 1000),
          maxPages: Number(ucdpDefinition.options.maxPages ?? 40),
          activeSinceYear: Number(ucdpDefinition.options.activeSinceYear ?? 2020),
          datasets: (ucdpDefinition.options.datasets as UcdpDataset[] | undefined) ?? ['ucdpprioconflict'],
        },
        resolver,
        ucdpDefinition.credentialEnvVar ?? 'UCDP_ACCESS_TOKEN',
        now,
      );
      return { data: harvest, recordCount: harvest.conflicts.length };
    },
    now,
  );

  const newsDefinition = getSource('newsfeeds');
  const newsOutcome = await runSource<SynthesisResult>(
    newsDefinition,
    previousHealthFor(previousHealth, 'newsfeeds'),
    async () => {
      const result = await synthesise(now);
      return { data: result, recordCount: result.stories.length };
    },
    now,
  );

  const firmsDefinition = getSource('firms');
  const firmsOutcome = await runSource<FirmsHarvest>(
    firmsDefinition,
    previousHealthFor(previousHealth, 'firms'),
    async () => {
      const harvest = await harvestFirms(
        {
          product: (firmsDefinition.options.product as FirmsProduct | undefined) ?? 'modis',
          gridDegrees: Number(firmsDefinition.options.gridDegrees ?? 0.25),
          minConfidence: Number(firmsDefinition.options.minConfidence ?? 50),
          minDetectionsPerCell: Number(firmsDefinition.options.minDetectionsPerCell ?? 2),
          maxCells: Number(firmsDefinition.options.maxCells ?? 4000),
        },
        now,
      );
      return { data: harvest, recordCount: harvest.cells.length };
    },
    now,
  );

  const mediaDefinition = getSource('media');
  const mediaOutcome = await runSource<MediaResult>(
    mediaDefinition,
    previousHealthFor(previousHealth, 'media'),
    async () => {
      const harvest = await harvestMedia(
        {
          postsPerAccount: Number(mediaDefinition.options.postsPerAccount ?? 15),
          videosPerChannel: Number(mediaDefinition.options.videosPerChannel ?? 10),
          maxAgeDays: Number(mediaDefinition.options.maxAgeDays ?? 7),
        },
        now,
      );
      return { data: harvest, recordCount: harvest.posts.length + harvest.videos.length };
    },
    now,
  );

  // Failure of one source must never discard the other's good data.
  const fromUcdp = ucdpOutcome.data?.conflicts ?? previousConflicts.filter((entry) => entry.origin === 'ucdp');
  // Hand-confirmed conflicts come from config, so they survive a UCDP outage and appear even
  // before the token exists — this is what closes the detection loop.
  const confirmed = verifiedConflicts(config.verifiedConflicts, now);
  const conflicts = [...confirmed, ...fromUcdp];

  const knownConflictCountries = new Set(
    conflicts
      .filter((conflict) => conflict.status === 'active')
      .flatMap((conflict) => conflict.countries.map((country) => country.fips))
      .filter((fips): fips is string => typeof fips === 'string'),
  );

  const clustered = gdeltOutcome.data ? clusterObservations(gdeltOutcome.data.observations) : undefined;

  /*
   * Incidents in countries awaiting a decision are held rather than dropped. A reviewer
   * confirms a candidate because of what has already happened, so those incidents have to
   * appear the moment it is confirmed — otherwise the map stays empty for an hour and the
   * evidence for the decision is nowhere to be seen. Only pending countries are buffered,
   * so this is a handful of records, not a second copy of the feed.
   */
  const pendingCountries = new Set(
    previousCandidates
      .filter((candidate) => candidate.status === 'pending_review')
      .map((candidate) => candidate.countryFips),
  );

  const bufferCutoff = new Date(Date.now() - PENDING_RETAIN_DAYS * 86_400_000).toISOString();
  const previousBuffer = readArtifact(dataPaths.pendingClusters, pendingClustersArtifact).value?.events ?? [];
  const buffer = [...previousBuffer, ...(clustered?.clusters ?? [])]
    .filter((event) => {
      const fips = event.location.countryFips;
      return fips !== undefined && pendingCountries.has(fips) && event.occurredAt >= bufferCutoff;
    })
    .filter((event, index, all) => all.findIndex((other) => other.id === event.id) === index);

  const displayEvents = clustered
    ? selectDisplayEvents([...clustered.clusters, ...buffer], knownConflictCountries)
    : selectDisplayEvents(buffer, knownConflictCountries);

  /*
   * The retained window is re-gated every run, not just appended to. Without this an incident
   * that passed the gate once stayed for thirty days even after its country left the register
   * — so dismissing a candidate would leave its incidents on the map for a month. The window
   * has to reflect the register as it is now, not as it was when each incident arrived.
   */
  const events = mergeEventWindow(
    selectDisplayEvents(previousEvents, knownConflictCountries),
    displayEvents,
    config.publish.eventWindowDays,
    new Date(now),
  );

  // The baseline sees every clustered event, gated or not: a new conflict appears in a
  // country the register does not list yet, so gating detection would hide exactly the
  // signal it exists to find.
  const baseline = clustered
    ? updateBaseline(
        previousBaseline,
        clustered.clusters,
        now,
        config.publish.baselineRetainDays,
        config.detection.countedCategories,
      )
    : previousBaseline;

  const detections = detectAnomalies({
    baseline,
    config: config.detection,
    today,
    knownConflictCountries,
    suppressedCountries: suppressedCountries(previousCandidates, config.detection, today),
  });

  // A candidate whose country now sits in the register has been acted on; the record says so
  // rather than sitting at pending_review forever.
  const confirmedCandidateIds = new Set(config.verifiedConflicts.conflicts.map((entry) => entry.candidateId));
  const reconciled = previousCandidates.map((candidate) =>
    confirmedCandidateIds.has(candidate.id) && candidate.status === 'pending_review'
      ? { ...candidate, status: 'confirmed' as const, resolvedAt: now, resolutionNote: 'Confirmed by hand.' }
      : candidate,
  );

  const candidates = mergeCandidates(
    reconciled,
    // Ungated clusters: a candidate must cite the articles behind it, and its country is
    // not in the register yet, so nothing of its own survives the display gate.
    detections.map((detection) => toCandidate(detection, clustered?.clusters ?? [], now)),
    config.detection,
    now,
  );

  const sources = [
    gdeltOutcome.health,
    ucdpOutcome.health,
    newsOutcome.health,
    firmsOutcome.health,
    mediaOutcome.health,
  ];

  writeArtifact(dataPaths.events, eventsArtifact, {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: now,
    windowDays: config.publish.eventWindowDays,
    ...(events.at(-1) ? { earliestEvent: events.at(-1)?.occurredAt } : {}),
    ...(events[0] ? { latestEvent: events[0].occurredAt } : {}),
    events,
  });
  writeArtifact(dataPaths.conflicts, conflictsArtifact, {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: now,
    conflicts,
  });
  writeArtifact(dataPaths.candidates, candidatesArtifact, {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: now,
    candidates,
  });
  if (newsOutcome.data) {
    writeArtifact(dataPaths.stories, storiesArtifact, {
      artifactVersion: ARTIFACT_VERSION,
      generatedAt: now,
      windowDays: config.stories.publish.windowDays,
      articlesConsidered: newsOutcome.data.articlesConsidered,
      storiesOutOfField: newsOutcome.data.storiesOutOfField,
      feedsOk: newsOutcome.data.feeds.filter((feed) => feed.ok).length,
      feedsTotal: newsOutcome.data.feeds.length,
      stories: newsOutcome.data.stories,
    });
  }

  if (firmsOutcome.data) {
    writeArtifact(dataPaths.heat, heatArtifact, {
      artifactVersion: ARTIFACT_VERSION,
      generatedAt: now,
      // Stated in the data so the map cannot quietly relabel heat as something it is not.
      measures: 'satellite_thermal_anomalies',
      instrument: firmsOutcome.data.instrument,
      windowHours: 24,
      gridDegrees: Number(firmsDefinition.options.gridDegrees ?? 0.25),
      detectionsConsidered: firmsOutcome.data.detectionsConsidered,
      cellsPublished: firmsOutcome.data.cells.length,
      source: firmsOutcome.data.source,
      cells: firmsOutcome.data.cells,
    });
  }

  if (mediaOutcome.data) {
    writeArtifact(dataPaths.media, mediaArtifact, {
      artifactVersion: ARTIFACT_VERSION,
      generatedAt: now,
      windowDays: Number(mediaDefinition.options.maxAgeDays ?? 7),
      accountsOk: mediaOutcome.data.accountsOk,
      accountsTotal: mediaOutcome.data.accountsTotal,
      posts: mediaOutcome.data.posts,
      videos: mediaOutcome.data.videos,
    });
  }

  writeArtifact(dataPaths.pendingClusters, pendingClustersArtifact, {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: now,
    retainDays: PENDING_RETAIN_DAYS,
    events: buffer,
  });

  writeArtifact(dataPaths.baseline, baselineArtifact, baseline);
  if (gdeltOutcome.data) writeArtifact(dataPaths.cursor, gdeltCursor, gdeltOutcome.data.cursor);

  writeArtifact(dataPaths.health, healthArtifact, {
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: now,
    runId,
    overall: overallStatus(sources),
    sources,
  });

  report(now, gdeltOutcome.data, ucdpOutcome.data, newsOutcome.data, firmsOutcome.data, mediaOutcome.data, {
    clustered: clustered?.clusters.length ?? 0,
    displayed: displayEvents.length,
    eventsInWindow: events.length,
    candidates: candidates.length,
    sources,
  });
}

interface RunSummary {
  clustered: number;
  displayed: number;
  eventsInWindow: number;
  candidates: number;
  sources: SourceHealth[];
}

function report(
  now: string,
  gdelt: GdeltHarvest | undefined,
  ucdp: UcdpHarvest | undefined,
  news: SynthesisResult | undefined,
  firms: FirmsHarvest | undefined,
  media: MediaResult | undefined,
  summary: RunSummary,
): void {
  const { clustered, displayed, eventsInWindow, candidates: candidateCount, sources } = summary;
  const lines = [`IGRED ingest ${now}`];
  if (gdelt) {
    lines.push(
      `  gdelt: ${gdelt.filesDownloaded}/${gdelt.filesRequested} files, ${gdelt.rowsParsed} rows, ${gdelt.observations.length} conflict-coded`,
    );
    if (Object.keys(gdelt.rowsSkipped).length > 0) {
      lines.push(`  gdelt skipped: ${JSON.stringify(gdelt.rowsSkipped)}`);
    }
  }
  lines.push(`  clustered: ${clustered} incidents, ${displayed} passed the display gate`);
  if (ucdp) {
    lines.push(`  ucdp: ${ucdp.conflicts.length} conflicts from ${ucdp.rowsFetched} rows`);
    if (ucdp.unresolvedCountries.length > 0) {
      lines.push(`  ucdp unresolved countries: ${ucdp.unresolvedCountries.slice(0, 15).join(', ')}`);
    }
  }
  if (news) {
    const failed = news.feeds.filter((feed) => !feed.ok).map((feed) => feed.feedId);
    lines.push(
      `  news: ${news.stories.length} stories from ${news.articlesConsidered} articles (${news.storiesOutOfField} clusters out of field)`,
    );
    if (failed.length > 0) lines.push(`  news feeds down: ${failed.join(', ')}`);
  }
  if (firms) {
    lines.push(
      `  heat: ${firms.cells.length} cells from ${firms.detectionsConsidered} thermal detections (${firms.instrument})`,
    );
  }
  if (media) {
    lines.push(
      `  media: ${media.posts.length} posts, ${media.videos.length} videos from ${media.accountsOk}/${media.accountsTotal} accounts`,
    );
    for (const failure of media.failures) lines.push(`  media down: ${failure}`);
  }
  lines.push(`  window: ${eventsInWindow} events, candidates: ${candidateCount}`);
  for (const entry of sources) {
    if (entry.status !== 'ok') lines.push(`  ${entry.sourceId}: ${entry.status} — ${entry.message ?? ''}`);
  }
  console.log(lines.join('\n'));
}

await ingest();
