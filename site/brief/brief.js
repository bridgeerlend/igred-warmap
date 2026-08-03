/**
 * The IGRED Brief — one dated edition each morning.
 *
 * An edition is fetched at view time, like the map's data, so publishing one never rebuilds
 * the site. Editions are immutable once written: the URL you cite today shows the same words
 * next year.
 *
 * Nothing on this page is authored by us except the chrome. Headlines are the publishers'
 * own, carried verbatim and attributed. Where a drafted paragraph appears it is labelled as
 * such and appears only because a human approved it.
 */
import { dataBaseUrl, repoUrl, CONFIG } from '../config.js';

const STRINGS = {
  en: {
    archive: 'Earlier editions',
    stories: (n) => `${n} ${n === 1 ? 'story' : 'stories'}`,
    outlets: (n) => `${n} ${n === 1 ? 'outlet' : 'outlets'}`,
    standfirst: (stories, outlets, articles, feeds) =>
      `<b>${stories}</b> ${stories === 1 ? 'story' : 'stories'} in geopolitical risk and economic development, drawn from <b>${articles}</b> articles across <b>${feeds}</b> feeds and grouped by coverage. <span class="quiet">Every story lists the outlets that reported it.</span>`,
    drafted: 'Drafted from the sources above, approved before publication',
    inField: 'in field',
    citeAs: (title, date, url) => `Cite as: ${title}, ${date}. ${url}`,
    colophon:
      'Stories are grouped from published reporting by this project, without any language model deciding what belongs together. Headlines are the publishers’ own words. A paragraph appears under a story only where one was drafted from the listed sources and approved by hand; every figure in it was checked against those sources in code. Full history is kept in the repository; older editions are available on request at',
    updated: 'Edition published',
    empty: 'No edition has been published yet.',
    emptyBody: 'The first Brief appears the morning after the pipeline has run for a full day.',
    errorTitle: 'The edition could not be loaded.',
    errorBody: (url) => `Tried <code>${url}</code>. Nothing is shown rather than something unverified.`,
    noProse: 'This edition carries no drafted prose.',
    noProseBody: 'Either none was drafted, or none was approved. The stories below are unaffected — they were never dependent on it.',
  },
  nb: {
    archive: 'Tidligere utgaver',
    stories: (n) => `${n} ${n === 1 ? 'sak' : 'saker'}`,
    outlets: (n) => `${n} ${n === 1 ? 'kilde' : 'kilder'}`,
    standfirst: (stories, outlets, articles, feeds) =>
      `<b>${stories}</b> ${stories === 1 ? 'sak' : 'saker'} innen georisiko og økonomisk utvikling, hentet fra <b>${articles}</b> artikler i <b>${feeds}</b> kilder og gruppert etter dekning. <span class="quiet">Hver sak viser redaksjonene som meldte den.</span>`,
    drafted: 'Skrevet ut fra kildene over, godkjent før publisering',
    inField: 'i feltet',
    citeAs: (title, date, url) => `Siteres som: ${title}, ${date}. ${url}`,
    colophon:
      'Sakene er gruppert fra publisert journalistikk av dette prosjektet, uten at noen språkmodell avgjør hva som hører sammen. Overskriftene er redaksjonenes egne ord. Et avsnitt står under en sak bare der det er skrevet ut fra kildene som er listet, og godkjent for hånd; hvert tall i det er kontrollert mot de kildene i kode. Full historikk ligger i repoet; eldre utgaver fås ved henvendelse til',
    updated: 'Utgave publisert',
    empty: 'Ingen utgave er publisert ennå.',
    emptyBody: 'Den første Briefen kommer morgenen etter at pipelinen har gått et helt døgn.',
    errorTitle: 'Utgaven kunne ikke lastes.',
    errorBody: (url) => `Forsøkte <code>${url}</code>. Ingenting vises heller enn noe ubekreftet.`,
    noProse: 'Denne utgaven har ingen utskrevne avsnitt.',
    noProseBody: 'Enten ble ingen skrevet, eller ingen godkjent. Sakene under er upåvirket — de var aldri avhengige av det.',
  },
};

