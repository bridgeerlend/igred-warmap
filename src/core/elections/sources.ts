/**
 * The yearly datasets behind the election risk score, downloaded once into
 * data/elections/sources/ with a manifest naming each file's source, licence and edition. A
 * file already there is never downloaded again; a new edition is a new entry in
 * config/elections.json. A source that cannot be downloaded automatically is recorded as
 * skipped, with the reason, and the score weights the other indicators up.
 *
 * The World Bank is read from its API instead, and cached here with the date it was fetched.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fetchJson, fetchText } from '../util/http.js';
import { dataDir } from '../util/paths.js';

export const SOURCES_DIR = path.join(dataDir, 'elections', 'sources');

export interface SourceConfig {
  id: string;
  indicator?: string;
  name: string;
  url?: string;
  page: string;
  file?: string;
  license?: string;
  licenseUrl?: string;
  edition?: string;
  skip?: string;
  nameNb?: string; editionNb?: string; licenseNb?: string; skipNb?: string;
  /** Shown beside the score, never in it. */
  background?: boolean;
  credit?: string;
}

export interface ManifestEntry {
  id: string;
  name: string;
  page: string;
  url?: string;
  file?: string;
  license?: string;
  licenseUrl?: string;
  edition?: string;
  indicator?: string;
  background?: boolean;
  credit?: string;
  nameNb?: string; editionNb?: string; licenseNb?: string; reasonNb?: string;
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  downloadedAt?: string;
  bytes?: number;
  sha256?: string;
}

const manifestFile = path.join(SOURCES_DIR, 'manifest.json');

export function readManifest(): Record<string, ManifestEntry> {
  return existsSync(manifestFile) ? (JSON.parse(readFileSync(manifestFile, 'utf-8')) as { sources: Record<string, ManifestEntry> }).sources : {};
}

/** Freedom House publishes its scores as a page, not a file: the table is kept as CSV. */
function freedomHouseCsv(html: string): string {
  const out = ['country,total,status'];
  for (const [row] of html.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
    const name = /data-code="country_name"[^>]*>([\s\S]*?)<\/td>/.exec(row)?.[1]?.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\*$/, '').trim();
    const cell = /data-code="fiw"[^>]*>([\s\S]*?)<\/td>/.exec(row)?.[1] ?? '';
    const total = /<span class="score">(\d{1,3})<\/span>/.exec(cell)?.[1];
    const status = /class="status[^"]*">([^<]+)</.exec(cell)?.[1]?.trim() ?? '';
    if (name && total) out.push(`"${name.replace(/"/g, '""')}",${total},"${status}"`);
  }
  if (out.length < 100) throw new Error(`only ${out.length - 1} rows in the Freedom House table`);
  return `${out.join('\n')}\n`;
}

