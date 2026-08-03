/**
 * The map fetches its data straight from the repository at view time, rather than having it
 * baked in at build time. That is what keeps an hourly data commit from triggering a site
 * rebuild — the page is built once and the JSON underneath it keeps moving.
 *
 * REPO_SLUG must be set once the public repository exists. Until then the page falls back to
 * a relative path, which works when serving the repo locally.
 */
export const CONFIG = {
  repoSlug: 'REPLACE_WITH/igred-warmap',
  branch: 'main',
  contactEmail: 'map@igred.org',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

export function dataBaseUrl() {
  const override = new URLSearchParams(location.search).get('data');
  if (override) return override.endsWith('/') ? override : `${override}/`;

  if (LOCAL_HOSTS.has(location.hostname)) return '../data/';
  if (CONFIG.repoSlug.startsWith('REPLACE_WITH')) return '../data/';

  return `https://raw.githubusercontent.com/${CONFIG.repoSlug}/${CONFIG.branch}/data/`;
}

export function repoUrl() {
  return CONFIG.repoSlug.startsWith('REPLACE_WITH')
    ? null
    : `https://github.com/${CONFIG.repoSlug}`;
}
