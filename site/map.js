/**
 * IGRED Global Conflict Monitor: the map.
 *
 * Data is fetched from the repository at view time, so the hourly ingest never needs a
 * site rebuild. The map draws Natural Earth borders itself; there are no third-party tiles.
 */
import { dataBaseUrl } from './config.js';
import {
  prefs, setupPrefs, h, fmtNum, fmtDate, crisisName, regionName, sparkline, CATEGORY,
} from './common.js';
import { renderCrisis } from './crisis-view.js';

const maplibregl = window.maplibregl;
const topojson = window.topojson;

/** ISO 3166 numeric ids (Natural Earth / world-atlas) for the FIPS codes the data uses. */
const FIPS_TO_ISO_N = {
  UP: '804', RS: '643', IS: '376', GZ: '275', WE: '275', LE: '422', IR: '364', YM: '887', SY: '760', IZ: '368',
  SU: '729', OD: '728', ET: '231', SO: '706', ML: '466', UV: '854', NG: '562', NI: '566', CG: '180', RW: '646',
  BY: '108', CM: '120', CT: '140', CD: '148', MZ: '508', LY: '434', BM: '104', PK: '586', AF: '004', IN: '356',
  RP: '608', TH: '764', HA: '332', MX: '484', CO: '170', EC: '218', VE: '862', TU: '792', KE: '404', ID: '360',
  AJ: '031', BR: '076', UG: '800', FR: '250', BN: '204', TO: '768', GG: '268', BL: '068', HO: '340', BE: '056',
};

const REGIONS = ['Middle East', 'Europe', 'Africa', 'Asia', 'Americas'];
const WORLD = [[-170, -50], [180, 72]];

const state = {
  days: 7,
  region: null,
  crises: [],
  events: null,
  open: null,
  detailCache: new Map(),
  markers: new Map(),
  map: null,
  mapReady: false,
};

const $ = (id) => document.getElementById(id);
const shortName = (c) => (prefs.lang === 'nb' ? c.shortNb : c.short) ?? crisisName(c);
const base = dataBaseUrl();
const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;

/* ---------- colours, read from the stylesheet so both themes stay in one place ---- */

function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    sea: v('--map-sea'), land: v('--map-land'), border: v('--map-border'), coast: v('--map-coast'),
    focus: v('--map-focus'), s: [v('--s1'), v('--s2'), v('--s3'), v('--s4'), v('--s5')], halo: v('--map-halo'),
  };
}

/* ---------- text ------------------------------------------------------- */

function paintStatic() {
  const t = prefs.t;
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = t[n.dataset.t]; });
  $('search').placeholder = t.search;
  document.querySelectorAll('#window button').forEach((b) => { b.textContent = t.win[b.dataset.days]; });
  $('zoom-in').setAttribute('aria-label', t.zoomIn);
  $('zoom-out').setAttribute('aria-label', t.zoomOut);
  $('zoom-reset').setAttribute('aria-label', t.resetView);
  $('legend-text').textContent = t.legend;
  $('rail-foot').textContent = t.colophon;
  renderRegions();
}

/* ---------- data ------------------------------------------------------- */

async function getJson(path) {
  const res = await fetch(`${base}${path}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} for ${path}`);
  return res.json();
}

function countFor(c) {
  return state.days === 1 ? c.last24h : state.days === 7 ? c.last7d : c.last30d;
}

/* ---------- a small locator map for each row ---------------------------- */

