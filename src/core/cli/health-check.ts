/**
 * Decides whether a human needs to be told. Silence means everything works: a source that
 * blipped and recovered, or one that simply has no credential yet, is not worth an alert.
 * Only a source that has been down past its own staleness budget qualifies.
 */
import { loadConfig } from '../config.js';
import { healthArtifact } from '../schema/artifact.js';
import { readArtifact } from '../pipeline/store.js';
import { dataPaths } from '../util/paths.js';
import { loadLocalEnv } from '../util/env.js';

loadLocalEnv();

const config = loadConfig();
const health = readArtifact(dataPaths.health, healthArtifact).value;

if (!health) {
  console.log('ALERT: data/health.json is missing or invalid — the pipeline did not complete.');
  process.exitCode = 1;
} else {
  const now = Date.now();
  const alarming = health.sources.filter((source) => {
    if (source.status !== 'failed') return false;
    const definition = config.sources.find((entry) => entry.id === source.sourceId);
    const budgetHours = definition?.staleAfterHours ?? 24;
    if (!source.lastSuccessAt) return true;
    return (now - Date.parse(source.lastSuccessAt)) / 3_600_000 > budgetHours;
  });

  if (alarming.length === 0) {
    console.log(`Healthy. Overall: ${health.overall}.`);
  } else {
    for (const source of alarming) {
      console.log(
        `ALERT: ${source.sourceId} has been failing since ${source.lastSuccessAt ?? 'never succeeding'} (${source.consecutiveFailures} consecutive). ${source.message ?? ''}`,
      );
    }
    process.exitCode = 1;
  }
}
