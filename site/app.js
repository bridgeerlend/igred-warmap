/**
 * IGRED Global Conflict Monitor — the map.
 *
 * Data is fetched at view time from the repository, never baked into this page, so the
 * hourly ingest can commit new JSON without any site rebuild.
 *
 * Nothing here invents a value. Every number on screen comes from the published artifact,
 * and every incident renders the sources that back it.
 */
import { toView } from './projection.js';
import { dataBaseUrl, repoUrl, CONFIG } from './config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARTIFACT_VERSION = 1;

/* ---------- language ------------------------------------------------ */

const STRINGS = {
  en: {
    titleLine1: 'The world,', titleLine2: 'at war',
    win1: '24 hours', win7: '7 days', win30: '30 days',
    reset: 'Reset', whereToday: 'Where, today',
    prompt: 'Select any point on the map',
    standfirst: (n, c, w) =>
      `<b>${n}</b> armed ${n === 1 ? 'incident' : 'incidents'} in the last ${w}, across <b>${c}</b> ${c === 1 ? 'country' : 'countries'} with a conflict on record. Each carries its outlet, its date, and a link to what was published. <span class="quiet">Nothing appears here without one.</span>`,
    standfirstEmpty: 'No incidents in this window yet.',
    intensity: 'Intensity', of: 'of',
    reports: (n) => `${n} ${n === 1 ? 'report' : 'reports'}`,
    outlets: (n) => `${n} ${n === 1 ? 'outlet' : 'outlets'}`,
    verified: 'IGRED-verified', reported: 'Reported', unconfirmed: 'Unconfirmed',
    sources: 'Sources',
    keyLow: 'Isolated', keyHigh: 'Heavy', keyVerified: 'IGRED-verified',
    loading: 'Loading…',
    errorTitle: 'The data could not be loaded.',
    errorBody: (url) => `Tried <code>${url}</code>. The map shows nothing rather than showing something unverified.`,
    registerTitle: 'The verified conflict register is not connected yet.',
    registerBody:
      'An incident reaches this map when the register lists its country as actively at war, or when the event type is inherently military. Until the UCDP register is connected, almost everything is held back. Detection of new conflicts runs regardless.',
    staleTitle: 'This data is older than expected.',
    staleBody: (hours) => `Last updated ${hours} hours ago. A source may be down; the map is showing the last good data rather than a gap.`,
    previewTitle: 'Preview data.',
    previewBody: 'This page is showing a captured sample so the layout can be reviewed. It is not live.',
    updated: 'Data updated', window: 'Window', windowDays: (d) => `${d} days`,
    colophon:
      'Incidents come from the GDELT news stream, clustered by this project without any language model, and are shown only with the outlet that reported them. Cartography is drawn from Natural Earth 1:110m (public domain) in the Natural Earth projection — no third-party tiles. Full history is kept in the repository; older data is available on request at',
    zoomHint: 'Scroll or pinch to zoom · drag to pan',
    heat: 'Thermal detections',
    heatOn: 'Hide heat', heatOff: 'Show heat',
    heatNote: (n, instrument) =>
      `<b>${n}</b> satellite thermal detections in the last 24 hours (${instrument}). These are heat signatures, not attacks — a fire may be shelling, a burning depot or land clearance, and the instrument cannot tell them apart.`,
  },
  nb: {
    titleLine1: 'Verden,', titleLine2: 'i krig',
    win1: '24 timer', win7: '7 dager', win30: '30 dager',
    reset: 'Nullstill', whereToday: 'Hvor, i dag',
    prompt: 'Velg et punkt på kartet',
    standfirst: (n, c, w) =>
      `<b>${n}</b> ${n === 1 ? 'væpnet hendelse' : 'væpnede hendelser'} siste ${w}, i <b>${c}</b> ${c === 1 ? 'land' : 'land'} med registrert konflikt. Hver enkelt bærer kilden sin, datoen sin og en lenke til det som ble publisert. <span class="quiet">Ingenting vises her uten.</span>`,
    standfirstEmpty: 'Ingen hendelser i dette tidsrommet ennå.',
    intensity: 'Intensitet', of: 'av',
    reports: (n) => `${n} ${n === 1 ? 'melding' : 'meldinger'}`,
    outlets: (n) => `${n} ${n === 1 ? 'kilde' : 'kilder'}`,
    verified: 'IGRED-verifisert', reported: 'Omtalt', unconfirmed: 'Ubekreftet',
    sources: 'Kilder',
    keyLow: 'Enkeltstående', keyHigh: 'Tung', keyVerified: 'IGRED-verifisert',
    loading: 'Laster…',
    errorTitle: 'Dataene kunne ikke lastes.',
    errorBody: (url) => `Forsøkte <code>${url}</code>. Kartet viser heller ingenting enn noe ubekreftet.`,
    registerTitle: 'Det verifiserte konfliktregisteret er ikke koblet til ennå.',
    registerBody:
      'En hendelse når dette kartet når registeret oppgir landet som i aktiv krig, eller når hendelsestypen i seg selv er militær. Inntil UCDP-registeret er koblet til, holdes nesten alt tilbake. Deteksjon av nye konflikter går uansett.',
    staleTitle: 'Disse dataene er eldre enn forventet.',
    staleBody: (hours) => `Sist oppdatert for ${hours} timer siden. En kilde kan være nede; kartet viser siste gode data i stedet for et hull.`,
    previewTitle: 'Forhåndsvisningsdata.',
    previewBody: 'Denne siden viser et lagret utvalg så layouten kan vurderes. Det er ikke sanntid.',
    updated: 'Data oppdatert', window: 'Tidsrom', windowDays: (d) => `${d} dager`,
    colophon:
      'Hendelsene kommer fra nyhetsstrømmen GDELT, gruppert av dette prosjektet uten noen språkmodell, og vises bare sammen med kilden som meldte dem. Kartografien er tegnet fra Natural Earth 1:110m (offentlig eiendom) i Natural Earth-projeksjonen — ingen kartfliser fra tredjepart. Full historikk ligger i repoet; eldre data fås ved henvendelse til',
    zoomHint: 'Rull eller knip for å zoome · dra for å flytte',
    heat: 'Varmedeteksjoner',
    heatOn: 'Skjul varme', heatOff: 'Vis varme',
    heatNote: (n, instrument) =>
      `<b>${n}</b> satellittmålte varmedeteksjoner siste døgn (${instrument}). Dette er varmesignaturer, ikke angrep — en brann kan være beskytning, et brennende lager eller nedbrenning av mark, og instrumentet skiller dem ikke.`,
  },
};

