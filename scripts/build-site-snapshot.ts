/**
 * Flattens the map into one self-contained HTML file with data inlined, so it can be opened
 * anywhere with no server and no network — for review before the site is deployed.
 *
 * The published site is the module-based version in site/; this is a snapshot of it, not a
 * second implementation. The three modules are concatenated in dependency order with their
 * import/export keywords stripped, and the result is checked for leftovers so a new import
 * cannot silently produce a broken file.
 *
 * Run: npx tsx scripts/build-site-snapshot.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';

const siteDir = path.join(repoRoot, 'site');
const read = (file: string) => readFileSync(path.join(siteDir, file), 'utf-8');

/** Removes ESM syntax so the modules can live in one script scope. */
function flatten(source: string, file: string): string {
  const out = source
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+(const|function|class)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');

  const leftover = out.match(/^\s*(import|export)\s/m);
  if (leftover) {
    throw new Error(`${file}: an import/export survived flattening near "${leftover[0].trim()}"`);
  }
  return out;
}

const modules = ['projection.js', 'config.js', 'app.js']
  .map((file) => `/* ---- ${file} ---- */\n${flatten(read(file), file)}`)
  .join('\n\n');

const world = read('world.json');
const events = read('preview-events.json');

/**
 * The fonts have to travel inside the file too, or the snapshot falls back to whatever the
 * viewing device happens to have — which is the exact thing self-hosting them was meant to
 * stop. Each woff2 becomes a data URI inside the generated @font-face rules.
 */
function inlineFonts(): string {
  return read(path.join('fonts', 'fonts.css')).replace(
    /url\('([^']+\.woff2)'\)/g,
    (_match, file: string) => {
      const bytes = readFileSync(path.join(siteDir, 'fonts', file));
      return `url('data:font/woff2;base64,${bytes.toString('base64')}')`;
    },
  );
}

const html = read('index.html')
  .replace(/\s*<link rel="preload"[^>]*>/g, '')
  .replace('<link rel="stylesheet" href="fonts/fonts.css">', `<style>\n${inlineFonts()}\n</style>`)
  .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${read('styles.css')}\n</style>`)
  .replace(
    '<script type="module" src="app.js"></script>',
    [
      '<script id="inline-world" type="application/json">' + world + '</script>',
      '<script id="inline-events" type="application/json">' + events + '</script>',
      '<script type="module">',
      // The snapshot has no server, so fetch is redirected to the inlined blobs.
      'const INLINE = {',
      '  "world.json": document.getElementById("inline-world").textContent,',
      '  "preview-events.json": document.getElementById("inline-events").textContent,',
      '};',
      'window.fetch = async (url) => {',
      '  const key = String(url).split("/").pop();',
      '  if (key in INLINE) return new Response(INLINE[key], { status: 200 });',
      '  return new Response("{}", { status: 404 });',
      '};',
      'const params = new URLSearchParams(location.search);',
      'if (!params.has("preview")) {',
      '  params.set("preview", "1");',
      '  history.replaceState(null, "", location.pathname + "?" + params);',
      '}',
      modules,
      '</script>',
    ].join('\n'),
  )
  .replace('<title>IGRED Global Conflict Monitor</title>', '<title>IGRED Global Conflict Monitor — snapshot</title>');

const target = path.join(repoRoot, 'design', 'atlas-snapshot.html');
writeFileSync(target, html, 'utf-8');
console.log(`atlas-snapshot.html: ${(html.length / 1024).toFixed(0)} KB`);
