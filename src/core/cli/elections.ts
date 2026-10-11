import { buildElections } from '../elections/build.js';

/**
 * Builds data/elections.json: the national electoral calendar for the next twelve months with
 * a sourced risk score per election. `--offline` rebuilds from the files already downloaded.
 */
const offline = process.argv.includes('--offline');
const started = Date.now();
const result = await buildElections({ offline, log: (line) => console.log(line) });
console.log(`elections: ${result.elections} written, ${result.scored} with a score, ${Math.round((Date.now() - started) / 1000)} s`);
