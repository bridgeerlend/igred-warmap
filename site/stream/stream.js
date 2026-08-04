/**
 * The Wire — everything the institute has fetched, newest first.
 *
 * No new pipeline and no new artifact. The map publishes the provenance behind every
 * incident and the Brief publishes the articles behind every story; both are already on the
 * CDN, so the wire is those two files merged, deduplicated by URL and sorted by date. That
 * keeps the ingest surface exactly as it was and means the stream can never disagree with
 * the products it is drawn from.
 *
 * Nothing here is written by a model, and nothing is shown without an outlet, a date and a
 * link. Outlets are named in plain text: a masthead is a trademark.
 */
import { dataBaseUrl, repoUrl, CONFIG } from '../config.js';

const PAGE = 60;

const STRINGS = {
  en: {
    wordmark: 'The Wire',
    titleLine1: 'The', titleLine2: 'Wire',
    standfirst: (n, outlets) =>
      `<b>${n}</b> ${n === 1 ? 'dispatch' : 'dispatches'} from <b>${outlets}</b> ${outlets === 1 ? 'outlet' : 'outlets'}, newest first. Every line is something an outlet published, with a link to it. <span class="quiet">Nothing here is written by us.</span>`,
    standfirstEmpty: 'Nothing has been fetched yet.',
    searchLabel: 'Search the wire',
    searchPlaceholder: 'Search a place, an outlet, a headline…',
    all: 'Everything', fromMap: 'Behind an incident', fromBrief: 'Behind a story',
    more: 'Older', end: 'That is everything the published data holds.',
    noResults: 'Nothing matches that.',
    errorTitle: 'The wire could not be loaded.',
    errorBody: (url) => `Tried <code>${url}</code>. The page shows nothing rather than showing something unsourced.`,
    colophon:
      'Every line on this page was fetched from the outlet that published it and is shown with its name in plain text — never a masthead, which is a trademark. Incidents come from the news stream behind the map; stories come from The IGRED Brief. Both are clustered by this project without any language model. Full history is kept in the repository; older data is available on request at',
    updated: 'Data updated',
    today: 'Today', yesterday: 'Yesterday',
    incidentAt: (place) => `Incident at ${place}`,
    firstSeen: 'first logged',
  },
  nb: {
    wordmark: 'The Wire',
    titleLine1: 'The', titleLine2: 'Wire',
    standfirst: (n, outlets) =>
      `<b>${n}</b> ${n === 1 ? 'melding' : 'meldinger'} fra <b>${outlets}</b> ${outlets === 1 ? 'kilde' : 'kilder'}, nyeste først. Hver linje er noe en redaksjon har publisert, med lenke til det. <span class="quiet">Ingenting her er skrevet av oss.</span>`,
    standfirstEmpty: 'Ingenting er hentet inn ennå.',
    searchLabel: 'Søk i strømmen',
    searchPlaceholder: 'Søk et sted, en kilde, en overskrift …',
    all: 'Alt', fromMap: 'Bak en hendelse', fromBrief: 'Bak en sak',
    more: 'Eldre', end: 'Det er alt de publiserte dataene inneholder.',
    noResults: 'Ingen treff.',
    errorTitle: 'Strømmen kunne ikke lastes.',
    errorBody: (url) => `Forsøkte <code>${url}</code>. Siden viser heller ingenting enn noe ukildebelagt.`,
    colophon:
      'Hver linje på denne siden er hentet fra redaksjonen som publiserte den, og vises med navnet i ren tekst — aldri en avislogo, som er et varemerke. Hendelsene kommer fra nyhetsstrømmen bak kartet; sakene kommer fra The IGRED Brief. Begge er gruppert av dette prosjektet uten noen språkmodell. Full historikk ligger i repoet; eldre data fås ved henvendelse til',
    updated: 'Data oppdatert',
    today: 'I dag', yesterday: 'I går',
    incidentAt: (place) => `Hendelse ved ${place}`,
    firstSeen: 'først loggført',
  },
};

const state = {
  lang: 'en',
  items: [],
  filter: 'all',
  shown: PAGE,
  generatedAt: null,
};