function silhouette(c) {
  if (!state.world || !state.countryBox) return '';
  let [w, s, e, n] = crisisBounds(c);
  const midLat = (s + n) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  // Square, padded, in an equirectangular frame corrected for latitude.
  const span = Math.max((e - w) * k, n - s) * 1.35 + 2;
  const cx = (w + e) / 2, cy = midLat;
  w = cx - span / 2 / k; e = cx + span / 2 / k; s = cy - span / 2; n = cy + span / 2;
  const S = 52;
  const px = (x) => (((x - w) / (e - w)) * S).toFixed(1);
  const py = (y) => (((n - y) / (n - s)) * S).toFixed(1);
  const own = new Set(c.fips.map((f) => FIPS_TO_ISO_N[f]));
  let land = '', focus = '';
  for (const f of state.world.features) {
    const b = state.countryBox.get(f.id);
    if (!b || b[2] < w || b[0] > e || b[3] < s || b[1] > n) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let d = '';
    for (const poly of polys) {
      const ring = poly[0];
      const step = Math.max(1, Math.floor(ring.length / 120));
      d += `M${ring.filter((_, i) => i % step === 0).map(([x, y]) => `${px(x)} ${py(y)}`).join('L')}Z`;
    }
    if (own.has(f.id)) focus += d; else land += d;
  }
  let dots = '';
  if (state.events) {
    const idx = state.events.crises.indexOf(c.id);
    const cutoff = Date.now() / 60000 - 30 * 1440;
    let count = 0;
    for (const r of state.events.events) {
      if (r[5] !== idx || r[0] < cutoff) continue;
      const x = r[1] / 100, y = r[2] / 100;
      if (x < w || x > e || y < s || y > n) continue;
      dots += `<circle cx="${px(x)}" cy="${py(y)}" r="${r[4] >= 3 ? 1.5 : 1}"/>`;
      if (++count > 160) break;
    }
  }
  return `<svg class="loc" viewBox="0 0 ${S} ${S}" aria-hidden="true"><path class="loc-land" d="${land}"/><path class="loc-focus" d="${focus}"/><g class="loc-dots">${dots}</g></svg>`;
}

/* ---------- the list --------------------------------------------------- */

function renderRegions() {
  const t = prefs.t;
  const box = $('regions');
  const present = REGIONS.filter((r) => state.crises.some((c) => c.region === r));
  box.replaceChildren(
    h('button', { type: 'button', 'aria-pressed': state.region === null ? 'true' : 'false', onclick: () => setRegion(null) }, t.all),
    ...present.map((r) => h('button', { type: 'button', 'aria-pressed': state.region === r ? 'true' : 'false', onclick: () => setRegion(r) }, t.regions[r] ?? r)),
  );
}

function setRegion(r) {
  state.region = r;
  renderRegions();
  renderList();
  updateMarkers();
}

function visibleCrises() {
  return state.crises
    .filter((c) => !state.region || c.region === state.region)
    .slice()
    .sort((a, b) => countFor(b) - countFor(a) || b.level - a.level);
}

function renderList() {
  const t = prefs.t;
  const list = $('crisis-list');
  const items = visibleCrises();
  $('rail-count').textContent = String(items.length);
  list.replaceChildren(...items.map((c) => {
    const n = countFor(c);
    const pct = c.change7dPct;
    const trend = state.days === 7 && pct !== null && c.prev7d >= 5
      ? h('span', { class: `trend ${pct >= 15 ? 'up' : pct <= -15 ? 'down' : ''}` }, t.vsPrev(pct))
      : null;
    const row = h('li', { class: `crisis-row${state.open === c.id ? ' is-open' : ''}` },
      h('button.crisis-btn', { type: 'button', 'data-id': c.id, onclick: () => openCrisis(c.id), onmouseenter: () => highlight(c.id, true), onmouseleave: () => highlight(c.id, false) },
        h('span.crisis-thumb', { 'data-level': c.level, html: silhouette(c) }),
        h('span.crisis-text', null,
          h('span.crisis-name', null, crisisName(c)),
          h('span.crisis-meta', null, n > 0 ? `${t.incidents(fmtNum(n))} ${t.winShort[state.days]}` : t.quiet, trend ? ' ' : '', trend)),
        h('span.crisis-spark', { html: sparkline(c.spark) })));
    return row;
  }));
  list.removeAttribute('aria-busy');
}

/* ---------- the map ---------------------------------------------------- */

function eventsGeoJson() {
  const cutoff = Date.now() / 60000 - state.days * 1440;
  const features = [];
  const rows = state.events.events;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] < cutoff) continue;
    features.push({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [r[1] / 100, r[2] / 100] },
      properties: { i, k: r[4], c: r[5] },
    });
  }
  // Brightest drawn last, so a heavy incident is never buried under a faint one.
  features.sort((a, b) => a.properties.k - b.properties.k);
  return { type: 'FeatureCollection', features };
}