const CATEGORY = {
  en: {
    armed_clash: 'Armed clash', armed_assault: 'Armed assault',
    aerial_strike: 'Aerial or missile strike', mass_violence: 'Mass violence',
    violent_repression: 'Violent repression', violent_unrest: 'Violent unrest',
    siege_blockade: 'Siege or blockade',
  },
  nb: {
    armed_clash: 'Væpnet sammenstøt', armed_assault: 'Væpnet angrep',
    aerial_strike: 'Luft- eller missilangrep', mass_violence: 'Massevold',
    violent_repression: 'Voldelig undertrykking', violent_unrest: 'Voldelige uroligheter',
    siege_blockade: 'Beleiring eller blokade',
  },
};

/* ---------- state ---------------------------------------------------- */

const state = {
  lang: 'en',
  windowDays: 30,
  world: null,
  events: [],
  generatedAt: null,
  artifactWindowDays: 30,
  selected: null,
  nodes: [],
  view: null,
  home: null,
  dragDistance: 0,
  heat: null,
  showHeat: true,
};

const $ = (id) => document.getElementById(id);
const t = () => STRINGS[state.lang];
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const make = (name, attrs) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
};

/* ---------- data ------------------------------------------------------ */

async function loadJson(base, file) {
  const response = await fetch(`${base}${file}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json();
}

async function load() {
  const preview = new URLSearchParams(location.search).has('preview');
  const base = dataBaseUrl();

  const world = await fetch('world.json').then((r) => r.json());
  state.world = world;

  // The heat layer is additive and independent of which events are shown, so it is attempted
  // in preview mode too — it was previously stranded behind the early return below.
  const loadHeat = () =>
    loadJson(base, 'heat.json')
      .then((heat) => {
        if (heat.artifactVersion !== ARTIFACT_VERSION) return;
        state.heat = heat;
        renderHeat();
        renderScaleKey();
        renderColophon();
      })
      .catch(() => {});

  if (preview) {
    const data = await fetch('preview-events.json').then((r) => r.json());
    applyEvents(data);
    showBanner(t().previewTitle, t().previewBody);
    loadHeat();
    return;
  }

  const events = await loadJson(base, 'events.json');
  // A shape this page does not understand is treated as no data, never rendered blindly.
  if (events.artifactVersion !== ARTIFACT_VERSION) {
    throw new Error(`events.json is version ${events.artifactVersion}, expected ${ARTIFACT_VERSION}`);
  }
  applyEvents(events);

  /*
   * Whether the register is connected is judged from the register itself, not from how many
   * incidents happen to be on screen. An empty register still lets a handful of inherently
   * military events through, and a map showing five points with no explanation looks
   * complete when it is not.
   */
  loadJson(base, 'conflicts.json')
    .then((conflicts) => {
      const active = (conflicts.conflicts ?? []).filter((entry) => entry.status === 'active');
      if (active.length === 0) showBanner(t().registerTitle, t().registerBody);
    })
    .catch(() => {});

  loadHeat();

  // Health is advisory: if it cannot be read, the map still works.
  loadJson(base, 'health.json').then(checkHealth).catch(() => {});
}

function applyEvents(payload) {
  state.generatedAt = payload.generatedAt;
  state.artifactWindowDays = payload.windowDays ?? 30;
  state.events = (payload.events ?? [])
    .filter((event) => Number.isFinite(event.location?.lat) && Number.isFinite(event.location?.lon))
    .map((event) => {
      const [x, y] = toView(event.location.lon, event.location.lat);
      return { ...event, x, y };
    })
    // Faintest first, so the strong points sit on top of the crowd.
    .sort((a, b) => a.intensity - b.intensity || a.reportCount - b.reportCount);
}

function checkHealth(health) {
  const generated = Date.parse(state.generatedAt ?? '');
  if (!Number.isFinite(generated)) return;
  const hours = Math.round((Date.now() - generated) / 3_600_000);
  // Staleness outranks the register notice: a stalled pipeline is the more urgent fact.
  if (hours >= 6) showBanner(t().staleTitle, t().staleBody(hours));
}

function showBanner(title, body) {
  const banner = $('banner');
  banner.hidden = false;
  banner.innerHTML = `<strong>${escapeHtml(title)}</strong> ${body}`;
}

/* ---------- map ------------------------------------------------------- */

function renderWorld() {
  const svg = $('map');
  const world = state.world;
  svg.setAttribute('viewBox', world.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = '';

  const defs = make('defs', {});
  const pattern = make('pattern', { id: 'stipple', width: 3, height: 3, patternUnits: 'userSpaceOnUse' });
  pattern.appendChild(make('circle', { cx: 1, cy: 1, r: 0.52, fill: 'var(--land)', 'fill-opacity': 'var(--stipple-opacity)' }));
  pattern.appendChild(make('circle', { cx: 2.5, cy: 2.5, r: 0.3, fill: 'var(--land)', 'fill-opacity': 'var(--stipple-opacity)' }));
  defs.appendChild(pattern);
  svg.appendChild(defs);

  const fills = make('g', {});
  const lines = make('g', {});
  for (const country of world.countries) {
    fills.appendChild(make('path', { d: country.path, class: 'land-fill' }));
    lines.appendChild(make('path', { d: country.path, class: 'land-line', 'vector-effect': 'non-scaling-stroke' }));
  }
  svg.append(fills, lines);

  state.home = { x: 0, y: 0, w: world.width, h: world.height };
  state.view = { ...state.home };
}

/**
 * Thermal detections, drawn beneath the incidents as a diffuse field rather than as marks.
 * They are a different kind of thing from a sourced incident and must not be mistaken for
 * one, so they carry no outline, no interaction and a distinctly cooler treatment.
 */
function renderHeat() {
  const svg = $('map');
  svg.querySelector('.heat')?.remove();
  if (!state.heat || !state.showHeat) return;

  const layer = make('g', { class: 'heat', 'aria-hidden': 'true' });
  const busiest = state.heat.cells.reduce((max, cell) => Math.max(max, cell.detections), 1);

  for (const cell of state.heat.cells) {
    const [x, y] = toView(cell.lon, cell.lat);
    // Square root keeps a single huge wildfire from swamping everything else.
    const weight = Math.sqrt(cell.detections / busiest);
    layer.appendChild(
      make('circle', {
        cx: x.toFixed(1),
        cy: y.toFixed(1),
        r: (1.2 + weight * 3.4).toFixed(2),
        fill: 'var(--heat)',
        'fill-opacity': (0.10 + weight * 0.30).toFixed(3),
      }),
    );
  }

  // Beneath the incidents: heat is context, not the subject.
  const points = svg.querySelector('.points');
  if (points) svg.insertBefore(layer, points);
  else svg.appendChild(layer);
}

function renderPoints() {
  const svg = $('map');
  svg.querySelector('.points')?.remove();

  const layer = make('g', { class: 'points' });
  state.nodes = [];

  for (const event of visibleEvents()) {
    const verified = event.confidence === 'verified';
    const tone = verified ? 'var(--verified)' : `var(--s${event.intensity})`;
    const group = make('g', { class: 'evt', tabindex: '0', role: 'button' });

    const halo = make('circle', { cx: event.x, cy: event.y, class: 'halo', fill: tone });
    const dot = make('circle', { cx: event.x, cy: event.y, class: 'dot', fill: tone, 'fill-opacity': 0.55 + event.intensity * 0.09 });
    // An invisible target: at world zoom on a phone a point is under a pixel wide, which
    // is impossible to tap. The visible mark stays small; the reachable area does not.
    const hit = make('circle', { cx: event.x, cy: event.y, class: 'hit', fill: 'transparent' });
    group.append(halo, dot, hit);

    // Verified incidents carry a ring as well as the accent colour, so the distinction
    // never rests on hue alone.
    const ring = verified
      ? make('circle', { cx: event.x, cy: event.y, class: 'vring', fill: 'none', stroke: 'var(--verified)', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke' })
      : null;
    if (ring) group.appendChild(ring);

    const title = make('title', {});
    title.textContent = `${categoryLabel(event.category)} — ${event.location.name}`;
    group.appendChild(title);

    layer.appendChild(group);
    state.nodes.push({ event, group, halo, dot, ring, hit });
  }

  svg.appendChild(layer);
  sizePoints();
  // Points were just appended on top; put the heat field back underneath them.
  const heat = svg.querySelector('.heat');
  if (heat) svg.insertBefore(heat, layer);
}

/**
 * Point radii are recomputed against the current zoom so their on-screen size stays
 * roughly constant. Zooming in should separate a cluster, not inflate it into a blob.
 */
function sizePoints() {
  const zoom = state.view.w / state.home.w;
  const rect = $('map').getBoundingClientRect();
  // View units per rendered pixel, so sizes can be expressed as real on-screen sizes.
  const perPixel = rect.width > 0 ? state.view.w / rect.width : 1;
  // A floor rather than a clamp: clamping to a minimum made every point on a phone the
  // same size and erased the intensity scale. Adding a floor keeps the spread visible.
  const floor = 1.5 * perPixel;
  const minTarget = 13 * perPixel;

  for (const node of state.nodes) {
    const base = floor + (1.1 + node.event.intensity * 0.72) * Math.pow(zoom, 0.75);
    node.dot.setAttribute('r', base.toFixed(2));
    node.halo.setAttribute('r', (base * 2.5).toFixed(2));
    node.halo.setAttribute('opacity', (0.05 + node.event.intensity * 0.035).toFixed(3));
    node.group.style.setProperty('--r0', base.toFixed(2));
    node.ring?.setAttribute('r', (base + 2.6 * Math.pow(zoom, 0.75)).toFixed(2));
    node.hit.setAttribute('r', Math.max(base * 1.6, minTarget).toFixed(2));
  }
}

function visibleEvents() {
  const cutoff = Date.now() - state.windowDays * 86_400_000;
  return state.events.filter((event) => Date.parse(event.occurredAt) >= cutoff);
}

/* ---------- zoom and pan ---------------------------------------------- */

const MIN_ZOOM = 0.06;

function applyView() {
  const { x, y, w, h } = state.view;
  $('map').setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  sizePoints();
}

function zoomBy(factor, originX, originY) {
  const view = state.view;
  const home = state.home;
  const nextW = Math.min(home.w, Math.max(home.w * MIN_ZOOM, view.w * factor));
  const scale = nextW / view.w;
  const nextH = view.h * scale;

  // Keep the point under the cursor fixed while the frame shrinks around it.
  const fx = originX === undefined ? view.x + view.w / 2 : originX;
  const fy = originY === undefined ? view.y + view.h / 2 : originY;

  state.view = {
    w: nextW,
    h: nextH,
    x: fx - (fx - view.x) * scale,
    y: fy - (fy - view.y) * scale,
  };
  clampView();
  applyView();
}

function clampView() {
  const view = state.view;
  const home = state.home;
  view.x = Math.min(Math.max(view.x, -home.w * 0.15), home.w * 1.15 - view.w);
  view.y = Math.min(Math.max(view.y, -home.h * 0.15), home.h * 1.15 - view.h);
}

function svgPoint(event) {
  const svg = $('map');
  const rect = svg.getBoundingClientRect();
  const view = state.view;
  // The SVG letterboxes inside its box, so map through the rendered scale, not the box.
  const scale = Math.min(rect.width / view.w, rect.height / view.h);
  const drawnW = view.w * scale;
  const drawnH = view.h * scale;
  const offsetX = rect.left + (rect.width - drawnW) / 2;
  const offsetY = rect.top + (rect.height - drawnH) / 2;
  return {
    x: view.x + (event.clientX - offsetX) / scale,
    y: view.y + (event.clientY - offsetY) / scale,
  };
}

/** Rendered pixels per view unit, accounting for the SVG letterboxing in its box. */
function renderScale() {
  const rect = $('map').getBoundingClientRect();
  return Math.min(rect.width / state.view.w, rect.height / state.view.h) || 1;
}

function wireZoom() {
  const svg = $('map');
  const pointers = new Map();
  let pinchDistance = null;
  let lastPan = null;

  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const at = svgPoint(ev);
    zoomBy(Math.exp(ev.deltaY * 0.0015), at.x, at.y);
  }, { passive: false });

  svg.addEventListener('pointerdown', (ev) => {
    svg.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    state.dragDistance = 0;

    if (pointers.size === 1) {
      lastPan = { x: ev.clientX, y: ev.clientY };
      svg.classList.add('is-panning');
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      lastPan = null;
    }
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pointers.size >= 2 && pinchDistance) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > 0) {
        zoomBy(pinchDistance / distance);
        pinchDistance = distance;
      }
      return;
    }

    if (!lastPan) return;
    const scale = renderScale();
    const dx = (ev.clientX - lastPan.x) / scale;
    const dy = (ev.clientY - lastPan.y) / scale;
    lastPan = { x: ev.clientX, y: ev.clientY };
    // Track total travel so a drag that ends on a point does not also select it.
    state.dragDistance += Math.abs(dx) + Math.abs(dy);

    state.view.x -= dx;
    state.view.y -= dy;
    clampView();
    applyView();
  });

  const release = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchDistance = null;
    if (pointers.size === 0) {
      svg.classList.remove('is-panning');
      lastPan = null;
    }
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('lostpointercapture', release);

  $('zoom-in').addEventListener('click', () => zoomBy(0.7));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / 0.7));
  $('zoom-reset').addEventListener('click', () => {
    state.view = { ...state.home };
    applyView();
  });
}

/* ---------- selection -------------------------------------------------- */

function categoryLabel(key) {
  return CATEGORY[state.lang][key] ?? key;
}

function select(node) {
  if (state.selected === node) return clearSelection();
  state.selected?.group.classList.remove('selected');
  state.selected = node;
  $('plate').classList.add('dimmed');
  node.group.classList.add('selected');
  renderDetail(node.event);
}

function clearSelection() {
  $('plate').classList.remove('dimmed');
  state.selected?.group.classList.remove('selected');
  state.selected = null;
  renderDetail(null);
}

function renderDetail(event) {
  const detail = $('detail');
  if (!event) {
    detail.innerHTML = `<p class="prompt">${escapeHtml(t().prompt)}</p>`;
    return;
  }

  const confidence =
    event.confidence === 'verified' ? `<span class="vmark">${escapeHtml(t().verified)}</span>`
    : event.confidence === 'reported' ? escapeHtml(t().reported)
    : escapeHtml(t().unconfirmed);

  // Every visible incident shows the sources behind it — that is the whole contract.
  const sources = event.provenance.slice(0, 6).map((entry) => {
    const outlet = entry.publisher ?? entry.sourceName;
    const when = (entry.publishedAt ?? entry.retrievedAt ?? '').slice(0, 10);
    return `<li><a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(outlet)}</a> <span class="outlet">· ${escapeHtml(when)}</span></li>`;
  }).join('');

  detail.innerHTML =
    `<h2 class="detail-place">${escapeHtml(event.location.name)}</h2>` +
    `<div class="detail-meta">` +
      `<span>${escapeHtml(categoryLabel(event.category))}</span>` +
      `<span>${escapeHtml(event.occurredAt.slice(0, 10))}</span>` +
      `<span>${escapeHtml(t().intensity)} ${event.intensity} ${escapeHtml(t().of)} 5</span>` +
      `<span>${escapeHtml(t().reports(event.reportCount))} · ${escapeHtml(t().outlets(event.distinctPublishers))}</span>` +
      `<span>${confidence}</span>` +
    `</div>` +
    `<ul class="detail-sources">${sources}</ul>`;
}

/* ---------- index ------------------------------------------------------ */

function renderIndex() {
  const grid = $('index-grid');
  grid.innerHTML = '';

  const byPlace = new Map();
  for (const node of state.nodes) {
    const key = node.event.location.name.split(',')[0].trim();
    const existing = byPlace.get(key);
    if (!existing) {
      byPlace.set(key, { node, count: 1 });
    } else {
      existing.count += 1;
      const better =
        node.event.intensity > existing.node.event.intensity ||
        (node.event.intensity === existing.node.event.intensity && node.event.reportCount > existing.node.event.reportCount);
      if (better) existing.node = node;
    }
  }

  [...byPlace.entries()]
    .sort((a, b) =>
      b[1].node.event.intensity - a[1].node.event.intensity ||
      b[1].count - a[1].count ||
      a[0].localeCompare(b[0]))
    .slice(0, 60)
    .forEach(([place, info]) => {
      const button = document.createElement('button');
      button.type = 'button';
      const verified = info.node.event.confidence === 'verified';
      button.innerHTML =
        `<span${verified ? ' class="is-verified"' : ''}>${escapeHtml(place)}</span>` +
        `<span class="count">${info.count}</span>`;
      button.addEventListener('click', () => {
        select(info.node);
        document.querySelector('.stage').scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      grid.appendChild(button);
    });
}

/* ---------- chrome ------------------------------------------------------ */

function renderScaleKey() {
  const key = $('scale-key');
  const swatch = (colour, size) =>
    `<span class="swatch" style="width:${size}px;height:${size}px;background:${colour}"></span>`;
  key.innerHTML =
    `<span class="item">${swatch('var(--s1)', 6)}${escapeHtml(t().keyLow)}</span>` +
    `<span class="item">${swatch('var(--s3)', 9)}</span>` +
    `<span class="item">${swatch('var(--s5)', 12)}${escapeHtml(t().keyHigh)}</span>` +
    `<span class="item">${swatch('var(--verified)', 10)}${escapeHtml(t().keyVerified)}</span>` +
    (state.heat
      ? `<span class="item"><span class="swatch heat-swatch" style="width:10px;height:10px"></span>${escapeHtml(t().heat)}</span>` +
        `<button type="button" class="link-button" id="heat-toggle">${escapeHtml(state.showHeat ? t().heatOn : t().heatOff)}</button>`
      : '') +
    `<span style="margin-left:auto">${escapeHtml(t().zoomHint)}</span>`;

  $('heat-toggle')?.addEventListener('click', () => {
    state.showHeat = !state.showHeat;
    renderHeat();
    renderScaleKey();
  });
}

function renderStandfirst() {
  const events = visibleEvents();
  const countries = new Set(events.map((event) => event.location.countryFips).filter(Boolean));
  const label = state.windowDays === 1 ? t().win1.toLowerCase() : t().windowDays(state.windowDays);
  $('standfirst').innerHTML = events.length === 0
    ? `<span class="quiet">${escapeHtml(t().standfirstEmpty)}</span>`
    : t().standfirst(events.length, countries.size, label);
}

function renderColophon() {
  const repo = repoUrl();
  $('colophon-text').innerHTML =
    `${escapeHtml(t().colophon)} <a href="mailto:${escapeHtml(CONFIG.contactEmail)}">${escapeHtml(CONFIG.contactEmail)}</a>.` +
    (repo ? ` <a href="${escapeHtml(repo)}" target="_blank" rel="noopener">Source</a>.` : '');

  document.querySelector('.heat-note')?.remove();
  if (state.heat) {
    const note = document.createElement('p');
    note.className = 'heat-note';
    note.innerHTML =
      t().heatNote(state.heat.cellsPublished, escapeHtml(state.heat.instrument)) +
      ` <a href="${escapeHtml(state.heat.source.url)}" target="_blank" rel="noopener">${escapeHtml(state.heat.source.sourceName)}</a>.`;
    $('colophon-text').after(note);
  }

  const updated = state.generatedAt ? new Date(state.generatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
  $('colophon-meta').textContent = `${t().updated}: ${updated} · ${t().window}: ${t().windowDays(state.artifactWindowDays)}`;
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

function refresh() {
  applyStaticStrings();
  renderPoints();
  renderStandfirst();
  renderScaleKey();
  renderIndex();
  renderDetail(state.selected?.event ?? null);
  wirePoints();
}

function wirePoints() {
  for (const node of state.nodes) {
    node.group.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // A pan that happens to finish over a point should not select it.
      if (state.dragDistance > 3) return;
      select(node);
    });
    node.group.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(node); }
    });
  }
}

function wireChrome() {
  $('map').addEventListener('click', (ev) => { if (ev.target === $('map')) clearSelection(); });

  for (const button of document.querySelectorAll('.window-option')) {
    button.addEventListener('click', () => {
      state.windowDays = Number(button.dataset.days);
      for (const other of document.querySelectorAll('.window-option')) other.classList.toggle('is-on', other === button);
      clearSelection();
      refresh();
    });
  }

  const root = document.documentElement;
  const stored = localStorage.getItem('igred-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = stored ?? (prefersDark ? 'dark' : 'light');
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
    refresh();
    renderColophon();
  });
}

/* ---------- pulse ------------------------------------------------------- */

function startPulse() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let tick = 0;
  setInterval(() => {
    const fresh = [...state.nodes].sort((a, b) => b.event.ingestedAt.localeCompare(a.event.ingestedAt)).slice(0, 12);
    if (fresh.length === 0) return;
    const node = fresh[tick++ % fresh.length];
    node.halo.classList.remove('bloom');
    void node.halo.getBoundingClientRect();
    node.halo.classList.add('bloom');
  }, 2600);
}

/* ---------- boot --------------------------------------------------------- */

async function boot() {
  wireChrome();
  applyStaticStrings();
  renderDetail(null);

  try {
    await load();
  } catch (error) {
    $('standfirst').innerHTML = `<span class="quiet">${escapeHtml(t().errorTitle)}</span>`;
    showBanner(t().errorTitle, t().errorBody(escapeHtml(dataBaseUrl())));
    console.error(error);
    if (!state.world) return;
  }

  renderWorld();
  wireZoom();
  refresh();

  // Point sizes are expressed in on-screen pixels, so they must be recomputed whenever the
  // map's rendered size changes — a rotation, a resize, or the layout crossing a breakpoint.
  new ResizeObserver(() => sizePoints()).observe($('map'));
  renderColophon();
  startPulse();
}

boot();