const $ = (id) => document.getElementById(id);
const t = () => STRINGS[state.lang];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function loadJson(base, file) {
  const response = await fetch(`${base}${file}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}

/**
 * One line on the wire.
 *
 * A provenance row on an incident carries no headline — GDELT gives a URL and an outlet, not
 * a title — so the incident's own place stands in, labelled as such rather than dressed up
 * as a headline nobody wrote.
 */
function itemsFromEvents(payload) {
  return (payload.events ?? []).flatMap((event) =>
    event.provenance.map((entry) => ({
      url: entry.url,
      outlet: entry.publisher ?? entry.sourceName,
      at: entry.publishedAt ?? entry.retrievedAt ?? event.occurredAt,
      /*
       * GDELT's timestamp is `dateAdded` — the quarter-hour in which the aggregator first
       * logged the story, not the minute the outlet published it. Close, but not the same
       * claim, so it does not get a publication clock in the margin; it is named for what
       * it is instead. Every one of the 204 live rows is one of twenty such buckets.
       */
      dated: entry.sourceId === 'gdelt' ? 'seen' : 'published',
      kind: 'map',
      place: event.location.name,
      headline: null,
    })),
  );
}

function itemsFromStories(payload) {
  return (payload.stories ?? []).flatMap((story) =>
    story.articles.map((article) => ({
      url: article.url,
      outlet: article.publisher,
      at: article.publishedAt ?? story.lastSeenAt,
      // A feed's own pubDate is a publication time, so this one stands.
      dated: article.publishedAt ? 'published' : 'seen',
      kind: 'brief',
      place: story.countries.map((country) => country.name).join(', ') || null,
      headline: article.title,
    })),
  );
}

/** Newest first, one line per URL. The same article can back both an incident and a story. */
function merge(lists) {
  const byUrl = new Map();
  for (const item of lists.flat()) {
    if (!item.url || !item.outlet) continue;
    const existing = byUrl.get(item.url);
    // A story article carries a real headline, so it wins over a bare provenance row.
    if (!existing || (!existing.headline && item.headline)) byUrl.set(item.url, item);
  }
  return [...byUrl.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function matching() {
  const query = $('search').value.trim().toLowerCase();
  const words = query.split(/\s+/).filter(Boolean);
  return state.items.filter((item) => {
    if (state.filter === 'map' && item.kind !== 'map') return false;
    if (state.filter === 'brief' && item.kind !== 'brief') return false;
    if (words.length === 0) return true;
    const haystack = `${item.headline ?? ''} ${item.outlet} ${item.place ?? ''}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** A date heading only where the day changes, so the column stays a column. */
function dayLabel(iso) {
  const day = String(iso).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (day === today) return t().today;
  if (day === yesterday) return t().yesterday;
  return day;
}

const clockOf = (iso) => (String(iso).length > 10 ? String(iso).slice(11, 16) : '');

function renderFeed() {
  const feed = $('feed');
  const results = matching();
  const page = results.slice(0, state.shown);

  if (results.length === 0) {
    feed.innerHTML = `<li class="none">${escapeHtml(t().noResults)}</li>`;
    $('more').hidden = true;
    $('feed-end').hidden = true;
    return;
  }

  let lastDay = null;
  feed.innerHTML = page.map((item) => {
    const day = String(item.at).slice(0, 10);
    const heading = day === lastDay ? '' : `<li class="day"><span>${escapeHtml(dayLabel(item.at))}</span></li>`;
    lastDay = day;
    const time = item.dated === 'published' ? clockOf(item.at) : '';
    return heading +
      `<li class="line">` +
        `<span class="line-time">${escapeHtml(time)}</span>` +
        `<span class="line-body">` +
          `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">` +
            `${escapeHtml(item.headline ?? t().incidentAt(item.place ?? ''))}</a>` +
          `<span class="line-meta">${escapeHtml(item.outlet)}` +
            (item.headline && item.place ? ` · ${escapeHtml(item.place)}` : '') +
            (item.dated === 'seen' ? ` · ${escapeHtml(t().firstSeen)} ${escapeHtml(clockOf(item.at) || String(item.at).slice(0, 10))}` : '') +
          `</span>` +
        `</span>` +
      `</li>`;
  }).join('');

  const remaining = results.length - page.length;
  $('more').hidden = remaining <= 0;
  $('more').textContent = `${t().more} (${remaining})`;
  $('feed-end').hidden = remaining > 0;
  $('feed-end').textContent = t().end;
}

function renderFilters() {
  const nav = $('filters');
  const counts = {
    all: state.items.length,
    map: state.items.filter((item) => item.kind === 'map').length,
    brief: state.items.filter((item) => item.kind === 'brief').length,
  };
  const option = (key, label) =>
    `<button type="button" class="wire-filter${state.filter === key ? ' is-on' : ''}" data-filter="${key}">` +
    `${escapeHtml(label)}<span class="count">${counts[key]}</span></button>`;

  nav.innerHTML = option('all', t().all) + option('map', t().fromMap) + option('brief', t().fromBrief);
  for (const button of nav.querySelectorAll('.wire-filter')) {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      state.shown = PAGE;
      renderFilters();
      renderFeed();
    });
  }
}