function buildStyle(world) {
  const p = palette();
  return {
    version: 8,
    sources: {
      countries: { type: 'geojson', data: world },
      events: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': p.sea } },
      { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': p.land, 'fill-antialias': true } },
      { id: 'focus', type: 'fill', source: 'countries', filter: ['in', ['get', 'iso'], ['literal', ['none']]], paint: { 'fill-color': p.focus } },
      { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': p.border, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 1] } },
      {
        id: 'glow', type: 'circle', source: 'events', filter: ['>=', ['get', 'k'], 3],
        paint: {
          'circle-color': ['match', ['get', 'k'], 3, p.s[2], 4, p.s[3], p.s[4]],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['*', 3, ['get', 'k']], 7, ['*', 7, ['get', 'k']]],
          'circle-blur': 1, 'circle-opacity': 0.28,
        },
      },
      {
        id: 'dots', type: 'circle', source: 'events',
        paint: {
          'circle-color': ['match', ['get', 'k'], 1, p.s[0], 2, p.s[1], 3, p.s[2], 4, p.s[3], p.s[4]],
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            1, ['+', 1.1, ['*', 0.55, ['get', 'k']]],
            5, ['+', 2.5, ['*', 1.1, ['get', 'k']]],
            9, ['+', 4, ['*', 1.6, ['get', 'k']]]],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 1, ['+', 0.45, ['*', 0.1, ['get', 'k']]], 6, 0.95],
          'circle-stroke-color': p.halo,
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 0.3, 6, 1],
        },
      },
    ],
  };
}

function repaintMap() {
  if (!state.mapReady) return;
  const m = state.map;
  const p = palette();
  m.setPaintProperty('sea', 'background-color', p.sea);
  m.setPaintProperty('land', 'fill-color', p.land);
  m.setPaintProperty('focus', 'fill-color', p.focus);
  m.setPaintProperty('borders', 'line-color', p.border);
  m.setPaintProperty('dots', 'circle-color', ['match', ['get', 'k'], 1, p.s[0], 2, p.s[1], 3, p.s[2], 4, p.s[3], p.s[4]]);
  m.setPaintProperty('dots', 'circle-stroke-color', p.halo);
  m.setPaintProperty('glow', 'circle-color', ['match', ['get', 'k'], 3, p.s[2], 4, p.s[3], p.s[4]]);
}

function refreshEvents() {
  if (!state.mapReady || !state.events) return;
  state.map.getSource('events').setData(eventsGeoJson());
}

function setFocus(fips) {
  if (!state.mapReady) return;
  const ids = [...new Set((fips ?? []).map((f) => FIPS_TO_ISO_N[f]).filter(Boolean))];
  state.map.setFilter('focus', ['in', ['get', 'iso'], ['literal', ids.length ? ids : ['none']]]);
}

/* crisis markers: an HTML element per crisis, so the labels can use the site's own type */
function buildMarkers() {
  for (const m of state.markers.values()) m.marker.remove();
  state.markers.clear();
  for (const c of state.crises) {
    const el = h('button.cm', { type: 'button', 'data-id': c.id, 'aria-label': crisisName(c), onclick: (ev) => { ev.stopPropagation(); openCrisis(c.id); } },
      h('span.cm-ring', { 'aria-hidden': 'true' }),
      h('span.cm-label', null, shortName(c)));
    el.addEventListener('mouseenter', () => highlight(c.id, true));
    el.addEventListener('mouseleave', () => highlight(c.id, false));
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(c.center).addTo(state.map);
    state.markers.set(c.id, { marker, el, c });
  }
  updateMarkers();
}

