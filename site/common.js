/**
 * Shared by the map and the crisis page: language, theme, formatting and the small DOM
 * helper both use. Nothing here fetches anything.
 */

export const STRINGS = {
  en: {
    map: 'Map', brief: 'Brief', wire: 'Wire',
    switchLang: 'NO', switchLangLabel: 'Bytt til norsk',
    dark: 'Dark', light: 'Light',
    search: 'Search crises and places',
    crises: 'Crises',
    all: 'All',
    win: { 1: '24 hours', 7: '7 days', 30: '30 days' },
    winShort: { 1: 'today', 7: 'this week', 30: 'in 30 days' },
    incidents: (n) => `${n} ${n === 1 ? 'incident' : 'incidents'}`,
    vsPrev: (pct) => (pct === null ? '' : pct >= 0 ? `+${Math.round(pct)}% on last week` : `${Math.round(pct)}% on last week`),
    quiet: 'Quiet this week',
    loading: 'Loading',
    loadError: 'The map data could not be loaded. Check the connection and reload the page.',
    crisisError: 'This crisis could not be loaded. Try again in a moment.',
    close: 'Close',
    openPage: 'Open as a page',
    backToMap: 'Back to the map',
    copyLink: 'Copy link', copied: 'Link copied',
    updated: (t) => `Updated ${t}`,
    figWeek: 'Incidents this week',
    figChange: 'Change on last week',
    figMonth: 'Incidents in 30 days',
    figOutlets: 'Outlets reporting',
    figToday: 'Last 24 hours',
    chartTitle: 'Reported incidents per day, last 30 days',
    situation: 'The situation',
    situationNote: 'Composed from the counts on this page by a fixed template. No language model writes this text.',
    background: 'Background',
    fromWikipedia: (t) => `From Wikipedia, “${t}”. CC BY-SA 4.0.`,
    readMore: 'Read the full article',
    live: 'Latest reporting',
    liveNote: (n) => `${n} articles from the last four days, newest first. Each opens at the publisher.`,
    showMore: (n) => `Show ${n} more`,
    pictures: 'Pictures',
    picturesNote: 'From the reporting outlets and Wikimedia Commons, each linked to where it was published.',
    videos: 'Video',
    posts: 'Posts',
    topStories: 'Most covered stories',
    outletsN: (n) => `${n} ${n === 1 ? 'outlet' : 'outlets'}`,
    hotspots: 'Most reported places',
    hotspotsNote: 'Last 30 days. Select a place to zoom to it.',
    incidentsTitle: 'Notable incidents this week',
    incidentsNote: 'From the GDELT news stream. Counts are reports of incidents, not verified events or casualties.',
    conflicts: 'Armed conflicts on record',
    conflictsNote: 'Active conflicts in the Uppsala Conflict Data Program register for these countries.',
    since: (y) => `since ${y}`,
    deaths: (n, y) => `${n} deaths recorded${y ? ` (${y})` : ''}`,
    ucdpLevel: { 1: 'Minor conflict', 2: 'War' },
    figures: 'Country figures',
    figuresNote: 'Latest available year, World Bank.',
    sources: 'Sources',
    sourcesSummary: (n, o) => `This page draws on ${n} linked sources from ${o} outlets.`,
    sourcesFeeds: 'Raw feeds behind this page',
    noNews: 'No reporting found in the last four days.',
    reportsN: (n) => `${n} ${n === 1 ? 'report' : 'reports'}`,
    level: 'Activity',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', resetView: 'Show the whole world',
    legend: 'Each dot is a reported incident. Brighter and larger means more widely reported.',
    otherIncidents: 'Outside the listed crises',
    openCrisis: 'Open crisis',
    source: 'Source',
    noResults: 'No crisis or place matches that.',
    place: 'Place',
    regions: { Europe: 'Europe', 'Middle East': 'Middle East', Africa: 'Africa', Asia: 'Asia', Americas: 'Americas' },
    autoNote: 'Added automatically: sustained, corroborated reporting in a country with an active conflict on record.',
    colophon: 'Incidents come from the GDELT news stream and are shown only with the outlet that reported them. Conflicts on record are from UCDP. Background is from Wikipedia and country figures from the World Bank. Borders are Natural Earth (public domain). No third-party map tiles.',
    ago: (m) => (m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`),
  },
  nb: {
    map: 'Kart', brief: 'Brief', wire: 'Wire',
    switchLang: 'EN', switchLangLabel: 'Switch to English',
    dark: 'Mørk', light: 'Lys',
    search: 'Søk i kriser og steder',
    crises: 'Kriser',
    all: 'Alle',
    win: { 1: '24 timer', 7: '7 dager', 30: '30 dager' },
    winShort: { 1: 'i dag', 7: 'denne uken', 30: 'på 30 dager' },
    incidents: (n) => `${n} ${n === 1 ? 'hendelse' : 'hendelser'}`,
    vsPrev: (pct) => (pct === null ? '' : pct >= 0 ? `+${Math.round(pct)} % mot forrige uke` : `${Math.round(pct)} % mot forrige uke`),
    quiet: 'Rolig denne uken',
    loading: 'Laster',
    loadError: 'Kartdataene kunne ikke lastes. Sjekk tilkoblingen og last siden på nytt.',
    crisisError: 'Krisen kunne ikke lastes. Prøv igjen om litt.',
    close: 'Lukk',
    openPage: 'Åpne som egen side',
    backToMap: 'Tilbake til kartet',
    copyLink: 'Kopier lenke', copied: 'Lenken er kopiert',
    updated: (t) => `Oppdatert ${t}`,
    figWeek: 'Hendelser denne uken',
    figChange: 'Endring fra forrige uke',
    figMonth: 'Hendelser på 30 dager',
    figOutlets: 'Medier som melder',
    figToday: 'Siste døgn',
    chartTitle: 'Meldte hendelser per dag, siste 30 dager',
    situation: 'Situasjonen',
    situationNote: 'Satt sammen av tallene på denne siden etter en fast mal. Ingen språkmodell skriver teksten.',
    background: 'Bakgrunn',
    fromWikipedia: (t) => `Fra Wikipedia, «${t}». CC BY-SA 4.0.`,
    readMore: 'Les hele artikkelen',
    live: 'Siste nytt',
    liveNote: (n) => `${n} artikler fra de siste fire dagene, nyeste først. Hver åpnes hos utgiveren.`,
    showMore: (n) => `Vis ${n} til`,
    pictures: 'Bilder',
    picturesNote: 'Fra mediene som melder og fra Wikimedia Commons, hvert lenket til der det ble publisert.',
    videos: 'Video',
    posts: 'Innlegg',
    topStories: 'Mest omtalte saker',
    outletsN: (n) => `${n} ${n === 1 ? 'medium' : 'medier'}`,
    hotspots: 'Mest omtalte steder',
    hotspotsNote: 'Siste 30 dager. Velg et sted for å zoome dit.',
    incidentsTitle: 'Viktige hendelser denne uken',
    incidentsNote: 'Fra nyhetsstrømmen GDELT. Tallene er meldinger om hendelser, ikke bekreftede hendelser eller dødstall.',
    conflicts: 'Registrerte væpnede konflikter',
    conflictsNote: 'Aktive konflikter i registeret til Uppsala Conflict Data Program for disse landene.',
    since: (y) => `siden ${y}`,
    deaths: (n, y) => `${n} drepte registrert${y ? ` (${y})` : ''}`,
    ucdpLevel: { 1: 'Mindre konflikt', 2: 'Krig' },
    figures: 'Landtall',
    figuresNote: 'Siste tilgjengelige år, Verdensbanken.',
    sources: 'Kilder',
    sourcesSummary: (n, o) => `Denne siden bygger på ${n} lenkede kilder fra ${o} medier.`,
    sourcesFeeds: 'Rådataene bak siden',
    noNews: 'Fant ingen dekning de siste fire dagene.',
    reportsN: (n) => `${n} ${n === 1 ? 'melding' : 'meldinger'}`,
    level: 'Aktivitet',
    zoomIn: 'Zoom inn', zoomOut: 'Zoom ut', resetView: 'Vis hele verden',
    legend: 'Hver prikk er en meldt hendelse. Sterkere og større betyr bredere omtalt.',
    otherIncidents: 'Utenfor de listede krisene',
    openCrisis: 'Åpne krisen',
    source: 'Kilde',
    noResults: 'Ingen krise eller sted passer.',
    place: 'Sted',
    regions: { Europe: 'Europa', 'Middle East': 'Midtøsten', Africa: 'Afrika', Asia: 'Asia', Americas: 'Amerika' },
    autoNote: 'Lagt til automatisk: vedvarende, bekreftet dekning i et land med en registrert aktiv konflikt.',
    colophon: 'Hendelsene kommer fra nyhetsstrømmen GDELT og vises bare sammen med mediet som meldte dem. Registrerte konflikter er fra UCDP. Bakgrunn er fra Wikipedia og landtall fra Verdensbanken. Grenser fra Natural Earth (offentlig eiendom). Ingen kartfliser fra tredjepart.',
    ago: (m) => (m < 60 ? `${Math.max(1, m)} min siden` : m < 1440 ? `${Math.round(m / 60)} t siden` : `${Math.round(m / 1440)} d siden`),
  },
};

export const CATEGORY = {
  en: {
    armed_clash: 'Armed clash', armed_assault: 'Armed assault', aerial_strike: 'Aerial or missile strike',
    mass_violence: 'Mass violence', violent_repression: 'Violent repression', violent_unrest: 'Violent unrest',
    siege_blockade: 'Siege or blockade',
  },
  nb: {
    armed_clash: 'Væpnet sammenstøt', armed_assault: 'Væpnet angrep', aerial_strike: 'Luft- eller missilangrep',
    mass_violence: 'Massevold', violent_repression: 'Voldelig undertrykking', violent_unrest: 'Voldelige uroligheter',
    siege_blockade: 'Beleiring eller blokade',
  },
};

export const prefs = {
  lang: 'en',
  get t() { return STRINGS[this.lang]; },
};

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

/** Wires the language and theme buttons; calls back when either changes. */
export function setupPrefs({ langButton, themeButton, onChange }) {
  const root = document.documentElement;
  const storedLang = safeGet('igred-lang');
  prefs.lang = storedLang === 'nb' || storedLang === 'en'
    ? storedLang
    : (navigator.language || '').toLowerCase().startsWith('n') ? 'nb' : 'en';
  const storedTheme = safeGet('igred-theme');
  root.dataset.theme = storedTheme === 'dark' || storedTheme === 'light'
    ? storedTheme
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  const paint = () => {
    root.lang = prefs.lang === 'nb' ? 'nb' : 'en';
    if (langButton) {
      langButton.textContent = prefs.t.switchLang;
      langButton.setAttribute('aria-label', prefs.t.switchLangLabel);
    }
    if (themeButton) themeButton.textContent = root.dataset.theme === 'dark' ? prefs.t.light : prefs.t.dark;
  };
  langButton?.addEventListener('click', () => {
    prefs.lang = prefs.lang === 'en' ? 'nb' : 'en';
    safeSet('igred-lang', prefs.lang);
    paint();
    onChange?.('lang');
  });
  themeButton?.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    safeSet('igred-theme', root.dataset.theme);
    paint();
    onChange?.('theme');
  });
  paint();
}

/** Tiny element builder: h('a.cls', { href }, child, 'text'). */
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function fmtNum(n) {
  return Number(n).toLocaleString(prefs.lang === 'nb' ? 'nb-NO' : 'en-GB');
}

export function fmtBig(n, unit) {
  const lang = prefs.lang === 'nb' ? 'nb-NO' : 'en-GB';
  if (unit === 'pct') return `${n.toLocaleString(lang, { maximumFractionDigits: 1 })} %`.replace(' %', prefs.lang === 'nb' ? ' %' : '%');
  if (unit === 'usd') return `${prefs.lang === 'nb' ? '' : '$'}${Math.round(n).toLocaleString(lang)}${prefs.lang === 'nb' ? ' USD' : ''}`;
  if (Math.abs(n) >= 1e6) {
    const m = (n / 1e6).toLocaleString(lang, { maximumFractionDigits: n >= 1e8 ? 0 : 1 });
    return prefs.lang === 'nb' ? `${m} mill.` : `${m} million`;
  }
  return Math.round(n).toLocaleString(lang);
}

export function ago(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return prefs.t.ago(minutes);
}

export function fmtDate(iso, withTime = false) {
  const d = new Date(iso);
  return d.toLocaleString(prefs.lang === 'nb' ? 'nb-NO' : 'en-GB', withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short' });
}

export function crisisName(c) { return prefs.lang === 'nb' ? c.nameNb : c.name; }
export function regionName(c) { return prefs.lang === 'nb' ? c.regionNb : c.region; }

/** A small inline sparkline as SVG markup. */
export function sparkline(values, { width = 72, height = 22, cls = 'spark' } = {}) {
  const max = Math.max(1, ...values);
  const step = width / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  const area = `M0,${height} L${pts.join(' L')} L${width},${height} Z`;
  return `<svg class="${cls}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><path d="${area}" class="spark-area"/><polyline points="${pts.join(' ')}" class="spark-line"/></svg>`;
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