/** Downloads every configured file that is not already there. Returns the manifest and a log. */
export async function ensureSources(configs: SourceConfig[], log: (line: string) => void): Promise<Record<string, ManifestEntry>> {
  mkdirSync(SOURCES_DIR, { recursive: true });
  const manifest = readManifest();
  for (const c of configs) {
    const base = { id: c.id, name: c.name, page: c.page, ...(c.url ? { url: c.url } : {}), ...(c.file ? { file: c.file } : {}), ...(c.license ? { license: c.license } : {}), ...(c.licenseUrl ? { licenseUrl: c.licenseUrl } : {}), ...(c.background ? { background: true } : {}), ...(c.credit ? { credit: c.credit } : {}), ...(c.nameNb ? { nameNb: c.nameNb } : {}), ...(c.editionNb ? { editionNb: c.editionNb } : {}), ...(c.licenseNb ? { licenseNb: c.licenseNb } : {}), ...(c.skipNb ? { reasonNb: c.skipNb } : {}), ...(c.edition ? { edition: c.edition } : {}), ...(c.indicator ? { indicator: c.indicator } : {}) };
    if (c.skip) { manifest[c.id] = { ...base, status: 'skipped', reason: c.skip }; continue; }
    const target = path.join(SOURCES_DIR, c.file!);
    // Already here: only the description (licence, link) is brought up to date with the config.
    if (existsSync(target) && manifest[c.id]?.status === 'ok' && manifest[c.id]?.edition === c.edition) { manifest[c.id] = { ...manifest[c.id]!, ...base }; continue; }
    try {
      let body = await fetchText(c.url!, { retries: 2, timeoutMs: 90_000 });
      if (c.id === 'fh') body = freedomHouseCsv(body);
      if (body.length < 500) throw new Error(`only ${body.length} bytes`);
      writeFileSync(target, body);
      manifest[c.id] = { ...base, status: 'ok', downloadedAt: new Date().toISOString(), bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') };
      log(`elections: downloaded ${c.id} (${c.edition}) to data/elections/sources/${c.file}`);
    } catch (error) {
      // Kept if an earlier run got it; otherwise the indicator goes without this source.
      if (!existsSync(target)) manifest[c.id] = { ...base, status: 'failed', reason: (error as Error).message };
      log(`elections: could not download ${c.id}: ${(error as Error).message}`);
    }
  }
  writeFileSync(manifestFile, `${JSON.stringify({ note: 'Every file in this folder, where it came from, its licence and edition. Written by src/core/elections/sources.ts.', sources: manifest }, null, 1)}\n`);
  return manifest;
}

/* ---------- reading the files ------------------------------------------------ */

const read = (file: string) => readFileSync(path.join(SOURCES_DIR, file), 'utf-8');
const has = (manifest: Record<string, ManifestEntry>, id: string) => manifest[id]?.status === 'ok' && !!manifest[id]?.file && existsSync(path.join(SOURCES_DIR, manifest[id]!.file!));

export interface Country { iso2: string; iso3: string; isoNum: string; fips: string; name: string }

/** GeoNames: ISO and FIPS codes for every country, the bridge between GDELT and the datasets. */
export function countries(manifest: Record<string, ManifestEntry>): Country[] {
  if (!has(manifest, 'geonames')) return [];
  return read(manifest.geonames!.file!).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const f = l.split('\t');
    return { iso2: f[0]!, iso3: f[1]!, isoNum: f[2]!, fips: f[3]!, name: f[4]! };
  });
}

/** V-Dem's clean elections index, the latest year for each country. */
export function vdem(manifest: Record<string, ManifestEntry>): Map<string, { value: number; year: number }> {
  const out = new Map<string, { value: number; year: number }>();
  if (!has(manifest, 'vdem')) return out;
  for (const line of read(manifest.vdem!.file!).split('\n').slice(1)) {
    const parts = line.split(',');
    if (parts.length < 4) continue;
    // "entity,code,year,value,region"; an entity name with a comma is quoted.
    const m = /^(?:"[^"]*"|[^,]*),([A-Z]{3}),(\d{4}),([\d.]+)/.exec(line);
    if (!m) continue;
    const year = Number(m[2]); const value = Number(m[3]);
    if (!out.has(m[1]!) || out.get(m[1]!)!.year < year) out.set(m[1]!, { value, year });
  }
  return out;
}

export interface PeiElection { iso3: string; year: number; date: string; office: string; index: number }
/** PEI: the expert index of electoral integrity (0 to 100) for each election it covers. */
export function pei(manifest: Record<string, ManifestEntry>): PeiElection[] {
  if (!has(manifest, 'pei')) return [];
  const lines = read(manifest.pei!.file!).split('\n');
  const head = lines[0]!.split('\t');
  const col = (name: string) => head.indexOf(name);
  const [iIso, iYear, iDate, iOffice, iIndex] = [col('ISO'), col('year'), col('date'), col('office'), col('PEI_add_original')];
  const unq = (v: string | undefined) => (v ?? '').replace(/^"|"$/g, '');
  return lines.slice(1).map((l) => l.split('\t')).filter((f) => f.length > iIndex && f[iIndex] && f[iIndex] !== 'NA').map((f) => ({
    iso3: unq(f[iIso]), year: Math.round(Number(f[iYear])), date: unq(f[iDate]), office: unq(f[iOffice]), index: Number(f[iIndex]),
  })).filter((e) => e.iso3 && Number.isFinite(e.index));
}

