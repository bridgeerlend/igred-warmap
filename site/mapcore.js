/**
 * The Atlas map in MapLibre: black sea, stippled land, fine coastlines, incidents in ember.
 * Drawn from Natural Earth 1:50m shipped in vendor/ — no third-party tiles, no style server.
 *
 * Uncertainty is visible in the mark itself: an incident resting on a single source is a
 * hollow ring; one carried by two or more independent outlets is filled. Incidents an
 * IGRED analyst has verified are magenta, and nothing else ever is.
 */
import { FIPS_TO_ISO_N, ISO_N_TO_FIPS, NAME_TO_FIPS } from './countries.js';

const maplibregl = window.maplibregl;
const topojson = window.topojson;

export const WORLD = [[-160, -50], [178, 72]];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function palette() {
  return {
    bg: css('--bg'), land: css('--land'), coast: css('--coast'), stipple: Number(css('--stipple-opacity')) || 0.2,
    s: [css('--s1'), css('--s2'), css('--s3'), css('--s4'), css('--s5')],
    verified: css('--verified'), pick: css('--pick'),
  };
}

/** Two dots per tile, offset, as the SVG Atlas map drew its land. */
function stippleImage(p) {
  const ratio = 2;
  const size = 5 * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = p.land;
  g.globalAlpha = p.stipple * 1.35;
  g.beginPath(); g.arc(1.5 * ratio, 1.5 * ratio, 0.62 * ratio, 0, Math.PI * 2); g.fill();
  g.globalAlpha = p.stipple * 0.9;
  g.beginPath(); g.arc(4 * ratio, 4 * ratio, 0.42 * ratio, 0, Math.PI * 2); g.fill();
  return { image: g.getImageData(0, 0, size, size), ratio };
}

const ember = (p) => ['match', ['get', 'k'], 1, p.s[0], 2, p.s[1], 3, p.s[2], 4, p.s[3], p.s[4]];
const radius = (base) => ['interpolate', ['linear'], ['zoom'],
  1, ['+', base, ['*', 0.5, ['get', 'k']]],
  5, ['+', base + 1.4, ['*', 0.95, ['get', 'k']]],
  9, ['+', base + 3, ['*', 1.5, ['get', 'k']]]];

/** Rings that cross the antimeridian are unwrapped past 180°, or they draw across the map. */
function loadWorld(topo) {
  const world = topojson.feature(topo, topo.objects.countries);
  world.features = world.features.filter((f) => f.id !== '010');
  const boxes = new Map();
  for (const f of world.features) {
    const polys = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) for (const ring of poly) {
      let jumps = false;
      for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i][0] - ring[i - 1][0]) > 180) { jumps = true; break; }
      if (jumps) for (const pt of ring) if (pt[0] < 0) pt[0] += 360;
    }
    const name = f.properties?.name ?? '';
    const fips = ISO_N_TO_FIPS[String(f.id ?? '')] ?? NAME_TO_FIPS[name] ?? null;
    f.properties = { iso: String(f.id ?? name), name, fips: fips ?? `n${f.id ?? name}` };
    // Bounds from the largest polygon only: France's are otherwise in South America.
    let best = null, bestArea = -1;
    for (const poly of polys) {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of poly[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
      const area = (e - w) * (n - s);
      if (area > bestArea) { bestArea = area; best = [w, s, e, n]; }
    }
    if (best) boxes.set(f.properties.fips, best);
  }
  return { world, boxes };
}

