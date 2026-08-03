/**
 * Captures one real day of clustered incidents for the design explorations, so the
 * cartography is judged against true event density and geography rather than invented
 * points. Written to design/build/ and never read by the pipeline.
 *
 * Run: npx tsx scripts/build-design-fixture.ts [--files 96]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { getSource } from '../src/core/config.js';
import { clusterObservations } from '../src/core/cluster/dedupe.js';
import { downloadExportFile, fetchLatestExportFile, recentExportFiles } from '../src/core/sources/gdelt/fetch.js';
import { parseGdeltExport } from '../src/core/sources/gdelt/parse.js';
import { toObservation, type Observation } from '../src/core/sources/gdelt/map.js';
import { repoRoot } from '../src/core/util/paths.js';

const fileCount = Number(process.argv[process.argv.indexOf('--files') + 1]) || 96;
const now = new Date().toISOString();
const maxEventAgeDays = Number(getSource('gdelt').options.maxEventAgeDays ?? 3);

const latest = await fetchLatestExportFile();
const files = recentExportFiles(latest, fileCount);

const observations: Observation[] = [];
let downloaded = 0;

const batchSize = 10;
for (let start = 0; start < files.length; start += batchSize) {
  const batch = await Promise.all(files.slice(start, start + batchSize).map(downloadExportFile));
  for (const entry of batch) {
    if (!entry) continue;
    downloaded += 1;
    for (const record of parseGdeltExport(entry.content).records) {
      const observation = toObservation(record, now, maxEventAgeDays);
      if (observation) observations.push(observation);
    }
  }
}

const { clusters } = clusterObservations(observations);

const events = clusters.map((event) => ({
  id: event.id,
  lat: event.location.lat,
  lon: event.location.lon,
  place: event.location.name,
  country: event.location.countryFips ?? '',
  category: event.category,
  label: event.label,
  severity: event.severity,
  reports: event.reportCount,
  publishers: event.distinctPublishers,
  confidence: event.confidence,
  occurredAt: event.occurredAt,
  source: event.provenance[0]?.url ?? '',
  publisher: event.provenance[0]?.publisher ?? '',
}));

// The verified accent must be visible in the mockups, but nothing here has actually been
// verified by a human. The pages label these as illustrative; picking them deterministically
// keeps the mockups stable between rebuilds.
const illustrativeVerified = [...events]
  .sort((a, b) => b.reports - a.reports || a.id.localeCompare(b.id))
  .slice(0, 4)
  .map((event) => event.id);

const payload = {
  $comment:
    'Design fixture: one real day of GDELT incidents, captured for visual exploration only. Not read by the pipeline.',
  capturedAt: now,
  filesDownloaded: downloaded,
  illustrativeVerified,
  events,
};

writeFileSync(path.join(repoRoot, 'design', 'build', 'sample-events.json'), JSON.stringify(payload), 'utf-8');

const byCategory = events.reduce<Record<string, number>>((counts, event) => {
  counts[event.category] = (counts[event.category] ?? 0) + 1;
  return counts;
}, {});
console.log(`${events.length} incidents from ${downloaded} files`);
console.log(byCategory);