/** RSF: the World Press Freedom Index score (0 to 100, higher is freer). */
export function rsf(manifest: Record<string, ManifestEntry>): Map<string, number> {
  const out = new Map<string, number>();
  if (!has(manifest, 'rsf')) return out;
  const lines = read(manifest.rsf!.file!).split(/\r?\n/);
  const head = lines[0]!.split(';');
  const iIso = head.indexOf('ISO'); const iScore = head.findIndex((h) => /^Score \d{4}$/.test(h));
  for (const l of lines.slice(1)) {
    const f = l.split(';');
    const v = Number((f[iScore] ?? '').replace(',', '.'));
    if (f[iIso] && Number.isFinite(v) && f[iScore]) out.set(f[iIso]!, v);
  }
  return out;
}

/** Freedom House: the global freedom score (0 to 100, higher is freer), by country name. */
export function freedomHouse(manifest: Record<string, ManifestEntry>): Map<string, number> {
  const out = new Map<string, number>();
  if (!has(manifest, 'fh')) return out;
  for (const l of read(manifest.fh!.file!).split('\n').slice(1)) {
    const m = /^"((?:[^"]|"")*)",(\d+),/.exec(l);
    if (m) out.set(m[1]!.replace(/""/g, '"'), Number(m[2]));
  }
  return out;
}

/* ---------- the World Bank, from its API ----------------------------------------- */

export const WB = {
  gdpPerPerson: 'NY.GDP.PCAP.CD',
  debt: 'GC.DOD.TOTL.GD.ZS',
  population: 'SP.POP.TOTL',
  exchangeRate: 'PA.NUS.FCRF',
} as const;

export type WorldBankSeries = Record<string, Record<string, { year: number; value: number }[]>>;
const wbFile = path.join(SOURCES_DIR, 'worldbank.json');

/** Latest values for every country, and six years of exchange rates for the currency trend. Refreshed monthly. */
export async function worldBankAll(log: (line: string) => void, offline = false): Promise<{ fetchedAt: string | null; series: WorldBankSeries }> {
  const cached = existsSync(wbFile) ? JSON.parse(readFileSync(wbFile, 'utf-8')) as { fetchedAt: string; series: WorldBankSeries } : null;
  if (offline || (cached && Date.now() - Date.parse(cached.fetchedAt) < 30 * 86_400_000)) return cached ?? { fetchedAt: null, series: {} };
  const series: WorldBankSeries = cached?.series ?? {};
  const thisYear = new Date().getUTCFullYear();
  let ok = 0;
  for (const id of Object.values(WB)) {
    const range = id === WB.exchangeRate ? `date=${thisYear - 7}:${thisYear}` : 'mrnev=1';
    try {
      const data = await fetchJson<[unknown, { countryiso3code?: string; date?: string; value?: number | null }[] | null]>(
        `https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&${range}&per_page=3000`, { retries: 2, timeoutMs: 90_000 },
      );
      const byCountry: Record<string, { year: number; value: number }[]> = {};
      for (const row of data?.[1] ?? []) {
        if (row.value === null || row.value === undefined || !row.countryiso3code) continue;
        (byCountry[row.countryiso3code] ??= []).push({ year: Number(row.date), value: row.value });
      }
      for (const list of Object.values(byCountry)) list.sort((a, b) => a.year - b.year);
      series[id] = byCountry;
      ok += 1;
    } catch (error) {
      log(`elections: World Bank ${id} not fetched (${(error as Error).message}); the cache stands`);
    }
  }
  const out = { fetchedAt: ok ? new Date().toISOString() : (cached?.fetchedAt ?? null), series };
  if (ok) { mkdirSync(SOURCES_DIR, { recursive: true }); writeFileSync(wbFile, `${JSON.stringify(out)}\n`); }
  return out;
}
