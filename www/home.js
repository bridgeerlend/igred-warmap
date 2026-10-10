/**
 * igred.org: the institute page.
 *
 * The hero film and the two live previews read today's data from the same repository the
 * map reads, so the front page is never out of date and is never rebuilt for it. If the data
 * cannot be reached the page still reads as a complete institute page; the live parts stay
 * quiet.
 */
import { toView } from './projection.js';
import { startHero } from './hero.js';

const LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const DATA = LOCAL ? '../data/' : 'https://raw.githubusercontent.com/bridgeerlend/igred-warmap/main/data/';

const STRINGS = {
  en: {
    fullName: 'Institute for Geopolitical Risk and Economic Development',
    heroLine: 'Armed conflict and geopolitical risk, with every source shown.',
    productsHeading: 'What we publish',
    mapBody: 'A live map of armed conflict. Open any crisis for the latest reporting, the numbers and every source behind them.',
    briefBody: 'A daily synthesis of geopolitical risk and economic development. Each edition is dated and fixed, so it can be cited.',
    reportsBody: 'Half-yearly assessments of geopolitical risk, written to the same framework each time so findings compare across editions.',
    baseBody: 'Books, articles and research worth reading, each with the institute’s own assessment of what it argues and where it holds.',
    aboutHeading: 'About IGRED',
    about1: 'IGRED is an independent analysis body. We track where political risk and economic conditions meet, and what that means for the countries and sectors exposed to both.',
    about2: 'Everything we publish carries its sources. Each figure names where it came from, when it was collected, and links to the original, so a reader can check the work rather than take it on trust.',
    role: 'Co-Founder & Analyst',
    open: 'Open', read: 'Read', coming: 'Coming',
    switchLang: 'NO', dark: 'Dark', light: 'Light',
    countLede: 'armed incidents reported in the past seven days',
    weekCount: (n) => `${n} incidents this week`,
    playback: 'Thirty days of reported incidents',
    briefToday: (d) => `The IGRED Brief, ${d}`,
    crisesToday: (n) => `${n} crises tracked`,
  },
  nb: {
    fullName: 'Institutt for geopolitisk risiko og økonomisk utvikling',
    heroLine: 'Væpnet konflikt og geopolitisk risiko, med hver kilde synlig.',
    productsHeading: 'Hva vi publiserer',
    mapBody: 'Et levende kart over væpnet konflikt. Åpne en krise for siste nytt, tallene og hver kilde bak dem.',
    briefBody: 'En daglig sammenstilling av geopolitisk risiko og økonomisk utvikling. Hver utgave er datert og låst, så den kan siteres.',
    reportsBody: 'Halvårlige vurderinger av geopolitisk risiko, skrevet etter samme rammeverk hver gang så funnene kan sammenlignes.',
    baseBody: 'Bøker, artikler og forskning verdt å lese, hver med instituttets egen vurdering av hva den hevder og hvor den holder.',
    aboutHeading: 'Om IGRED',
    about1: 'IGRED er et uavhengig analysemiljø. Vi følger hvor politisk risiko og økonomiske forhold møtes, og hva det betyr for landene og sektorene som er utsatt for begge.',
    about2: 'Alt vi publiserer har kilder. Hvert tall sier hvor det kommer fra, når det ble hentet, og lenker til originalen, så leseren kan sjekke arbeidet i stedet for å ta det på tro.',
    role: 'Medgründer og analytiker',
    open: 'Åpne', read: 'Les', coming: 'Kommer',
    switchLang: 'EN', dark: 'Mørk', light: 'Lys',
    countLede: 'væpnede hendelser meldt de siste sju dagene',
    weekCount: (n) => `${n} hendelser denne uken`,
    playback: 'Tretti dager med meldte hendelser',
    briefToday: (d) => `The IGRED Brief, ${d}`,
    crisesToday: (n) => `${n} kriser fulgt`,
  },
};

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

