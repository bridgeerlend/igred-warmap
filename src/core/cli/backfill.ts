import { getSource, loadConfig } from '../config.js';
import { clusterObservations } from '../cluster/dedupe.js';
import { emptyBaseline, updateBaseline } from '../detect/baseline.js';
import { baselineArtifact } from '../schema/artifact.js';
import { readArtifact, writeArtifact } from '../pipeline/store.js';
import { downloadExportFile } from '../sources/gdelt/fetch.js';
import { parseGdeltExport } from '../sources/gdelt/parse.js';
import { toObservation, type Observation } from '../sources/gdelt/map.js';
import { gdeltCursor } from '../sources/gdelt/index.js';
import { addDays } from '../util/misc.js';
import { dataPaths } from '../util/paths.js';
import { loadLocalEnv } from '../util/env.js';

loadLocalEnv();

/**
 * Builds detection history from the same GDELT 2.0 15-minute stream the hourly run uses.
 * The daily GDELT 1.0 files would be a cheaper download, but they carry roughly 2.4x the
 * row volume, so mixing them would inflate the baseline median for weeks and mask real
 * spikes. Consistency with the live feed matters more than download size here.
 */
const SLOTS_PER_DAY = 96;
const DEFAULT_DAYS = 30;
const DEFAULT_CONCURRENCY = 8;

function stampsForDay(day: string): string[] {
  const base = day.replace(/-/g, '');
  const stamps: string[] = [];
  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    const minutes = slot * 15;
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    stamps.push(`${base}${hh}${mm}00`);
  }
  return stamps;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

function parseArgs(): { days: number; concurrency: number } {
  const args = process.argv.slice(2);
  const read = (flag: string, fallback: number): number => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    const value = Number(args[index + 1]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return { days: read('--days', DEFAULT_DAYS), concurrency: read('--concurrency', DEFAULT_CONCURRENCY) };
}

async function backfill(): Promise<void> {
  const { days, concurrency } = parseArgs();
  const config = loadConfig();
  // Must match the live run exactly, or backfilled days would be counted on different
  // rules than fresh ones and the baseline would compare apples to oranges.
  const maxEventAgeDays = Number(getSource('gdelt').options.maxEventAgeDays ?? 3);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  let baseline = readArtifact(dataPaths.baseline, baselineArtifact).value ?? emptyBaseline(now);
  const processedStamps = new Set(readArtifact(dataPaths.cursor, gdeltCursor).value?.processedStamps ?? []);

  console.log(`Backfilling ${days} days of GDELT 2.0 at concurrency ${concurrency}.`);

  for (let offset = days; offset >= 1; offset--) {
    const day = addDays(today, -offset);
    const stamps = stampsForDay(day).filter((stamp) => !processedStamps.has(stamp));
    if (stamps.length === 0) {
      console.log(`${day}: already processed`);
      continue;
    }

    // One day at a time: a full 30-day window of raw observations would not fit in memory.
    const perFile = await mapWithConcurrency(stamps, concurrency, async (stamp) => {
      const downloaded = await downloadExportFile({
        stamp,
        url: `http://data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip`,
        publishedAt: now,
      });
      if (!downloaded) return [];
      const { records } = parseGdeltExport(downloaded.content);
      return records
        .map((record) => toObservation(record, now, maxEventAgeDays))
        .filter((observation): observation is Observation => observation !== undefined);
    });

    const observations = perFile.flat();
    const { clusters } = clusterObservations(observations);
    baseline = updateBaseline(
      baseline,
      clusters,
      now,
      config.publish.baselineRetainDays,
      config.detection.countedCategories,
    );
    for (const stamp of stamps) processedStamps.add(stamp);

    const downloaded = perFile.filter((entry) => entry.length > 0).length;
    console.log(
      `${day}: ${downloaded}/${stamps.length} files, ${observations.length} conflict-coded, ${clusters.length} incidents`,
    );
  }

  writeArtifact(dataPaths.baseline, baselineArtifact, baseline);
  writeArtifact(dataPaths.cursor, gdeltCursor, {
    processedStamps: [...processedStamps].sort().slice(-40_000),
    updatedAt: now,
  });

  const countries = Object.keys(baseline.countries).length;
  const totalDays = Object.values(baseline.countries).reduce((sum, entry) => sum + entry.days.length, 0);
  console.log(`Baseline now covers ${countries} countries and ${totalDays} country-days.`);
}

await backfill();
