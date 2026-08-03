import { z } from 'zod';
import { isoDateTime } from '../../schema/common.js';
import { downloadExportFile, fetchLatestExportFile, recentExportFiles } from './fetch.js';
import { parseGdeltExport } from './parse.js';
import { toObservation, type Observation } from './map.js';

export const gdeltCursor = z.strictObject({
  /** Stamps already folded into the data, so an hourly run never double-counts a file. */
  processedStamps: z.array(z.string().regex(/^\d{14}$/)),
  updatedAt: isoDateTime,
});
export type GdeltCursor = z.infer<typeof gdeltCursor>;

/** Generous enough that a 30-day backfill's stamps survive later hourly runs. */
const CURSOR_MEMORY = 5000;

export interface GdeltOptions {
  filesPerRun: number;
  maxEventAgeDays: number;
}

export interface GdeltHarvest {
  observations: Observation[];
  filesRequested: number;
  filesDownloaded: number;
  rowsParsed: number;
  rowsSkipped: Record<string, number>;
  cursor: GdeltCursor;
}

export async function harvestGdelt(
  options: GdeltOptions,
  previousCursor: GdeltCursor | undefined,
  now: string,
): Promise<GdeltHarvest> {
  const latest = await fetchLatestExportFile();
  const candidates = recentExportFiles(latest, options.filesPerRun);
  const alreadyProcessed = new Set(previousCursor?.processedStamps ?? []);
  const pending = candidates.filter((file) => !alreadyProcessed.has(file.stamp));

  const observations: Observation[] = [];
  const rowsSkipped: Record<string, number> = {};
  const processed: string[] = [];
  let rowsParsed = 0;
  let filesDownloaded = 0;

  for (const file of pending) {
    const downloaded = await downloadExportFile(file);
    if (!downloaded) continue;
    filesDownloaded += 1;

    const { records, skipped } = parseGdeltExport(downloaded.content);
    rowsParsed += records.length;
    for (const [reason, count] of Object.entries(skipped)) {
      rowsSkipped[reason] = (rowsSkipped[reason] ?? 0) + count;
    }

    for (const record of records) {
      const observation = toObservation(record, now, options.maxEventAgeDays);
      if (observation) observations.push(observation);
    }
    processed.push(file.stamp);
  }

  if (filesDownloaded === 0 && pending.length > 0) {
    throw new Error(
      `None of the ${pending.length} expected GDELT export files could be downloaded.`,
    );
  }

  const processedStamps = [...alreadyProcessed, ...processed].sort().slice(-CURSOR_MEMORY);

  return {
    observations,
    filesRequested: pending.length,
    filesDownloaded,
    rowsParsed,
    rowsSkipped,
    cursor: { processedStamps, updatedAt: now },
  };
}