function renderStandfirst() {
  const outlets = new Set(state.items.map((item) => item.outlet)).size;
  $('standfirst').innerHTML = state.items.length === 0
    ? `<span class="quiet">${escapeHtml(t().standfirstEmpty)}</span>`
    : t().standfirst(state.items.length, outlets);
}

function renderColophon() {
  const repo = repoUrl();
  $('colophon-text').innerHTML =
    `${escapeHtml(t().colophon)} <a href="mailto:${escapeHtml(CONFIG.contactEmail)}">${escapeHtml(CONFIG.contactEmail)}</a>.` +
    (repo ? ` <a href="${escapeHtml(repo)}" target="_blank" rel="noopener">Source</a>.` : '');
  const updated = state.generatedAt
    ? `${new Date(state.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : '—';
  $('colophon-meta').textContent = `${t().updated}: ${updated}`;
}

function showBanner(title, body) {
  const banner = $('banner');
  banner.innerHTML = `<strong>${escapeHtml(title)}</strong> <span>${body}</span>`;
  banner.hidden = false;
}

function applyStaticStrings() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = t()[node.dataset.i18n];
    if (typeof value === 'string') node.textContent = value;
  }
  $('search').placeholder = t().searchPlaceholder;
  document.documentElement.lang = state.lang;
  $('lang').textContent = state.lang === 'en' ? 'NO' : 'EN';
  $('lang').setAttribute('aria-label', state.lang === 'en' ? 'Bytt til norsk' : 'Switch to English');
}

function refresh() {
  applyStaticStrings();
  renderStandfirst();
  renderFilters();
  renderFeed();
  renderColophon();
}

async function load() {
  const base = dataBaseUrl();
  // Either file alone still makes a wire, so they are settled independently rather than
  // letting one outage take the page down with it.
  const [events, stories] = await Promise.all([
    loadJson(base, 'events.json').catch(() => null),
    loadJson(base, 'stories.json').catch(() => null),
  ]);
  if (!events && !stories) throw new Error('neither events.json nor stories.json could be read');

  state.items = merge([
    events ? itemsFromEvents(events) : [],
    stories ? itemsFromStories(stories) : [],
  ]);
  state.generatedAt = events?.generatedAt ?? stories?.generatedAt ?? null;
}

function wire() {
  $('search').addEventListener('input', () => {
    state.shown = PAGE;
    renderFeed();
  });
  $('search').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('search').value = '';
      renderFeed();
    }
  });
  $('more').addEventListener('click', () => {
    state.shown += PAGE;
    renderFeed();
  });

  const stored = localStorage.getItem('igred-lang');
  if (stored === 'nb' || stored === 'en') state.lang = stored;
  $('lang').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'nb' : 'en';
    localStorage.setItem('igred-lang', state.lang);
    refresh();
  });

  const root = document.documentElement;
  const theme = localStorage.getItem('igred-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = theme ?? (prefersDark ? 'dark' : 'light');
  const syncTheme = () => { $('theme').textContent = root.dataset.theme === 'dark' ? 'Light' : 'Dark'; };
  syncTheme();
  $('theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('igred-theme', root.dataset.theme);
    syncTheme();
  });
}

async function boot() {
  wire();
  applyStaticStrings();
  try {
    await load();
  } catch (error) {
    showBanner(t().errorTitle, t().errorBody(escapeHtml(dataBaseUrl())));
    console.error(error);
  }
  // Guarded like the fetch: a crash while drawing should say so, not leave a blank column.
  try {
    refresh();
  } catch (error) {
    showBanner(t().errorTitle, t().errorBody(escapeHtml(dataBaseUrl())));
    console.error(error);
  }
}

boot();
