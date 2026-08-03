/**
 * Turns Natural Earth (public domain) country polygons into SVG paths in the Natural Earth
 * projection, so the explorations carry real, art-directed cartography instead of an
 * off-the-shelf tile layer. Emits land, borders and a graticule as separate layers, plus
 * the projection function so events can be placed in the same space.
 *
 * Run: npx tsx scripts/build-map-geometry.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';
import { toView, VIEW_HEIGHT, VIEW_WIDTH, X_MAX, Y_MAX } from './lib/projection.js';

const buildDir = path.join(repoRoot, 'design', 'build');
const siteDir = path.join(repoRoot, 'site');

const round = (value: number): string => value.toFixed(1).replace(/\.0$/, '');

type Ring = [number, number][];

function ringToPath(ring: Ring): string {
  const points: string[] = [];
  let previous: [number, number] | undefined;
  for (const [lon, lat] of ring) {
    const [x, y] = toView(lon, lat);
    // Drop points that land on the same tenth of a unit as the last one; at this scale
    // they are invisible and they roughly halve the file size.
    if (previous && Math.abs(x - previous[0]) < 0.15 && Math.abs(y - previous[1]) < 0.15) continue;
    points.push(`${round(x)} ${round(y)}`);
    previous = [x, y];
  }
  if (points.length < 3) return '';
  return `M${points.join('L')}Z`;
}

interface Feature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

function ringsOf(feature: Feature): Ring[] {
  if (!feature.geometry) return [];
  if (feature.geometry.type === 'Polygon') return feature.geometry.coordinates as Ring[];
  if (feature.geometry.type === 'MultiPolygon') {
    return (feature.geometry.coordinates as Ring[][][]).flat() as unknown as Ring[];
  }
  return [];
}

/** Shoelace area in projected units; used to drop specks too small to render. */
function ringArea(ring: Ring): number {
  let total = 0;
  for (let index = 0; index < ring.length; index++) {
    const [x1, y1] = toView(...(ring[index] as [number, number]));
    const [x2, y2] = toView(...(ring[(index + 1) % ring.length] as [number, number]));
    total += x1 * y2 - x2 * y1;
  }
  return Math.abs(total) / 2;
}

const MIN_RING_AREA = 0.4;

/**
 * Natural Earth leaves FIPS_10 as "-99" for these, so they would never match an event's
 * country code. Filled in by name, which is stable in this dataset.
 */
const FIPS_GAPS: Record<string, string> = {
  Norway: 'NO',
  Israel: 'IS',
  Palestine: 'WE',
  'N. Cyprus': 'CY',
  Somaliland: 'SO',
  'S. Sudan': 'OD',
};

const geojson = JSON.parse(readFileSync(path.join(buildDir, 'ne110m.geojson'), 'utf-8')) as {
  features: Feature[];
};

const countries: { fips: string; name: string; path: string }[] = [];
let dropped = 0;

for (const feature of geojson.features) {
  const name = String(feature.properties.NAME ?? '').trim();
  const rawFips = String(feature.properties.FIPS_10 ?? '').trim();
  const fips = rawFips === '-99' || rawFips === '' ? (FIPS_GAPS[name] ?? '') : rawFips;
  const paths = ringsOf(feature)
    .filter((ring) => {
      if (ringArea(ring) >= MIN_RING_AREA) return true;
      dropped += 1;
      return false;
    })
    .map(ringToPath)
    .filter((entry) => entry.length > 0);

  if (paths.length === 0) continue;
  countries.push({ fips, name, path: paths.join('') });
}

// A graticule reads as considered cartography rather than a default basemap, and one
// direction uses it as a primary visual element.
const graticule: string[] = [];
for (let lon = -180; lon <= 180; lon += 30) {
  const points: string[] = [];
  for (let lat = -90; lat <= 90; lat += 3) points.push(toView(lon, lat).map(round).join(' '));
  graticule.push(`M${points.join('L')}`);
}
for (let lat = -60; lat <= 60; lat += 30) {
  const points: string[] = [];
  for (let lon = -180; lon <= 180; lon += 3) points.push(toView(lon, lat).map(round).join(' '));
  graticule.push(`M${points.join('L')}`);
}

// The projection outline, so the map can be framed as a plate rather than a bleeding edge.
const outline: string[] = [];
{
  const points: string[] = [];
  for (let lat = -90; lat <= 90; lat += 2) points.push(toView(180, lat).map(round).join(' '));
  for (let lat = 90; lat >= -90; lat -= 2) points.push(toView(-180, lat).map(round).join(' '));
  outline.push(`M${points.join('L')}Z`);
}

// Tick positions come from the projection itself. An approximation in the page drifted
// visibly from the graticule it was meant to label.
const ticks = {
  lon: [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180].map((lon) => ({
    value: lon,
    label: `${Math.abs(lon)}${lon === 0 ? '' : lon < 0 ? 'W' : 'E'}`,
    x: Number(round(toView(lon, 0)[0])),
  })),
  lat: [-60, -30, 0, 30, 60].map((lat) => ({
    value: lat,
    label: `${Math.abs(lat)}${lat === 0 ? '' : lat < 0 ? 'S' : 'N'}`,
    y: Number(round(toView(0, lat)[1])),
  })),
};

const output = {
  $comment:
    'Generated by scripts/build-map-geometry.ts from Natural Earth 1:110m (public domain), Natural Earth projection.',
  viewBox: `0 0 ${round(VIEW_WIDTH)} ${round(VIEW_HEIGHT)}`,
  width: Number(round(VIEW_WIDTH)),
  height: Number(round(VIEW_HEIGHT)),
  projection: { xMax: X_MAX, yMax: Y_MAX },
  graticule: graticule.join(''),
  outline: outline.join(''),
  ticks,
  countries,
};

// The site is the canonical consumer; the design explorations read the same file.
writeFileSync(path.join(siteDir, 'world.json'), JSON.stringify(output), 'utf-8');

const bytes = JSON.stringify(output).length;
console.log(
  `world.json: ${countries.length} countries, ${dropped} specks dropped, ${(bytes / 1024).toFixed(0)} KB, viewBox ${output.viewBox}`,
);
