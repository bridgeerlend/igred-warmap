/**
 * Flattens igred.org into one self-contained file with fonts inlined, for review before the
 * page is deployed. The published page stays the module version in www/.
 *
 * Run: npx tsx scripts/build-home-snapshot.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';

const wwwDir = path.join(repoRoot, 'www');
const read = (file: string) => readFileSync(path.join(wwwDir, file), 'utf-8');

function flatten(source: string, file: string): string {
  const out = source
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+(const|function|class)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  const leftover = out.match(/^\s*(import|export)\s/m);
  if (leftover) throw new Error(`${file}: an import/export survived flattening`);
  return out;
}

/** Fonts travel inside the file, or the snapshot falls back to a device face. */
function inlineFonts(): string {
  return read(path.join('fonts', 'fonts.css')).replace(
    /url\('([^']+\.woff2)'\)/g,
    (_m, file: string) =>
      `url('data:font/woff2;base64,${readFileSync(path.join(wwwDir, 'fonts', file)).toString('base64')}')`,
  );
}

const html = read('index.html')
  .replace(/\s*<link rel="preload"[^>]*>/g, '')
  .replace('<link rel="stylesheet" href="fonts/fonts.css">', `<style>\n${inlineFonts()}\n</style>`)
  .replace('<link rel="stylesheet" href="atlas.css">', `<style>\n${read('atlas.css')}\n</style>`)
  .replace('<link rel="stylesheet" href="home.css">', `<style>\n${read('home.css')}\n</style>`)
  .replace('<title>', '<title>Snapshot · ')
  .replace(
    '<script type="module" src="home.js"></script>',
    `<script type="module">\n${flatten(read('home.js'), 'home.js')}\n</script>`,
  );

const target = path.join(repoRoot, 'design', 'home-snapshot.html');
writeFileSync(target, html, 'utf-8');
console.log(`home-snapshot.html: ${(html.length / 1024).toFixed(0)} KB`);