let lang = safeGet('igred-lang') === 'nb' ? 'nb' : safeGet('igred-lang') === 'en' ? 'en' : (navigator.language || '').toLowerCase().match(/^(nb|nn|no)/) ? 'nb' : 'en';
const t = () => STRINGS[lang];
let home = null;
let world = null;
let hero = null;

function paintStrings() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const v = t()[node.dataset.i18n];
    if (typeof v === 'string') node.textContent = v;
  }
  $('lang').textContent = t().switchLang;
  $('theme').textContent = document.documentElement.dataset.theme === 'dark' ? t().light : t().dark;
}

/** The map entry's preview: today's crises as rings on the Atlas outline. */
function paintMapPreview() {
  const box = $('preview-map');
  if (!world || !home) return;
  const rings = home.crises.slice(0, 10).map((c, i) => {
    const [x, y] = toView(c.center[0], c.center[1]);
    const r = 4 + 14 * Math.sqrt((c.score || c.last7d / 4) / Math.max(1, home.crises[0].score || 1));
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="0.8" vector-effect="non-scaling-stroke"/>` +
      (i < 4 ? `<text x="${(x + r + 4).toFixed(1)}" y="${(y + 3).toFixed(1)}" class="pv-label">${esc(lang === 'nb' ? c.shortNb : c.short).toUpperCase()}</text>` : '');
  }).join('');
  const dots = home.points.filter((p) => p[2] >= home.days.length - 7).map((p) => {
    const [x, y] = toView(p[0] / 10, p[1] / 10);
    return p[4] ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.4" class="pv-dot"/>` : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.2" class="pv-hollow"/>`;
  }).join('');
  box.innerHTML = `<svg viewBox="40 30 920 420" preserveAspectRatio="xMidYMid slice">
    <defs><pattern id="pv-st" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.5" class="pv-stipple"/></pattern></defs>
    <g>${world.countries.map((c) => `<path d="${c.path}" fill="url(#pv-st)" class="pv-land"/>`).join('')}</g>
    <g>${dots}</g><g class="pv-rings">${rings}</g></svg>`;
}

/** The Brief entry's preview: today's lead headline, with its outlet named. */
function paintBriefPreview() {
  const box = $('preview-brief');
  const lead = home?.brief?.headlines?.[0];
  if (!lead) { box.innerHTML = ''; return; }
  const date = new Date(`${home.brief.date}T00:00:00Z`).toLocaleDateString(lang === 'nb' ? 'nb-NO' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  box.innerHTML = `<p class="meta">${esc(t().briefToday(date))}</p><p class="preview-headline">${esc(lead.headline)}</p><p class="meta">${esc(lead.publisher)}</p>`;
}

function setupToggles() {
  $('lang').addEventListener('click', () => {
    lang = lang === 'en' ? 'nb' : 'en';
    safeSet('igred-lang', lang);
    paintStrings(); paintMapPreview(); paintBriefPreview();
    restartHero();
  });
  $('theme').addEventListener('click', () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    safeSet('igred-theme-v2', root.dataset.theme);
    paintStrings();
  });
}

function restartHero() {
  if (!home || !world) return;
  hero?.stop();
  $('hero-scene').replaceChildren();
  const q = new URLSearchParams(location.search);
  const at = q.has('at') ? Number(q.get('at')) : null;
  hero = startHero({ canvas: $('hero-canvas'), scene: $('hero-scene'), data: home, world, strings: t(), lang, freezeAt: Number.isFinite(at) ? at : null });
}

async function start() {
  paintStrings();
  setupToggles();
  try {
    [home, world] = await Promise.all([
      fetch(`${DATA}home.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch('world.json').then((r) => r.json()),
    ]);
  } catch {
    return; // the page stands without the live parts
  }
  paintMapPreview();
  paintBriefPreview();
  // After the page has painted, so the film never competes with the first render.
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200)))(restartHero);
}

start();