export async function createMap(container, options = {}) {
  const topo = await fetch(options.vendor ?? 'vendor/countries-50m.json').then((r) => r.json());
  const { world, boxes } = loadWorld(topo);
  const names = new Map(world.features.map((f) => [f.properties.fips, f.properties.name]));
  const p = palette();

  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        countries: { type: 'geojson', data: world },
        events: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        pulse: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'sea', type: 'background', paint: { 'background-color': p.bg } },
        { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-pattern': 'stipple' } },
        { id: 'land-hit', type: 'fill', source: 'countries', paint: { 'fill-color': '#000', 'fill-opacity': 0 } },
        { id: 'coast', type: 'line', source: 'countries', paint: { 'line-color': p.coast, 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.35, 6, 0.9] } },
        { id: 'crisis-line', type: 'line', source: 'countries', filter: ['in', ['get', 'fips'], ['literal', ['-']]], paint: { 'line-color': p.pick, 'line-opacity': 0.45, 'line-width': 0.8 } },
        { id: 'pick-line', type: 'line', source: 'countries', filter: ['==', ['get', 'fips'], '-'], paint: { 'line-color': p.pick, 'line-width': 1.2 } },
        {
          id: 'ev-hollow', type: 'circle', source: 'events', filter: ['all', ['==', ['get', 'o'], 0], ['==', ['get', 'v'], 0]],
          layout: { 'circle-sort-key': ['get', 'k'] },
          paint: { 'circle-radius': radius(1.1), 'circle-color': p.bg, 'circle-opacity': 0, 'circle-stroke-color': ember(p), 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 0.8, 6, 1.2], 'circle-stroke-opacity': 0.72 },
        },
        {
          id: 'ev-filled', type: 'circle', source: 'events', filter: ['all', ['==', ['get', 'o'], 1], ['==', ['get', 'v'], 0]],
          layout: { 'circle-sort-key': ['get', 'k'] },
          paint: { 'circle-radius': radius(1.3), 'circle-color': ember(p), 'circle-opacity': 0.95, 'circle-stroke-color': p.bg, 'circle-stroke-width': 0.6 },
        },
        {
          id: 'ev-verified', type: 'circle', source: 'events', filter: ['==', ['get', 'v'], 1],
          paint: { 'circle-radius': radius(1.8), 'circle-color': p.verified, 'circle-stroke-color': p.verified, 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.5 },
        },
        { id: 'pulse', type: 'circle', source: 'pulse', paint: { 'circle-radius': 4, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': p.s[2], 'circle-stroke-width': 1, 'circle-stroke-opacity': 0 } },
      ],
    },
    bounds: options.bounds ?? WORLD,
    fitBoundsOptions: { padding: options.padding ?? 16 },
    minZoom: 0,
    maxZoom: 10,
    renderWorldCopies: false,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    interactive: options.interactive !== false,
    cooperativeGestures: !!options.cooperative,
    locale: options.locale,
  });
  map.touchZoomRotate.disableRotation();
  map.on('styleimagemissing', (e) => {
    if (e.id === 'stipple' && !map.hasImage('stipple')) {
      const { image, ratio } = stippleImage(palette());
      map.addImage('stipple', image, { pixelRatio: ratio });
    }
  });
  await new Promise((resolve) => map.on('load', resolve));
  if (!options.bounds) map.fitBounds(WORLD, { padding: options.padding ?? 16, duration: 0 });

  const EVENT_LAYERS = ['ev-verified', 'ev-filled', 'ev-hollow'];
  const markers = new Map();
  let openCrisis = null;

  const api = {
    map, names, boxes, world,

    repaint() {
      const q = palette();
      map.setPaintProperty('sea', 'background-color', q.bg);
      map.setPaintProperty('coast', 'line-color', q.coast);
      map.setPaintProperty('crisis-line', 'line-color', q.pick);
      map.setPaintProperty('pick-line', 'line-color', q.pick);
      map.setPaintProperty('ev-hollow', 'circle-stroke-color', ember(q));
      map.setPaintProperty('ev-filled', 'circle-color', ember(q));
      map.setPaintProperty('ev-filled', 'circle-stroke-color', q.bg);
      map.setPaintProperty('ev-verified', 'circle-color', q.verified);
      map.setPaintProperty('ev-verified', 'circle-stroke-color', q.verified);
      map.setPaintProperty('pulse', 'circle-stroke-color', q.s[2]);
      if (map.hasImage('stipple')) map.removeImage('stipple');
      const { image, ratio } = stippleImage(q);
      map.addImage('stipple', image, { pixelRatio: ratio });
    },

    setEvents(features) {
      map.getSource('events').setData({ type: 'FeatureCollection', features });
    },

    /** Others fade back while a crisis is open, so its own incidents read first. */
    setOpenCrisis(id, fips = []) {
      openCrisis = id;
      map.setFilter('crisis-line', ['in', ['get', 'fips'], ['literal', fips.length ? fips : ['-']]]);
      const dim = id === null ? 1 : ['case', ['==', ['get', 'c'], id], 1, 0.22];
      map.setPaintProperty('ev-filled', 'circle-opacity', id === null ? 0.95 : ['case', ['==', ['get', 'c'], id], 0.95, 0.2]);
      map.setPaintProperty('ev-hollow', 'circle-stroke-opacity', id === null ? 0.72 : ['case', ['==', ['get', 'c'], id], 0.8, 0.16]);
      map.setPaintProperty('ev-verified', 'circle-opacity', dim);
      for (const m of markers.values()) m.el.classList.toggle('is-open', m.id === id);
    },

    setPickedCountry(fips) {
      map.setFilter('pick-line', ['==', ['get', 'fips'], fips ?? '-']);
    },

    fit(bounds, padding) {
      map.fitBounds(bounds, { padding, maxZoom: 6.4, duration: reduced() ? 0 : 1100, essential: false, curve: 1.2 });
    },

    flyTo(center, zoom) {
      map.flyTo({ center, zoom, duration: reduced() ? 0 : 1100, curve: 1.2 });
    },

    countryBounds(fips) { return boxes.get(fips) ?? null; },

    /** Crisis markers: a thin ring, and a name in tracked capitals where there is room. */
    setMarkers(list, onClick) {
      for (const m of markers.values()) m.marker.remove();
      markers.clear();
      for (const item of list) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'cm';
        el.setAttribute('aria-label', item.label);
        el.innerHTML = '<span class="cm-ring" aria-hidden="true"></span><span class="cm-label"></span>';
        el.querySelector('.cm-label').textContent = item.label;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(item.id); });
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(item.center).addTo(map);
        markers.set(item.id, { ...item, el, marker });
      }
      api.layoutMarkers();
    },

    updateMarkers(sizes) {
      for (const [id, m] of markers) {
        const s = sizes.get(id) ?? { size: 0, rank: 999 };
        m.size = s.size; m.rank = s.rank;
        m.el.hidden = s.size === 0 && id !== openCrisis;
        m.el.style.setProperty('--size', `${Math.max(10, s.size)}px`);
      }
      api.layoutMarkers();
    },

    /**
     * Names never collide and the largest crisis claims its place first. In the overview
     * only the six largest are named; zoomed in, any that fit.
     */
    layoutMarkers() {
      const zoom = map.getZoom();
      const placed = [];
      const ranked = [...markers.values()].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      for (const m of ranked) {
        if (m.el.hidden) continue;
        const pt = map.project(m.marker.getLngLat());
        const r = Math.max(10, m.size ?? 10) / 2;
        const w = 7.4 * m.label.length + 12;
        const box = { x0: pt.x + r + 2, x1: pt.x + r + 2 + w, y0: pt.y - 9, y1: pt.y + 9 };
        const allowed = m.id === openCrisis || (openCrisis === null && (m.rank < 6 || zoom >= 3.2));
        const clash = placed.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1));
        const show = allowed && (!clash || m.id === openCrisis);
        m.el.classList.toggle('show-label', show);
        if (show) placed.push(box);
      }
    },

    /** One short pulse where new incidents came in since the last look. */
    pulse(coords) {
      if (reduced() || coords.length === 0) return;
      map.getSource('pulse').setData({ type: 'FeatureCollection', features: coords.map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })) });
      const start = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - start) / 1600);
        map.setPaintProperty('pulse', 'circle-radius', 3 + 18 * k);
        map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.8 * (1 - k));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    onEventClick(handler) {
      map.on('click', (ev) => {
        const pad = 6;
        const hits = map.queryRenderedFeatures([[ev.point.x - pad, ev.point.y - pad], [ev.point.x + pad, ev.point.y + pad]], { layers: EVENT_LAYERS });
        if (hits.length) {
          // The brightest incident under the pointer, not merely the topmost.
          const f = hits.sort((a, b) => (b.properties.v - a.properties.v) || (b.properties.k - a.properties.k))[0];
          handler({ kind: 'event', feature: f });
          return;
        }
        const land = map.queryRenderedFeatures(ev.point, { layers: ['land-hit'] })[0];
        if (land) handler({ kind: 'country', fips: land.properties.fips, name: land.properties.name });
      });
      for (const id of EVENT_LAYERS) {
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
      }
    },
  };

  map.on('move', () => api.layoutMarkers());
  return api;
}

export function isoOf(fips) { return FIPS_TO_ISO_N[fips] ?? null; }
