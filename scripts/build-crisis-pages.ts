/**
 * One page per crisis at site/crisis/<id>/, so a crisis can be shared and indexed with its
 * own title, description and Open Graph picture. The content still loads at view time from
 * data/, exactly like the map: the pages are only shells.
 *
 * They change only when the list of crises or their names change — that is, when
 * config/crises.json changes — so this never turns an hourly data commit into a site build.
 * It writes nothing when the pages are already current. Automatic crises, which come and go
 * with the data, are served by the generic page at site/crisis/?id=<id> instead.
 *
 * Run: npx tsx scripts/build-crisis-pages.ts  (--check exits 1 if a page is out of date)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';

interface Crisis { id: string; name: string; nameNb: string; short?: string; region: string }

const SITE = 'https://map.igred.org';
const config = JSON.parse(readFileSync(path.join(repoRoot, 'config/crises.json'), 'utf-8')) as { crises: Crisis[] };
const index = existsSync(path.join(repoRoot, 'data/crises.json'))
  ? (JSON.parse(readFileSync(path.join(repoRoot, 'data/crises.json'), 'utf-8')) as { crises: { id: string; image: { src: string } | null }[] })
  : { crises: [] };
const outDir = path.join(repoRoot, 'site/crisis');
const check = process.argv.includes('--check');

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(c: Crisis | null, depth: number): string {
  const up = '../'.repeat(depth);
  const title = c ? `${c.name} · IGRED Global Conflict Monitor` : 'Crisis · IGRED Global Conflict Monitor';
  const description = c
    ? `${c.name}: the latest reporting, every incident with its sources, the UCDP register and the background. Updated every hour.`
    : 'One crisis: the latest reporting, every incident with its sources, the UCDP register and the background.';
  const url = c ? `${SITE}/crisis/${c.id}/` : `${SITE}/crisis/`;
  // The Commons picture the pipeline chose for this crisis when the page was generated. It is
  // kept until the page is next generated, so a new picture never forces a deploy.
  const existing = c ? path.join(outDir, c.id, 'index.html') : '';
  const kept = existing && existsSync(existing) ? /<meta property="og:image" content="([^"]+)"/.exec(readFileSync(existing, 'utf-8'))?.[1]?.replace(/\?.*$/, '') : undefined;
  const image = kept ?? (c ? index.crises.find((x) => x.id === c.id)?.image?.src : undefined);
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#0B0B0A">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="IGRED Global Conflict Monitor">
<meta property="og:title" content="${esc(c ? c.name : 'Crisis')}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
${image ? `<meta property="og:image" content="${esc(image)}">\n<meta name="twitter:card" content="summary_large_image">\n` : '<meta name="twitter:card" content="summary">\n'}<script>try{if(localStorage.getItem('igred-theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}</script>
<link rel="preload" href="${up}fonts/fraunces-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${up}fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${up}fonts/fonts.css">
<link rel="stylesheet" href="${up}atlas.css">
<link rel="stylesheet" href="${up}vendor/maplibre-gl.css">
<link rel="stylesheet" href="${up}app.css">
<link rel="stylesheet" href="${up}crisis.css">
</head>
<body class="crisis-page"${c ? ` data-crisis="${c.id}"` : ''}>
<div class="banner" id="banner" hidden></div>
<header class="masthead page-masthead">
  <a class="wordmark wordmark-link" href="https://igred.org/"><strong>IGRED</strong></a>
  <nav class="controls">
    <a class="link-button" href="${up}" data-i18n="map">Map</a>
    <a class="link-button" href="${up}brief/" data-i18n="brief">Brief</a>
    <a class="link-button" href="${up}stream/" data-i18n="wire">Wire</a>
    <button type="button" class="link-button" id="lang">NO</button>
  </nav>
</header>
<div class="page-map"><div class="map" id="map" role="region" aria-label="Map"></div></div>
<main class="page-body">
  <p class="page-onmap"><a class="link-button" id="onmap" href="${up}${c ? `#crisis=${c.id}` : ''}" data-i18n="onMap">Open on the map</a></p>
  <section class="detail" id="detail" aria-live="polite"></section>
</main>
<footer class="colophon">
  <p class="colophon-method"><span id="method"></span> <span id="ranking"></span></p>
  <p class="meta"><span id="updated"></span></p>
  <p class="meta"><button type="button" class="link-button quiet" id="theme">Light</button></p>
  <p class="meta"><a href="mailto:contact@igred.org">contact@igred.org</a></p>
</footer>
<script src="${up}vendor/maplibre-gl.js"></script>
<script src="${up}vendor/topojson-client.min.js"></script>
<script type="module" src="${up}crisis.js"></script>
</body>
</html>
`;
}

const wanted = new Map<string, string>([[path.join(outDir, 'index.html'), page(null, 1)]]);
for (const c of config.crises) wanted.set(path.join(outDir, c.id, 'index.html'), page(c, 2));

let changed = 0;
for (const [file, html] of wanted) {
  if (existsSync(file) && readFileSync(file, 'utf-8') === html) continue;
  changed += 1;
  if (check) { console.error(`out of date: ${path.relative(repoRoot, file)}`); continue; }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
}
// A crisis removed from the config loses its page.
for (const entry of readdirSync(outDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || wanted.has(path.join(outDir, entry.name, 'index.html'))) continue;
  changed += 1;
  if (check) { console.error(`stale: site/crisis/${entry.name}/`); continue; }
  rmSync(path.join(outDir, entry.name), { recursive: true });
}
console.log(changed ? `crisis pages: ${changed} ${check ? 'out of date' : 'written'}` : 'crisis pages: already current, nothing written');
if (check && changed) process.exit(1);
