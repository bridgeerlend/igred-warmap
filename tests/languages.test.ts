/**
 * Every page in both languages: loaded in a browser with the reader's choice set, the fixed
 * texts of the page (menu, buttons, labels, headings, notes, footer) must be in that language.
 * Content is left alone: news headlines, report text and anything marked with its own lang.
 */
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { repoRoot } from '../src/core/util/paths.js';

const PAGES = ['/site/', '/site/crisis/sudan/', '/site/metode/', '/site/valg/', '/site/brief/', '/site/stream/'];

/** Words that give a fixed text away as the other language. Whole words, case as written. */
const TELLS = {
  nb: ['Map', 'Method', 'Elections', 'Reports', 'Light', 'Dark', 'Menu', 'Skip to', 'Sources', 'Updated', 'Data updated', 'Search', 'Play', 'Reset', 'English only', 'Read more', 'Open on the map', 'incidents', 'Coming up', 'Recently held', 'Background', 'Source'],
  en: ['Kart', 'Metode', 'Valg', 'Rapporter', 'Lys', 'Mørk', 'Meny', 'Hopp til', 'Kilder', 'oppdatert', 'Søk', 'Spill av', 'Nullstill', 'Kun på engelsk', 'Les mer', 'Åpne på kartet', 'hendelser', 'Kommende', 'Nylig holdt', 'Bakgrunn', 'Kildekode'],
} as const;

/** The page's own words: chrome and labels, not the news or any text marked with its own language. */
const SCAN = `(() => {
  const own = document.documentElement.lang;
  const sel = 'header, nav, footer, .colophon, button, label, th, h1, h2, .meta, [data-i18n], .legend, .mapfilter, .skip, .standfirst';
  const skip = (el) => el.closest('[lang]:not(html)')?.getAttribute('lang') && el.closest('[lang]:not(html)').getAttribute('lang') !== own
    || el.closest('.cv-news, .cv-headlines, .wire-list, .line, .story, .stories, .cv-bg, .pop, .vote-why, .vote-result, .cv-summary, .cv-machine-text');
  const out = new Set();
  for (const el of document.querySelectorAll(sel)) {
    if (skip(el)) continue;
    const clone = el.cloneNode(true);
    for (const c of clone.querySelectorAll('[lang]')) if (c.getAttribute('lang') !== own) c.remove();
    const text = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) out.add(text);
  }
  return [...out].join(' | ');
})()`;

let server: Server;
let browser: Browser | null = null;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let file = path.join(repoRoot, decodeURIComponent((req.url ?? '/').split('?')[0]!));
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(repoRoot) || !existsSync(file)) { res.writeHead(404).end(); return; }
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => { await browser?.close(); server?.close(); });

describe('every page speaks the reader\'s language', () => {
  for (const lang of ['nb', 'en'] as const) {
    for (const page of PAGES) {
      it(`${page} in ${lang === 'nb' ? 'Norwegian' : 'English'}`, async () => {
        const ctx = await browser!.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addInitScript((l) => { try { localStorage.setItem('igred-lang', l); } catch { /* none */ } }, lang);
        const p = await ctx.newPage();
        await p.goto(`${base}${page}`, { waitUntil: 'load' });
        await p.waitForTimeout(1500);
        expect(await p.evaluate('document.documentElement.lang')).toBe(lang);
        const text = await p.evaluate(SCAN) as string;
        await ctx.close();
        const found = TELLS[lang].filter((w) => new RegExp(`(?<![\\p{L}])${w}(?![\\p{L}])`, 'u').test(text));
        expect(found, `${page} (${lang}) shows: ${found.join(', ')}\n${text.slice(0, 1200)}`).toEqual([]);
      }, 30_000);
    }
  }
});
