/**
 * Flattens the Brief into one self-contained HTML file with the edition inlined, so it can
 * be reviewed on any device before the site is deployed.
 *
 * The published Brief is the module-based version in site/brief/; this is a snapshot of it,
 * not a second implementation.
 *
 * Run: npx tsx scripts/build-brief-snapshot.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';

const siteDir = path.join(repoRoot, 'site');
const briefDir = path.join(siteDir, 'brief');
const editionsDir = path.join(repoRoot, 'data', 'editions');

/** Removes ESM syntax so the modules can share one script scope. */
function flatten(source: string, file: string): string {
  const out = source
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+(const|function|class)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  const leftover = out.match(/^\s*(import|export)\s/m);
  if (leftover) throw new Error(`${file}: an import/export survived flattening near "${leftover[0].trim()}"`);
  return out;
}

/** Fonts travel inside the file too, or the snapshot falls back to a device face. */
function inlineFonts(): string {
  return readFileSync(path.join(siteDir, 'fonts', 'fonts.css'), 'utf-8').replace(
    /url\('([^']+\.woff2)'\)/g,
    (_match, file: string) =>
      `url('data:font/woff2;base64,${readFileSync(path.join(siteDir, 'fonts', file)).toString('base64')}')`,
  );
}

const inlineData: Record<string, string> = {};
for (const file of readdirSync(editionsDir).filter((name) => name.endsWith('.json'))) {
  inlineData[file] = readFileSync(path.join(editionsDir, file), 'utf-8');
}
if (!inlineData['index.json']) throw new Error('No edition index — run `npm run edition` first.');

const modules = [
  { file: 'config.js', source: readFileSync(path.join(siteDir, 'config.js'), 'utf-8') },
  { file: 'brief.js', source: readFileSync(path.join(briefDir, 'brief.js'), 'utf-8') },
]
  .map(({ file, source }) => `/* ---- ${file} ---- */\n${flatten(source, file)}`)
  .join('\n\n');

const html = readFileSync(path.join(briefDir, 'index.html'), 'utf-8')
  .replace(/\s*<link rel="preload"[^>]*>/g, '')
  .replace('<link rel="stylesheet" href="../fonts/fonts.css">', `<style>\n${inlineFonts()}\n</style>`)
  .replace(
    '<link rel="stylesheet" href="../atlas.css">',
    `<style>\n${readFileSync(path.join(siteDir, 'atlas.css'), 'utf-8')}\n</style>`,
  )
  .replace(
    '<link rel="stylesheet" href="brief.css">',
    `<style>\n${readFileSync(path.join(briefDir, 'brief.css'), 'utf-8')}\n</style>`,
  )
  .replace('<title>The IGRED Brief</title>', '<title>The IGRED Brief — snapshot</title>')
  .replace(
    '<script type="module" src="brief.js"></script>',
    [
      `<script id="inline-editions" type="application/json">${JSON.stringify(inlineData)}</script>`,
      '<script type="module">',
      // No server here, so fetch is redirected to the inlined editions.
      'const EDITIONS = JSON.parse(document.getElementById("inline-editions").textContent);',
      'window.fetch = async (url) => {',
      '  const key = String(url).split("/").pop().split("?")[0];',
      '  if (key in EDITIONS) return new Response(EDITIONS[key], { status: 200 });',
      '  return new Response("{}", { status: 404 });',
      '};',
      modules,
      '</script>',
    ].join('\n'),
  );

const target = path.join(repoRoot, 'design', 'brief-snapshot.html');
writeFileSync(target, html, 'utf-8');
console.log(
  `brief-snapshot.html: ${(html.length / 1024).toFixed(0)} KB, ${Object.keys(inlineData).length - 1} edition(s) inlined`,
);
