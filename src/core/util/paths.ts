import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, '..', '..', '..');
export const configDir = path.join(repoRoot, 'config');
export const dataDir = path.join(repoRoot, 'data');
export const editionsDir = path.join(dataDir, 'editions');

export const dataPaths = {
  events: path.join(dataDir, 'events.json'),
  conflicts: path.join(dataDir, 'conflicts.json'),
  candidates: path.join(dataDir, 'candidates.json'),
  baseline: path.join(dataDir, 'baseline.json'),
  health: path.join(dataDir, 'health.json'),
  stories: path.join(dataDir, 'stories.json'),
  heat: path.join(dataDir, 'heat.json'),
  media: path.join(dataDir, 'media.json'),
  cursor: path.join(dataDir, 'internal', 'gdelt-cursor.json'),
  pendingClusters: path.join(dataDir, 'internal', 'pending-clusters.json'),
} as const;
