import { buildCrises } from '../crises/build.js';

/**
 * Builds the crisis pages and the map's compact incident file from what the ingest already
 * published, plus GDELT's article index, Google News, Wikipedia and the World Bank.
 * `--offline` rebuilds from the cache alone, for layout work.
 */
const offline = process.argv.includes('--offline');
const started = Date.now();
const result = await buildCrises({ offline, log: (line) => console.log(line) });
console.log(`crises: ${result.crises} written, ${result.mapEvents} incidents in map-events.json, ${Math.round((Date.now() - started) / 1000)} s`);
