import { z } from 'zod';
import { isoDateTime, provenance } from './common.js';

/**
 * Satellite thermal anomalies, aggregated onto a grid.
 *
 * These are heat detections and nothing more. A fire near a front line may be shelling, a
 * burning depot, or farmers clearing land — the satellite cannot tell them apart and neither
 * can we. The schema says "detections" everywhere and never "strikes", so the wording cannot
 * quietly drift into a claim the data does not support.
 */
export const heatCell = z.strictObject({
  /** Grid cell centre. */
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  detections: z.number().int().positive(),
  /** Fire radiative power, megawatts, summed over the cell. A rough intensity. */
  totalPower: z.number().min(0),
  /** Highest per-detection confidence in the cell, 0-100 as the instrument reports it. */
  peakConfidence: z.number().min(0).max(100),
  observedAt: isoDateTime,
});
export type HeatCell = z.infer<typeof heatCell>;

export const heatArtifact = z.strictObject({
  artifactVersion: z.literal(1),
  generatedAt: isoDateTime,
  /** What the reader is looking at, carried in the data so the map cannot mislabel it. */
  measures: z.literal('satellite_thermal_anomalies'),
  instrument: z.string().min(1),
  windowHours: z.number().int().positive(),
  gridDegrees: z.number().positive(),
  detectionsConsidered: z.number().int().min(0),
  cellsPublished: z.number().int().min(0),
  /**
   * One file is the source for every cell below, so provenance sits here rather than being
   * repeated thousands of times.
   */
  source: provenance,
  cells: z.array(heatCell),
});
export type HeatArtifact = z.infer<typeof heatArtifact>;
