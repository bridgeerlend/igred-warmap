/**
 * igred.org: the institute page.
 *
 * The hero map and the crisis cards read the same crises.json the conflict map uses, so the
 * front page shows this week's picture without anyone updating it. If the data cannot be
 * reached the page still reads as a complete institute page; the live parts simply stay empty.
 */
import { toView } from './projection.js';

const DATA = ['localhost', '127.0.0.1', ''].includes(location.hostname)
  ? '../data/'
  : 'https://raw.githubusercontent.com/bridgeerlend/igred-warmap/main/data/';
const MAP = 'https://map.igred.org/';

const STRINGS = {
  en: {
    wordmarkFull: 'Institute for Geopolitical Risk and Economic Development',
    navMap: 'Conflict map', navBrief: 'The Brief',
    heroTitle: 'Geopolitical risk and economic development, with every source shown',
    heroStandfirst:
      'IGRED is an independent analysis body. We track armed conflict as it is reported, explain each crisis with the numbers behind it, and link every figure to where it came from.',
    ctaMap: 'Open the conflict map', ctaBrief: 'Read today’s Brief',
    liveCaption: (crises, n, t) => `Live: ${crises} crises tracked, ${n} incidents reported in the past seven days. Updated ${t}.`,
    liveOffline: 'The live map is updated every hour at map.igred.org.',
    nowHeading: 'Where it is worst this week',
    nowAll: 'All crises on the map',
    incidents: (n) => `${n} incidents this week`,
    change: (p) => (p >= 0 ? `up ${Math.round(p)}% on last week` : `down ${Math.abs(Math.round(p))}% on last week`),
    productsHeading: 'What we publish',
    kindLive: 'Live, updated every hour',
    kindDaily: 'Daily, one dated edition',
    kindTwiceYearly: 'Twice a year, in preparation',
    kindOngoing: 'Ongoing, in preparation',
    mapName: 'Global Conflict Monitor',
    mapBody: 'A live map of armed conflict. Open any crisis for the latest reporting, the numbers, the background and every source behind them.',
    briefName: 'The IGRED Brief',
    briefBody: 'A daily synthesis of geopolitical risk and economic development, grouped by theme. Each edition is dated and fixed once published, so it can be cited.',
    reportsName: 'Half-yearly reports',
    reportsBody: 'Longer assessments of geopolitical risk, written to the same framework each time so findings can be compared across editions.',
    baseName: 'Knowledge base',
    baseBody: 'Books, articles and research worth reading, each with the institute’s own assessment of what it argues and where it holds.',
    whatHeading: 'About IGRED',
    whatBody1: 'IGRED monitors where political risk and economic conditions meet, and what that means for the countries and sectors exposed to both.',
    whatBody2: 'Everything we publish carries its sources. Each figure names where it came from, when it was collected, and links to the original, so a reader can check the work rather than take it on trust.',
    role: 'Co-Founder and Analyst',
    dark: 'Dark', light: 'Light', switchLang: 'NO', switchLabel: 'Bytt til norsk',
  },
  nb: {
    wordmarkFull: 'Institutt for Geopolitisk Risiko og Økonomisk Utvikling',
    navMap: 'Konfliktkart', navBrief: 'The Brief',
    heroTitle: 'Geopolitisk risiko og økonomisk utvikling, med alle kilder synlige',
    heroStandfirst:
      'IGRED er et uavhengig analysemiljø. Vi følger væpnet konflikt slik den meldes, forklarer hver krise med tallene bak, og lenker hvert tall til der det kommer fra.',
    ctaMap: 'Åpne konfliktkartet', ctaBrief: 'Les dagens Brief',
    liveCaption: (crises, n, t) => `Sanntid: ${crises} kriser fulgt, ${n} hendelser meldt de siste sju dagene. Oppdatert ${t}.`,
    liveOffline: 'Sanntidskartet oppdateres hver time på map.igred.org.',
    nowHeading: 'Der det er verst denne uken',
    nowAll: 'Alle kriser på kartet',
    incidents: (n) => `${n} hendelser denne uken`,
    change: (p) => (p >= 0 ? `opp ${Math.round(p)} prosent fra forrige uke` : `ned ${Math.abs(Math.round(p))} prosent fra forrige uke`),
    productsHeading: 'Hva vi publiserer',
    kindLive: 'Sanntid, oppdateres hver time',
    kindDaily: 'Daglig, én datert utgave',
    kindTwiceYearly: 'To ganger i året, under arbeid',
    kindOngoing: 'Løpende, under arbeid',
    mapName: 'Global Conflict Monitor',
    mapBody: 'Et sanntidskart over væpnet konflikt. Åpne en krise for siste nytt, tallene, bakgrunnen og alle kildene bak.',
    briefName: 'The IGRED Brief',
    briefBody: 'En daglig syntese av geopolitisk risiko og økonomisk utvikling, gruppert etter tema. Hver utgave er datert og står fast når den er publisert, slik at den kan siteres.',
    reportsName: 'Halvårsrapporter',
    reportsBody: 'Grundigere vurderinger av geopolitisk risiko, skrevet etter samme rammeverk hver gang slik at funn kan sammenlignes mellom utgaver.',
    baseName: 'Kunnskapsbase',
    baseBody: 'Bøker, artikler og forskning verdt å lese, hver med instituttets egen vurdering av hva den hevder og hvor den holder.',
    whatHeading: 'Om IGRED',
    whatBody1: 'IGRED overvåker der politisk risiko og økonomiske forhold møtes, og hva det betyr for landene og sektorene som er utsatt for begge.',
    whatBody2: 'Alt vi publiserer bærer kildene sine. Hvert tall oppgir hvor det kommer fra, når det ble hentet, og lenker til originalen, slik at en leser kan etterprøve arbeidet.',
    role: 'Co-Founder and Analyst',
    dark: 'Mørk', light: 'Lys', switchLang: 'EN', switchLabel: 'Switch to English',
  },
};

