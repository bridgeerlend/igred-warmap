/**
 * The brand, from config/brand.json: the name, tagline, product names and the mark. Build
 * scripts, feeds and PDFs import it from here; the pages get the same values through the
 * brand.js modules that `npm run brand` writes from the same file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configDir } from './util/paths.js';

export interface Brand {
  name: string;
  short: string;
  tagline: { en: string; nb: string };
  products: { monitor: string; brief: string; reports: string };
  verified: { en: string; nb: string };
  editorial: string;
  filePrefix: string;
  mark: { accent: string; light: string; dark: string; viewBox: string; accentPath: string; stonePaths: string[] };
  favicon: { viewBox: string; background: string; radius: number; accentPath: string; stonePaths: string[] };
}

export function loadBrand(): Brand {
  const raw = JSON.parse(readFileSync(path.join(configDir, 'brand.json'), 'utf-8')) as Record<string, unknown>;
  const strip = (v: unknown): unknown => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, strip(x)])) : v);
  return strip(raw) as Brand;
}

export const BRAND = loadBrand();

/** The mark for a page header: the light stones in currentColor, the accent stone fixed. */
export function markSvg(b: Brand = BRAND): string {
  const m = b.mark;
  return `<svg class="brand-mark" viewBox="${m.viewBox}" aria-hidden="true" focusable="false">`
    + `<path d="${m.accentPath}" fill="${m.accent}"/>`
    + m.stonePaths.map((d) => `<path d="${d}" fill="currentColor"/>`).join('')
    + '</svg>';
}

/** The mark and the name, linked: one line where there is room, two beside the mark where not. */
export function brandLink(href: string, b: Brand = BRAND, extra = ''): string {
  return `<a class="wordmark wordmark-link brand" href="${href}" aria-label="${b.name}">${markSvg(b)}<strong>${b.name}</strong>${extra}</a>`;
}

/** The favicon, a complete SVG document. */
export function faviconSvg(b: Brand = BRAND): string {
  const f = b.favicon;
  const [x, y, w, h] = f.viewBox.split(' ').map(Number);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f.viewBox}"><title>${b.name}</title>`
    + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${f.radius}" fill="${f.background}"/>`
    + `<path d="${f.accentPath}" fill="${b.mark.accent}"/>`
    + f.stonePaths.map((d) => `<path d="${d}" fill="${b.mark.light}"/>`).join('')
    + '</svg>\n';
}
