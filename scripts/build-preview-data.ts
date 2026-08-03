/**
 * Writes site/preview-events.json in the real published artifact schema, from the captured
 * design fixture plus the placeholder register.
 *
 * This exists so the layout can be reviewed at realistic density before the UCDP register is
 * connected. It is loaded only with ?preview=1 and the page shows a banner saying so — the
 * live map never reads it.
 *
 * Run: npx tsx scripts/build-preview-data.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eventsArtifact, ARTIFACT_VERSION } from '../src/core/schema/artifact.js';
import { intensityOf } from '../src/core/util/intensity.js';
import { repoRoot } from '../src/core/util/paths.js';

const buildDir = path.join(repoRoot, 'design', 'build');
const read = (file: string) => JSON.parse(readFileSync(path.join(buildDir, file), 'utf-8'));

const fixture = read('sample-events.json');
const register = read('placeholder-register.json');
const active = new Set<string>(register.activeConflictCountries);
const illustrativeVerified = new Set<string>(fixture.illustrativeVerified);

interface FixtureEvent {
  id: string; lat: number; lon: number; place: string; country: string;
  category: string; severity: number; reports: number; publishers: number;
  confidence: string; occurredAt: string; source: string; publisher: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  armed_clash: 'Armed clash', armed_assault: 'Armed assault',
  aerial_strike: 'Aerial or missile strike', mass_violence: 'Mass violence',
  violent_repression: 'Violent repression', violent_unrest: 'Violent unrest',
  siege_blockade: 'Siege or blockade',
};

const now = new Date(fixture.capturedAt as string).toISOString();

const events = (fixture.events as FixtureEvent[])
  .filter((event) => active.has(event.country))
  .map((event) => ({
    id: event.id,
    occurredAt: event.occurredAt,
    dateBasis: 'event_date' as const,
    ingestedAt: now,
    category: event.category as never,
    label: `${CATEGORY_LABEL[event.category] ?? event.category} — ${event.place}`,
    cameoCode: '190',
    location: {
      lat: event.lat,
      lon: event.lon,
      name: event.place,
      countryFips: event.country,
      precision: 'city' as const,
    },
    actors: [],
    // Illustrative only: nothing in this fixture has actually been verified by hand.
    confidence: illustrativeVerified.has(event.id)
      ? ('verified' as const)
      : (event.confidence as 'reported' | 'unconfirmed'),
    severity: event.severity,
    intensity: intensityOf(event.severity, event.reports),
    reportCount: event.reports,
    distinctPublishers: event.publishers,
    provenance: [
      {
        sourceId: 'gdelt',
        sourceName: 'GDELT 2.0 Event Database',
        sourceTier: 1 as const,
        url: event.source,
        retrievedAt: now,
        publishedAt: event.occurredAt,
        ...(event.publisher ? { publisher: event.publisher } : {}),
      },
    ],
  }))
  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

// Validated against the same schema the pipeline publishes, so the preview can never drift
// into a shape the live map would reject.
const artifact = eventsArtifact.parse({
  artifactVersion: ARTIFACT_VERSION,
  generatedAt: now,
  windowDays: 30,
  ...(events.at(-1) ? { earliestEvent: events.at(-1)!.occurredAt } : {}),
  ...(events[0] ? { latestEvent: events[0].occurredAt } : {}),
  events,
});

writeFileSync(path.join(repoRoot, 'site', 'preview-events.json'), JSON.stringify(artifact), 'utf-8');
console.log(`preview-events.json: ${events.length} incidents (validated against the published schema)`);
