/**
 * Turns a pending candidate into a proposed register entry and a readable pull request.
 *
 * This is the step the brief calls for: the system flags a possible new conflict, a human
 * confirms it. Detection never asserts a conflict on its own, and merging the pull request
 * is the only thing that puts one on the map.
 *
 * Always exits 0. Nothing to propose is the ordinary case.
 *
 * Run: npm run propose-conflict [-- --pr-body /tmp/body.md]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { candidatesArtifact } from '../schema/artifact.js';
import { verifiedConflictsConfig } from '../schema/config.js';
import { readArtifact, writeArtifact } from '../pipeline/store.js';
import { configDir, dataPaths } from '../util/paths.js';
import { loadLocalEnv } from '../util/env.js';

loadLocalEnv();

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const now = new Date().toISOString();
const config = loadConfig();

const candidates = readArtifact(dataPaths.candidates, candidatesArtifact).value?.candidates ?? [];
const alreadyProposed = new Set(config.verifiedConflicts.conflicts.map((entry) => entry.candidateId));

const pending = candidates.filter(
  (candidate) => candidate.status === 'pending_review' && !alreadyProposed.has(candidate.id),
);

if (pending.length === 0) {
  console.log('PROPOSED=0');
  console.log('No unproposed candidate awaiting review.');
  process.exit(0);
}

// One at a time. Two conflicts in one pull request means one decision cannot be taken
// without the other, and these are independent judgements.
const candidate = pending[0]!;

const slug = candidate.countryName
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z]+/g, '-')
  .replace(/^-|-$/g, '');

const entry = {
  id: `igred-${slug}-${candidate.detectedAt.slice(0, 7)}`,
  name: `${candidate.countryName} — under review`,
  countries: [{ name: candidate.countryName, fips: candidate.countryFips }],
  confirmedOn: now.slice(0, 10),
  candidateId: candidate.id,
  sources: [...new Set(candidate.provenance.map((source) => source.url))].slice(0, 12),
  note: `Proposed from abnormal armed-incident coverage detected on ${candidate.evidence[0]?.day ?? candidate.detectedAt.slice(0, 10)}.`,
};

const next = {
  ...config.verifiedConflicts,
  conflicts: [...config.verifiedConflicts.conflicts, entry],
};

writeArtifact(path.join(configDir, 'verified-conflicts.json'), verifiedConflictsConfig, next);

/* ---------- the pull request body ------------------------------------- */

const prBody = flag('pr-body');
if (prBody) {
  const rows = candidate.evidence
    .map(
      (day) =>
        `| ${day.day} | ${day.eventCount} | ${day.baselineMedian} | ${day.modifiedZ} | ${day.distinctPublishers} |`,
    )
    .join('\n');

  const lines = [
    `## Possible new conflict: ${candidate.countryName}`,
    '',
    '**This is not a claim that a conflict exists.** The system can only say that armed-incident',
    'coverage in this country is far above its own recent norm, and has stayed there. Deciding',
    'whether that is a conflict is yours.',
    '',
    '**Merge to put it on the map. Close to dismiss** — the country then stays quiet for the',
    `configured cooldown of ${config.detection.candidate.cooldownDays} days rather than asking again tomorrow.`,
    '',
    '### What was measured',
    '',
    '| Day | Armed incidents | Country’s own median | Deviation | Outlets |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
    `Detection requires ${config.detection.trigger.sustainedDaysRequired} such days inside ${config.detection.trigger.sustainedWindowDays},`,
    `at least ${config.detection.trigger.minEventsInDay} incidents and ${config.detection.trigger.minDistinctPublishers} separate outlets.`,
    '',
  ];

  if (candidate.sampleIncidents.length > 0) {
    lines.push('### Incidents behind it', '');
    for (const incident of candidate.sampleIncidents) {
      lines.push(`- ${incident.occurredAt.slice(0, 10)} — ${incident.label}`);
    }
    lines.push('');
  }

  lines.push('<details><summary>Reporting behind those incidents</summary>', '');
  for (const source of entry.sources) lines.push(`- ${source}`);
  lines.push('', '</details>', '');
  lines.push(
    '---',
    '',
    'Merging adds the entry to `config/verified-conflicts.json`. From the next hourly run the',
    'map will show incidents in this country, and the Brief can group its stories under it.',
  );

  writeFileSync(prBody, lines.join('\n'), 'utf-8');
}

console.log(`PROPOSED=1`);
console.log(`CANDIDATE_ID=${candidate.id}`);
console.log(`COUNTRY=${candidate.countryName}`);
console.log(`Proposed ${entry.id} for review (${pending.length - 1} other candidates waiting).`);
