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
import { groupEvents, groupRadiusForPointer, nearestMark, PICK_RADIUS_PX } from './picking.js';
import { dataBaseUrl, repoUrl, CONFIG } from './config.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARTIFACT_VERSION = 1;

/* ---------- language ------------------------------------------------ */

const STRINGS = {
  en: {
    titleLine1: 'Global Conflict', titleLine2: 'Monitor',
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
    incidentLabel: 'The incident',
    close: 'Close',
    closeLabel: 'Close this record',
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
    searchLabel: 'Search conflicts and places',
    searchPlaceholder: 'Search a conflict or a place…',
    noResults: 'Nothing matches that.',
    resultConflict: 'Conflict on record', resultPlace: 'Incident location',
    conflictsHere: (country) => `Conflicts on record in ${country}`,
    conflictCount: (n) => `${n} ${n === 1 ? 'conflict' : 'conflicts'} on record here`,
    partiesLabel: 'Parties',
    countryLabel: 'Country',
    calloutHint: 'Full record in the panel',
    dayPrecision: 'Dated to the day',
    reportedOn: 'Reported',
    conflictCaveat:
      'These are the conflicts the verified register records in this country. Which of them, if any, this incident belongs to is not something the source data establishes.',
    noConflictHere: 'No conflict is recorded in this country by the register.',
    pileTitle: (n) => `${n} incidents on this spot`,
    pileTitleArea: (n) => `${n} incidents in this area`,
    pileNote: 'They sit too close to separate at this zoom. Zoom in and they come apart; every one of them is listed below.',
    pileNoteSpot: 'The source geolocates these to the same place, so no amount of zoom will separate them. Every one of them is listed below.',
    incidentNumber: (i, n) => `Incident ${i} of ${n}`,
    relatedTitle: 'Related reporting',
    relatedNote:
      'Stories from The IGRED Brief that name this country. They are matched by country, not to this incident — a news cluster on the map usually rests on a single dispatch, and this is the wider reporting that exists around it.',
    relatedMore: 'Read the Brief',
    articlesLabel: (n) => `${n} ${n === 1 ? 'article' : 'articles'}`,
  },
  nb: {
    // The product name is a proper noun and stays in English, as "The IGRED Brief" does.
    titleLine1: 'Global Conflict', titleLine2: 'Monitor',
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
    incidentLabel: 'Hendelsen',
    close: 'Lukk',
    closeLabel: 'Lukk denne oppføringen',
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
    searchLabel: 'Søk i konflikter og steder',
    searchPlaceholder: 'Søk en konflikt eller et sted …',
    noResults: 'Ingen treff.',
    resultConflict: 'Registrert konflikt', resultPlace: 'Hendelsessted',
    conflictsHere: (country) => `Konflikter registrert i ${country}`,
    conflictCount: (n) => `${n} ${n === 1 ? 'konflikt' : 'konflikter'} registrert her`,
    partiesLabel: 'Parter',
    countryLabel: 'Land',
    calloutHint: 'Hele oppføringen står i panelet',
    dayPrecision: 'Datert til dagen',
    reportedOn: 'Meldt',
    conflictCaveat:
      'Dette er konfliktene det verifiserte registeret fører i dette landet. Hvilken av dem denne hendelsen eventuelt hører til, er ikke noe kildedataene fastslår.',
    noConflictHere: 'Registeret fører ingen konflikt i dette landet.',
    pileTitle: (n) => `${n} hendelser på dette punktet`,
    pileTitleArea: (n) => `${n} hendelser i dette området`,
    pileNote: 'De ligger for tett til å skilles ved denne zoomen. Zoom inn, så løsner de fra hverandre; alle er uansett listet nedenfor.',
    pileNoteSpot: 'Kilden stedfester disse til samme sted, så ingen zoom skiller dem. Alle er listet nedenfor.',
    incidentNumber: (i, n) => `Hendelse ${i} av ${n}`,
    relatedTitle: 'Beslektet dekning',
    relatedNote:
      'Saker fra The IGRED Brief som nevner dette landet. De er koblet på land, ikke til denne hendelsen — en nyhetsklynge på kartet hviler som regel på én enkelt melding, og dette er den bredere dekningen som finnes rundt den.',
    relatedMore: 'Les Briefen',
    articlesLabel: (n) => `${n} ${n === 1 ? 'artikkel' : 'artikler'}`,
  },
};

