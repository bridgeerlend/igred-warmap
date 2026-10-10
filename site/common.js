/**
 * Shared by the map and the crisis pages: language, theme, formatting, the incident model
 * and the small DOM helper all of them use. Every number on screen is counted here from the
 * published incident file; nothing is estimated.
 */
import { dataBaseUrl } from './config.js';

export const STRINGS = {
  en: {
    brief: 'Brief', wire: 'Wire', map: 'Map',
    switchLang: 'NO', switchLangLabel: 'Bytt til norsk',
    dark: 'Dark', light: 'Light',
    titleLine1: 'Global Conflict', titleLine2: 'Monitor',
    search: 'Search a crisis, country or place',
    win: { 1: '24 hours', 7: '7 days', 30: '30 days' },
    standfirst: (n, c, span) => `<b>${n}</b> armed ${n === '1' ? 'incident' : 'incidents'} reported ${span}, across <b>${c}</b> ${c === '1' ? 'crisis' : 'crises'}.`,
    span: (w, asOf) => asOf
      ? (w === 1 ? `on ${asOf}` : `in the ${w === 7 ? 'seven' : '30'} days to ${asOf}`)
      : (w === 1 ? 'in the past 24 hours' : w === 7 ? 'in the past seven days' : 'in the past 30 days'),
    prevSpan: (w) => (w === 1 ? 'the day before' : w === 7 ? 'the week before' : 'the 30 days before'),
    status: (n, span, change, where) =>
      `<b>${n}</b> armed ${n === '1' ? 'incident' : 'incidents'} reported ${span}${change}${where}.`,
    statusNone: (span) => `No armed incidents reported ${span}.`,
    more: (pct, prev) => `, <b>${pct}%</b> more than ${prev}`,
    fewer: (pct, prev) => `, <b>${pct}%</b> fewer than ${prev}`,
    where: (list) => `, most of them in ${list}`,
    and: 'and',
    allCrises: 'All crises',
    overview: 'Overview', news: 'News', places: 'Places and sources',
    summaryLabel: 'Machine-written from the linked sources below, checked for figures not in them.',
    summarySources: 'Written from',
    background: 'Background',
    fromWikipedia: (t) => `Wikipedia, “${t}”, CC BY-SA 4.0`,
    readMore: 'Read the full article',
    conflicts: 'Armed conflicts on the UCDP register',
    since: (y) => `since ${y}`,
    deaths: (n, y) => `${n} deaths${y ? ` in ${y}` : ''}`,
    ucdpBattle: (n, y) => `UCDP counted <b>${n}</b> battle-related deaths here in ${y}, a count of fatalities rather than of reports.`,
    ucdpOther: (n, k, y) => `Its register adds <b>${n}</b> deaths${y ? ` in ${y}` : ''} from ${k === 1 ? 'one conflict' : `${k} conflicts`} of non-state or one-sided violence.`,
    ucdpOtherOnly: (n, k, y) => `UCDP’s register records <b>${n}</b> deaths${y ? ` in ${y}` : ''} from ${k === 1 ? 'one conflict' : `${k} conflicts`} of non-state or one-sided violence here; it gives no figure for state-based wars.`,
    type: { state_based: 'State-based', non_state: 'Non-state', one_sided: 'One-sided violence' },
    figures: 'Country figures',
    picture: 'Picture',
    topStories: 'Most covered',
    outletsN: (n) => `${n} ${n === 1 ? 'outlet' : 'outlets'}`,
    inBrief: 'In the Brief',
    latest: 'Latest',
    video: 'Video',
    playVideo: 'Play',
    gallery: 'Wikimedia Commons',
    hotspots: 'Most reported places',
    incidents: 'Incidents',
    outlets: 'Every outlet',
    rawData: 'Raw data',
    noNews: 'No reporting found in the past four days.',
    reportsN: (n) => `${n} ${n === 1 ? 'report' : 'reports'}`,
    oneSource: 'One source',
    corroborated: (n) => `${n} independent outlets`,
    verified: 'Verified by IGRED',
    verify: 'Verify',
    openCrisis: 'Open crisis',
    source: 'Source',
    region: { Europe: 'Europe', 'Middle East': 'Middle East', Africa: 'Africa', Asia: 'Asia', Americas: 'Americas' },
    country: 'Country',
    countryConflicts: 'Active conflicts on the UCDP register',
    noConflicts: 'UCDP lists no active armed conflict here.',
    partOf: 'Part of',
    countryNone: (span) => `No armed incidents reported here ${span}.`,
    recent: 'Latest incidents',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset',
    play: 'Play', pause: 'Pause', now: 'Now',
    keyEmber: 'Reported incident, by intensity',
    keyHollow: 'One source',
    keyFilled: 'Two or more outlets',
    keyVerified: 'Verified by IGRED',
    noResults: 'Nothing matches that.',
    kindCrisis: 'Crisis', kindCountry: 'Country', kindPlace: 'Place',
    updated: 'Data updated',
    stale: (h) => `These figures are ${h} hours old. A source may be down; the map shows the last good data.`,
    loadError: 'The map data could not be loaded. Check the connection and reload the page.',
    method: 'Incidents are counted from the GDELT news stream, each shown with the outlet that reported it; a hollow mark rests on a single source. Conflicts and fatalities: UCDP. Background: Wikipedia. Figures: World Bank. Pictures: Wikimedia Commons. Borders: Natural Earth.',
    ranking: 'Crises are ranked by incidents carried by two or more independent outlets, weighted by severity, not by raw counts.',
    close: 'Close',
    onMap: 'Open on the map',
    contact: 'Contact',
    ago: (m) => (m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`),
  },
  nb: {
    brief: 'Brief', wire: 'Wire', map: 'Kart',
    switchLang: 'EN', switchLangLabel: 'Switch to English',
    dark: 'Mørk', light: 'Lys',
    titleLine1: 'Global Conflict', titleLine2: 'Monitor',
    search: 'Søk etter krise, land eller sted',
    win: { 1: '24 timer', 7: '7 dager', 30: '30 dager' },
    standfirst: (n, c, span) => `<b>${n}</b> ${n === '1' ? 'væpnet hendelse' : 'væpnede hendelser'} meldt ${span}, i <b>${c}</b> ${c === '1' ? 'krise' : 'kriser'}.`,
    span: (w, asOf) => asOf
      ? (w === 1 ? `${asOf}` : `de ${w === 7 ? 'sju' : '30'} dagene fram til ${asOf}`)
      : (w === 1 ? 'det siste døgnet' : w === 7 ? 'de siste sju dagene' : 'de siste 30 dagene'),
    prevSpan: (w) => (w === 1 ? 'døgnet før' : w === 7 ? 'uken før' : 'de 30 dagene før'),
    status: (n, span, change, where) =>
      `<b>${n}</b> ${n === '1' ? 'væpnet hendelse' : 'væpnede hendelser'} meldt ${span}${change}${where}.`,
    statusNone: (span) => `Ingen væpnede hendelser meldt ${span}.`,
    more: (pct, prev) => `, <b>${pct} prosent</b> flere enn ${prev}`,
    fewer: (pct, prev) => `, <b>${pct} prosent</b> færre enn ${prev}`,
    where: (list) => `, flest i ${list}`,
    and: 'og',
    allCrises: 'Alle kriser',
    overview: 'Oversikt', news: 'Nyheter', places: 'Steder og kilder',
    summaryLabel: 'Maskinskrevet fra de lenkede kildene under, kontrollert for tall som ikke står i dem.',
    summarySources: 'Skrevet fra',
    background: 'Bakgrunn',
    fromWikipedia: (t) => `Wikipedia, «${t}», CC BY-SA 4.0`,
    readMore: 'Les hele artikkelen',
    conflicts: 'Væpnede konflikter i UCDP-registeret',
    since: (y) => `siden ${y}`,
    deaths: (n, y) => `${n} drepte${y ? ` i ${y}` : ''}`,
    ucdpBattle: (n, y) => `UCDP talte <b>${n}</b> kamprelaterte dødsfall her i ${y}, en telling av dødsfall, ikke av meldinger.`,
    ucdpOther: (n, k, y) => `Registeret legger til <b>${n}</b> drepte${y ? ` i ${y}` : ''} i ${k === 1 ? 'én konflikt' : `${k} konflikter`} med ikke-statlig eller ensidig vold.`,
    ucdpOtherOnly: (n, k, y) => `UCDP-registeret fører <b>${n}</b> drepte${y ? ` i ${y}` : ''} i ${k === 1 ? 'én konflikt' : `${k} konflikter`} med ikke-statlig eller ensidig vold her; det gir ingen tall for statlige kriger.`,
    type: { state_based: 'Statlig', non_state: 'Ikke-statlig', one_sided: 'Ensidig vold' },
    figures: 'Landtall',
    picture: 'Bilde',
    topStories: 'Mest omtalt',
    outletsN: (n) => `${n} ${n === 1 ? 'medium' : 'medier'}`,
    inBrief: 'I Briefen',
    latest: 'Siste nytt',
    video: 'Video',
    playVideo: 'Spill av',
    gallery: 'Wikimedia Commons',
    hotspots: 'Mest omtalte steder',
    incidents: 'Hendelser',
    outlets: 'Alle medier',
    rawData: 'Rådata',
    noNews: 'Fant ingen dekning de siste fire dagene.',
    reportsN: (n) => `${n} ${n === 1 ? 'melding' : 'meldinger'}`,
    oneSource: 'Én kilde',
    corroborated: (n) => `${n} uavhengige medier`,
    verified: 'Verifisert av IGRED',
    verify: 'Verifiser',
    openCrisis: 'Åpne krisen',
    source: 'Kilde',
    region: { Europe: 'Europa', 'Middle East': 'Midtøsten', Africa: 'Afrika', Asia: 'Asia', Americas: 'Amerika' },
    country: 'Land',
    countryConflicts: 'Aktive konflikter i UCDP-registeret',
    noConflicts: 'UCDP fører ingen aktiv væpnet konflikt her.',
    partOf: 'Del av',
    countryNone: (span) => `Ingen væpnede hendelser meldt her ${span}.`,
    recent: 'Siste hendelser',
    zoomIn: 'Zoom inn', zoomOut: 'Zoom ut', reset: 'Nullstill',
    play: 'Spill av', pause: 'Pause', now: 'Nå',
    keyEmber: 'Meldt hendelse, etter intensitet',
    keyHollow: 'Én kilde',
    keyFilled: 'To eller flere medier',
    keyVerified: 'Verifisert av IGRED',
    noResults: 'Ingen treff.',
    kindCrisis: 'Krise', kindCountry: 'Land', kindPlace: 'Sted',
    updated: 'Data oppdatert',
    stale: (h) => `Tallene er ${h} timer gamle. En kilde kan være nede; kartet viser siste gode data.`,
    loadError: 'Kartdataene kunne ikke lastes. Sjekk tilkoblingen og last siden på nytt.',
    method: 'Hendelsene telles fra nyhetsstrømmen GDELT og vises med mediet som meldte dem; et hult merke hviler på én kilde. Konflikter og dødstall: UCDP. Bakgrunn: Wikipedia. Landtall: Verdensbanken. Bilder: Wikimedia Commons. Grenser: Natural Earth.',
    ranking: 'Krisene rangeres etter hendelser meldt av to eller flere uavhengige medier, vektet etter alvorlighet, ikke etter rå antall.',
    close: 'Lukk',
    onMap: 'Åpne på kartet',
    contact: 'Kontakt',
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

/* ---------- preferences ----------------------------------------------- */

export const prefs = {
  lang: 'en',
  get t() { return STRINGS[this.lang]; },
};

export function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function safeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }

/**
 * Language and theme. Dark is the default whatever the system says; light is kept only once
 * the reader has chosen it in the footer.
 */
export function setupPrefs({ langButton, themeButton, onChange }) {
  const root = document.documentElement;
  const storedLang = safeGet('igred-lang');
  prefs.lang = storedLang === 'nb' || storedLang === 'en'
    ? storedLang
    : (navigator.language || '').toLowerCase().match(/^(nb|nn|no)/) ? 'nb' : 'en';
  root.dataset.theme = safeGet('igred-theme') === 'light' ? 'light' : 'dark';

  const paint = () => {
    root.lang = prefs.lang;
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

/* ---------- DOM and formatting ---------------------------------------- */

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

export const $ = (id) => document.getElementById(id);

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const locale = () => (prefs.lang === 'nb' ? 'nb-NO' : 'en-GB');

export function fmtNum(n) {
  return Number(n).toLocaleString(locale()).replace(/ /g, ' ');
}

export function fmtBig(n, unit) {
  if (unit === 'pct') return prefs.lang === 'nb' ? `${n.toLocaleString(locale(), { maximumFractionDigits: 1 })} prosent` : `${n.toLocaleString(locale(), { maximumFractionDigits: 1 })}%`;
  if (unit === 'usd') return prefs.lang === 'nb' ? `${Math.round(n).toLocaleString(locale())} USD` : `$${Math.round(n).toLocaleString(locale())}`;
  if (Math.abs(n) >= 1e6) {
    const m = (n / 1e6).toLocaleString(locale(), { maximumFractionDigits: n >= 1e8 ? 0 : 1 });
    return prefs.lang === 'nb' ? `${m} mill.` : `${m} million`;
  }
  return Math.round(n).toLocaleString(locale());
}

export function ago(iso) {
  return prefs.t.ago(Math.round((Date.now() - Date.parse(iso)) / 60000));
}

export function fmtDay(iso) {
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function fmtShortDay(iso) {
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
}

export function fmtStamp(iso) {
  return `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${prefs.t.and} ${names[names.length - 1]}`;
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export const crisisName = (c) => (prefs.lang === 'nb' ? c.nameNb : c.name);
export const shortName = (c) => (prefs.lang === 'nb' ? c.shortNb : c.short);
export const regionName = (c) => prefs.t.region[c.region] ?? (prefs.lang === 'nb' ? c.regionNb : c.region);

/**
 * The long name as a two-line monument, the way the page title is set: "Sudan's / civil war".
 * The break falls after the first word or possessive, which is where the names turn.
 */
export function monumentLines(name) {
  const words = name.split(' ');
  if (words.length < 2) return [name, ''];
  let cut = words.findIndex((w) => /['’]s$/.test(w));
  if (cut === -1 || cut > 2) cut = words.length > 3 ? 1 : 0;
  return [words.slice(0, cut + 1).join(' '), words.slice(cut + 1).join(' ')];
}

/* ---------- data ------------------------------------------------------- */

export async function getJson(file) {
  const response = await fetch(`${dataBaseUrl()}${file}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}

export const MIN = 60_000;
export const DAY = 86_400_000;

/** The incident file, with the indexes the views need built once. */
export class Incidents {
  constructor(payload) {
    this.p = payload;
    this.rows = payload.events;
    this.generatedAt = payload.generatedAt;
    this.now = Date.parse(payload.generatedAt);
    // Today is the last day on the timeline; the 29 before it make the month.
    this.today = new Date(this.now).toISOString().slice(0, 10);
    this.days = [];
    for (let i = 29; i >= 0; i--) this.days.push(new Date(Date.parse(`${this.today}T00:00:00Z`) - i * DAY).toISOString().slice(0, 10));
  }

  at(r) { return r[0] * MIN; }
  lon(r) { return r[1] / 100; }
  lat(r) { return r[2] / 100; }
  category(r) { return this.p.categories[r[3]]; }
  crisis(r) { return r[6] >= 0 ? this.p.crises[r[6]] : null; }
  outlets(r) { return r[7]; }
  publisher(r) { return this.p.publishers[r[11]]; }
  country(r) { return this.p.countries[r[12]]; }
  id(r) { return r[13]; }
  verified(r) { return this.p.verified?.[r[13]] ?? null; }

  /** [from, to) in ms for a window of `w` days ending at the end of day `asOf` (or now). */
  range(w, asOf) {
    const end = asOf && asOf !== this.today ? Date.parse(`${asOf}T00:00:00Z`) + DAY : this.now;
    return [end - w * DAY, end];
  }

  select(filter, from, to) {
    const out = [];
    for (const r of this.rows) {
      const t = r[0] * MIN;
      if (t >= from && t < to && filter(r)) out.push(r);
    }
    return out;
  }

  daily(filter) {
    const index = new Map(this.days.map((d, i) => [d, i]));
    const counts = this.days.map(() => 0);
    for (const r of this.rows) {
      if (!filter(r)) continue;
      const i = index.get(new Date(r[0] * MIN).toISOString().slice(0, 10));
      if (i !== undefined) counts[i] += 1;
    }
    return counts;
  }
}

/** The ranking weight: severity summed over incidents carried by two or more outlets. */
export function scoreOf(rows) {
  let s = 0;
  for (const r of rows) if (r[7] >= 2) s += r[5];
  return s;
}

/** Change against the previous window, shown only where it means something. */
export function changeOf(now, before) {
  if (before < 5) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return Math.abs(pct) >= 15 ? pct : null;
}

export function topPlaces(rows, exclude = new Set(), n = 3) {
  const counts = new Map();
  for (const r of rows) {
    const name = r[9].split(',')[0].trim();
    if (!name || exclude.has(name) || /\(general\)/i.test(r[9])) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** The status sentence over a set of incidents in the chosen window, figures in bold. */
export function statusSentence(inc, rows, prevRows, w, asOf, exclude) {
  const t = prefs.t;
  const span = t.span(w, asOf && asOf !== inc.today ? fmtDay(asOf) : null);
  if (rows.length === 0) return t.statusNone(span);
  const pct = w === 30 ? null : changeOf(rows.length, prevRows.length);
  const change = pct === null ? '' : pct > 0 ? t.more(pct, t.prevSpan(w)) : t.fewer(Math.abs(pct), t.prevSpan(w));
  const places = topPlaces(rows, exclude).map(([name]) => esc(name));
  return t.status(fmtNum(rows.length), span, change, places.length ? t.where(joinNames(places)) : '');
}

/**
 * Thirty days as flat bars. The chosen window is drawn at full strength, the rest faintly;
 * dates sit underneath in small capitals. No line, no area, no gradient.
 */
export function barChart(counts, days, { from = days.length - 7, to = days.length, cls = 'bars' } = {}) {
  const max = Math.max(1, ...counts);
  const W = 300, H = 64, gap = 2;
  const bw = (W - gap * (counts.length - 1)) / counts.length;
  const bars = counts.map((v, i) => {
    const hgt = v === 0 ? 1 : Math.max(2, (v / max) * H);
    const on = i >= from && i < to;
    return `<rect x="${(i * (bw + gap)).toFixed(2)}" y="${(H - hgt).toFixed(2)}" width="${bw.toFixed(2)}" height="${hgt.toFixed(2)}" class="${on ? 'on' : 'off'}"><title>${esc(fmtShortDay(days[i]))}: ${v}</title></rect>`;
  }).join('');
  const label = (i, anchor) => `<span style="${anchor}">${esc(fmtShortDay(days[i]))}</span>`;
  return `<figure class="${cls}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(counts.join(', '))}">${bars}</svg>` +
    `<figcaption class="meta">${label(0, 'left:0')}${label(Math.floor(days.length / 2), 'left:50%;transform:translateX(-50%)')}${label(days.length - 1, 'right:0')}</figcaption></figure>`;
}

/** Hours since the incident stream was published, for the staleness line. */
export function hoursOld(iso) {
  return Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
}
