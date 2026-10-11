/**
 * The election risk score: six indicators, each a risk from 0 to 100 built from named
 * sources, and their weighted mean. Nothing here fetches anything; build.ts hands in the
 * figures. Every part keeps its source, year and raw value, so the page can show them all.
 */
export type IndicatorId = 'quality' | 'unrest' | 'press' | 'now' | 'close' | 'economy';
export const INDICATORS: IndicatorId[] = ['quality', 'unrest', 'press', 'now', 'close', 'economy'];

export interface Part {
  /** Which figure: "vdem", "pei", "rsf", "fh", "events", "trend", "margin", "turnout", "gdp", "debt", "currency". */
  key: string;
  source: string;
  url: string;
  year: string;
  /** The figure as the source gives it. */
  raw: number;
  unit: string;
  /** The same figure as a risk from 0 to 100. */
  risk: number;
  /** What the page needs to name the figure in either language: an office, a date, an article. */
  meta?: Record<string, string>;
}

export interface Indicator { id: IndicatorId; risk: number | null; parts: Part[] }

export interface Scales {
  marginPointsForZero: number;
  turnoutForZero: number;
  turnoutForHundred: number;
  gdpPerPersonForZero: number;
  gdpPerPersonForHundred: number;
  debtForHundred: number;
  depreciationForHundred: number;
  depreciationYears: number;
}

export const clamp = (v: number) => Math.max(0, Math.min(100, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
/** A straight line from `zero` (risk 0) to `hundred` (risk 100), clamped. */
export const line = (v: number, zero: number, hundred: number) => clamp(((v - zero) / (hundred - zero)) * 100);

export const risk = {
  /** V-Dem's index runs from 0 to 1, higher is cleaner. */
  vdem: (v: number) => clamp((1 - v) * 100),
  /** PEI, RSF and Freedom House run from 0 to 100, higher is better. */
  inverse100: (v: number) => clamp(100 - v),
  margin: (points: number, s: Scales) => line(points, s.marginPointsForZero, 0),
  turnout: (pct: number, s: Scales) => line(pct, s.turnoutForZero, s.turnoutForHundred),
  gdp: (usd: number, s: Scales) => line(Math.log10(Math.max(usd, 1)), Math.log10(s.gdpPerPersonForZero), Math.log10(s.gdpPerPersonForHundred)),
  debt: (pct: number, s: Scales) => line(pct, 0, s.debtForHundred),
  /** Local currency per dollar, now against `years` ago: a rise is a depreciation. */
  depreciation: (pct: number, s: Scales) => line(pct, 0, s.depreciationForHundred),
  /** Incidents in the past 30 days against the 30 before: as many is 50, twice as many 100, half 0. */
  trend: (last: number, prev: number) => clamp(50 + 50 * Math.log2((last + 1) / (prev + 1))),
};

export function indicator(id: IndicatorId, parts: Part[], combine?: (parts: Part[]) => number): Indicator {
  const usable = parts.filter((p) => Number.isFinite(p.risk));
  if (!usable.length) return { id, risk: null, parts: [] };
  const value = combine ? combine(usable) : usable.reduce((a, p) => a + p.risk, 0) / usable.length;
  return { id, risk: round1(clamp(value)), parts: usable.map((p) => ({ ...p, raw: round1(p.raw), risk: round1(p.risk) })) };
}

export interface Score { score: number | null; level: 'low' | 'elevated' | 'high' | null; coverage: number; missing: IndicatorId[] }

/**
 * The weighted mean of the indicators that have data. `coverage` is the share of the total
 * weight the score rests on; with less than half, there is no score.
 */
export function combine(indicators: Indicator[], weights: Record<IndicatorId, number>, levels: { elevated: number; high: number }): Score {
  const total = INDICATORS.reduce((a, id) => a + (weights[id] ?? 0), 0);
  let sum = 0; let used = 0;
  const missing: IndicatorId[] = [];
  for (const id of INDICATORS) {
    const ind = indicators.find((x) => x.id === id);
    if (!ind || ind.risk === null || !weights[id]) { if (weights[id]) missing.push(id); continue; }
    sum += ind.risk * weights[id]; used += weights[id];
  }
  const coverage = total ? round1((used / total) * 100) : 0;
  if (!used || coverage < 50) return { score: null, level: null, coverage, missing };
  const score = Math.round(sum / used);
  return { score, level: score >= levels.high ? 'high' : score >= levels.elevated ? 'elevated' : 'low', coverage, missing };
}

/** Where a value falls among others, from 0 (lowest) to 100 (highest). */
export function percentile(value: number, all: number[]): number {
  if (!all.length) return 50;
  const below = all.filter((v) => v < value).length;
  const equal = all.filter((v) => v === value).length;
  return clamp(((below + equal / 2) / all.length) * 100);
}