const CONFLICT_TYPE = {
  en: { state_based: 'State-based', non_state: 'Non-state', one_sided: 'One-sided violence' },
  nb: { state_based: 'Statlig', non_state: 'Ikke-statlig', one_sided: 'Ensidig vold' },
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
  conflicts: [],
  countryNames: new Map(),
  stories: [],
  candidate: null,
  // Marks are groups of incidents that land on the same spot at the current zoom, so the
  // zoom level they were built for has to be remembered to know when to rebuild them.
  groupedAtWidth: null,
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

  if (preview) {
    const data = await fetch('preview-events.json').then((r) => r.json());
    applyEvents(data);
    showBanner(t().previewTitle, t().previewBody);
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
    .then((payload) => {
      const active = (payload.conflicts ?? []).filter((entry) => entry.status === 'active');
      state.conflicts = active;
      for (const conflict of active) {
        for (const country of conflict.countries) {
          if (country.fips) state.countryNames.set(country.fips, country.name);
        }
      }
      if (active.length === 0) showBanner(t().registerTitle, t().registerBody);
      // The register arrives after the first paint, so anything already selected is redrawn
      // with the context it was missing.
      renderDetail(state.selected ?? null);
      renderSearch();
    })
    .catch(() => {});

  // The Brief's stories, joined by country. A GDELT cluster usually has a single article —
  // 48 of 57 on the live map — so the reporting a reader actually wants is mostly here.
  loadJson(base, 'stories.json')
    .then((payload) => {
      state.stories = payload.stories ?? [];
      renderDetail(state.selected ?? null);
    })
    .catch(() => {});

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

/** View units per rendered pixel, so sizes and distances can be stated in real pixels. */
function perPixelNow() {
  const rect = $('map').getBoundingClientRect();
  return rect.width > 0 ? state.view.w / rect.width : state.view.w / 1000;
}

function renderPoints() {
  const svg = $('map');
  svg.querySelector('.points')?.remove();

  const layer = make('g', { class: 'points' });
  state.groupedAtWidth = state.view.w;
  state.nodes = groupEvents(visibleEvents(), perPixelNow(), groupRadiusForPointer());

  for (const mark of state.nodes) {
    const event = mark.lead;
    const piled = mark.events.length > 1;
    const verified = mark.events.some((entry) => entry.confidence === 'verified');
    const tone = verified ? 'var(--verified)' : `var(--s${event.intensity})`;
    const group = make('g', { class: `evt${piled ? ' piled' : ''}`, tabindex: '0', role: 'button' });

    const halo = make('circle', { cx: mark.x, cy: mark.y, class: 'halo', fill: tone });
    const dot = make('circle', { cx: mark.x, cy: mark.y, class: 'dot', fill: tone, 'fill-opacity': 0.55 + event.intensity * 0.09 });
    group.append(halo, dot);

    // A pile wears a hairline collar. It is the quietest mark that still says "more than
    // one here" without a badge or a number floating over the cartography.
    const collar = piled
      ? make('circle', { cx: mark.x, cy: mark.y, class: 'collar', fill: 'none', stroke: tone, 'stroke-width': 0.7, 'vector-effect': 'non-scaling-stroke' })
      : null;
    if (collar) group.appendChild(collar);

    // Verified incidents carry a ring as well as the accent colour, so the distinction
    // never rests on hue alone.
    const ring = verified
      ? make('circle', { cx: mark.x, cy: mark.y, class: 'vring', fill: 'none', stroke: 'var(--verified)', 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke' })
      : null;
    if (ring) group.appendChild(ring);

    const title = make('title', {});
    title.textContent = piled
      ? `${event.location.name} — ${pileLabel(mark)}`
      : `${categoryLabel(event.category)} — ${event.location.name}`;
    group.appendChild(title);

    layer.appendChild(group);
    Object.assign(mark, { group, halo, dot, ring, collar });
  }

  svg.appendChild(layer);
  sizePoints();
}

/**
 * Point radii are recomputed against the current zoom so their on-screen size stays
 * roughly constant. Zooming in should separate a cluster, not inflate it into a blob.
 */
function sizePoints() {
  const zoom = state.view.w / state.home.w;
  const perPixel = perPixelNow();
  // A floor rather than a clamp: clamping to a minimum made every point on a phone the
  // same size and erased the intensity scale. Adding a floor keeps the spread visible.
  const floor = 1.5 * perPixel;

  for (const mark of state.nodes) {
    const base = floor + (1.1 + mark.lead.intensity * 0.72) * Math.pow(zoom, 0.75);
    mark.dot.setAttribute('r', base.toFixed(2));
    mark.halo.setAttribute('r', (base * 2.5).toFixed(2));
    mark.halo.setAttribute('opacity', (0.05 + mark.lead.intensity * 0.035).toFixed(3));
    mark.group.style.setProperty('--r0', base.toFixed(2));
    mark.ring?.setAttribute('r', (base + 2.6 * Math.pow(zoom, 0.75)).toFixed(2));
    // Far enough out to read as a collar rather than a thick edge on the dot, close enough
    // that it does not become a second mark in its own right.
    mark.collar?.setAttribute('r', (base + 4.5 * perPixel).toFixed(2));
  }
}

/* ---------- picking ----------------------------------------------------- */

/** Client pixels to view units, using the same fit the callout uses. */
function toViewCoords(clientX, clientY) {
  const box = $('map').getBoundingClientRect();
  const view = state.view;
  const scale = Math.min(box.width / view.w, box.height / view.h);
  if (!(scale > 0)) return null;
  const drawnLeft = box.left + (box.width - view.w * scale) / 2;
  const drawnTop = box.top + (box.height - view.h * scale) / 2;
  return { x: view.x + (clientX - drawnLeft) / scale, y: view.y + (clientY - drawnTop) / scale, scale };
}

/**
 * The nearest mark to a click, or null if the click was not near one.
 *
 * Nearest wins, rather than whichever invisible circle sits on top. Two marks can no longer
 * both claim the same pixel, so aiming at a dot now opens that dot.
 */
function pickAt(clientX, clientY) {
  const point = toViewCoords(clientX, clientY);
  if (!point) return null;
  const reach = PICK_RADIUS_PX / point.scale;

  return nearestMark(state.nodes, point.x, point.y, reach);
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

  /*
   * Which incidents land on the same spot is a function of the zoom, so the grouping is
   * rebuilt when the zoom has moved materially. This is what makes zooming the remedy for a
   * pile: go in, and the mark comes apart into the incidents it was hiding.
   *
   * Panning does not change it, and the threshold keeps a pinch from rebuilding every frame.
   */
  const rescaled = state.groupedAtWidth === null || Math.abs(Math.log(w / state.groupedAtWidth)) > 0.1;
  if (rescaled && state.nodes.length > 0) {
    const keep = state.selected?.lead ?? null;
    state.candidate = null;
    renderPoints();
    wirePoints();
    if (keep) selectEvent(keep);
  } else {
    sizePoints();
  }

  // Anchored in screen space, so panning or zooming has to move it with the point.
  if (state.selected) showCallout(state.selected);
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

/**
 * What a pile actually is, so it can be described without overstating.
 *
 * Incidents the source pinned to the identical coordinate are on one spot and no zoom will
 * separate them. Incidents merely drawn too close together at this zoom are in an area, and
 * going in will pull them apart. Calling the second case "this spot" would put Kyiv inside
 * Kherson.
 */
function pileShape(mark) {
  const coordinates = new Set(mark.events.map((event) => `${event.x},${event.y}`));
  return coordinates.size === 1 ? 'spot' : 'area';
}

function pileLabel(mark) {
  return pileShape(mark) === 'spot' ? t().pileTitle(mark.events.length) : t().pileTitleArea(mark.events.length);
}

/** The mark currently holding a given incident, which changes as the grouping is rebuilt. */
function markFor(event) {
  if (!event) return null;
  return state.nodes.find((mark) => mark.events.some((entry) => entry.id === event.id)) ?? null;
}

function applySelection(mark) {
  state.selected?.group.classList.remove('selected');
  state.selected = mark ?? null;
  /*
   * Two states, not one layout that has to serve both. Reading a record, the standfirst is
   * context the reader already has and the title can stand down, which lifts the record
   * most of the way up the column instead of leaving it below the fold.
   */
  document.querySelector('.stage').classList.toggle('reading', Boolean(mark));
  if (!mark) {
    $('plate').classList.remove('dimmed');
    renderDetail(null);
    hideCallout();
    return;
  }
  $('plate').classList.add('dimmed');
  mark.group.classList.add('selected');
  renderDetail(mark);
  showCallout(mark);
}

function select(mark) {
  if (!mark || state.selected === mark) return clearSelection();
  applySelection(mark);
}

/**
 * Selection by incident rather than by mark, for callers that outlive a regrouping — the
 * index, search, and restoring the selection after a zoom.
 */
function selectEvent(event) {
  const mark = markFor(event);
  if (mark) applySelection(mark);
}

function clearSelection() {
  applySelection(null);
}

function conflictsInCountry(fips) {
  if (!fips) return [];
  return state.conflicts.filter((conflict) => conflict.countries.some((country) => country.fips === fips));
}

/**
 * Stories from the Brief that name this country.
 *
 * A map incident is a GDELT cluster, and those are thin: on the live register 48 of 57 rest
 * on a single dispatch, and the richest has five. The reporting a reader wants is already
 * collected by the sibling product, so the map joins to it rather than pretending an
 * incident has depth it does not have. Matched on country, and labelled as such.
 */
function relatedStories(fips) {
  if (!fips) return [];
  return state.stories
    .filter((story) => story.countries.some((country) => country.fips === fips))
    .sort((a, b) => b.prominence - a.prominence || b.articleCount - a.articleCount)
    .slice(0, 6);
}

function sourceList(provenance) {
  // Every source behind the incident, not a sample of them. The pipeline already caps
  // provenance at 25 per incident, so there is nothing further to truncate here.
  return provenance.map((entry) => {
    const outlet = entry.publisher ?? entry.sourceName;
    const when = (entry.publishedAt ?? entry.retrievedAt ?? '').slice(0, 10);
    return `<li><a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(outlet)}</a> <span class="outlet">· ${escapeHtml(when)}</span></li>`;
  }).join('');
}

function incidentMeta(event) {
  // GDELT dates most incidents to the day, so the precision is stated rather than implied.
  const dated = event.dateBasis === 'report_date' ? t().reportedOn : t().dayPrecision;
  const confidence =
    event.confidence === 'verified' ? `<span class="vmark">${escapeHtml(t().verified)}</span>`
    : event.confidence === 'reported' ? escapeHtml(t().reported)
    : escapeHtml(t().unconfirmed);
  return `<div class="detail-meta">` +
    `<span>${escapeHtml(categoryLabel(event.category))}</span>` +
    `<span>${escapeHtml(dated)} ${escapeHtml(event.occurredAt.slice(0, 10))}</span>` +
    `<span>${escapeHtml(t().intensity)} ${event.intensity} ${escapeHtml(t().of)} 5</span>` +
    `<span>${escapeHtml(t().reports(event.reportCount))} · ${escapeHtml(t().outlets(event.distinctPublishers))}</span>` +
    `<span>${confidence}</span>` +
    `</div>`;
}

function renderDetail(mark) {
  const detail = $('detail');
  if (!mark) {
    detail.innerHTML = `<p class="prompt">${escapeHtml(t().prompt)}</p>`;
    return;
  }

  const lead = mark.lead;
  const piled = mark.events.length > 1;

  /*
   * The register's conflicts for this country, with their verified parties.
   *
   * The incident's own CAMEO actors are deliberately not shown. They are assigned by word
   * matching and are routinely wrong in a way that reads as fact: the live feed has "SCHOOL"
   * as the initiator of an armed clash in Gaza and "JORDAN" as the initiator of one in
   * Tehran. The register's parties are verified, so those are shown instead.
   *
   * The association is by country and is described as such. Iran has three conflicts on
   * record; which one a given incident belongs to is not in the data.
   */
  /*
   * Every country the mark touches, not just the lead's. A pile is drawn at one point but
   * can hold incidents from either side of a border, and showing only the lead's register
   * entries would silently drop the other country's conflicts from the record.
   */
  const fipsHere = [...new Set(mark.events.map((event) => event.location.countryFips).filter(Boolean))];
  const seenConflicts = new Set();
  const here = fipsHere.flatMap((fips) =>
    conflictsInCountry(fips).filter((conflict) => {
      if (seenConflicts.has(conflict.id)) return false;
      seenConflicts.add(conflict.id);
      return true;
    }),
  );
  const countryName = fipsHere
    .map((fips) => state.countryNames.get(fips) ?? fips)
    .join(' · ') || (lead.location.name.split(',').pop()?.trim() ?? '');

  const context = here.length > 0
    ? `<section class="detail-context">` +
      `<h3>${escapeHtml(t().conflictsHere(countryName))}</h3>` +
      `<ul class="detail-conflicts">` +
      here.slice(0, 6).map((conflict) => {
        const parties = conflict.parties.map((party) => party.name).filter(Boolean);
        return `<li>` +
          `<span class="conflict-name">${escapeHtml(conflict.name)}</span>` +
          `<span class="conflict-kind">${escapeHtml(CONFLICT_TYPE[state.lang][conflict.type] ?? conflict.type)}` +
          (parties.length ? ` · ${escapeHtml(t().partiesLabel)}: ${escapeHtml(parties.join(' · '))}` : '') +
          `</span></li>`;
      }).join('') +
      `</ul>` +
      `<p class="detail-caveat">${escapeHtml(t().conflictCaveat)}</p>` +
      `</section>`
    : `<section class="detail-context"><p class="detail-caveat">${escapeHtml(t().noConflictHere)}</p></section>`;

  // A pile lists every incident on the spot, each with its own date, category and sources.
  // Nothing is hidden behind the topmost one the way it used to be.
  const body = piled
    ? `<p class="detail-pile">${escapeHtml(pileShape(mark) === 'spot' ? t().pileNoteSpot : t().pileNote)}</p>` +
      `<ol class="detail-incidents">` +
      mark.events.map((event, index) =>
        `<li>` +
        `<h3 class="incident-head">${escapeHtml(t().incidentNumber(index + 1, mark.events.length))}` +
        `<span class="incident-place">${escapeHtml(event.location.name)}</span></h3>` +
        incidentMeta(event) +
        `<h4 class="sources-head">${escapeHtml(t().sources)}</h4>` +
        `<ul class="detail-sources">${sourceList(event.provenance)}</ul>` +
        `</li>`).join('') +
      `</ol>`
    : incidentMeta(lead) +
      `<section class="detail-sourceblock">` +
      `<h3>${escapeHtml(t().sources)}</h3>` +
      `<ul class="detail-sources">${sourceList(lead.provenance)}</ul>` +
      `</section>`;

  const seenStories = new Set();
  const stories = fipsHere
    .flatMap((fips) => relatedStories(fips))
    .filter((story) => {
      if (seenStories.has(story.id)) return false;
      seenStories.add(story.id);
      return true;
    })
    .slice(0, 6);
  const related = stories.length > 0
    ? `<section class="detail-related">` +
      `<h3>${escapeHtml(t().relatedTitle)}</h3>` +
      `<ul class="related-stories">` +
      stories.map((story) =>
        `<li>` +
        `<span class="related-headline">${escapeHtml(story.headline)}</span>` +
        `<span class="related-outlets">` +
        story.articles.map((article) =>
          `<a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.publisher)}</a>`,
        ).join('<span class="sep">·</span>') +
        `</span></li>`).join('') +
      `</ul>` +
      `<p class="detail-caveat">${escapeHtml(t().relatedNote)} <a href="brief/">${escapeHtml(t().relatedMore)}</a>.</p>` +
      `</section>`
    : '';

  /*
   * Ordered the way the question is actually asked: what happened and where, then which
   * conflict the register puts in that country, then what was published. The conflict block
   * used to come first, which meant the reader met a list of wars before the incident they
   * had just clicked.
   */
  detail.innerHTML =
    `<div class="detail-top">` +
      `<h2 class="detail-place">${escapeHtml(lead.location.name)}` +
      (piled ? `<span class="detail-pile-count">${escapeHtml(pileLabel(mark))}</span>` : '') +
      `</h2>` +
      `<button type="button" class="link-button detail-close" id="detail-close" aria-label="${escapeHtml(t().closeLabel)}">${escapeHtml(t().close)}</button>` +
    `</div>` +
    body +
    context +
    related;

  $('detail-close')?.addEventListener('click', clearSelection);

  // One quiet pulse of the label's own rule, so a click 900px away is visibly answered.
  detail.classList.remove('just-updated');
  void detail.offsetWidth;
  detail.classList.add('just-updated');
}

/* ---------- the callout, anchored where you clicked -------------------- */

function hideCallout() {
  $('callout').hidden = true;
}

function showCallout(mark) {
  const event = mark.lead;
  const callout = $('callout');
  const svg = $('map');
  const plate = $('plate');

  const svgBox = svg.getBoundingClientRect();
  const plateBox = plate.getBoundingClientRect();
  const view = state.view;
  const scale = Math.min(svgBox.width / view.w, svgBox.height / view.h);
  const drawnLeft = svgBox.left + (svgBox.width - view.w * scale) / 2;
  const drawnTop = svgBox.top + (svgBox.height - view.h * scale) / 2;

  const x = drawnLeft + (mark.x - view.x) * scale - plateBox.left;
  const y = drawnTop + (mark.y - view.y) * scale - plateBox.top;

  const here = conflictsInCountry(event.location.countryFips);
  callout.innerHTML =
    `<p class="callout-place">${escapeHtml(event.location.name)}</p>` +
    `<p class="callout-meta">` +
    (mark.events.length > 1
      ? `${escapeHtml(pileLabel(mark))}`
      : `${escapeHtml(categoryLabel(event.category))} · ${escapeHtml(t().outlets(event.distinctPublishers))}`) +
    // A count, not a name. Israel has five conflicts on record; naming the first would
    // assert exactly what the panel below says the data does not establish.
    (here.length ? ` · ${escapeHtml(t().conflictCount(here.length))}` : '') +
    `</p>` +
    `<p class="callout-hint">${escapeHtml(t().calloutHint)}</p>`;

  callout.hidden = false;
  callout.classList.remove('flip-below');
  callout.style.left = '0px';
  callout.style.top = `${y}px`;

  /*
   * Clamped numerically rather than flipped by class. A flip moves the box by a fixed
   * offset, which is not enough when the box is wider than the space beside the point — on a
   * narrow plate it still hung over the edge. The leader then has to be told where the point
   * actually is, since the box is no longer centred on it.
   */
  const width = callout.offsetWidth;
  const height = callout.offsetHeight;
  const pad = 8;
  const left = Math.min(Math.max(x - width / 2, pad), Math.max(pad, plateBox.width - width - pad));
  callout.style.left = `${left}px`;
  callout.style.setProperty('--leader-x', `${Math.min(Math.max(x - left, 10), width - 10)}px`);

  // Above the point unless there is no room, in which case below it.
  if (y - height - 14 < 0) callout.classList.add('flip-below');
}

/* ---------- index ------------------------------------------------------ */

function renderIndex() {
  const grid = $('index-grid');
  grid.innerHTML = '';

  // Keyed on the incident rather than the mark, because marks are rebuilt on every zoom and
  // a button holding a stale one would select a group that no longer exists.
  const byPlace = new Map();
  for (const mark of state.nodes) {
    for (const event of mark.events) {
      const key = event.location.name.split(',')[0].trim();
      const existing = byPlace.get(key);
      if (!existing) {
        byPlace.set(key, { event, count: 1 });
      } else {
        existing.count += 1;
        const better =
          event.intensity > existing.event.intensity ||
          (event.intensity === existing.event.intensity && event.reportCount > existing.event.reportCount);
        if (better) existing.event = event;
      }
    }
  }

  [...byPlace.entries()]
    .sort((a, b) =>
      b[1].event.intensity - a[1].event.intensity ||
      b[1].count - a[1].count ||
      a[0].localeCompare(b[0]))
    .slice(0, 60)
    .forEach(([place, info]) => {
      const button = document.createElement('button');
      button.type = 'button';
      const verified = info.event.confidence === 'verified';
      button.innerHTML =
        `<span${verified ? ' class="is-verified"' : ''}>${escapeHtml(place)}</span>` +
        `<span class="count">${info.count}</span>`;
      button.addEventListener('click', () => {
        selectEvent(info.event);
        document.querySelector('.stage').scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      grid.appendChild(button);
    });
}

/* ---------- search over conflicts and places ---------------------------- */

/**
 * Two kinds of result, because the map holds two kinds of thing.
 *
 * A place is an incident: selecting it opens the record. A conflict may have no incident in
 * the window at all — most do not — so it centres its country instead, using the centroid
 * carried in the geometry. Saying "nothing to show" for a conflict that plainly exists would
 * be worse than putting the map where it is.
 */
function searchResults(query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = (haystack) => words.every((word) => haystack.includes(word));

  const results = [];

  for (const conflict of state.conflicts) {
    const haystack = [
      conflict.name,
      ...conflict.parties.map((party) => party.name),
      ...conflict.countries.map((country) => country.name),
    ].join(' ').toLowerCase();
    if (!matches(haystack)) continue;
    const fips = conflict.countries.find((country) => country.fips)?.fips;
    results.push({
      kind: 'conflict',
      label: conflict.name,
      detail: conflict.countries.map((country) => country.name).join(', '),
      fips,
    });
  }

  const seenPlaces = new Set();
  for (const mark of state.nodes) {
    for (const event of mark.events) {
      const place = event.location.name;
      if (seenPlaces.has(place)) continue;
      if (!matches(`${place} ${categoryLabel(event.category)}`.toLowerCase())) continue;
      seenPlaces.add(place);
      results.push({ kind: 'place', label: place, detail: categoryLabel(event.category), event });
    }
  }

  // Conflicts first: a search for "Ukraine" should offer the conflict before one incident.
  return results.slice(0, 24);
}

function renderSearch() {
  const box = $('results');
  const query = $('search').value.trim();

  if (query.length < 2) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const results = searchResults(query);
  box.hidden = false;

  if (results.length === 0) {
    box.innerHTML = `<p class="none">${escapeHtml(t().noResults)}</p>`;
    return;
  }

  box.innerHTML = results
    .map(
      (result, index) =>
        `<button type="button" data-index="${index}">` +
        `<span class="result-name">${escapeHtml(result.label)}</span>` +
        `<span class="result-kind">${escapeHtml(result.kind === 'conflict' ? t().resultConflict : t().resultPlace)}` +
        (result.detail ? ` · ${escapeHtml(result.detail)}` : '') +
        `</span></button>`,
    )
    .join('');

  for (const button of box.querySelectorAll('button')) {
    button.addEventListener('click', () => goTo(results[Number(button.dataset.index)]));
  }
}

/** Centres the view on a point without changing the zoom the reader chose. */
function centreOn(x, y, zoomTo) {
  const width = zoomTo ?? state.view.w;
  const height = (width * state.home.h) / state.home.w;
  state.view = { x: x - width / 2, y: y - height / 2, w: width, h: height };
  clampView();
  applyView();
}

function goTo(result) {
  if (!result) return;

  if (result.kind === 'place' && result.event) {
    // Close enough to read the place, but not so close the surroundings vanish. Centring
    // rescales, which regroups the marks, so the incident is selected after the move.
    centreOn(result.event.x, result.event.y, Math.min(state.view.w, state.home.w * 0.22));
    selectEvent(result.event);
    return;
  }

  const country = state.world?.countries.find((entry) => entry.fips === result.fips);
  if (country?.centre) {
    clearSelection();
    centreOn(country.centre[0], country.centre[1], Math.min(state.view.w, state.home.w * 0.35));
  }
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
    `<span style="margin-left:auto">${escapeHtml(t().zoomHint)}</span>`;
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

  const updated = state.generatedAt ? new Date(state.generatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';
  $('colophon-meta').textContent = `${t().updated}: ${updated} · ${t().window}: ${t().windowDays(state.artifactWindowDays)}`;
}

function applyStaticStrings() {
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = t()[node.dataset.i18n];
    if (typeof value === 'string') node.textContent = value;
  }
  $('search').placeholder = t().searchPlaceholder;

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
  renderDetail(state.selected ?? null);
  renderSearch();
  wirePoints();
}

/**
 * Which mark the pointer is currently claiming.
 *
 * Nearest-mark picking is only as clear as the reader's ability to predict it, so the map
 * says out loud what a click would take: the candidate lifts as the pointer moves, and the
 * cursor becomes a pointer only when there is something to take. Without this the dots read
 * as decoration on a background, which is exactly how they were being read.
 */
function trackCandidate(clientX, clientY) {
  const mark = pickAt(clientX, clientY);
  if (mark === state.candidate) return;
  state.candidate?.group.classList.remove('candidate');
  state.candidate = mark;
  mark?.group.classList.add('candidate');
  $('map').classList.toggle('over-mark', Boolean(mark));
}

function clearCandidate() {
  state.candidate?.group.classList.remove('candidate');
  state.candidate = null;
  $('map').classList.remove('over-mark');
}

/**
 * Only the keyboard is wired per mark. Pointer selection is delegated to the plate and
 * resolved by distance, so no mark can shadow another.
 */
function wirePoints() {
  for (const mark of state.nodes) {
    mark.group.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(mark); }
    });
  }
}

function wireChrome() {
  /*
   * One handler for the whole map, resolved by distance to the nearest mark.
   *
   * The old build put an invisible target on every incident and let the document decide
   * which one a click belonged to. Where points overlap — 55 of 57 did — the winner was the
   * last one rendered, not the one under the cursor, so clicking a dot opened a different
   * incident. Nearest-mark picking removes stacking from the question entirely.
   */
  $('map').addEventListener('click', (ev) => {
    // A pan that happens to finish over a point should not select it.
    if (state.dragDistance > 3) return;
    select(pickAt(ev.clientX, ev.clientY));
  });

  /*
   * Run straight off the event rather than through requestAnimationFrame. Picking is a walk
   * over a few dozen marks, so deferring buys nothing, and a throttled frame callback leaves
   * the highlight lagging or stuck — which defeats the point of showing it at all.
   */
  $('map').addEventListener('pointermove', (ev) => {
    // A finger has no hover, and pointing at a mark under it would be meaningless.
    if (ev.pointerType === 'touch') return;
    trackCandidate(ev.clientX, ev.clientY);
  });
  $('map').addEventListener('pointerleave', clearCandidate);

  const search = $('search');
  search.addEventListener('input', renderSearch);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      search.value = '';
      renderSearch();
    }
    // Enter takes the first result, which is what a reader expects from a search field.
    if (event.key === 'Enter') {
      event.preventDefault();
      goTo(searchResults(search.value.trim())[0]);
    }
  });

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

  /*
   * Drawing is guarded as well as fetching.
   *
   * A crash in here used to leave the page showing cartography, no incidents and no
   * explanation, with the rejection going unhandled: it looked like a quiet day rather than
   * a broken map. Whatever fails, the reader is told.
   */
  try {
    renderWorld();
    wireZoom();
    refresh();
    new ResizeObserver(() => sizePoints()).observe($('map'));
    renderColophon();
    startPulse();
  } catch (error) {
    $('standfirst').innerHTML = `<span class="quiet">${escapeHtml(t().errorTitle)}</span>`;
    showBanner(t().errorTitle, t().errorBody(escapeHtml(dataBaseUrl())));
    console.error(error);
  }
}

// Point sizes are expressed in on-screen pixels, so they are recomputed whenever the map's
// rendered size changes — a rotation, a resize, or the layout crossing a breakpoint.
boot();
