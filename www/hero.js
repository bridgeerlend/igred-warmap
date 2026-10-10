/**
 * The front page's film, drawn from today's data at every visit — not a video file.
 *
 * A dark world map in the Atlas style pans slowly; today's crises light up one after
 * another with their names set large; the Brief's real headlines arrive as type; the week's
 * count runs up; thirty days of incidents play back; the film ends on the institute's name
 * and loops. Every dot is a published incident and every headline links back from the Brief.
 *
 * Reduced motion gets one still frame. Nothing here blocks the page: it starts after load,
 * pauses when the hero is off screen, and costs one small JSON file.
 */
import { toView } from './projection.js';

const W0 = 1000, H0 = 520;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;


export function startHero({ canvas, scene, data, world, strings, lang = 'en', freezeAt = null }) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1;
  let land = null, coast = null, stipple = null;

  /* ---- geometry ---- */
  const pts = data.points.map((p) => {
    const [x, y] = toView(p[0] / 10, p[1] / 10);
    return { x, y, day: p[2], k: p[3], o: p[4] };
  });
  const crises = data.crises.slice(0, 4).map((c) => {
    const [x, y] = toView(c.center[0], c.center[1]);
    return { ...c, x, y };
  });
  const lastDay = data.days.length - 1;

  function buildPaths() {
    land = new Path2D();
    for (const c of world.countries) land.addPath(new Path2D(c.path));
    coast = land;
    const tile = document.createElement('canvas');
    const s = Math.round(5 * dpr);
    tile.width = tile.height = s;
    const g = tile.getContext('2d');
    g.fillStyle = 'rgba(247,245,239,0.30)';
    g.beginPath(); g.arc(1.5 * dpr, 1.5 * dpr, 0.62 * dpr, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(247,245,239,0.18)';
    g.beginPath(); g.arc(4 * dpr, 4 * dpr, 0.42 * dpr, 0, Math.PI * 2); g.fill();
    stipple = ctx.createPattern(tile, 'repeat');
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    buildPaths();
  }

  /* ---- camera: centre in map units and a zoom over the cover fit ---- */
  const cover = () => Math.max(W / W0, H / (H0 * 0.82));
  const WORLD_CAM = { x: 520, y: 225, z: 1 };

  function draw(cam, { dots = 'week', day = lastDay, focus = null, dim = 0, ringT = 0 } = {}) {
    const s = cover() * cam.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0B0B0A';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - cam.x * s), dpr * (H / 2 - cam.y * s));

    // Stippled land: the pattern is kept at screen scale so zooming never fattens the dots.
    stipple.setTransform(new DOMMatrix().scale(1 / (s * dpr), 1 / (s * dpr)));
    ctx.fillStyle = stipple;
    ctx.fill(land);
    ctx.lineWidth = 0.55 / s;
    ctx.strokeStyle = 'rgba(247,245,239,0.36)';
    ctx.stroke(coast);

    // Incidents: hollow for one source, filled for two or more outlets. Ember only.
    const ember = ['#F2914A', '#EE7637', '#E85A2C', '#DC3F26', '#C9261F'];
    for (const p of pts) {
      if (dots === 'none') break;
      if (dots === 'week' && p.day < lastDay - 6) continue;
      if (dots === 'upto' && p.day > day) continue;
      const fresh = dots === 'upto' && p.day === day;
      const r = (1.1 + p.k * 0.55) / Math.sqrt(s) * (fresh ? 1.6 : 1);
      const near = focus ? Math.hypot(p.x - focus.x, p.y - focus.y) < 60 : true;
      const alpha = (focus && !near ? 0.18 : 0.9) * (1 - dim);
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (p.o) { ctx.fillStyle = ember[p.k - 1]; ctx.fill(); }
      else { ctx.strokeStyle = ember[p.k - 1]; ctx.lineWidth = 0.9 / s; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;

    // The crisis in focus gets a thin ring that draws itself.
    if (focus && ringT > 0) {
      ctx.strokeStyle = 'rgba(140,199,255,0.9)';
      ctx.lineWidth = 1 / s;
      ctx.beginPath();
      ctx.arc(focus.x, focus.y, 26 / s * 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ringT));
      ctx.stroke();
    }
    if (dim > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(11,11,10,${0.55 * dim})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---- scenes ---- */
  const fmt = (n) => Math.round(n).toLocaleString(lang === 'nb' ? 'nb-NO' : 'en-GB').replace(/ /g, ' ');
  const name = (c) => (lang === 'nb' ? c.nameNb : c.name);
  const split = (text) => {
    const words = text.split(' ');
    let cut = words.findIndex((w) => /['’]s$/.test(w));
    if (cut === -1 || cut > 2) cut = words.length > 3 ? 1 : 0;
    return [words.slice(0, cut + 1).join(' '), words.slice(cut + 1).join(' ')];
  };
  const dayLabel = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'nb' ? 'nb-NO' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });

  function setScene(html, cls = '') {
    const node = document.createElement('div');
    node.className = `scene ${cls}`;
    node.innerHTML = html;
    for (const old of scene.querySelectorAll('.scene')) {
      old.style.transitionDuration = '260ms';
      old.classList.remove('is-in');
      setTimeout(() => old.remove(), 300);
    }
    scene.append(node);
    setTimeout(() => node.classList.add('is-in'), 240);
    return node;
  }
  const esc = (v) => String(v).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  const headlines = (data.brief?.headlines ?? []).slice(0, 3);
  const scenes = [];
  const add = (seconds, enter, frame) => scenes.push({ seconds, enter, frame });

  // 1. The week, counted.
  add(5, () => setScene(`<p class="scene-count">0</p><p class="scene-lede">${esc(strings.countLede)}</p>`),
    (t, node) => {
      const n = node.querySelector('.scene-count');
      if (n) n.textContent = fmt(data.incidents7d * ease(Math.min(1, t * 1.4)));
      draw({ x: WORLD_CAM.x - 40 + 60 * t, y: WORLD_CAM.y, z: 1 }, { dots: 'week', dim: 0.35 });
    });

  // 2. Crises, one by one.
  crises.forEach((c, i) => {
    add(3, () => {
      const [l1, l2] = split(name(c));
      return setScene(`<p class="scene-big">${esc(l1)}${l2 ? `<span class="italic">${esc(l2)}</span>` : ''}</p><p class="scene-meta">${esc(strings.weekCount(fmt(c.last7d)))}</p>`);
    }, (t) => {
      const prevShift = (W * (W > 760 ? 0.24 : 0)) / (cover() * 2.6);
      const prevLift = (W > 760 ? 0 : H * 0.18) / (cover() * 2.6);
      const from = i === 0 ? WORLD_CAM : { x: crises[i - 1].x - prevShift, y: crises[i - 1].y + prevLift, z: 2.6 };
      const k = ease(Math.min(1, t * 1.6));
      // The crisis sits in the right third, clear of its name on the left.
      const shift = (W * (W > 760 ? 0.24 : 0)) / (cover() * 2.6);
      const lift = (W > 760 ? 0 : H * 0.18) / (cover() * 2.6);
      draw({ x: lerp(from.x, c.x - shift, k), y: lerp(from.y, c.y + lift, k), z: lerp(from.z, 2.6, k) }, { dots: 'week', focus: c, ringT: t * 1.4 });
    });
  });

  // 3. The Brief's headlines, as type.
  headlines.forEach((hl) => {
    add(2.2, () => {
      const words = hl.headline.split(' ').map((w, j) => `<span class="w" style="transition-delay:${j * 45}ms">${esc(w)}</span>`).join(' ');
      const node = setScene(`<p class="scene-headline">${words}</p><p class="scene-outlet">${esc(hl.publisher)} · The IGRED Brief</p>`);
      setTimeout(() => { node.querySelector('.scene-headline')?.classList.add('is-in'); node.querySelector('.scene-outlet')?.classList.add('is-in'); }, 60);
      return node;
    }, (t) => draw({ x: WORLD_CAM.x + 30 * t, y: WORLD_CAM.y, z: 1.05 }, { dots: 'week', dim: 0.7 }));
  });

  // 4. Thirty days, played back.
  add(5, () => setScene(`<p class="scene-date"></p><div class="scene-progress">${data.days.map(() => '<span></span>').join('')}</div><p class="scene-meta">${esc(strings.playback)}</p>`),
    (t, node) => {
      const day = Math.min(lastDay, Math.floor(t * (lastDay + 1.5)));
      const label = node.querySelector('.scene-date');
      if (label) label.textContent = dayLabel(data.days[day]);
      node.querySelectorAll('.scene-progress span').forEach((sp, j) => sp.classList.toggle('on', j <= day));
      draw({ x: WORLD_CAM.x, y: WORLD_CAM.y, z: 1 }, { dots: 'upto', day, dim: 0.15 });
    });

  // 5. The name, then again.
  add(4.5, () => setScene(`<p class="scene-big">IGRED</p><p class="scene-meta">${esc(strings.fullName)}</p>`, 'scene-end'),
    (t) => draw({ x: WORLD_CAM.x, y: WORLD_CAM.y, z: 1 }, { dots: 'week', dim: 0.6 + 0.3 * t }));

  /* ---- the clock ---- */
  resize();
  window.addEventListener('resize', () => { resize(); if (reduced) still(); });

  function still() {
    draw(WORLD_CAM, { dots: 'week' });
    setScene(`<p class="scene-count">${fmt(data.incidents7d)}</p><p class="scene-lede">${esc(strings.countLede)}</p>`).classList.add('is-in');
  }
  if (reduced) { still(); return { stop() {} }; }

  const total = scenes.reduce((a, s) => a + s.seconds, 0);
  let index = -1, node = null, sceneStart = 0, raf = 0, visible = true, t0 = performance.now();
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }, { threshold: 0.05 });
  io.observe(canvas);

  function loop() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!visible) return;
    // ?at=12 holds the film at one moment, for review and screenshots.
    const elapsed = freezeAt !== null ? Math.min(total - 0.01, freezeAt) : ((now - t0) / 1000) % total;
    let acc = 0, i = 0;
    while (i < scenes.length - 1 && elapsed >= acc + scenes[i].seconds) { acc += scenes[i].seconds; i++; }
    if (i !== index) {
      scenes[index]?.leave?.();
      index = i;
      sceneStart = acc;
      node = scenes[i].enter();
    }
    scenes[i].frame((elapsed - sceneStart) / scenes[i].seconds, node);
    raf = requestAnimationFrame(tick);
  }
  loop();
  return { stop() { cancelAnimationFrame(raf); io.disconnect(); }, total };
}
