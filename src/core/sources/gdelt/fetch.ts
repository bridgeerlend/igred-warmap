import { fetchBinary, fetchText, HttpError } from '../../util/http.js';
import { unzipSingleText } from '../../util/misc.js';
import { gdeltStampToIso } from './parse.js';

const LAST_UPDATE_URL = 'http://data.gdeltproject.org/gdeltv2/lastupdate.txt';
const SLOT_MINUTES = 15;

export interface GdeltFile {
  stamp: string;
  url: string;
  publishedAt: string;
}

function stampToDate(stamp: string): Date {
  const iso = gdeltStampToIso(stamp);
  if (!iso) throw new Error(`Unparseable GDELT stamp: ${stamp}`);
  return new Date(iso);
}

function dateToStamp(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function fileForStamp(stamp: string): GdeltFile {
  const iso = gdeltStampToIso(stamp);
  if (!iso) throw new Error(`Unparseable GDELT stamp: ${stamp}`);
  return {
    stamp,
    url: `http://data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip`,
    publishedAt: iso,
  };
}

/** Reads the pointer file GDELT rewrites every 15 minutes. */
export async function fetchLatestExportFile(): Promise<GdeltFile> {
  const body = await fetchText(LAST_UPDATE_URL, { timeoutMs: 20_000 });
  const line = body.split('\n').find((entry) => entry.includes('.export.CSV.zip'));
  const url = line?.trim().split(/\s+/)[2];
  const stamp = url?.match(/(\d{14})\.export\.CSV\.zip$/)?.[1];
  if (!url || !stamp) {
    throw new Error(`lastupdate.txt did not contain an export file entry:\n${body.slice(0, 300)}`);
  }
  return fileForStamp(stamp);
}

/**
 * GDELT publishes on a fixed 15-minute grid, so the recent file list can be derived
 * by walking back from the latest pointer — far cheaper than the multi-megabyte
 * master file list.
 */
export function recentExportFiles(latest: GdeltFile, count: number): GdeltFile[] {
  const files: GdeltFile[] = [];
  const cursor = stampToDate(latest.stamp);
  for (let index = 0; index < count; index++) {
    files.push(fileForStamp(dateToStamp(cursor)));
    cursor.setUTCMinutes(cursor.getUTCMinutes() - SLOT_MINUTES);
  }
  return files.reverse();
}

export interface DownloadedFile {
  file: GdeltFile;
  content: string;
}

/**
 * GDELT occasionally skips a slot, so a 404 is expected and non-fatal.
 * Any other failure propagates — a silently short run would corrupt the baseline.
 */
export async function downloadExportFile(file: GdeltFile): Promise<DownloadedFile | undefined> {
  try {
    const bytes = await fetchBinary(file.url, { timeoutMs: 60_000, retries: 2 });
    return { file, content: unzipSingleText(bytes, '.csv') };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 403)) {
      return undefined;
    }
    throw error;
  }
}
