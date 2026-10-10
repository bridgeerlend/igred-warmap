/**
 * IGRED Global Conflict Monitor — the map page.
 *
 * Data is fetched at view time from the repository, never baked into this page, so the
 * hourly pipeline can commit new JSON without any site rebuild.
 *
 * Two columns at most: the list (or an open crisis or country) on the left, the map on the
 * right. Everything the reader chooses — crisis, country, window, date, view — is in the
 * address, so a link opens exactly the same picture.
 */
import {
  prefs, setupPrefs, h, $, esc, fmtNum, fmtDay, fmtShortDay, fmtStamp, shortName, crisisName,
  getJson, Incidents, scoreOf, changeOf, hoursOld, CATEGORY, DAY,
} from './common.js';
import { renderCrisis, renderCountry } from './view.js';
import { createMap, WORLD } from './mapcore.js';
import { repoUrl } from './config.js';

const state = {
  w: 7,
  asOf: null,          // YYYY-MM-DD, or null for now
  crisis: null,        // id
  country: null,       // FIPS
  tab: null,
  index: null,         // crises.json
  countries: null,     // countries.json
  inc: null,           // Incidents
  features: [],        // one GeoJSON feature per incident, built once
  details: new Map(),
  playing: null,
};

const narrow = () => matchMedia('(max-width: 899px)').matches;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let atlas = null;

/* ---------- address ---------------------------------------------------- */

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const w = Number(q.get('w'));
  state.w = [1, 7, 30].includes(w) ? w : 7;
  const t = q.get('t');
  state.asOf = t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  state.crisis = q.get('crisis');
  state.country = state.crisis ? null : q.get('country');
  state.tab = q.get('tab');
  const v = q.get('v')?.split(',').map(Number);
  return v && v.length === 3 && v.every(Number.isFinite) ? { center: [v[0], v[1]], zoom: v[2] } : null;
}

let hashTimer = null;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const q = new URLSearchParams();
    if (state.crisis) q.set('crisis', state.crisis);
    else if (state.country) q.set('country', state.country);
    if (state.asOf && state.inc && state.asOf !== state.inc.today) q.set('t', state.asOf);
    if (state.w !== 7) q.set('w', String(state.w));
    if (state.tab && state.tab !== 'overview' && state.crisis) q.set('tab', state.tab);
    if (atlas) {
      const c = atlas.map.getCenter();
      q.set('v', `${c.lng.toFixed(2)},${c.lat.toFixed(2)},${atlas.map.getZoom().toFixed(2)}`);
    }
    const next = q.toString();
    if (next !== location.hash.slice(1)) history.replaceState(null, '', next ? `#${next}` : location.pathname);
  }, 150);
}

/* ---------- counting ---------------------------------------------------- */

function windowRows() {
  const [from, to] = state.inc.range(state.w, state.asOf);
  return { from, to, rows: state.inc.select(() => true, from, to), prev: state.inc.select(() => true, from - state.w * DAY, from) };
}

/** Crises ranked for the chosen window: corroborated incidents weighted by severity. */
function rankedCrises() {
  const { rows, prev } = windowRows();
  const by = new Map(state.index.crises.map((c) => [c.id, { c, rows: [], prev: 0 }]));
  for (const r of rows) { const id = state.inc.crisis(r); if (id && by.has(id)) by.get(id).rows.push(r); }
  for (const r of prev) { const id = state.inc.crisis(r); if (id && by.has(id)) by.get(id).prev += 1; }
  return [...by.values()]
    .map((x) => ({ ...x, n: x.rows.length, score: scoreOf(x.rows) }))
    .sort((a, b) => b.score - a.score || b.n - a.n);
}

/* ---------- the overview column ---------------------------------------- */

function renderStandfirst(ranked) {
  const t = prefs.t;
  const { rows } = windowRows();
  const span = t.span(state.w, state.asOf && state.asOf !== state.inc.today ? fmtDay(state.asOf) : null);
  const active = ranked.filter((x) => x.n > 0).length;
  $('standfirst').innerHTML = t.standfirst(fmtNum(rows.length), fmtNum(active), span);
}