const FIELD_LABEL = {
  en: { geopolitical_risk: 'Geopolitical risk', economic_development: 'Economic development' },
  nb: { geopolitical_risk: 'Georisiko', economic_development: 'Økonomisk utvikling' },
};

const state = { lang: 'en', edition: null, summaries: new Map(), index: [] };

const $ = (id) => document.getElementById(id);
const t = () => STRINGS[state.lang];
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function showBanner(title, body) {
  const banner = $('banner');
  banner.hidden = false;
  banner.innerHTML = `<strong>${escapeHtml(title)}</strong> ${body}`;
}

/* ---------- loading ---------------------------------------------------- */

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function requestedDate() {
  const value = new URLSearchParams(location.search).get('edition');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

async function load() {
  const base = `${dataBaseUrl()}editions/`;
  const index = await loadJson(`${base}index.json`);
  state.index = index.editions ?? [];

  if (state.index.length === 0) {
    showBanner(t().empty, t().emptyBody);
    return;
  }

  const date = requestedDate() ?? state.index[0].date;
  state.edition = await loadJson(`${base}${date}.json`);

  // Prose is optional by design: it lives in its own file and only exists once approved.
  try {
    const summaries = await loadJson(`${base}${date}.summaries.json`);
    for (const entry of summaries.summaries ?? []) state.summaries.set(entry.storyId, entry);
  } catch {
    state.summaries.clear();
  }
}

/* ---------- rendering --------------------------------------------------- */

function renderDateline() {
  const edition = state.edition;
  const date = new Date(`${edition.date}T00:00:00Z`);
  const locale = state.lang === 'nb' ? 'nb-NO' : 'en-GB';
  const weekday = date.toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });
  const rest = date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  $('edition-date').innerHTML =
    `<span class="weekday">${escapeHtml(weekday)}</span><span>${escapeHtml(rest)}</span>`;

  const outlets = new Set(edition.stories.flatMap((story) => story.articles.map((a) => a.publisher))).size;
  $('standfirst').innerHTML = t().standfirst(
    edition.stories.length,
    outlets,
    edition.articlesConsidered,
    edition.feedsTotal,
  );
}

function renderStory(story, underThemeId) {
  const summary = state.summaries.get(story.id);
  // The section heading already names the primary theme; repeating it in the meta line
  // just adds noise. Only the secondary themes tell the reader something new.
  const themes = story.themes
    .filter((theme) => theme.id !== underThemeId)
    .slice(0, 2)
    .map((theme) => escapeHtml(theme.label))
    .join(' · ');

  const sources = [...new Map(story.articles.map((a) => [a.publisher, a])).values()]
    .map(
      (article) =>
        `<li><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.publisher)}</a></li>`,
    )
    .join('');

  return (
    `<li class="story">` +
    `<h3 class="story-headline"><a href="${escapeHtml(story.headlineFrom.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.headline)}</a></h3>` +
    `<p class="story-meta">` +
    `<span class="lead">${escapeHtml(story.headlineFrom.publisher)}</span>` +
    `<span>${escapeHtml(t().outlets(story.distinctPublishers))}</span>` +
    `<span>${escapeHtml(story.lastSeenAt.slice(0, 10))}</span>` +
    (themes ? `<span>${themes}</span>` : '') +
    `</p>` +
    (summary
      ? `<div class="story-summary">${escapeHtml(summary.text)}<span class="attribution">${escapeHtml(t().drafted)}</span></div>`
      : '') +
    `<ul class="sources">${sources}</ul>` +
    `</li>`
  );
}

