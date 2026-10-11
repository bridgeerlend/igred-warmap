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

/** Words that carry a conflict headline: what happened. Matched as word stems. */
const STRONG = /^(kill|killed|kills|killing|dead|deaths?|attack(s|ed)?|strike(s)?|struck|war|wars|invasion|invade[sd]?|missile(s)?|drone(s)?|bomb(s|ing|ed)?|shell(ing|ed)|ceasefire|truce|deal|sanctions?|coup|famine|genocide|massacre|siege|offensive|captured?|seize[sd]?|evacuat\w*|displaced|refugees?|hostages?|arrest(s|ed)?|detained|protests?|clash(es|ed)?|fighting|assault|raid(s)?|suicide|nuclear|recalls?|condemns?|warns?|demands?|blames?|hits?)$/;
/** Capitalised words that are not names: they open a headline or a clause. */
const PLAIN = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'after', 'as', 'how', 'why', 'what', 'who', 'when', 'several', 'thousands', 'hundreds', 'dozens', 'three', 'two', 'four', 'five', 'one', 'photos', 'live', 'former', 'new', 'top', 'security', 'council', 'president', 'prime', 'minister']);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);


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
  // Today's four worst crises, visited west to east so the camera glides one way across the
  // map instead of swinging back and forth between continents.
  const crises = data.crises.slice(0, 4).map((c) => {
    const [x, y] = toView(c.center[0], c.center[1]);
    return { ...c, x, y };
  }).sort((a, b) => a.x - b.x);
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
    // 1.5 is sharp enough for stipple and keeps the canvas a third lighter on a retina screen.
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    buildPaths();
  }

  /* ---- camera: centre in map units and a zoom over the cover fit ---- */
  const cover = () => Math.max(W / W0, H / (H0 * 0.82));
  const WORLD_CAM = { x: 520, y: 225, z: 1 };
  const EMBER = ['#F2914A', '#EE7637', '#E85A2C', '#DC3F26', '#C9261F'];

  /**
   * The incidents, drawn in a dozen batches rather than one by one: one path per colour and
   * per mark (hollow or filled), at two strengths when a crisis is in focus. Changing the
   * fill style for every dot was what made the film stutter on a phone.
   */
  function drawDots(s, { dots, day, focus, dim }) {
    if (dots === 'none') return;
    const groups = new Map();
    for (const p of pts) {
      if (dots === 'week' && p.day < lastDay - 6) continue;
      if (dots === 'upto' && p.day > day) continue;
      const near = focus ? Math.abs(p.x - focus.x) < 60 && Math.abs(p.y - focus.y) < 60 : true;
      const fresh = dots === 'upto' && p.day === day ? 1 : 0;
      const key = `${p.o}${p.k}${near ? 1 : 0}${fresh}`;
      let g = groups.get(key);
      if (!g) { g = { o: p.o, k: p.k, near, fresh, path: new Path2D() }; groups.set(key, g); }
      const r = ((1.1 + p.k * 0.55) / Math.sqrt(s)) * (fresh ? 1.6 : 1);
      g.path.moveTo(p.x + r, p.y);
      g.path.arc(p.x, p.y, r, 0, Math.PI * 2);
    }
    ctx.lineWidth = 0.9 / s;
    for (const g of groups.values()) {
      ctx.globalAlpha = (focus && !g.near ? 0.18 : 0.9) * (1 - dim);
      if (g.o) { ctx.fillStyle = EMBER[g.k - 1]; ctx.fill(g.path); }
      else { ctx.strokeStyle = EMBER[g.k - 1]; ctx.stroke(g.path); }
    }
    ctx.globalAlpha = 1;
  }

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

    drawDots(s, { dots, day, focus, dim });

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

  /**
   * One camera path for the whole film, not one per scene. Each scene used to start its own
   * pan from the same place, so the map jumped at every cut and every headline restarted the
   * glide. Now the scenes only say what is drawn; where the camera is comes from a single
   * smooth curve through keyframes (Catmull-Rom, zoom in log space), which keeps moving
   * through each keyframe instead of stopping at it, and ends where it began so the loop is
   * seamless.
   */
  let track = [];
  function buildTrack(starts) {
    const z = 2.6;
    const shift = (W * (W > 760 ? 0.24 : 0)) / (cover() * z);
    const lift = (W > 760 ? 0 : H * 0.18) / (cover() * z);
    const k = [];
    k.push({ t: 0, x: 470, y: 228, z: 1 });
    k.push({ t: starts.crises - 1.2, x: 545, y: 222, z: 1.05 });
    crises.forEach((c, i) => {
      const t0 = starts.crises + i * 3;
      // Arrive early in the scene, then keep drifting gently while the name is read.
      // Between two crises the camera rises a little and comes down again, the way a map
      // flies, so a long hop never becomes a fast sideways smear.
      if (i > 0) {
        const p = crises[i - 1];
        // The longer the hop, the higher it rises: screen speed stays about the same.
        const hop = Math.hypot(c.x - p.x, c.y - p.y);
        const zMid = Math.max(1.05, Math.min(1.9, (z * 70) / Math.max(70, hop)));
        k.push({ t: t0 + 0.3, x: (p.x + c.x) / 2 - shift, y: (p.y + c.y) / 2 + lift, z: zMid });
      }
      k.push({ t: t0 + 1.25, x: c.x - shift - 6, y: c.y + lift, z });
      k.push({ t: t0 + 2.4, x: c.x - shift + 6, y: c.y + lift - 2, z });
    });
    // Out from the last crisis where it stands, then a slow drift back west through the
    // headlines and the playback, so the loop returns to its start without a sweep.
    const last = crises[crises.length - 1];
    const outX = Math.min(640, Math.max(520, last ? last.x - 40 : 560));
    k.push({ t: starts.headlines + 1.6, x: outX, y: 228, z: 1.1 });
    k.push({ t: starts.playback + 1.0, x: (outX + 520) / 2 + 10, y: 226, z: 1.03 });
    k.push({ t: starts.end, x: 520, y: 225, z: 1 });
    k.push({ t: starts.total - 0.8, x: 480, y: 228, z: 1 });
    track = k;
  }

  function camAt(t, total) {
    const n = track.length;
    // Cyclic, so the last keyframe flows into the first.
    const at = (i) => {
      const w = ((i % n) + n) % n;
      const lap = Math.floor(i / n);
      const kf = track[w];
      return { t: kf.t + lap * total, x: kf.x, y: kf.y, lz: Math.log(kf.z) };
    };
    let i = 0;
    while (i < n - 1 && t >= track[i + 1].t) i++;
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const u = (t - p1.t) / Math.max(1e-6, p2.t - p1.t);
    const hermite = (key) => {
      const m1 = ((p2[key] - p0[key]) / (p2.t - p0.t)) * (p2.t - p1.t);
      const m2 = ((p3[key] - p1[key]) / (p3.t - p1.t)) * (p2.t - p1.t);
      const u2 = u * u, u3 = u2 * u;
      return (2 * u3 - 3 * u2 + 1) * p1[key] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[key] + (u3 - u2) * m2;
    };
    return { x: hermite('x'), y: hermite('y'), z: Math.exp(hermite('lz')) };
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
  const starts = {};

  // 1. The week, counted.
  add(5, () => setScene(`<p class="scene-count">0</p><p class="scene-lede">${esc(strings.countLede)}</p>`),
    (t, node) => {
      const n = node.querySelector('.scene-count');
      if (n) n.textContent = fmt(data.incidents7d * ease(Math.min(1, t * 1.4)));
      return { dots: 'week', dim: 0.35 };
    });

  // 2. Crises, one by one.
  starts.crises = scenes.reduce((a, x) => a + x.seconds, 0);
  crises.forEach((c) => {
    add(3, () => {
      const [l1, l2] = split(name(c));
      return setScene(`<p class="scene-big">${esc(l1)}${l2 ? `<span class="italic">${esc(l2)}</span>` : ''}</p><p class="scene-meta">${esc(strings.weekCount(fmt(c.last7d)))}</p>`);
    }, (t) => ({ dots: 'week', focus: c, ringT: t * 1.4 }));
  });

  // 3. The Brief's headlines, as type.
  starts.headlines = scenes.reduce((a, x) => a + x.seconds, 0);
  headlines.forEach((hl) => {
    add(2.2, () => {
      // The words that carry the sentence — who, what happened, how many — are set in italic
      // ember; the connective words stay plain, so each headline reads at a glance.
      const words = hl.headline.split(' ').map((w, j) => {
        const bare = w.replace(/^[‘'"“(]+|[’'"”),.:;!?]+$/g, '');
        const lower = bare.toLowerCase();
        const name = /^\p{Lu}[\p{Ll}\p{Lu}'-]+/u.test(bare) && !PLAIN.has(lower) && (j > 0 || bare.length > 3);
        const cls = /\d/.test(bare) ? ' fig' : STRONG.test(lower) ? ' strong' : name ? ' name' : '';
        return `<span class="w${cls}" style="transition-delay:${j * 45}ms">${esc(w)}</span>`;
      }).join(' ');
      const node = setScene(`<p class="scene-headline">${words}</p><p class="scene-outlet">${esc(hl.publisher)} · The IGRED Brief</p>`);
      setTimeout(() => { node.querySelector('.scene-headline')?.classList.add('is-in'); node.querySelector('.scene-outlet')?.classList.add('is-in'); }, 60);
      return node;
    }, () => ({ dots: 'week', dim: 0.7 }));
  });

  // 4. Thirty days, played back.
  starts.playback = scenes.reduce((a, x) => a + x.seconds, 0);
  add(5, () => setScene(`<p class="scene-date"></p><div class="scene-progress">${data.days.map(() => '<span></span>').join('')}</div><p class="scene-meta">${esc(strings.playback)}</p>`),
    (t, node) => {
      const day = Math.min(lastDay, Math.floor(t * (lastDay + 1.5)));
      // The date and the ticks change thirty times, not sixty times a second.
      if (node && node.dataset.day !== String(day)) {
        node.dataset.day = String(day);
        const label = node.querySelector('.scene-date');
        if (label) label.textContent = dayLabel(data.days[day]);
        node.querySelectorAll('.scene-progress span').forEach((sp, j) => sp.classList.toggle('on', j <= day));
      }
      return { dots: 'upto', day, dim: 0.15 };
    });

  // 5. The name, then again.
  starts.end = scenes.reduce((a, x) => a + x.seconds, 0);
  add(4.5, () => setScene(`<p class="scene-big">IGRED</p><p class="scene-meta">${esc(strings.fullName)}</p>`, 'scene-end'),
    // Back to the opening scene's shade by the end, so the loop has no seam.
    (t) => ({ dots: 'week', dim: 0.35 + 0.4 * Math.sin(Math.PI * t) }));
  starts.total = scenes.reduce((a, x) => a + x.seconds, 0);

  /* ---- the clock ---- */
  resize();
  buildTrack(starts);
  window.addEventListener('resize', () => { resize(); buildTrack(starts); if (reduced) still(); });

  function still() {
    draw(WORLD_CAM, { dots: 'week' });
    setScene(`<p class="scene-count">${fmt(data.incidents7d)}</p><p class="scene-lede">${esc(strings.countLede)}</p>`).classList.add('is-in');
  }
  if (reduced) { still(); return { stop() {} }; }

  const total = scenes.reduce((a, s) => a + s.seconds, 0);
  let index = -1, node = null, sceneStart = 0, raf = 0, visible = true, t0 = performance.now();
  let shade = 0.35, lastFrame = 0;
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
    const opts = scenes[i].frame((elapsed - sceneStart) / scenes[i].seconds, node);
    // The map's shade eases between scenes instead of switching at the cut.
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1;
    lastFrame = now;
    shade = freezeAt !== null ? opts.dim ?? 0 : shade + ((opts.dim ?? 0) - shade) * Math.min(1, dt * 3.5);
    draw(camAt(elapsed, total), { ...opts, dim: shade });
    raf = requestAnimationFrame(tick);
  }
  loop();
  return { stop() { cancelAnimationFrame(raf); io.disconnect(); }, total };
}