function renderList(ranked) {
  const list = $('crisis-list');
  list.replaceChildren(...ranked.map((x) => {
    const pct = state.w === 30 ? null : changeOf(x.n, x.prev);
    return h('li', null, h('button.crisis-row', {
      type: 'button', 'data-id': x.c.id,
      onclick: () => openCrisis(x.c.id),
      onmouseenter: () => markerHover(x.c.id, true),
      onmouseleave: () => markerHover(x.c.id, false),
    },
    h('span.crisis-name', null, shortName(x.c)),
    h('span.crisis-count', null,
      pct === null ? null : h(`span.crisis-change.${pct > 0 ? 'up' : 'down'}`, { title: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` }, `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`),
      h('span.num', null, fmtNum(x.n)))));
  }));
}

function markerHover(id, on) {
  document.querySelector(`.cm[aria-label="${CSS.escape(crisisLabel(id))}"]`)?.classList.toggle('is-hover', on);
}
const crisisLabel = (id) => { const c = state.index.crises.find((x) => x.id === id); return c ? shortName(c) : id; };

/* ---------- the map ----------------------------------------------------- */

function buildFeatures() {
  const inc = state.inc;
  state.features = inc.rows.map((r, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [inc.lon(r), inc.lat(r)] },
    properties: { i, k: r[4], o: r[7] >= 2 ? 1 : 0, v: inc.verified(r) ? 1 : 0, c: inc.crisis(r) ?? '' },
  }));
}

function paintMap(ranked) {
  if (!atlas) return;
  const { from, to } = windowRows();
  const rows = state.inc.rows;
  // Rows are newest first, so the window is one contiguous slice.
  const feats = [];
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i][0] * 60000;
    if (t >= to) continue;
    if (t < from) break;
    feats.push(state.features[i]);
  }
  atlas.setEvents(feats);
  const max = Math.max(1, ...ranked.map((x) => x.score || x.n));
  atlas.updateMarkers(new Map(ranked.map((x, rank) => [x.c.id, { size: x.n === 0 ? 0 : Math.round((narrow() ? 0.65 : 1) * (10 + 24 * Math.sqrt((x.score || x.n * 0.25) / max))), rank }])));
}

function padding() {
  if (narrow()) return { top: 24, bottom: 24, left: 24, right: 24 };
  return { top: 50, bottom: 96, left: 40, right: 40 };
}

function frameCrisis(c) {
  let [w, s, e, n] = c.bbox;
  for (const f of c.fips) {
    if (f === 'RS') continue; // Russia is too large to frame a war fought mostly in Ukraine.
    const box = atlas.countryBounds(f);
    if (!box) continue;
    w = Math.min(w, box[0]); s = Math.min(s, box[1]); e = Math.max(e, box[2]); n = Math.max(n, box[3]);
  }
  atlas.fit([[w, s], [e, n]], padding());
}

/* ---------- popup -------------------------------------------------------- */

let popup = null;
function showIncident(feature) {
  const t = prefs.t;
  const inc = state.inc;
  const r = inc.rows[feature.properties.i];
  const crisisId = inc.crisis(r);
  const crisis = crisisId ? state.index.crises.find((c) => c.id === crisisId) : null;
  const v = inc.verified(r);
  const day = new Date(inc.at(r)).toISOString();
  const repo = repoUrl();
  const template = JSON.stringify({ id: `evt_${inc.id(r)}`, note: '', source: '', verifiedAt: new Date().toISOString().slice(0, 10) }, null, 2);
  const verifyUrl = repo ? `${repo}/new/main?filename=${encodeURIComponent(`config/verified-events/evt_${inc.id(r)}.json`)}&value=${encodeURIComponent(template)}` : null;

  const node = h('div.pop', null,
    h('p.meta', null, CATEGORY[prefs.lang][inc.category(r)] ?? ''),
    h('p.pop-place', null, r[9]),
    h('p.meta', null, [fmtShortDay(day), t.reportsN(r[8]), v ? t.verified : r[7] >= 2 ? t.corroborated(r[7]) : t.oneSource].join(' · ')),
    v ? h('p.pop-note', null, v.note, ' ', h('a', { href: v.source, target: '_blank', rel: 'noopener' }, t.source)) : null,
    r[10] ? h('p.pop-src', null, h('span.meta', null, `${t.source} `), h('a', { href: r[10], target: '_blank', rel: 'noopener' }, inc.publisher(r) || r[10])) : null,
    h('p.pop-actions', null,
      crisis ? h('button.link-button', { type: 'button', onclick: () => { popup?.remove(); openCrisis(crisis.id); } }, t.openCrisis) : null,
      verifyUrl && !v ? h('a.pop-verify', { href: verifyUrl, target: '_blank', rel: 'noopener' }, t.verify) : null));
  popup?.remove();
  popup = new window.maplibregl.Popup({ closeButton: true, maxWidth: '290px', offset: 10, className: 'igred-pop', focusAfterOpen: false })
    .setLngLat(feature.geometry.coordinates).setDOMContent(node).addTo(atlas.map);
}

/* ---------- crisis and country ------------------------------------------ */

function detailCtx() {
  return {
    inc: state.inc, w: state.w, asOf: state.asOf,
    get cvTab() { return state.tab; },
    set cvTab(v) { state.tab = v; writeHash(); },
    onBack: narrow() ? null : closeDetail,
    onClose: narrow() ? closeDetail : null,
    onZoom: (center, zoom) => { atlas.flyTo(center, zoom); if (narrow()) scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); },
    onOpenCrisis: (id) => openCrisis(id),
  };
}

async function loadDetail(id) {
  if (state.details.has(id)) return state.details.get(id);
  const d = await getJson(`crises/${encodeURIComponent(id)}.json`);
  state.details.set(id, d);
  return d;
}

function showDetail() {
  $('overview').hidden = true;
  $('detail').hidden = false;
  document.body.classList.add('has-detail');
  $('rail').scrollTop = 0;
  $('detail').scrollTop = 0;
}

async function openCrisis(id, { frame = true } = {}) {
  const entry = state.index.crises.find((c) => c.id === id);
  if (!entry) return;
  if (state.crisis !== id) state.tab = state.tab && state.crisis === null ? state.tab : null;
  state.crisis = id;
  state.country = null;
  popup?.remove();
  showDetail();
  atlas?.setOpenCrisis(id, entry.fips);
  atlas?.setPickedCountry(null);
  atlas?.layoutMarkers();
  if (frame && atlas) frameCrisis(entry);
  renderCrisis($('detail'), detailCtx(), entry, state.details.get(id) ?? null);
  writeHash();
  try {
    const d = await loadDetail(id);
    if (state.crisis === id) renderCrisis($('detail'), detailCtx(), entry, d);
  } catch {
    // The header is counted from the incident file and already stands on its own.
  }
}

function countryName(fips) {
  const info = state.countries?.countries?.[fips];
  if (info) return prefs.lang === 'nb' ? info.nameNb : info.name;
  return atlas?.names.get(fips) ?? fips;
}

function openCountry(fips, { frame = true } = {}) {
  state.country = fips;
  state.crisis = null;
  popup?.remove();
  showDetail();
  atlas?.setOpenCrisis(null);
  atlas?.setPickedCountry(fips);
  atlas?.layoutMarkers();
  const box = atlas?.countryBounds(fips);
  if (frame && box) atlas.fit([[box[0], box[1]], [box[2], box[3]]], padding());
  const info = state.countries?.countries?.[fips] ?? null;
  const crisisEntry = info?.crisis ? state.index.crises.find((c) => c.id === info.crisis) : state.index.crises.find((c) => c.fips.includes(fips));
  renderCountry($('detail'), detailCtx(), fips, countryName(fips), info, crisisEntry ?? null);
  writeHash();
}

function closeDetail() {
  state.crisis = null;
  state.country = null;
  state.tab = null;
  $('detail').hidden = true;
  $('overview').hidden = false;
  document.body.classList.remove('has-detail');
  atlas?.setOpenCrisis(null);
  atlas?.setPickedCountry(null);
  atlas?.layoutMarkers();
  if (atlas && !narrow()) atlas.fit(WORLD, padding());
  writeHash();
}

function rerenderDetail() {
  if (state.crisis) {
    const entry = state.index.crises.find((c) => c.id === state.crisis);
    renderCrisis($('detail'), detailCtx(), entry, state.details.get(state.crisis) ?? null);
  } else if (state.country) {
    const info = state.countries?.countries?.[state.country] ?? null;
    const crisisEntry = info?.crisis ? state.index.crises.find((c) => c.id === info.crisis) : null;
    renderCountry($('detail'), detailCtx(), state.country, countryName(state.country), info, crisisEntry);
  }
}

/* ---------- search ------------------------------------------------------ */

function searchIndex() {
  const out = [];
  for (const c of state.index.crises) out.push({ kind: 'crisis', label: crisisName(c), alt: `${c.name} ${c.nameNb} ${c.short} ${c.shortNb}`, id: c.id });
  const seen = new Set();
  for (const [fips, info] of Object.entries(state.countries?.countries ?? {})) {
    seen.add(fips);
    out.push({ kind: 'country', label: prefs.lang === 'nb' ? info.nameNb : info.name, alt: `${info.name} ${info.nameNb}`, id: fips });
  }
  for (const [fips, name] of atlas?.names ?? []) if (!seen.has(fips)) out.push({ kind: 'country', label: name, alt: name, id: fips });
  const places = new Map();
  for (const r of state.inc.rows) {
    const name = r[9];
    if (!places.has(name)) places.set(name, { kind: 'place', label: name, alt: name, center: [r[1] / 100, r[2] / 100], n: 0 });
    places.get(name).n += 1;
  }
  out.push(...[...places.values()].sort((a, b) => b.n - a.n));
  return out;
}

function setupSearch() {
  const input = $('search');
  const box = $('results');
  let index = null;
  const kinds = () => ({ crisis: prefs.t.kindCrisis, country: prefs.t.kindCountry, place: prefs.t.kindPlace });
  const pick = (item) => {
    box.hidden = true;
    input.value = '';
    if (item.kind === 'crisis') openCrisis(item.id);
    else if (item.kind === 'country') openCountry(item.id);
    else atlas.flyTo(item.center, 7);
  };
  let current = [];
  input.addEventListener('input', () => {
    index ??= searchIndex();
    const words = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) { box.hidden = true; return; }
    // A name that starts with what was typed beats one that merely contains it: "mali" is Mali, not Somalia.
    const starts = (x) => words.every((w) => new RegExp(`(^|[\\s,(])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(`${x.label} ${x.alt}`));
    const hits = index.filter((x) => words.every((w) => x.alt.toLowerCase().includes(w) || x.label.toLowerCase().includes(w)));
    current = [...hits.filter(starts), ...hits.filter((x) => !starts(x))].slice(0, 8);
    box.hidden = false;
    box.replaceChildren(...(current.length ? current.map((item) => h('button.result', { type: 'button', role: 'option', onclick: () => pick(item) },
      h('span', null, item.label), h('span.meta', null, kinds()[item.kind]))) : [h('p.meta', null, prefs.t.noResults)]));
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && current[0]) { ev.preventDefault(); pick(current[0]); }
    if (ev.key === 'Escape') { box.hidden = true; input.blur(); }
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.search')) box.hidden = true; });
  return () => { index = null; };
}

/* ---------- timeline ----------------------------------------------------- */

function renderTimeline() {
  const inc = state.inc;
  const counts = inc.daily(() => true);
  const max = Math.max(1, ...counts);
  const at = state.asOf ? inc.days.indexOf(state.asOf) : inc.days.length - 1;
  const from = at - state.w + 1;
  $('timeline-bars').replaceChildren(...counts.map((n, i) => h('span', {
    class: i > at ? 'after' : i >= from ? 'on' : 'off',
    style: { height: `${Math.max(1, Math.round((n / max) * 100))}%` },
  })));
  $('asof').value = String(at);
  $('asof-date').textContent = state.asOf && state.asOf !== inc.today ? fmtDay(state.asOf) : `${prefs.t.now} · ${fmtDay(inc.today)}`;
  $('now').hidden = !state.asOf || state.asOf === inc.today;
}

function setAsOf(index) {
  const day = state.inc.days[index];
  state.asOf = day === state.inc.today ? null : day;
  refresh({ keepSearch: true });
}

function togglePlay() {
  if (state.playing) { stopPlay(); return; }
  let i = 0;
  setAsOf(0);
  $('play').textContent = prefs.t.pause;
  // Thirty days in about ten seconds; reduced motion steps a day per second instead.
  const stepMs = reduced() ? 1000 : 330;
  state.playing = setInterval(() => {
    i += 1;
    if (i >= state.inc.days.length) { stopPlay(); return; }
    setAsOf(i);
  }, stepMs);
}

function stopPlay() {
  clearInterval(state.playing);
  state.playing = null;
  $('play').textContent = prefs.t.play;
}

/* ---------- chrome ------------------------------------------------------- */

function renderLegend() {
  const t = prefs.t;
  $('legend').innerHTML =
    `<span class="key"><i class="sw e1"></i><i class="sw e3"></i><i class="sw e5"></i>${esc(t.keyEmber)}</span>` +
    `<span class="key"><i class="sw hollow"></i>${esc(t.keyHollow)}</span>` +
    `<span class="key"><i class="sw filled"></i>${esc(t.keyFilled)}</span>` +
    `<span class="key"><i class="sw verified"></i>${esc(t.keyVerified)}</span>`;
}

function renderStatic() {
  const t = prefs.t;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const v = t[node.dataset.i18n];
    if (typeof v === 'string') node.textContent = v;
  }
  $('search').placeholder = t.search;
  for (const b of $('window').children) {
    const w = Number(b.dataset.w);
    b.textContent = t.win[w];
    b.classList.toggle('is-on', w === state.w);
    b.classList.toggle('quiet', w !== state.w);
    b.setAttribute('aria-pressed', String(w === state.w));
  }
  $('play').textContent = state.playing ? t.pause : t.play;
  $('now').textContent = t.now;
  $('zoom-in').setAttribute('aria-label', t.zoomIn);
  $('zoom-out').setAttribute('aria-label', t.zoomOut);
  $('method').textContent = t.method;
  $('ranking').textContent = t.ranking;
  if (state.inc) $('updated').textContent = `${t.updated} ${fmtStamp(state.inc.generatedAt)}`;
  renderLegend();
}

function checkFreshness() {
  const hours = hoursOld(state.inc.generatedAt);
  const banner = $('banner');
  banner.hidden = hours < 3;
  if (hours >= 3) banner.textContent = prefs.t.stale(hours);
}

function refresh({ keepSearch = false } = {}) {
  renderStatic();
  const ranked = rankedCrises();
  renderStandfirst(ranked);
  renderList(ranked);
  renderTimeline();
  paintMap(ranked);
  if (!$('detail').hidden) rerenderDetail();
  checkFreshness();
  writeHash();
  if (!keepSearch) resetSearch?.();
}

let resetSearch = null;

/* ---------- live updates ------------------------------------------------- */

/** Every ten minutes: if the pipeline has published, redraw and pulse what is new. */
function watch() {
  setInterval(async () => {
    try {
      const next = await getJson('map-events.json');
      if (next.generatedAt === state.inc.generatedAt) return;
      const known = new Set(state.inc.rows.map((r) => r[13]));
      state.inc = new Incidents(next);
      buildFeatures();
      refresh({ keepSearch: true });
      atlas?.pulse(next.events.filter((r) => !known.has(r[13])).slice(0, 60).map((r) => [r[1] / 100, r[2] / 100]));
    } catch {
      // keep showing what is loaded
    }
  }, 10 * 60_000);
}

/* ---------- start -------------------------------------------------------- */

async function start() {
  const view = readHash();
  setupPrefs({ langButton: $('lang'), themeButton: $('theme'), onChange: (what) => {
    if (what === 'theme') atlas?.repaint();
    if (what === 'lang' && atlas) atlas.setMarkers(state.index.crises.map((c) => ({ id: c.id, label: shortName(c), center: c.center })), openCrisis);
    refresh();
  } });
  renderStatic();

  // The map's geometry and the data load side by side; the column does not wait for the map.
  const nb = prefs.lang === 'nb';
  const mapReady = createMap($('map'), {
    padding: narrow() ? 8 : { top: 30, bottom: 90, left: 20, right: 20 },
    cooperative: narrow(),
    locale: {
      'CooperativeGesturesHandler.MobileHelpText': nb ? 'Bruk to fingre for å flytte kartet' : 'Use two fingers to move the map',
      'CooperativeGesturesHandler.WindowsHelpText': nb ? 'Hold Ctrl og rull for å zoome' : 'Use Ctrl + scroll to zoom the map',
      'CooperativeGesturesHandler.MacHelpText': nb ? 'Hold ⌘ og rull for å zoome' : 'Use ⌘ + scroll to zoom the map',
    },
  });

  try {
    const [index, events, countries] = await Promise.all([
      getJson('crises.json'), getJson('map-events.json'), getJson('countries.json').catch(() => null),
    ]);
    state.index = index;
    state.inc = new Incidents(events);
    state.countries = countries;
  } catch {
    const banner = $('banner');
    banner.hidden = false;
    banner.textContent = prefs.t.loadError;
    return;
  }
  if (state.asOf && !state.inc.days.includes(state.asOf)) state.asOf = null;
  buildFeatures();
  refresh();

  for (const b of $('window').children) b.addEventListener('click', () => { state.w = Number(b.dataset.w); refresh({ keepSearch: true }); });
  $('asof').addEventListener('input', (ev) => { stopPlay(); setAsOf(Number(ev.target.value)); });
  $('play').addEventListener('click', togglePlay);
  $('now').addEventListener('click', () => { stopPlay(); state.asOf = null; refresh({ keepSearch: true }); });
  resetSearch = setupSearch();

  if (state.crisis) openCrisis(state.crisis, { frame: false });
  else if (state.country) openCountry(state.country, { frame: false });

  atlas = await mapReady;
  atlas.setMarkers(state.index.crises.map((c) => ({ id: c.id, label: shortName(c), center: c.center })), openCrisis);
  atlas.onEventClick((hit) => {
    if (hit.kind === 'event') showIncident(hit.feature);
    else if (hit.kind === 'country') openCountry(hit.fips, { frame: false });
  });
  atlas.map.on('moveend', writeHash);
  $('zoom-in').addEventListener('click', () => atlas.map.zoomIn());
  $('zoom-out').addEventListener('click', () => atlas.map.zoomOut());
  $('zoom-reset').addEventListener('click', () => atlas.fit(WORLD, padding()));

  refresh({ keepSearch: true });
  if (state.crisis) openCrisis(state.crisis, { frame: !view });
  else if (state.country) openCountry(state.country, { frame: !view });
  if (view) atlas.map.jumpTo(view);

  // A link pasted into the same tab changes only the hash; follow it.
  window.addEventListener('hashchange', () => {
    const before = location.hash;
    const v = readHash();
    if (state.crisis) openCrisis(state.crisis, { frame: !v });
    else if (state.country) openCountry(state.country, { frame: !v });
    else if (!$('detail').hidden) closeDetail();
    if (v) atlas.map.jumpTo(v);
    refresh({ keepSearch: true });
    if (location.hash !== before) history.replaceState(null, '', before);
  });
  watch();
}

start();
