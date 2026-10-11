/**
 * The crisis view and the country view: one template, used beside the map, as a sheet on a
 * phone, and full width on a crisis's own page.
 *
 * The header follows the map's chosen window and date, so it is counted here from the
 * incident file. Everything below it comes from the crisis file the pipeline publishes,
 * and every item in it opens at its source.
 */
import {
  prefs, h, esc, fmtNum, fmtBig, fmtDay, fmtShortDay, ago, joinNames, hostOf,
  crisisName, regionName, monumentLines, statusSentence, barChart, CATEGORY, DAY,
} from './common.js';
import { CONFIG } from './config.js';

const BRIEF = CONFIG.briefBaseUrl;

/** Which bars of the thirty-day chart the chosen window covers. */
function windowBars(inc, w, asOf) {
  const end = asOf ? inc.days.indexOf(asOf) + 1 : inc.days.length;
  return { from: Math.max(0, end - w), to: end };
}

function header(ctx, { title, region, rows, prevRows, exclude, daily }) {
  const { inc, w, asOf } = ctx;
  const [l1, l2] = title;
  const bars = windowBars(inc, w, asOf);
  return [
    h('nav.cv-top', null,
      ctx.onBack ? h('button.link-button.quiet.cv-back', { type: 'button', onclick: ctx.onBack }, `← ${prefs.t.allCrises}`) : null,
      region ? h('span.meta', null, region) : null,
      ctx.onClose ? h('button.link-button.quiet.cv-close', { type: 'button', onclick: ctx.onClose, 'aria-label': prefs.t.close }, prefs.t.close) : null),
    h('h2.title.cv-title', null, h('span', null, l1), l2 ? h('span.italic', null, l2) : null),
    h('p.standfirst.cv-status', { html: statusSentence(inc, rows, prevRows, w, asOf, exclude) }),
    h('div.cv-chart', { html: barChart(daily, inc.days, bars) }),
  ];
}

function tabs(ctx, panes) {
  const key = 'cvTab';
  const active = panes.some((p) => p.id === ctx[key]) ? ctx[key] : panes[0].id;
  const body = h('div.cv-pane');
  const nav = h('nav.tabs', { role: 'tablist' });
  const show = (id) => {
    ctx[key] = id;
    for (const b of nav.children) b.setAttribute('aria-selected', String(b.dataset.id === id));
    body.replaceChildren(...panes.find((p) => p.id === id).render());
  };
  for (const p of panes) {
    nav.append(h('button.tab', { type: 'button', role: 'tab', 'data-id': p.id, onclick: () => show(p.id) }, p.label));
  }
  show(active);
  return [nav, body];
}

const section = (title, ...children) => h('section.cv-section', null, title ? h('h3.cv-h', null, title) : null, ...children);

