/**
 * Puts the brand in config/brand.json on every page. The build scripts (crisis pages,
 * reports and their PDFs, the RSS feeds, the election data) read the file themselves; this
 * does the rest:
 *
 *   - writes site/brand.js and www/brand.js, which the pages' scripts import;
 *   - rewrites the static pages (titles, Open Graph, the header mark, the text that names us)
 *     from the brand last applied to the current one;
 *   - redraws the header mark everywhere and the icons when the favicon changed;
 *   - regenerates the crisis pages.
 *
 * A rename is an edit to config/brand.json and `npm run brand`. `--check` changes nothing and
 * exits 1 if any page is behind the config, which the tests run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND, faviconSvg, markSvg, type Brand } from '../src/core/brand.js';
import { repoRoot } from '../src/core/util/paths.js';

const check = process.argv.includes('--check');
const rel = (p: string) => path.join(repoRoot, p);

function moduleSource(b: Brand): string {
  return `// Written by scripts/apply-brand.ts from config/brand.json. Edit that file and run \`npm run brand\`.\nexport const BRAND = ${JSON.stringify(b, null, 2)};\n`;
}
function previousBrand(): Brand {
  const file = rel('site/brand.js');
  if (!existsSync(file)) return BRAND;
  return JSON.parse(/export const BRAND = ([\s\S]*);\s*$/.exec(readFileSync(file, 'utf-8'))![1]!) as Brand;
}

/** The static pages and files that carry the name: everything a build script does not write. */
function staticFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, skip: (p: string) => boolean) => {
    for (const name of readdirSync(rel(dir))) {
      const p = path.join(dir, name);
      if (skip(p)) continue;
      if (statSync(rel(p)).isDirectory()) walk(p, skip);
      else if (/\.(html|webmanifest)$/.test(name)) out.push(p);
    }
  };
  walk('site', (p) => /^site\/(crisis|vendor|feed|fonts)(\/|$)/.test(p));
  walk('www', (p) => /^www\/(reports|content|fonts)(\/|$)/.test(p));
  out.push('config/brief.json', 'docs/rapporter-oppsett.md');
  return out;
}

/** The old brand's words to the new one's, longest first so a product name goes before the short name. */
function replacements(from: Brand, to: Brand): [RegExp, string][] {
  const pairs: [string, string][] = [
    [from.products.monitor, to.products.monitor], [from.products.brief, to.products.brief], [from.products.reports, to.products.reports],
    [from.verified.en, to.verified.en], [from.verified.nb, to.verified.nb], [from.editorial, to.editorial],
    [from.tagline.en, to.tagline.en], [from.tagline.nb, to.tagline.nb], [from.name, to.name], [from.short, to.short],
  ];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return pairs.filter(([a, b]) => a !== b).sort((x, y) => y[0].length - x[0].length)
    .map(([a, b]) => [new RegExp(`(?<![\\p{L}])${esc(a)}(?![\\p{L}])`, 'gu'), b]);
}

const prev = previousBrand();
const subs = replacements(prev, BRAND);
const mark = markSvg();
const pending: string[] = [];
const write = (p: string, body: string) => {
  const file = rel(p);
  if (existsSync(file) && readFileSync(file, 'utf-8') === body) return;
  pending.push(p);
  if (!check) writeFileSync(file, body);
};

for (const p of ['site/brand.js', 'www/brand.js']) write(p, moduleSource(BRAND));
for (const p of staticFiles()) {
  let body = readFileSync(rel(p), 'utf-8');
  for (const [re, to] of subs) body = body.replace(re, to);
  body = body.replace(/<svg class="brand-mark"[\s\S]*?<\/svg>/g, mark);
  write(p, body);
}
const iconsBehind = readFileSync(rel('site/favicon.svg'), 'utf-8') !== faviconSvg() || readFileSync(rel('www/favicon.svg'), 'utf-8') !== faviconSvg();
if (iconsBehind) pending.push('icons');

if (check) {
  const crisis = (() => { try { execFileSync('npx', ['tsx', 'scripts/build-crisis-pages.ts', '--check'], { cwd: repoRoot, stdio: 'pipe' }); return true; } catch { return false; } })();
  if (!crisis) pending.push('site/crisis/');
  if (pending.length) { console.error(`brand: behind config/brand.json: ${pending.join(', ')}`); process.exit(1); }
  console.log('brand: every page matches config/brand.json');
} else {
  if (iconsBehind) { const { writeIcons } = await import('./build-icons.js'); await writeIcons(); }
  execFileSync('npx', ['tsx', 'scripts/build-crisis-pages.ts'], { cwd: repoRoot, stdio: 'inherit' });
  console.log(pending.length ? `brand: updated ${pending.join(', ')}` : 'brand: already current');
}