function renderSections() {
  const edition = state.edition;
  const byId = new Map(edition.stories.map((story) => [story.id, story]));
  const labels = FIELD_LABEL[state.lang];

  $('sections').innerHTML = edition.sections
    .map((section) => {
      const count = section.themes.reduce((sum, theme) => sum + theme.storyIds.length, 0);
      const themes = section.themes
        .map((theme) => {
          const stories = theme.storyIds
            .map((id) => byId.get(id))
            .filter(Boolean)
            .map((story) => renderStory(story, theme.id))
            .join('');
          return `<h3 class="theme-heading">${escapeHtml(theme.label)}</h3><ul class="stories">${stories}</ul>`;
        })
        .join('');
      return (
        `<section class="field">` +
        `<h2 class="field-heading">${escapeHtml(labels[section.field] ?? section.fieldLabel)}</h2>` +
        `<p class="field-count">${escapeHtml(t().stories(count))}</p>` +
        themes +
        `</section>`
      );
    })
    .join('');
}

function renderArchive() {
  const current = state.edition?.date;
  $('archive-list').innerHTML = state.index
    .slice(0, 60)
    .map((entry) => {
      const date = new Date(`${entry.date}T00:00:00Z`).toLocaleDateString(
        state.lang === 'nb' ? 'nb-NO' : 'en-GB',
        { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' },
      );
      return (
        `<a href="?edition=${entry.date}"${entry.date === current ? ' aria-current="page"' : ''}>` +
        `<span class="when">${escapeHtml(date)}</span>` +
        `<span class="lead-headline">${escapeHtml(entry.leadHeadline)}</span>` +
        `<span class="count">${entry.storyCount}</span>` +
        `</a>`
      );
    })
    .join('');
}

function renderColophon() {
  const edition = state.edition;
  const repo = repoUrl();

  if (edition) {
    const url = `${CONFIG.briefBaseUrl}?edition=${edition.date}`;
    $('cite').textContent = t().citeAs('IGRED Brief', edition.date, url);
    $('colophon-meta').textContent =
      `${t().updated}: ${new Date(edition.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }

  $('colophon-text').innerHTML =
    `${escapeHtml(t().colophon)} <a href="mailto:${escapeHtml(CONFIG.contactEmail)}">${escapeHtml(CONFIG.contactEmail)}</a>.` +
    (repo ? ` <a href="${escapeHtml(repo)}" target="_blank" rel="noopener">Source</a>.` : '');
}

function applyStaticStrings() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = t()[node.dataset.i18n];
    if (typeof value === 'string') node.textContent = value;
  }
  document.documentElement.lang = state.lang;
  $('lang').textContent = state.lang === 'en' ? 'NO' : 'EN';
  $('lang').setAttribute('aria-label', state.lang === 'en' ? 'Bytt til norsk' : 'Switch to English');
}

function render() {
  applyStaticStrings();
  if (state.edition) {
    renderDateline();
    renderSections();
  }
  renderArchive();
  renderColophon();
}

/* ---------- chrome ------------------------------------------------------ */

function wireChrome() {
  const root = document.documentElement;
  const stored = localStorage.getItem('igred-theme');
  root.dataset.theme = stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const syncTheme = () => { $('theme').textContent = root.dataset.theme === 'dark' ? 'Light' : 'Dark'; };
  syncTheme();
  $('theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('igred-theme', root.dataset.theme);
    syncTheme();
  });

  const storedLang = localStorage.getItem('igred-lang');
  if (storedLang === 'nb' || storedLang === 'en') state.lang = storedLang;
  $('lang').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'nb' : 'en';
    localStorage.setItem('igred-lang', state.lang);
    render();
  });
}

async function boot() {
  wireChrome();
  applyStaticStrings();

  try {
    await load();
  } catch (error) {
    showBanner(t().errorTitle, t().errorBody(escapeHtml(`${dataBaseUrl()}editions/`)));
    console.error(error);
  }

  render();

  if (state.edition && state.edition.leadStoryIds.length > 0 && state.summaries.size === 0) {
    showBanner(t().noProse, t().noProseBody);
  }
}

boot();