function updateMarkers() {
  const max = Math.max(1, ...state.crises.map(countFor));
  const zoom = state.mapReady ? state.map.getZoom() : 1;
  const placed = [];
  const ranked = [...state.markers.values()].sort((a, b) => countFor(b.c) - countFor(a.c));
  for (const { el, c, marker } of ranked) {
    const n = countFor(c);
    const hidden = (state.region && c.region !== state.region) || (n === 0 && c.level === 0);
    el.hidden = hidden;
    if (hidden) continue;
    const size = Math.round(14 + 30 * Math.sqrt(n / max));
    el.style.setProperty('--size', `${size}px`);
    el.dataset.level = String(c.level);
    el.classList.toggle('is-open', state.open === c.id);
    // Labels never collide: the busiest crisis claims its space first.
    const pt = state.mapReady ? state.map.project(marker.getLngLat()) : { x: 0, y: 0 };
    const label = shortName(c);
    const w = 7.2 * label.length + 10;
    const box = { x0: pt.x + size / 2, x1: pt.x + size / 2 + w, y0: pt.y - 10, y1: pt.y + 10 };
    const clash = placed.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1));
    const show = state.open === c.id || (!clash && (zoom >= 2.4 || c.level >= 3 || n >= max * 0.15));
    el.classList.toggle('show-label', show);
    if (show) placed.push(box);
  }
}

function highlight(id, on) {
  const m = state.markers.get(id);
  if (m) m.el.classList.toggle('is-hover', on);
  document.querySelector(`.crisis-btn[data-id="${CSS.escape(id)}"]`)?.classList.toggle('is-hover', on);
}

function panelPadding() {
  if (isNarrow()) return { top: 30, bottom: 30, left: 30, right: 30 };
  const panelOpen = !$('panel').hidden;
  return { top: 70, bottom: 60, left: 40, right: panelOpen ? $('panel').offsetWidth + 40 : 60 };
}

/** The crisis's own countries, joined with where its incidents actually are. Russia is too
 *  large to frame a war fought mostly in Ukraine, so it only counts through its incidents. */
function crisisBounds(c) {
  let [w, s, e, n] = c.bbox;
  for (const f of c.fips) {
    if (f === 'RS') continue;
    const box = state.countryBox?.get(FIPS_TO_ISO_N[f]);
    if (!box) continue;
    w = Math.min(w, box[0]); s = Math.min(s, box[1]); e = Math.max(e, box[2]); n = Math.max(n, box[3]);
  }
  return [w, s, e, n];
}

function flyToCrisis(c) {
  if (!state.mapReady) return;
  const [w, s, e, n] = crisisBounds(c);
  state.map.fitBounds([[w, s], [e, n]], { padding: panelPadding(), maxZoom: 6.2, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900 });
}

/* incident popup */
let popup = null;
function showIncident(feature) {
  const t = prefs.t;
  const r = state.events.events[feature.properties.i];
  const crisisId = r[5] >= 0 ? state.events.crises[r[5]] : null;
  const crisis = crisisId ? state.crises.find((c) => c.id === crisisId) : null;
  const node = h('div.pop', null,
    h('p.pop-cat', null, h('span', { class: `cv-dot i${r[4]}`, 'aria-hidden': 'true' }), CATEGORY[prefs.lang][state.events.categories[r[3]]] ?? ''),
    h('p.pop-place', null, r[8]),
    h('p.pop-meta', null, `${fmtDate(new Date(r[0] * 60000).toISOString())}, ${t.reportsN(r[7])}`),
    r[9] ? h('p.pop-src', null, `${t.source}: `, h('a', { href: r[9], target: '_blank', rel: 'noopener' }, r[10] || r[9])) : null,
    crisis ? h('button.pop-open', { type: 'button', onclick: () => { popup?.remove(); openCrisis(crisis.id); } }, `${t.openCrisis}: ${crisisName(crisis)}`) : null);
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px', offset: 10, className: 'igred-pop' })
    .setLngLat(feature.geometry.coordinates).setDOMContent(node).addTo(state.map);
}

