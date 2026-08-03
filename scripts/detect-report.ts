/**
 * Diagnostic for tuning detection thresholds against the real baseline. Prints the
 * highest-scoring countries whether or not they cross the trigger, so it is visible how
 * close the threshold sits to the noise floor. Read-only: writes nothing.
 */
import { loadConfig } from '../src/core/config.js';
import { detectAnomalies, modifiedZScore } from '../src/core/detect/anomaly.js';
import { baselineArtifact } from '../src/core/schema/artifact.js';
import { readArtifact } from '../src/core/pipeline/store.js';
import { addDays } from '../src/core/util/misc.js';
import { dataPaths } from '../src/core/util/paths.js';

const config = loadConfig();
const baseline = readArtifact(dataPaths.baseline, baselineArtifact).value;
if (!baseline) throw new Error('No baseline yet — run: npm run backfill');

const today = new Date().toISOString().slice(0, 10);
const baselineTo = addDays(today, -config.detection.baseline.excludeRecentDays);
const baselineFrom = addDays(baselineTo, -config.detection.baseline.windowDays);

const rows = Object.entries(baseline.countries)
  .map(([fips, country]) => {
    const history = country.days
      .filter((day) => day.day >= baselineFrom && day.day < baselineTo)
      .map((day) => day.armedEventCount);
    const recent = country.days.filter((day) => day.day >= addDays(today, -2));
    if (history.length < config.detection.baseline.minDaysRequired || recent.length === 0) return undefined;

    const peak = recent.reduce((best, day) => (day.armedEventCount > best.armedEventCount ? day : best));
    const { z, centre } = modifiedZScore(peak.armedEventCount, history);
    return { fips, name: country.countryName, day: peak.day, count: peak.armedEventCount, centre, z, publishers: peak.distinctPublishers };
  })
  .filter((row): row is NonNullable<typeof row> => row !== undefined)
  .sort((a, b) => b.z - a.z);

console.log(`Baseline window ${baselineFrom} to ${baselineTo}, ${Object.keys(baseline.countries).length} countries\n`);
console.log('country                 day         count  median      z  publishers');
for (const row of rows.slice(0, 20)) {
  console.log(
    `${row.name.slice(0, 22).padEnd(22)}  ${row.day}  ${String(row.count).padStart(5)}  ${row.centre.toFixed(1).padStart(6)}  ${row.z.toFixed(1).padStart(5)}  ${String(row.publishers).padStart(10)}`,
  );
}

const detections = detectAnomalies({
  baseline,
  config: config.detection,
  today,
  knownConflictCountries: new Set(),
  suppressedCountries: new Set(),
});
console.log(`\nAbove trigger threshold today: ${detections.length}`);
for (const detection of detections) {
  console.log(`  ${detection.countryName} (${detection.countryFips})`);
  for (const entry of detection.evidence) {
    console.log(`    ${entry.day}: ${entry.eventCount} events, z=${entry.modifiedZ}, ratio=${entry.ratioOverBaseline}`);
  }
}

// Replays every day in the history as if it were "today". A detector that never fires on
// 30 days of real world data is not conservative, it is broken — this is what tells them apart.
console.log('\nBacktest across the retained history:');
let firedDays = 0;
for (let offset = 20; offset >= 1; offset--) {
  const asOf = addDays(today, -offset);
  const fired = detectAnomalies({
    baseline,
    config: config.detection,
    today: asOf,
    knownConflictCountries: new Set(),
    suppressedCountries: new Set(),
  });
  if (fired.length === 0) continue;
  firedDays += 1;
  console.log(
    `  ${asOf}: ${fired.map((entry) => `${entry.countryName} (z=${Math.max(...entry.evidence.map((e) => e.modifiedZ))})`).join(', ')}`,
  );
}
console.log(`  ${firedDays} of the last 20 days produced at least one candidate.`);
