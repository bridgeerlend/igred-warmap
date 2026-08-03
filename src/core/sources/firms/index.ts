import type { HeatCell } from '../../schema/heat.js';
import type { Provenance } from '../../schema/common.js';
import { fetchText } from '../../util/http.js';

/**
 * NASA FIRMS active-fire detections.
 *
 * The documented API needs a free MAP_KEY, but FIRMS also publishes the same global
 * 24-hour products as plain CSV with no key at all — so this source costs nothing and
 * requires no setup. The keyed API is only needed for custom areas and longer windows,
 * which this project does not use.
 *
 * Raw detections are aggregated onto a grid before publishing: 18,000 global points would
 * be neither useful nor small, and a heat layer is about where the heat is, not about
 * individual pixels.
 */
const PRODUCTS = {
  modis: {
    url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
    instrument: 'MODIS C6.1 (Aqua/Terra)',
  },
  viirs_snpp: {
    url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
    instrument: 'VIIRS C2 (Suomi NPP)',
  },
} as const;

export type FirmsProduct = keyof typeof PRODUCTS;

export class FirmsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmsFormatError';
  }
}

export interface FirmsOptions {
  product: FirmsProduct;
  gridDegrees: number;
  minConfidence: number;
  minDetectionsPerCell: number;
  maxCells: number;
}

export interface FirmsHarvest {
  cells: HeatCell[];
  detectionsConsidered: number;
  detectionsKept: number;
  instrument: string;
  source: Provenance;
}

interface Columns {
  latitude: number;
  longitude: number;
  confidence: number;
  frp: number;
  acq_date: number;
  acq_time: number;
}

/** Column order differs between products, so it is read from the header, never assumed. */
function readHeader(line: string): Columns {
  const names = line.split(',').map((name) => name.trim().toLowerCase());
  const need = (name: string): number => {
    const index = names.indexOf(name);
    if (index === -1) throw new FirmsFormatError(`FIRMS CSV has no "${name}" column (got: ${names.join(', ')})`);
    return index;
  };
  return {
    latitude: need('latitude'),
    longitude: need('longitude'),
    confidence: need('confidence'),
    frp: need('frp'),
    acq_date: need('acq_date'),
    acq_time: need('acq_time'),
  };
}

/**
 * VIIRS reports confidence as l/n/h rather than a number. Both are mapped onto 0-100 so the
 * threshold means the same thing whichever product is configured.
 */
function parseConfidence(raw: string): number | undefined {
  const text = raw.trim().toLowerCase();
  if (text === 'l') return 20;
  if (text === 'n') return 60;
  if (text === 'h') return 90;
  const value = Number(text);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined;
}

/** acq_date is YYYY-MM-DD and acq_time is HHMM in UTC, zero-padded inconsistently. */
function observedAt(date: string, time: string): string | undefined {
  const padded = time.trim().padStart(4, '0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !/^\d{4}$/.test(padded)) return undefined;
  const iso = `${date.trim()}T${padded.slice(0, 2)}:${padded.slice(2)}:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

export async function harvestFirms(options: FirmsOptions, now: string): Promise<FirmsHarvest> {
  const product = PRODUCTS[options.product];
  const csv = await fetchText(product.url, { timeoutMs: 90_000, retries: 2 });

  const lines = csv.split('\n');
  const header = lines[0];
  if (!header) throw new FirmsFormatError('FIRMS returned an empty file');
  const columns = readHeader(header);

  const grid = options.gridDegrees;
  const cells = new Map<string, HeatCell>();
  let considered = 0;
  let kept = 0;

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line || line.trim().length === 0) continue;
    considered += 1;

    const fields = line.split(',');
    const lat = Number(fields[columns.latitude]);
    const lon = Number(fields[columns.longitude]);
    const confidence = parseConfidence(fields[columns.confidence] ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || confidence === undefined) continue;
    if (confidence < options.minConfidence) continue;

    const at = observedAt(fields[columns.acq_date] ?? '', fields[columns.acq_time] ?? '');
    if (!at) continue;

    kept += 1;
    const power = Number(fields[columns.frp]);
    // Snap to the cell centre so points sit on the grid rather than on their own coordinates.
    const cellLat = (Math.floor(lat / grid) + 0.5) * grid;
    const cellLon = (Math.floor(lon / grid) + 0.5) * grid;
    const key = `${cellLat.toFixed(3)},${cellLon.toFixed(3)}`;

    const existing = cells.get(key);
    if (existing) {
      existing.detections += 1;
      existing.totalPower += Number.isFinite(power) ? power : 0;
      existing.peakConfidence = Math.max(existing.peakConfidence, confidence);
      if (at > existing.observedAt) existing.observedAt = at;
    } else {
      cells.set(key, {
        lat: Number(cellLat.toFixed(3)),
        lon: Number(cellLon.toFixed(3)),
        detections: 1,
        totalPower: Number.isFinite(power) ? power : 0,
        peakConfidence: confidence,
        observedAt: at,
      });
    }
  }

  if (considered === 0) throw new FirmsFormatError('FIRMS returned a header but no detections');

  const published = [...cells.values()]
    .filter((cell) => cell.detections >= options.minDetectionsPerCell)
    .sort((a, b) => b.detections - a.detections || b.totalPower - a.totalPower)
    .slice(0, options.maxCells)
    .map((cell) => ({ ...cell, totalPower: Number(cell.totalPower.toFixed(1)) }));

  return {
    cells: published,
    detectionsConsidered: considered,
    detectionsKept: kept,
    instrument: product.instrument,
    source: {
      sourceId: 'firms',
      sourceName: `NASA FIRMS — ${product.instrument}`,
      sourceTier: 1,
      url: product.url,
      retrievedAt: now,
      license: 'NASA FIRMS, free and open (attribution requested)',
    },
  };
}
