/**
 * A crisis on its own page: the crisis view full width, a small map above it framed on the
 * crisis, and a link to the same view on the main map. Shares everything with the map page;
 * only the layout differs. The id comes from the page (site/crisis/<id>/) or ?id= for
 * automatic crises, which have no page of their own.
 */
import { prefs, setupPrefs, $, getJson, Incidents, shortName, crisisName, fmtStamp, hoursOld } from './common.js';
import { renderCrisis } from './view.js';
import { createMap } from './mapcore.js';

const id = document.body.dataset.crisis || new URLSearchParams(location.search).get('id');
const state = { w: 7, tab: null, index: null, inc: null, detail: null, entry: null };
let atlas = null;

function ctx() {
  return {
    inc: state.inc, w: state.w, asOf: null,
    get cvTab() { return state.tab; },
    set cvTab(v) { state.tab = v; },
    onZoom: (center, zoom) => { atlas?.flyTo(center, zoom); window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); },
  };
}

function paint() {
  const t = prefs.t;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const v = t[node.dataset.i18n];
    if (typeof v === 'string') node.textContent = v;
  }
  $('method').textContent = t.method;
  $('ranking').textContent = t.ranking;
  if (state.inc) $('updated').textContent = `${t.updated} ${fmtStamp(state.inc.generatedAt)}`;
  if (state.entry) {
    document.title = `${crisisName(state.entry)} · IGRED Global Conflict Monitor`;
    renderCrisis($('detail'), ctx(), state.entry, state.detail);
  }
}

function frame() {
  const c = state.entry;
  let [w, s, e, n] = c.bbox;
  for (const f of c.fips) {
    if (f === 'RS') continue;
    const box = atlas.countryBounds(f);
    if (!box) continue;
    w = Math.min(w, box[0]); s = Math.min(s, box[1]); e = Math.max(e, box[2]); n = Math.max(n, box[3]);
  }
  atlas.map.fitBounds([[w, s], [e, n]], { padding: 24, maxZoom: 6, duration: 0 });
}

async function start() {
  setupPrefs({ langButton: $('lang'), themeButton: $('theme'), onChange: (what) => { if (what === 'theme') atlas?.repaint(); paint(); } });
  paint();
  const up = location.pathname.includes(`/crisis/${id}/`) ? '../../' : '../';
  const mapReady = createMap($('map'), { vendor: `${up}vendor/countries-50m.json`, cooperative: true, padding: 24 });
  try {
    const [index, events, detail] = await Promise.all([getJson('crises.json'), getJson('map-events.json'), getJson(`crises/${encodeURIComponent(id)}.json`)]);
    state.index = index;
    state.inc = new Incidents(events);
    state.detail = detail;
    state.entry = index.crises.find((c) => c.id === id);
  } catch {
    $('banner').hidden = false;
    $('banner').textContent = prefs.t.loadError;
    return;
  }
  if (!state.entry) return;
  $('onmap').href = `${up}#crisis=${encodeURIComponent(id)}`;
  const hours = hoursOld(state.inc.generatedAt);
  if (hours >= 3) { $('banner').hidden = false; $('banner').textContent = prefs.t.stale(hours); }
  paint();

  atlas = await mapReady;
  const inc = state.inc;
  const [from] = inc.range(30, null);
  const feats = [];
  inc.rows.forEach((r, i) => {
    if (r[0] * 60000 < from || inc.crisis(r) !== id) return;
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [inc.lon(r), inc.lat(r)] }, properties: { i, k: r[4], o: r[7] >= 2 ? 1 : 0, v: inc.verified(r) ? 1 : 0, c: id } });
  });
  atlas.setEvents(feats);
  atlas.setOpenCrisis(id, state.entry.fips);
  atlas.setMarkers([{ id, label: shortName(state.entry), center: state.entry.center }], () => {});
  atlas.updateMarkers(new Map([[id, { size: 18, rank: 0 }]]));
  frame();
}

start();
