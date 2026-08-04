/**
 * The map fetches its data straight from the repository at view time, rather than having it
 * baked in at build time. That is what keeps an hourly data commit from triggering a site
 * rebuild — the page is built once and the JSON underneath it keeps moving.
 *
 * REPO_SLUG must be set once the public repository exists. Until then the page falls back to
 * a relative path, which works when serving the repo locally.
 */
export const CONFIG = {
  repoSlug: 'bridgeerlend/igred-warmap',
  branch: 'main',
  contactEmail: 'map@igred.org',
  briefBaseUrl: 'https://map.igred.org/brief/',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

/**
 * Pages sit at different depths (/site/, /site/brief/, /site/stream/), so the relative
 * fallback has to climb the right number of levels. Derived from the path rather than
 * listed by name: the list was one page out of date the moment a third page was added.
 */
function localDataPath() {
  const parts = location.pathname.split('/').filter(Boolean);
  const site = parts.lastIndexOf('site');
  // Directories below /site/, ignoring a trailing file name.
  const last = parts[parts.length - 1] ?? '';
  const depth = site === -1 ? 0 : parts.length - site - 1 - (last.includes('.') ? 1 : 0);
  return `${'../'.repeat(depth + 1)}data/`;
}

export function dataBaseUrl() {
  const override = new URLSearchParams(location.search).get('data');
  if (override) return override.endsWith('/') ? override : `${override}/`;

  if (LOCAL_HOSTS.has(location.hostname)) return localDataPath();
  if (CONFIG.repoSlug.startsWith('REPLACE_WITH')) return localDataPath();

  return `https://raw.githubusercontent.com/${CONFIG.repoSlug}/${CONFIG.branch}/data/`;
}

export function repoUrl() {
  return CONFIG.repoSlug.startsWith('REPLACE_WITH')
    ? null
    : `https://github.com/${CONFIG.repoSlug}`;
}