async function initMap() {
  const topo = await fetch('vendor/countries-50m.json').then((r) => r.json());
  const world = topojson.feature(topo, topo.objects.countries);
  // Antarctica takes a fifth of a Mercator map and holds no incidents.
  world.features = world.features.filter((f) => f.id !== '010');
  // Rings that cross the antimeridian (Russia's far east, Fiji) are unwrapped past 180°,
  // or they draw as lines across the whole map.
  for (const f of world.features) {
    const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) for (const ring of poly) {
      let jumps = false;
      for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) { jumps = true; break; }
      if (jumps) for (const pt of ring) if (pt[0] < 0) pt[0] += 360;
    }
  }
  for (const f of world.features) f.properties = { ...(f.properties ?? {}), iso: String(f.id ?? '') };
  state.world = world;
  state.countryBox = new Map();
  for (const f of world.features) {
    let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity;
    const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) for (const [x, y] of poly[0]) { w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y); }
    if (Number.isFinite(w)) state.countryBox.set(f.id, [w, so, e, n]);
  }
  renderList();

  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(world),
    bounds: WORLD,
    fitBoundsOptions: { padding: 20 },
    minZoom: 0.6,
    maxZoom: 10,
    renderWorldCopies: false,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // On a phone the map sits inside a scrolling page: one finger scrolls the page, two move the map.
    cooperativeGestures: isNarrow(),
    locale: {
      'CooperativeGesturesHandler.MobileHelpText': prefs.lang === 'nb' ? 'Bruk to fingre for å flytte kartet' : 'Use two fingers to move the map',
      'CooperativeGesturesHandler.WindowsHelpText': prefs.lang === 'nb' ? 'Hold Ctrl og rull for å zoome' : 'Use Ctrl + scroll to zoom the map',
      'CooperativeGesturesHandler.MacHelpText': prefs.lang === 'nb' ? 'Hold ⌘ og rull for å zoome' : 'Use ⌘ + scroll to zoom the map',
    },
  });
  map.touchZoomRotate.disableRotation();
  state.map = map;

  await new Promise((resolve) => map.on('load', resolve));
  state.mapReady = true;

  map.on('mousemove', 'dots', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'dots', () => { map.getCanvas().style.cursor = ''; });
  map.on('click', 'dots', (ev) => {
    // The brightest incident under the pointer, not merely the topmost.
    const f = [...ev.features].sort((a, b) => b.properties.k - a.properties.k)[0];
    if (f) showIncident(f);
  });
  map.on('move', updateMarkers);

  $('zoom-in').addEventListener('click', () => map.zoomIn());
  $('zoom-out').addEventListener('click', () => map.zoomOut());
  $('zoom-reset').addEventListener('click', () => map.fitBounds(WORLD, { padding: panelPadding() }));
}

/* ---------- the crisis panel ------------------------------------------ */

async function loadDetail(id) {
  if (state.detailCache.has(id)) return state.detailCache.get(id);
  const d = await getJson(`crises/${encodeURIComponent(id)}.json`);
  state.detailCache.set(id, d);
  return d;
}

let lastFocus = null;

async function openCrisis(id, { fromHash = false } = {}) {
  const c = state.crises.find((x) => x.id === id);
  if (!c) return;
  if (!fromHash) history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  lastFocus = document.activeElement;
  state.open = id;
  const panel = $('panel');
  const scroll = $('panel-scroll');
  panel.hidden = false;
  document.body.classList.add('panel-open');
  scroll.replaceChildren(h('p.panel-loading', null, prefs.t.loading));
  renderList();
  updateMarkers();
  setFocus(c.fips);
  flyToCrisis(c);
  try {
    const d = await loadDetail(id);
    if (state.open !== id) return;
    scroll.replaceChildren(renderCrisis(d, {
      mode: 'panel',
      pageUrl: `crisis/?id=${encodeURIComponent(id)}`,
      onClose: closeCrisis,
      onPlace: (p) => {
        if (isNarrow()) closeCrisis({ keepFocus: true });
        state.map.flyTo({ center: [p.lon, p.lat], zoom: 7, padding: panelPadding() });
      },
    }));
    scroll.scrollTop = 0;
    scroll.focus({ preventScroll: true });
  } catch {
    scroll.replaceChildren(h('p.panel-loading', null, prefs.t.crisisError));
  }
}