const state = { lang: 'en', index: null, world: null };
const $ = (id) => document.getElementById(id);
const t = () => STRINGS[state.lang];
const fmt = (n) => Number(n).toLocaleString(state.lang === 'nb' ? 'nb-NO' : 'en-GB');
const name = (c) => (state.lang === 'nb' ? c.nameNb : c.name);
const short = (c) => (state.lang === 'nb' ? c.shortNb : c.short) ?? name(c);
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/* ---------- the hero map: Natural Earth outlines, this week's crises on top ---------- */

function drawLive() {
  const svg = $('live-svg');
  svg.replaceChildren();
  if (state.world) {
    const focus = new Set((state.index?.crises ?? []).filter((c) => c.last7d > 0).flatMap((c) => c.fips).filter((f) => f !== 'RS'));
    const land = svgEl('g', { class: 'lv-land' });
    for (const c of state.world.countries) {
      land.append(svgEl('path', { d: c.path, class: focus.has(c.fips) ? 'lv-focus' : '' }));
    }
    svg.append(land);
  }
  if (!state.index) return;
  const crises = state.index.crises.filter((c) => c.last7d > 0);
  const max = Math.max(1, ...crises.map((c) => c.last7d));
  const top = new Set([...crises].sort((a, b) => b.last7d - a.last7d).slice(0, 7).map((c) => c.id));
  const marks = svgEl('g', { class: 'lv-marks' });
  const labels = svgEl('g', { class: 'lv-labels' });
  for (const c of [...crises].sort((a, b) => a.last7d - b.last7d)) {
    const [x, y] = toView(c.center[0], c.center[1]);
    const r = 4 + 18 * Math.sqrt(c.last7d / max);
    marks.append(svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(1), class: `lv-c l${c.level}` }));
    marks.append(svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 1.8, class: 'lv-core' }));
    if (top.has(c.id)) {
      const label = svgEl('text', { x: (x + r + 4).toFixed(1), y: (y + 4).toFixed(1) });
      label.textContent = short(c);
      labels.append(label);
    }
  }
  svg.append(marks, labels);
}

