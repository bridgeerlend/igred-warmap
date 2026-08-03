/**
 * Copies the shared Atlas foundation into www/ so the institute site is self-contained and
 * can be deployed anywhere — including a different host from the map, which is where it
 * lives today.
 *
 * site/atlas.css and site/fonts remain the single source; this only mirrors them.
 *
 * Run: npx tsx scripts/build-www.ts
 */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';

const siteDir = path.join(repoRoot, 'site');
const wwwDir = path.join(repoRoot, 'www');

mkdirSync(path.join(wwwDir, 'fonts'), { recursive: true });
copyFileSync(path.join(siteDir, 'atlas.css'), path.join(wwwDir, 'atlas.css'));

let fonts = 0;
for (const file of readdirSync(path.join(siteDir, 'fonts'))) {
  copyFileSync(path.join(siteDir, 'fonts', file), path.join(wwwDir, 'fonts', file));
  fonts += 1;
}

console.log(`www/: atlas.css + ${fonts} font files mirrored from site/`);
