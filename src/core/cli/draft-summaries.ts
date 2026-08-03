/**
 * Drafts the prose for an edition's lead stories and writes it where the approval pull
 * request can pick it up. Nothing here touches the published edition.
 *
 * Always exits 0. An empty quota, a missing key or a rejected draft are ordinary outcomes:
 * the edition is already live and simply carries no prose.
 *
 * Run: npm run draft [-- --date 2026-08-03] [-- --pr-body /tmp/body.md]
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { draftSummaries } from '../edition/draft.js';
import { editionPath, summariesPath } from '../edition/build.js';
import { edition as editionSchema, editionSummaries } from '../schema/edition.js';
import { readArtifact, writeArtifact } from '../pipeline/store.js';
import { repoRoot } from '../util/paths.js';

// Locally the key lives in a gitignored .env; in Actions it arrives as a real environment
// variable and this file simply does not exist.
const envFile = path.join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const now = new Date().toISOString();
const date = flag('date') ?? now.slice(0, 10);
const config = loadConfig().brief;

const loaded = readArtifact(editionPath(date), editionSchema);
if (!loaded.value) {
  console.log(`No published edition for ${date} — nothing to draft against.`);
  process.exit(0);
}

const outcome = await draftSummaries(loaded.value, config, now);

for (const entry of outcome.rejected) {
  console.log(`rejected: ${entry.headline.slice(0, 60)} — ${entry.reason}`);
}
if (outcome.skippedReason) console.log(`stopped early: ${outcome.skippedReason}`);

if (outcome.summaries.length === 0) {
  console.log(`SUMMARIES=0`);
  console.log('No prose this edition. It publishes as sourced records only, which is a valid Brief.');
  process.exit(0);
}

writeArtifact(summariesPath(date), editionSummaries, {
  artifactVersion: 1,
  date,
  generatedAt: now,
  model: config.ai.model,
  summaries: outcome.summaries,
});

// The pull request body carries the prose in readable form. Reviewing a JSON diff on a
// phone is miserable; reading four paragraphs is not.
const prBody = flag('pr-body');
if (prBody) {
  const lines = [
    `## Brief ${date} — ${outcome.summaries.length} drafted paragraph${outcome.summaries.length === 1 ? '' : 's'}`,
    '',
    'Each paragraph below was written by a language model from the headlines listed under it,',
    'and nothing else. Every figure it contains was checked against those headlines in code',
    'before this pull request was opened.',
    '',
    '**Merge to publish. Close to discard — the edition stays up either way.**',
    '',
  ];
  for (const summary of outcome.summaries) {
    lines.push(`### ${summary.headline}`, '', summary.text, '', '<details><summary>Sources the model was given</summary>', '');
    for (const url of summary.sourcesGiven) lines.push(`- ${url}`);
    lines.push('', '</details>', '');
  }
  if (outcome.rejected.length > 0) {
    lines.push('---', '', '_Discarded before review:_');
    for (const entry of outcome.rejected) lines.push(`- ${entry.headline} — ${entry.reason}`);
  }
  writeFileSync(prBody, lines.join('\n'), 'utf-8');
}

console.log(`SUMMARIES=${outcome.summaries.length}`);
console.log(`Drafted ${outcome.summaries.length} of ${outcome.attempted} attempted, ${outcome.rejected.length} rejected.`);
