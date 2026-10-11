/**
 * Looks up a cover and a catalogue page for every work in www/knowledge.json on Open
 * Library, once, and writes them into the file. The page then shows the covers without
 * asking anyone at view time. Works already carrying a cover are left alone; a work Open
 * Library does not know keeps its typographic cover.
 *
 * Run: npx tsx scripts/knowledge-covers.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../src/core/util/paths.js';

interface Work { title: string; author?: string; year?: number; cover?: string; url?: string; [k: string]: unknown }
const file = path.join(repoRoot, 'www/knowledge.json');
const data = JSON.parse(readFileSync(file, 'utf-8')) as { works: Work[] } & Record<string, unknown>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The first named author, without "(eds.)" or "et al.", which search does not understand. */
const firstAuthor = (a?: string) => (a ?? '').replace(/\(eds?\.\)/g, '').split(/,| and | et al\./)[0]!.trim();
const shortTitle = (t: string) => t.split(':')[0]!.replace(/[?]/g, '').trim();

let found = 0;
for (const w of data.works) {
  if (w.cover) continue;
  const params = new URLSearchParams({ title: shortTitle(w.title), limit: '5', fields: 'key,cover_i,title,author_name,first_publish_year' });
  const author = firstAuthor(w.author);
  if (author) params.set('author', author.split(' ').slice(-1)[0]!);
  try {
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: { 'user-agent': 'IGRED knowledge base (contact@igred.org)' } });
    const json = (await res.json()) as { docs?: { key?: string; cover_i?: number; first_publish_year?: number }[] };
    const doc = (json.docs ?? []).find((d) => d.cover_i) ?? json.docs?.[0];
    if (doc?.key && !w.url) w.url = `https://openlibrary.org${doc.key}`;
    if (doc?.cover_i) { w.cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`; found += 1; }
  } catch {
    // keeps its typographic cover
  }
  await sleep(350);
}
data.$coversNote = 'Covers and catalogue links from Open Library (openlibrary.org), looked up once by scripts/knowledge-covers.ts.';
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
console.log(`covers: ${found} found, ${data.works.filter((w) => !w.cover).length} without`);