function closeCrisis({ keepFocus = false } = {}) {
  state.open = null;
  $('panel').hidden = true;
  document.body.classList.remove('panel-open');
  history.replaceState(null, '', location.pathname + location.search);
  setFocus([]);
  renderList();
  updateMarkers();
  if (!keepFocus && lastFocus instanceof HTMLElement) lastFocus.focus({ preventScroll: true });
}

/* ---------- search ----------------------------------------------------- */

function setupSearch() {
  const input = $('search');
  const box = $('search-results');
  let places = null;
  let active = -1;

  const close = () => { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const choose = (item) => {
    close();
    input.value = '';
    input.blur();
    if (item.kind === 'crisis') openCrisis(item.id);
    else state.map?.flyTo({ center: item.at, zoom: 6.5, padding: panelPadding() });
  };

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return close();
    if (!places && state.events) {
      const seen = new Map();
      for (const r of state.events.events) {
        const key = r[8];
        if (!seen.has(key)) seen.set(key, { kind: 'place', label: key, at: [r[1] / 100, r[2] / 100], n: 0 });
        seen.get(key).n += 1;
      }
      places = [...seen.values()].sort((a, b) => b.n - a.n);
    }
    const crises = state.crises
      .filter((c) => `${c.name} ${c.nameNb}`.toLowerCase().includes(q))
      .map((c) => ({ kind: 'crisis', id: c.id, label: crisisName(c), sub: regionName(c) }));
    const hits = [...crises, ...(places ?? []).filter((p) => p.label.toLowerCase().includes(q)).slice(0, 8).map((p) => ({ ...p, sub: prefs.t.incidents(fmtNum(p.n)) }))];
    box.replaceChildren(...(hits.length ? hits.map((item, i) =>
      h('li', { role: 'option', id: `sr-${i}`, class: item.kind, onmousedown: (ev) => { ev.preventDefault(); choose(item); } },
        h('span.sr-label', null, item.label), h('span.sr-sub', null, item.kind === 'place' ? `${prefs.t.place}, ${item.sub}` : item.sub)))
      : [h('li.sr-empty', null, prefs.t.noResults)]));
    box._hits = hits;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  });
  input.addEventListener('keydown', (ev) => {
    const hits = box._hits ?? [];
    if (box.hidden || hits.length === 0) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      [...box.children].forEach((li, i) => li.setAttribute('aria-selected', i === active ? 'true' : 'false'));
      input.setAttribute('aria-activedescendant', `sr-${active}`);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(hits[Math.max(0, active)]);
    } else if (ev.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

/* ---------- start ------------------------------------------------------ */

function setupControls() {
  document.querySelectorAll('#window button').forEach((b) => b.addEventListener('click', () => {
    state.days = Number(b.dataset.days);
    document.querySelectorAll('#window button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    renderList();
    refreshEvents();
    updateMarkers();
  }));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.open && !(ev.target instanceof HTMLInputElement)) closeCrisis();
  });
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id && id !== state.open) openCrisis(id, { fromHash: true });
  });
}

async function start() {
  setupPrefs({
    langButton: $('lang'),
    themeButton: $('theme'),
    onChange: (what) => {
      if (what === 'theme') { repaintMap(); return; }
      paintStatic();
      renderList();
      for (const { el, c } of state.markers.values()) {
        el.querySelector('.cm-label').textContent = shortName(c);
        el.setAttribute('aria-label', crisisName(c));
      }
      updateMarkers();
      if (state.open) openCrisis(state.open, { fromHash: true });
    },
  });
  paintStatic();
  setupControls();
  setupSearch();
  $('status').textContent = prefs.t.loading;

  const mapPromise = initMap();
  try {
    const [index, events] = await Promise.all([getJson('crises.json'), getJson('map-events.json')]);
    state.crises = index.crises;
    state.events = events;
  } catch {
    $('status').textContent = prefs.t.loadError;
    $('status').classList.add('is-error');
    return;
  }
  renderRegions();
  renderList();
  await mapPromise;
  renderList();
  refreshEvents();
  buildMarkers();
  $('status').textContent = '';

  const fromHash = decodeURIComponent(location.hash.slice(1));
  if (fromHash) openCrisis(fromHash, { fromHash: true });
}

start();
