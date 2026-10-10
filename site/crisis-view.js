/**
 * Renders one crisis file, either as the panel beside the map or as a page of its own.
 * Every line on it is a count from the data, a source's own words with a link, or a fixed
 * template filled with those counts.
 */
import { h, prefs, fmtNum, fmtBig, ago, fmtDate, crisisName, regionName, CATEGORY, hostOf } from './common.js';

const NEWS_FIRST = 8;
const NEWS_STEP = 12;

function section(title, note, ...body) {
  return h('section.cv-section', null,
    h('h2.cv-h', null, title),
    note ? h('p.cv-note', null, note) : null,
    ...body);
}

function img(src, alt, cls) {
  const node = h(`img${cls ? `.${cls}` : ''}`, { src, alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  // A dead preview image is removed, not left as a broken frame.
  node.addEventListener('error', () => {
    const holder = node.closest('[data-img-holder]');
    if (holder) holder.classList.add('no-img');
    node.remove();
  });
  return node;
}

function figure(value, label, tone) {
  return h('div.cv-fig', null, h(`span.cv-fig-v${tone ? `.${tone}` : ''}`, null, value), h('span.cv-fig-l', null, label));
}

function chart(daily) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  const w = 300, hgt = 86, gap = 2;
  const bw = (w - gap * (daily.length - 1)) / daily.length;
  const bars = daily.map((d, i) => {
    const bh = d.count === 0 ? 1 : Math.max(2, (d.count / max) * (hgt - 14));
    const x = i * (bw + gap);
    const recent = i >= daily.length - 7;
    return `<rect x="${x.toFixed(1)}" y="${(hgt - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" class="${recent ? 'bar-recent' : 'bar'}"><title>${fmtDate(d.date)}: ${prefs.t.incidents(d.count)}</title></rect>`;
  }).join('');
  const node = h('figure.cv-chart', null);
  node.innerHTML = `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" role="img" aria-label="${prefs.t.chartTitle}">${bars}</svg>
    <figcaption><span>${fmtDate(daily[0].date)}</span><span>${prefs.t.chartTitle}</span><span>${fmtDate(daily[daily.length - 1].date)}</span></figcaption>`;
  return node;
}

function newsItem(a) {
  const holder = h('a.cv-news-item', { href: a.url, target: '_blank', rel: 'noopener', 'data-img-holder': '' },
    a.image ? h('span.cv-news-thumb', null, img(a.image, '')) : null,
    h('span.cv-news-text', null,
      h('span.cv-news-title', null, a.title),
      h('span.cv-news-meta', null, `${a.publisher}, ${ago(a.publishedAt)}`)));
  if (!a.image) holder.classList.add('no-img');
  return holder;
}

function newsList(news) {
  const t = prefs.t;
  if (news.length === 0) return h('p.cv-empty', null, t.noNews);
  const list = h('div.cv-news');
  let shown = 0;
  const more = h('button.cv-more', { type: 'button' });
  const step = (n) => {
    news.slice(shown, shown + n).forEach((a) => list.append(newsItem(a)));
    shown = Math.min(news.length, shown + n);
    const left = news.length - shown;
    more.hidden = left === 0;
    more.textContent = t.showMore(Math.min(NEWS_STEP, left));
  };
  more.addEventListener('click', () => step(NEWS_STEP));
  step(NEWS_FIRST);
  return h('div', null, list, more);
}

function gallery(images) {
  return h('div.cv-gallery', null, images.map((im) =>
    h('a.cv-shot', { href: im.url, target: '_blank', rel: 'noopener', 'data-img-holder': '' },
      img(im.src, im.caption),
      h('span.cv-shot-cap', null, h('span', null, im.caption), h('span.cv-credit', null, im.credit)))));
}

function videos(list) {
  return h('div.cv-videos', null, list.map((v) => {
    const card = h('div.cv-video', null);
    const play = h('button.cv-video-play', { type: 'button', 'aria-label': v.title },
      img(`https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/hqdefault.jpg`, ''),
      h('span.cv-play', { 'aria-hidden': 'true' }));
    play.addEventListener('click', () => {
      // Embedded only when asked for: the privacy-enhanced player, nothing loaded before.
      const frame = h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.videoId)}?autoplay=1&rel=0`,
        title: v.title, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, loading: 'lazy',
      });
      play.replaceWith(h('div.cv-frame', null, frame));
    });
    card.append(play, h('a.cv-video-title', { href: v.url, target: '_blank', rel: 'noopener' }, v.title),
      h('span.cv-news-meta', null, `${v.channel}, ${ago(v.publishedAt)}`));
    return card;
  }));
}

function stories(headlines) {
  const t = prefs.t;
  return h('ol.cv-stories', null, headlines.slice(0, 6).map((s) =>
    h('li', null,
      h('a.cv-story', { href: s.url, target: '_blank', rel: 'noopener' }, s.headline),
      h('details.cv-story-more', null,
        h('summary', null, `${s.publisher}, ${t.outletsN(s.outlets.length)}`),
        h('ul.cv-links', null, s.articles.map((a) =>
          h('li', null, h('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.title), h('span.cv-news-meta', null, ` ${a.publisher}`))))))));
}

function hotspots(list, onPlace) {
  const max = Math.max(1, ...list.map((s) => s.count));
  return h('ul.cv-spots', null, list.map((s) =>
    h('li', null, h('button.cv-spot', { type: 'button', onclick: () => onPlace?.(s) },
      h('span.cv-spot-name', null, s.name),
      h('span.cv-spot-bar', null, h('span', { style: { width: `${Math.round((100 * s.count) / max)}%` } })),
      h('span.cv-spot-n', null, fmtNum(s.count))))));
}

function incidents(list, onPlace) {
  const t = prefs.t;
  return h('ul.cv-incidents', null, list.slice(0, 20).map((e) =>
    h('li.cv-incident', null,
      h('div.cv-incident-head', null,
        h('span', { class: `cv-dot i${e.intensity}`, 'aria-hidden': 'true' }),
        h('button.cv-incident-place', { type: 'button', onclick: () => onPlace?.(e) }, e.place),
        h('span.cv-news-meta', null, fmtDate(e.at))),
      h('div.cv-incident-body', null,
        h('span', null, CATEGORY[prefs.lang][e.category] ?? e.category),
        h('span.cv-news-meta', null, `, ${t.reportsN(e.reports)}: `),
        e.sources.map((s, i) => [i ? ', ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.publisher)])))));
}

function conflicts(list) {
  const t = prefs.t;
  return h('ul.cv-conflicts', null, list.map((c) =>
    h('li', null,
      h('span.cv-conflict-name', null, c.name),
      h('span.cv-news-meta', null, [
        c.intensityLevel ? t.ucdpLevel[c.intensityLevel] : null,
        c.startDate ? t.since(c.startDate.slice(0, 4)) : null,
        c.fatalities ? t.deaths(fmtNum(c.fatalities), c.fatalitiesAsOf?.slice(0, 4)) : null,
      ].filter(Boolean).join(', ')))));
}

function figuresTable(indicators) {
  const countries = [...new Map(indicators.flatMap((i) => i.values.map((v) => [v.iso3, v.country]))).entries()];
  const lang = prefs.lang;
  return h('div.cv-table-wrap', null, h('table.cv-table', null,
    countries.length > 1 ? h('thead', null, h('tr', null, h('th', null, ''), countries.map(([, name]) => h('th', { scope: 'col' }, name)))) : null,
    h('tbody', null, indicators.map((ind) =>
      h('tr', null,
        h('th', { scope: 'row' }, h('a', { href: ind.url, target: '_blank', rel: 'noopener' }, lang === 'nb' ? ind.labelNb : ind.label)),
        countries.map(([iso3]) => {
          const v = ind.values.find((x) => x.iso3 === iso3);
          return h('td', null, v ? [fmtBig(v.value, ind.unit), h('span.cv-year', null, ` ${v.year}`)] : '');
        }))))));
}

function posts(list) {
  return h('ul.cv-posts', null, list.slice(0, 8).map((p) =>
    h('li', null,
      h('p.cv-post-text', null, p.text),
      h('a.cv-news-meta', { href: p.url, target: '_blank', rel: 'noopener' }, `${p.author}, ${ago(p.postedAt)}`))));
}

function sources(d) {
  const t = prefs.t;
  const chips = h('ul.cv-outlets', null);
  const fill = (n) => {
    chips.replaceChildren(...d.outlets.slice(0, n).map((o) => h('li', null, o.name, h('span.cv-news-meta', null, ` ${o.count}`))));
  };
  fill(40);
  const all = d.outlets.length > 40 ? h('button.cv-more', { type: 'button', onclick: (ev) => { fill(d.outlets.length); ev.currentTarget.remove(); } }, t.showMore(d.outlets.length - 40)) : null;
  const feeds = [
    ['GDELT', d.feeds.gdelt], ['Google News', d.feeds.gnews], ['Wikipedia', d.feeds.wikipedia], ['World Bank', d.feeds.worldBank],
    ['UCDP', 'https://ucdp.uu.se/'],
  ];
  return [
    h('p', null, t.sourcesSummary(fmtNum(d.sourceCount), fmtNum(d.outlets.length))),
    chips, all,
    h('p.cv-note', null, t.sourcesFeeds, ': ', feeds.map(([name, url], i) => [i ? ', ' : '', h('a', { href: url, target: '_blank', rel: 'noopener' }, name)])),
  ];
}

/**
 * @param {object} d the crisis file
 * @param {{ mode: 'panel' | 'page', onPlace?: Function, onClose?: Function, pageUrl?: string }} opts
 */
export function renderCrisis(d, opts) {
  const t = prefs.t;
  const s = d.stats;
  const root = h(`article.cv.cv-${opts.mode}`, { 'aria-labelledby': 'cv-title' });

  const hero = d.images[0];
  const head = h('header.cv-head', null,
    hero ? h('a.cv-hero', { href: hero.url, target: '_blank', rel: 'noopener', 'data-img-holder': '' },
      img(hero.src, hero.caption),
      h('span.cv-credit.cv-hero-credit', null, hero.credit)) : null,
    h('div.cv-titles', null,
      d.region ? h('p.cv-region', null, regionName(d)) : null,
      h('h1.cv-title', { id: 'cv-title' }, crisisName(d)),
      h('p.cv-news-meta', null, t.updated(ago(d.generatedAt))),
      d.auto ? h('p.cv-note', null, t.autoNote) : null));
  if (!hero) head.classList.add('no-hero');

  const change = s.change7dPct === null ? '–' : `${s.change7dPct >= 0 ? '+' : ''}${Math.round(s.change7dPct)}%`;
  const figs = h('div.cv-figs', null,
    figure(fmtNum(s.last7d), t.figWeek),
    figure(change, t.figChange, s.change7dPct === null ? '' : s.change7dPct >= 15 ? 'up' : s.change7dPct <= -15 ? 'down' : ''),
    figure(fmtNum(s.last30d), t.figMonth),
    figure(fmtNum(s.outlets30d), t.figOutlets));

  const situationText = prefs.lang === 'nb' ? d.situation.nb : d.situation.en;
  const bg = d.background;
  const bgText = bg && (prefs.lang === 'nb' && bg.extractNb ? bg.extractNb : bg.extract);
  const bgTitle = bg && (prefs.lang === 'nb' && bg.titleNb ? bg.titleNb : bg.title);
  const bgUrl = bg && (prefs.lang === 'nb' && bg.urlNb ? bg.urlNb : bg.url);

  const actions = h('div.cv-actions', null,
    opts.mode === 'panel' ? h('a.cv-action', { href: opts.pageUrl ?? `crisis/?id=${encodeURIComponent(d.id)}` }, t.openPage) : null,
    h('button.cv-action', { type: 'button', onclick: async (ev) => {
      const url = opts.mode === 'panel' ? new URL(`crisis/?id=${encodeURIComponent(d.id)}`, location.href).href : location.href;
      try { await navigator.clipboard.writeText(url); ev.currentTarget.textContent = t.copied; } catch { /* clipboard refused */ }
    } }, t.copyLink));

  const main = h('div.cv-main', null,
    figs,
    chart(s.daily),
    section(t.situation, null, h('p.cv-lede', null, situationText), h('p.cv-note', null, t.situationNote)),
    section(t.live, d.news.length ? t.liveNote(d.news.length) : null, newsList(d.news)),
    d.images.length > 1 ? section(t.pictures, t.picturesNote, gallery(d.images.slice(1))) : null,
    d.headlines.length ? section(t.topStories, null, stories(d.headlines)) : null,
    d.videos.length ? section(t.videos, null, videos(d.videos.slice(0, 4))) : null,
    bg ? section(t.background, null,
      h('p.cv-bg', null, bgText),
      h('p.cv-note', null, t.fromWikipedia(bgTitle), ' ', h('a', { href: bgUrl, target: '_blank', rel: 'noopener' }, t.readMore))) : null,
    s.hotspots.length ? section(t.hotspots, opts.onPlace ? t.hotspotsNote : null, hotspots(s.hotspots, opts.onPlace)) : null,
    d.incidents.length ? section(t.incidentsTitle, t.incidentsNote, incidents(d.incidents, opts.onPlace)) : null,
    d.conflicts.length ? section(t.conflicts, t.conflictsNote, conflicts(d.conflicts)) : null,
    d.indicators.length ? section(t.figures, t.figuresNote, figuresTable(d.indicators)) : null,
    d.posts.length ? section(t.posts, null, posts(d.posts)) : null,
    section(t.sources, null, ...sources(d)),
    actions);

  if (opts.mode === 'panel') {
    root.append(h('button.cv-close', { type: 'button', 'aria-label': t.close, onclick: () => opts.onClose?.() }, h('span', { 'aria-hidden': 'true' }, '×')));
  }
  root.append(head, main);
  return root;
}

export { hostOf };
