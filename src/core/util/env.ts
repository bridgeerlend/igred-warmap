import { existsSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './paths.js';

/**
 * Loads the gitignored .env when running locally.
 *
 * In GitHub Actions the credentials arrive as real environment variables and this file does
 * not exist, so this is a no-op there. Every command that touches a credentialed source
 * calls it — leaving it to individual commands is how the ingest ended up reporting UCDP as
 * unconfigured while the token sat in .env the whole time.
 */
export function loadLocalEnv(): void {
  const file = path.join(repoRoot, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