function caption() {
  const cap = $('live-caption');
  if (!state.index) { cap.textContent = t().liveOffline; return; }
  const crises = state.index.crises;
  const total = crises.reduce((s, c) => s + c.last7d, 0);
  const when = new Date(state.index.generatedAt).toLocaleTimeString(state.lang === 'nb' ? 'nb-NO' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  cap.textContent = t().liveCaption(crises.length, fmt(total), when);
}

/* A crisis without a picture gets its own place on the map instead. */
function locator(c) {
  if (!state.world) return null;
  const [w, s, e, n] = c.bbox;
  const pts = [toView(w, s), toView(e, n), toView(w, n), toView(e, s)];
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  // 16:10, with room around the crisis.
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let wd = Math.max(x1 - x0, 30) * 1.8, ht = Math.max(y1 - y0, 20) * 1.8;
  if (wd / ht > 1.6) ht = wd / 1.6; else wd = ht * 1.6;
  const svg = svgEl('svg', { viewBox: `${(cx - wd / 2).toFixed(1)} ${(cy - ht / 2).toFixed(1)} ${wd.toFixed(1)} ${ht.toFixed(1)}`, class: 'card-loc', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid slice' });
  const own = new Set(c.fips);
  const g = svgEl('g', { class: 'lv-land' });
  for (const k of state.world.countries) g.append(svgEl('path', { d: k.path, class: own.has(k.fips) ? 'lv-focus' : '', 'vector-effect': 'non-scaling-stroke' }));
  svg.append(g);
  const [mx, my] = toView(c.center[0], c.center[1]);
  svg.append(svgEl('circle', { cx: mx.toFixed(1), cy: my.toFixed(1), r: (wd / 40).toFixed(2), class: `lv-c l${c.level}`, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

/* ---------- this week's worst, as cards ---------- */

function cards() {
  const list = $('cards');
  list.closest('section').hidden = !state.index;
  if (!state.index) return;
  const top = [...state.index.crises].sort((a, b) => b.level - a.level || b.last7d - a.last7d).slice(0, 6);
  list.replaceChildren(...top.map((c) => {
    const li = el('li', 'card');
    const a = el('a', 'card-link');
    a.href = `${MAP}#${encodeURIComponent(c.id)}`;
    const pic = el('span', 'card-pic');
    if (c.image) {
      const img = el('img');
      img.src = c.image.src; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => { pic.classList.add('is-empty'); img.remove(); });
      pic.append(img, el('span', 'card-credit', c.image.credit));
    } else {
      pic.classList.add('is-empty');
      const loc = locator(c);
      if (loc) pic.append(loc);
    }
    const body = el('span', 'card-body');
    body.append(el('span', 'card-region', state.lang === 'nb' ? c.regionNb : c.region));
    body.append(el('span', 'card-name', name(c)));
    const stat = el('span', 'card-stat', t().incidents(fmt(c.last7d)));
    if (c.change7dPct !== null && c.prev7d >= 5 && Math.abs(c.change7dPct) >= 15) {
      stat.append(document.createTextNode(`, ${t().change(c.change7dPct)}`));
    }
    body.append(stat);
    if (c.lead) {
      const lead = el('span', 'card-lead');
      lead.append(el('span', 'card-headline', c.lead.title), el('span', 'card-pub', c.lead.publisher));
      body.append(lead);
    }
    a.append(pic, body);
    li.append(a);
    return li;
  }));
  list.removeAttribute('aria-busy');
}

function render() {
  const s = t();
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const v = s[node.dataset.i18n];
    if (typeof v === 'string') node.textContent = v;
  }
  document.documentElement.lang = state.lang;
  $('lang').textContent = s.switchLang;
  $('lang').setAttribute('aria-label', s.switchLabel);
  $('theme').textContent = document.documentElement.dataset.theme === 'dark' ? s.light : s.dark;
  document.title = `IGRED · ${s.wordmarkFull}`;
  drawLive();
  caption();
  cards();
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

function wire() {
  const root = document.documentElement;
  const theme = safeGet('igred-theme');
  root.dataset.theme = theme === 'dark' || theme === 'light' ? theme : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const lang = safeGet('igred-lang');
  state.lang = lang === 'nb' || lang === 'en' ? lang : (navigator.language || '').toLowerCase().startsWith('n') ? 'nb' : 'en';
  $('theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    safeSet('igred-theme', root.dataset.theme);
    render();
  });
  $('lang').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'nb' : 'en';
    safeSet('igred-lang', state.lang);
    render();
  });
}

wire();
render();

const [world, index] = await Promise.allSettled([
  fetch('world.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
  fetch(`${DATA}crises.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
]);
if (world.status === 'fulfilled') state.world = world.value;
if (index.status === 'fulfilled') state.index = index.value;
render();
