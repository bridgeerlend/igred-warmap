export const USER_AGENT =
  'IGRED-Global-Conflict-Monitor/0.1 (+https://map.igred.org; map@igred.org)';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodySnippet: string,
  ) {
    super(`HTTP ${status} for ${url}: ${bodySnippet.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Status codes that should not be retried, because retrying cannot help. */
  noRetryStatuses?: number[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string, options: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT, ...options.headers },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(url: string, options: FetchOptions): Promise<Response> {
  const retries = options.retries ?? 3;
  const noRetry = new Set(options.noRetryStatuses ?? [400, 401, 403, 404, 410]);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    try {
      const response = await fetchOnce(url, options);
      if (response.ok) return response;
      const snippet = await response.text().catch(() => '');
      const error = new HttpError(response.status, url, snippet);
      if (noRetry.has(response.status)) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof HttpError && noRetry.has(error.status)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  return (await withRetry(url, options)).text();
}

export async function fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
  const response = await withRetry(url, {
    ...options,
    headers: { accept: 'application/json', ...options.headers },
  });
  return (await response.json()) as T;
}

export async function fetchBinary(url: string, options: FetchOptions = {}): Promise<Uint8Array> {
  const response = await withRetry(url, options);
  return new Uint8Array(await response.arrayBuffer());
}
