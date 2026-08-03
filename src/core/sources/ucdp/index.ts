import type { Conflict } from '../../schema/conflict.js';
import type { CountryResolver } from '../../util/country.js';
import { fetchUcdpDataset, readToken } from './client.js';
import { mapUcdpRows, type UcdpDataset } from './map.js';

export interface UcdpOptions {
  apiVersion: string;
  pageSize: number;
  maxPages: number;
  activeSinceYear: number;
  datasets: UcdpDataset[];
}

export interface UcdpHarvest {
  conflicts: Conflict[];
  rowsFetched: number;
  rowsSkipped: number;
  unresolvedCountries: string[];
  truncatedDatasets: string[];
}

export async function harvestUcdp(
  options: UcdpOptions,
  resolver: CountryResolver,
  envVar: string,
  retrievedAt: string,
): Promise<UcdpHarvest> {
  const token = readToken(envVar);
  const conflicts: Conflict[] = [];
  const unresolved = new Set<string>();
  const truncatedDatasets: string[] = [];
  let rowsFetched = 0;
  let rowsSkipped = 0;

  for (const dataset of options.datasets) {
    const result = await fetchUcdpDataset(
      {
        dataset,
        apiVersion: options.apiVersion,
        pageSize: options.pageSize,
        maxPages: options.maxPages,
      },
      token,
    );
    if (result.truncated) truncatedDatasets.push(dataset);
    rowsFetched += result.rows.length;

    const mapped = mapUcdpRows(
      dataset,
      result.rows,
      result.requestUrls[0] as string,
      resolver,
      retrievedAt,
      options.activeSinceYear,
    );
    conflicts.push(...mapped.conflicts);
    rowsSkipped += mapped.skippedRows;
    for (const name of mapped.unresolvedCountries) unresolved.add(name);

    if (result.rows.length > 0 && mapped.conflicts.length === 0) {
      throw new Error(
        `UCDP ${dataset} returned ${result.rows.length} rows but none could be mapped — the dataset shape has changed.`,
      );
    }
  }

  return {
    conflicts,
    rowsFetched,
    rowsSkipped,
    unresolvedCountries: [...unresolved].sort(),
    truncatedDatasets,
  };
}
