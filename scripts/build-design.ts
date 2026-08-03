/**
 * Inlines map geometry, the event fixture and the placeholder register into each design
 * exploration, so every page is a single self-contained file that opens anywhere with no
 * server and no network.
 *
 * Events are projected here rather than in the page, so the points and the coastlines can
 * never drift out of alignment.
 *
 * Run: npx tsx scripts/build-design.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';
import { toView } from './lib/projection.js';

const designDir = path.join(repoRoot, 'design');
const srcDir = path.join(designDir, 'src');
const buildDir = path.join(designDir, 'build');

const read = (file: string) => JSON.parse(readFileSync(path.join(buildDir, file), 'utf-8'));

const world = read('world.json');
const fixture = read('sample-events.json');
const register = read('placeholder-register.json');

const active = new Set<string>(register.activeConflictCountries);
const verified = new Set<string>(fixture.illustrativeVerified);

interface FixtureEvent {
  id: string;
  lat: number;
  lon: number;
  place: string;
  country: string;
  category: string;
  severity: number;
  reports: number;
  publishers: number;
  confidence: string;
  occurredAt: string;
  source: string;
  publisher: string;
}

const round = (value: number) => Number(value.toFixed(1));

/**
 * Category severity alone renders almost flat: 88% of a real day is armed clashes, all
 * carrying the same value. Intensity blends the category with how widely the incident was
 * reported, log-scaled so one enormous story cannot dominate.
 *
 * The result is deliberately bottom-heavy, because the data is: 71% of incidents have a
 * single source. That is the honest shape — a quiet field of small embers with genuinely
 * rare bright ones — rather than a spread manufactured to look busy.
 */
function intensityOf(severity: number, reports: number): number {
  const corroboration = 1 + Math.log2(Math.max(1, reports));
  return Math.max(1, Math.min(5, Math.round(0.4 * severity + 0.7 * corroboration - 0.6)));
}

/**
 * Compact field names and projected coordinates: the fixture is inlined into every page,
 * so shaving it keeps the mockups quick to open on a phone.
 */
const events = (fixture.events as FixtureEvent[])
  .filter((event) => active.has(event.country))
  .map((event) => {
    const [x, y] = toView(event.lon, event.lat);
    return {
      x: round(x),
      y: round(y),
      p: event.place,
      c: event.country,
      k: event.category,
      s: event.severity,
      i: intensityOf(event.severity, event.reports),
      r: event.reports,
      n: event.publishers,
      t: event.occurredAt,
      u: event.source,
      b: event.publisher,
      v: verified.has(event.id) || undefined,
    };
  })
  // Drawn faintest-first so the severe points sit on top of the crowd.
  .sort((a, b) => a.i - b.i || a.r - b.r);

// The illustrative verified marks must survive the register gate, or the accent colour
// never appears in the mockups.
if (!events.some((event) => event.v)) {
  for (const event of [...events].sort((a, b) => b.r - a.r || b.s - a.s).slice(0, 4)) {
    event.v = true;
  }
}

const payload = {
  capturedAt: fixture.capturedAt,
  totalBeforeGate: fixture.events.length,
  events,
};

const worldJson = JSON.stringify(world);
const eventsJson = JSON.stringify(payload);

// index.html is hand-written straight into design/ and carries no data.
for (const file of readdirSync(srcDir).filter((name) => name.endsWith('.html') && name !== 'index.html')) {
  const template = readFileSync(path.join(srcDir, file), 'utf-8');
  for (const token of ['"__WORLD__"', '"__EVENTS__"']) {
    if (!template.includes(token)) throw new Error(`${file} is missing the ${token} placeholder`);
  }
  const output = template.replace('"__WORLD__"', worldJson).replace('"__EVENTS__"', eventsJson);
  writeFileSync(path.join(designDir, file), output, 'utf-8');
  console.log(`${file}: ${(output.length / 1024).toFixed(0)} KB`);
}

console.log(
  `${events.length} incidents on the map (${payload.totalBeforeGate} before the placeholder register gate), ${events.filter((e) => e.v).length} marked verified for illustration`,
);