function sourceLinks(list) {
  return list.map((s, i) => [i ? ', ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.publisher)]);
}

/* ---------- the crisis ------------------------------------------------- */

export function renderCrisis(container, ctx, entry, detail) {
  const t = prefs.t;
  const { inc, w, asOf } = ctx;
  const own = (r) => inc.crisis(r) === entry.id;
  const [from, to] = inc.range(w, asOf);
  const rows = inc.select(own, from, to);
  const prevRows = inc.select(own, from - w * DAY, from);
  const exclude = new Set(detail?.countries.map((c) => c.name.replace(/^the /, '')) ?? []);

  container.replaceChildren(
    ...header(ctx, {
      title: monumentLines(crisisName(entry)),
      region: regionName(entry),
      rows, prevRows, exclude,
      daily: inc.daily(own),
    }),
    ...(detail ? tabs(ctx, [
      { id: 'overview', label: t.overview, render: () => overview(detail) },
      { id: 'news', label: t.news, render: () => news(detail) },
      { id: 'places', label: t.places, render: () => places(ctx, detail) },
    ]) : [h('p.meta.cv-loading', null, '…')]),
  );
}

function overview(d) {
  const t = prefs.t;
  const nb = prefs.lang === 'nb';
  const out = [];

  if (d.summary) {
    out.push(section(null,
      h('div.cv-summary', null, ...(nb ? d.summary.nb : d.summary.en).split(/(?<=[.!?])\s+(?=\S)/).reduce((paras, s, i, all) => {
        // Two short paragraphs read better than one block of five sentences.
        const cut = Math.ceil(all.length / 2);
        (paras[i < cut ? 0 : 1] ??= []).push(s);
        return paras;
      }, []).map((p) => h('p', null, p.join(' ')))),
      h('p.meta.cv-machine', null, t.summaryLabel),
      h('p.cv-sources', null, h('span.meta', null, `${t.summarySources} `), sourceLinks(d.summary.sources))));
  }

  const f = d.ucdpFatalities;
  if (f) {
    const parts = [];
    if (f.battle) parts.push(t.ucdpBattle(fmtNum(f.battle.total), f.battle.years));
    if (f.other) parts.push((f.battle ? t.ucdpOther : t.ucdpOtherOnly)(fmtNum(f.other.total), f.other.conflicts, f.other.years));
    out.push(h('p.cv-contrast', { html: parts.join(' ') }));
  }

  if (d.background) {
    const useNb = nb && d.background.extractNb;
    const bgUrl = useNb ? d.background.urlNb : d.background.url;
    out.push(section(t.background,
      h('p.cv-bg', null, useNb ? d.background.extractNb : d.background.extract),
      h('p.meta', null, t.fromWikipedia(useNb ? d.background.titleNb : d.background.title), ' · ',
        h('a', { href: bgUrl, target: '_blank', rel: 'noopener' }, t.readMore))));
  }

  const picture = d.images.find((im) => im.kind !== 'person') ?? d.images[0];
  if (picture) out.push(figure(picture, 'cv-picture'));

  if (d.conflicts.length) {
    out.push(section(t.conflicts, h('ul.cv-list', null, d.conflicts.map((c) =>
      h('li', null,
        h('span.cv-name', null, c.name),
        h('span.meta', null, [t.type[c.type] ?? c.type, c.startDate ? t.since(c.startDate.slice(0, 4)) : null,
          typeof c.fatalities === 'number' ? t.deaths(fmtNum(c.fatalities), c.fatalitiesAsOf?.slice(0, 4)) : null].filter(Boolean).join(' · ')))))));
  }

  if (d.indicators.length) {
    const multi = d.indicators.some((ind) => ind.values.length > 1);
    out.push(section(t.figures, h('table.cv-table', null, h('tbody', null, d.indicators.flatMap((ind) =>
      ind.values.map((v, i) => h('tr', null,
        h('th', { scope: 'row' }, i === 0 ? h('a', { href: ind.url, target: '_blank', rel: 'noopener' }, nb ? ind.labelNb : ind.label) : ''),
        multi ? h('td.meta', null, v.country) : null,
        h('td.num', null, fmtBig(v.value, ind.unit)),
        h('td.meta', null, v.year)))))),
      h('p.meta', null, 'World Bank')));
  }
  return out;
}

function figure(im, cls) {
  const credit = [im.author, im.license].filter(Boolean).join(', ');
  return h(`figure.${cls}`, null,
    h('a', { href: im.url, target: '_blank', rel: 'noopener' },
      h('img', { src: im.src, alt: im.caption, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })),
    h('figcaption', null, h('span', null, im.caption), h('span.meta', null, credit ? `${credit} · Wikimedia Commons` : 'Wikimedia Commons')));
}

/** "Archive picture: Volodymyr Zelenskyy · Author, CC BY 4.0" — never mistaken for the event. */
function pictureCredit(p) {
  const who = [p.author, p.license].filter(Boolean).join(', ');
  return `${prefs.t.archive}: ${p.subject}${who ? ` · ${who}` : ''} · Wikimedia Commons`;
}

function picture(p, cls) {
  return h(`a.${cls}`, { href: p.url, target: '_blank', rel: 'noopener', title: pictureCredit(p), 'aria-label': pictureCredit(p) },
    h('img', { src: cls === 'cv-lead-pic' ? p.src : p.thumb, alt: p.subject, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
}

function news(d) {
  const t = prefs.t;
  const out = [];
  if (d.headlines.length) {
    // The most covered story leads with its picture; the rest carry a small one beside them.
    const leadIndex = d.headlines.slice(0, 8).findIndex((s) => s.picture);
    out.push(section(t.topStories, h('ol.cv-stories', null, d.headlines.slice(0, 8).map((s, i) =>
      h(`li${s.picture ? (i === leadIndex ? '.has-lead' : '.has-pic') : ''}`, null,
        s.picture && i === leadIndex ? picture(s.picture, 'cv-lead-pic') : null,
        h('div.cv-item-text', null,
          h('a.cv-story', { href: s.url, target: '_blank', rel: 'noopener' }, s.headline),
          h('span.meta', null, `${s.publisher} · ${t.outletsN(s.outlets.length)}`,
            s.edition ? [' · ', h('a', { href: `${BRIEF}?edition=${s.edition}#${s.storyId}` }, t.inBrief)] : null),
          s.picture ? h('span.meta.cv-pic-credit', null, pictureCredit(s.picture)) : null),
        s.picture && i !== leadIndex ? picture(s.picture, 'cv-thumb-pic') : null)))));
  }
  // The same face on every other line is wallpaper, not news: a subject already pictured in
  // the last few items is left out until it has had a rest.
  const recent = d.headlines.slice(0, 8).map((s) => s.picture?.subject).filter(Boolean);
  const pictured = d.news.slice(0, 30).map((a) => {
    const subject = a.picture?.subject;
    const show = !!subject && !recent.slice(-3).includes(subject);
    if (show) recent.push(subject);
    return show ? a.picture : null;
  });
  out.push(section(t.latest, d.news.length
    ? h('ul.cv-news', null, d.news.slice(0, 30).map((a, i) => {
      const pic = pictured[i];
      return h(`li${pic ? '.has-pic' : ''}`, null,
        h('div.cv-item-text', null,
          h('a.cv-news-item', { href: a.url, target: '_blank', rel: 'noopener' }, a.title),
          h('span.meta', null, `${a.publisher}, ${ago(a.publishedAt)}`),
          pic ? h('span.meta.cv-pic-credit', null, pictureCredit(pic)) : null),
        pic ? picture(pic, 'cv-thumb-pic') : null);
    }))
    : h('p.meta', null, t.noNews)));

  if (d.videos.length) {
    out.push(section(t.video, h('ul.cv-videos', null, d.videos.slice(0, 4).map((v) => {
      const slot = h('div.cv-video');
      const play = h('button.cv-video-play', {
        type: 'button', 'aria-label': `${t.playVideo}: ${v.title}`,
        onclick: () => slot.replaceChildren(h('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.videoId)}?autoplay=1&rel=0`,
          title: v.title, allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, loading: 'lazy',
        })),
      }, h('img', { src: `https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/mqdefault.jpg`, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      h('span.link-button', null, t.playVideo));
      slot.append(play);
      return h('li', null, slot,
        h('a', { href: v.url, target: '_blank', rel: 'noopener' }, v.title),
        h('span.meta', null, `${v.channel}, ${ago(v.publishedAt)}`));
    }))));
  }

  const gallery = d.images.filter((im) => im.kind !== 'map').slice(0, 6);
  if (gallery.length) out.push(section(t.gallery, h('div.cv-gallery', null, gallery.map((im) => figure(im, 'cv-thumb')))));
  return out;
}

function places(ctx, d) {
  const t = prefs.t;
  const out = [];
  if (d.stats.hotspots.length) {
    out.push(section(t.hotspots, h('ol.cv-places', null, d.stats.hotspots.map((p) =>
      h('li', null,
        h('button.cv-place', { type: 'button', onclick: () => ctx.onZoom?.([p.lon, p.lat], 7) }, p.name.split(',')[0]),
        h('span.meta.num', null, fmtNum(p.count)))))));
  }
  if (d.incidents.length) {
    out.push(section(t.incidents, h('ul.cv-incidents', null, d.incidents.map((e) => {
      const v = ctx.inc.p.verified?.[e.id.replace(/^evt_/, '')];
      return h(`li${v ? '.is-verified' : ''}`, null,
        h('p.meta', null, [fmtShortDay(e.at), CATEGORY[prefs.lang][e.category] ?? e.category,
          v ? t.verified : e.outlets >= 2 ? t.corroborated(e.outlets) : t.oneSource].join(' · ')),
        h('button.cv-place', { type: 'button', onclick: () => ctx.onZoom?.([e.lon, e.lat], 8) }, e.place),
        v ? h('p.cv-note', null, v.note, ' ', h('a', { href: v.source, target: '_blank', rel: 'noopener' }, t.source)) : null,
        h('p.cv-src', null, e.sources.map((s, i) => [i ? ', ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.publisher)])));
    }))));
  }
  if (d.outlets.length) {
    out.push(section(t.outlets, h('p.cv-outlets', null, d.outlets.map((o, i) => [i ? ', ' : '', h('span', null, o.name), h('span.meta', null, ` ${o.count}`)]))));
  }
  out.push(section(t.rawData, h('p.cv-raw', null,
    [['GDELT', d.feeds.gdelt], ['Google News', d.feeds.gnews], ['Wikipedia', d.feeds.wikipedia], ['World Bank', d.feeds.worldBank], ['UCDP', 'https://ucdp.uu.se/']]
      .map(([label, url], i) => [i ? ' · ' : '', h('a', { href: url, target: '_blank', rel: 'noopener' }, label)]))));
  return out;
}

/* ---------- the country ----------------------------------------------- */

export function renderCountry(container, ctx, fips, name, info, crisisEntry) {
  const t = prefs.t;
  const { inc, w, asOf } = ctx;
  const own = (r) => inc.country(r) === fips;
  const [from, to] = inc.range(w, asOf);
  const rows = inc.select(own, from, to);
  const prevRows = inc.select(own, from - w * DAY, from);
  const recent = rows.slice(0, 25);

  const body = [];
  if (crisisEntry) {
    body.push(section(null, h('p.cv-partof', null, h('span.meta', null, `${t.partOf} `), crisisName(crisisEntry), ' ',
      h('button.link-button', { type: 'button', onclick: () => ctx.onOpenCrisis?.(crisisEntry.id) }, t.openCrisis))));
  }
  const conflicts = info?.conflicts ?? [];
  body.push(section(t.countryConflicts, conflicts.length
    ? h('ul.cv-list', null, conflicts.map((c) => h('li', null,
      h('span.cv-name', null, c.name),
      h('span.meta', null, [t.type[c.type] ?? c.type, c.startYear ? t.since(c.startYear) : null,
        typeof c.fatalities === 'number' ? t.deaths(fmtNum(c.fatalities), c.fatalitiesAsOf?.slice(0, 4)) : null].filter(Boolean).join(' · ')))))
    : h('p', null, t.noConflicts)));
  if (recent.length) {
    body.push(section(t.recent, h('ul.cv-incidents', null, recent.map((r) => {
      const v = inc.verified(r);
      return h(`li${v ? '.is-verified' : ''}`, null,
        h('p.meta', null, [fmtShortDay(new Date(inc.at(r)).toISOString()), CATEGORY[prefs.lang][inc.category(r)] ?? '',
          v ? t.verified : inc.outlets(r) >= 2 ? t.corroborated(inc.outlets(r)) : t.oneSource].join(' · ')),
        h('button.cv-place', { type: 'button', onclick: () => ctx.onZoom?.([inc.lon(r), inc.lat(r)], 8) }, r[9]),
        v ? h('p.cv-note', null, v.note) : null,
        r[10] ? h('p.cv-src', null, h('a', { href: r[10], target: '_blank', rel: 'noopener' }, inc.publisher(r) || hostOf(r[10]))) : null);
    }))));
  }

  container.replaceChildren(
    ...header(ctx, {
      title: [name, ''],
      region: t.country,
      rows, prevRows, exclude: new Set([name]),
      daily: inc.daily(own),
    }),
    ...body,
  );
}

export { fmtDay, esc, joinNames };
