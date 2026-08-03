import { z } from 'zod';
import { fetchJson } from '../../util/http.js';
import { ConfigurationError } from '../../pipeline/errors.js';

const BASE_URL = 'https://ucdpapi.pcr.uu.se/api';

export class UcdpCredentialMissing extends ConfigurationError {
  constructor() {
    super(
      'UCDP_ACCESS_TOKEN is not set. Request a free token at https://ucdp.uu.se/apidocs/ and add it as a repository secret.',
    );
    this.name = 'UcdpCredentialMissing';
  }
}

/**
 * Only the envelope is pinned. Records stay permissive because UCDP adds columns between
 * dataset versions, and an added column must not take the pipeline down.
 */
const page = z.object({
  TotalCount: z.number().optional(),
  TotalPages: z.number().optional(),
  NextPageUrl: z.string().optional(),
  Result: z.array(z.record(z.string(), z.unknown())),
});

export interface UcdpQuery {
  dataset: string;
  apiVersion: string;
  pageSize: number;
  maxPages: number;
}

export interface UcdpFetchResult {
  dataset: string;
  requestUrls: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}

export async function fetchUcdpDataset(query: UcdpQuery, token: string): Promise<UcdpFetchResult> {
  const rows: Record<string, unknown>[] = [];
  const requestUrls: string[] = [];
  let truncated = false;

  for (let pageIndex = 0; pageIndex < query.maxPages; pageIndex++) {
    const url = `${BASE_URL}/${query.dataset}/${query.apiVersion}?pagesize=${query.pageSize}&page=${pageIndex}`;
    requestUrls.push(url);

    const payload = await fetchJson(url, {
      timeoutMs: 45_000,
      headers: { 'x-ucdp-access-token': token },
    });

    const parsed = page.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `UCDP ${query.dataset} returned an unexpected envelope: ${JSON.stringify(parsed.error.issues).slice(0, 300)}`,
      );
    }

    rows.push(...parsed.data.Result);
    if (parsed.data.Result.length < query.pageSize) return { dataset: query.dataset, requestUrls, rows, truncated };
    if (pageIndex === query.maxPages - 1) truncated = true;
  }

  return { dataset: query.dataset, requestUrls, rows, truncated };
}

export function readToken(envVar: string): string {
  const token = process.env[envVar]?.trim();
  if (!token) throw new UcdpCredentialMissing();
  return token;
}
