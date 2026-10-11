/**
 * The election page: national elections in the next twelve months from data/elections.json,
 * each with its risk score, every indicator behind it with source and year, and after the
 * election its result and whether unrest followed. Read at view time, like the map.
 */
import { prefs, setupPrefs, $, h, getJson, fmtDay, electionKind, BRAND } from '../common.js';

const S = {
  en: {
    title: 'Elections', page: 'Elections',
    intro: 'National elections in the next twelve months, from Wikipedia\'s electoral calendar. Each has a risk score from 0 to 100 built from six indicators; open an election to see every figure with its source and year.',
    updated: (d, c) => `Calendar read ${d}. Incident counts through ${c}.`,
    upcoming: 'Coming up', held: 'Recently held', none: 'None in this period.',
    score: 'Election risk', of100: 'of 100', noScore: 'Too little data for a score',
    coverage: (p, missing) => `Rests on ${p} % of the weights${missing ? `; no data for ${missing}` : ''}.`,
    why: 'Why it matters', machine: 'Written by a language model from Wikipedia and checked by the fact guard.', how: 'How', result: 'Result',
    noResult: 'No result stated in the sources yet.',
    unrest: (u) => `Incidents in the first ${u.days} days: ${u.after}, against ${u.before} in the ${u.days} days before${u.complete ? '' : ' (still counting)'}.`,
    unrestYes: 'Unrest followed the election.', unrestNo: 'No unrest beyond the usual level.',
    crisis: 'The country has an active crisis on the map:', wiki: 'Wikipedia', onMap: 'On the map',
    head: { indicator: 'Indicator', figure: 'Figure', year: 'Year', risk: 'Risk', source: 'Source' },
    missing: 'No data', weight: (w) => `weight ${w}`,
    background: 'Background, not in the score', rsfLine: (v) => `World Press Freedom Index 2026: ${v} of 100.`, rsfWhy: 'Shown unchanged; RSF\'s licence does not allow it to be adapted into a score.',
    method: 'How the score is made',
    methodIntro: 'Each indicator is a risk from 0 to 100, and the score is their weighted mean. An indicator without data for a country is left out and the others weigh more; with less than half of the weight there is no score. Below {e} is low, from {e} elevated, from {h} high.',
    sourcesH: 'Sources', skipped: 'Not used',
    lead: 'The figures are the sources\' own. The scales that turn them into risk are in config/elections.json.',
    ind: {
      quality: 'Election quality', unrest: 'Unrest at the last election', press: 'Press freedom and rights',
      now: 'The situation now', close: 'A close race', economy: 'Economic exposure',
    },
    units: {
      index: (v) => `${fmt(v, 2)} of 1`, of100: (v) => `${fmt(v, 1)} of 100`, incidents: (v) => `${fmt(v, 0)} incidents in 30 days`,
      pct: (v, key) => (key === 'turnout' ? `${fmt(v, 1)} % turnout` : key === 'debt' ? `${fmt(v, 1)} % of GDP` : key === 'currency' ? `${v >= 0 ? '+' : ''}${fmt(v, 1)} % per US dollar` : `${v >= 0 ? '+' : ''}${fmt(v, 0)} %`),
      points: (v) => `${fmt(v, 1)} points between the first two`, usd: (v) => `US$ ${fmt(v, 0)} per person`,
    },
    src: {
      vdem: () => 'V-Dem, clean elections index',
      pei: (m) => `Electoral Integrity Project (PEI), ${m.office} election ${m.date}`,
      rsf: () => 'RSF, World Press Freedom Index',
      fh: () => 'Freedom House, Freedom in the World',
      events: () => `GDELT as ${BRAND.short} counts it: violent protest, repression and armed violence`,
      trend: () => `GDELT as ${BRAND.short} counts it: the past 30 days against the 30 before`,
      margin: (m) => `Wikipedia: ${m.article}`, turnout: (m) => `Wikipedia: ${m.article}`,
      gdp: () => 'World Bank, GDP per person (current US$)',
      debt: () => 'World Bank, central government debt (share of GDP)',
      currency: (m) => `World Bank, official exchange rate against the US dollar, ${m.from} to ${m.to}`,
    },
    span: (a, b) => `${a} to ${b}`,
    sw: 'NO', light: 'Light', dark: 'Dark',
  },
  nb: {
    title: 'Valg', page: 'Valg',
    intro: 'Nasjonale valg de neste tolv månedene, fra Wikipedias valgkalender. Hvert valg har en risikoscore fra 0 til 100 bygget av seks indikatorer; åpne et valg for å se hvert tall med kilde og årstall.',
    updated: (d, c) => `Kalenderen lest ${d}. Hendelsestall til og med ${c}.`,
    upcoming: 'Kommende', held: 'Nylig holdt', none: 'Ingen i perioden.',
    score: 'Valgrisiko', of100: 'av 100', noScore: 'For lite data til en score',
    coverage: (p, missing) => `Bygger på ${p} % av vektene${missing ? `; mangler data for ${missing}` : ''}.`,
    why: 'Hvorfor valget betyr noe', machine: 'Skrevet av en språkmodell fra Wikipedia og kontrollert av faktavakten.', how: 'Slik', result: 'Resultat',
    noResult: 'Kildene oppgir ikke noe resultat ennå.',
    unrest: (u) => `Hendelser de første ${u.days} dagene: ${u.after}, mot ${u.before} de ${u.days} dagene før${u.complete ? '' : ' (telles fortsatt)'}.`,
    unrestYes: 'Det kom uro etter valget.', unrestNo: 'Ingen uro utover det vanlige.',
    crisis: 'Landet har en aktiv krise på kartet:', wiki: 'Wikipedia', onMap: 'På kartet',
    head: { indicator: 'Indikator', figure: 'Tall', year: 'År', risk: 'Risiko', source: 'Kilde' },
    missing: 'Ingen data', weight: (w) => `vekt ${w}`,
    background: 'Bakgrunnstall, ikke i scoren', rsfLine: (v) => `World Press Freedom Index 2026: ${v} av 100.`, rsfWhy: 'Vist uendret; RSFs lisens tillater ikke at indeksen bearbeides til en score.',
    method: 'Slik regnes scoren',
    methodIntro: 'Hver indikator er en risiko fra 0 til 100, og scoren er det vektede snittet. En indikator uten data for landet utelates, og de andre veier mer; med under halvparten av vekten blir det ingen score. Under {e} er lav, fra {e} forhøyet, fra {h} høy.',
    sourcesH: 'Kilder', skipped: 'Ikke brukt',
    lead: 'Tallene er kildenes egne. Skalaene som gjør dem om til risiko står i config/elections.json.',
    ind: {
      quality: 'Valgkvalitet', unrest: 'Uro ved forrige valg', press: 'Pressefrihet og rettigheter',
      now: 'Situasjonen nå', close: 'Tett valg', economy: 'Økonomisk eksponering',
    },
    units: {
      index: (v) => `${fmt(v, 2)} av 1`, of100: (v) => `${fmt(v, 1)} av 100`, incidents: (v) => `${fmt(v, 0)} hendelser på 30 dager`,
      pct: (v, key) => (key === 'turnout' ? `${fmt(v, 1)} % valgdeltakelse` : key === 'debt' ? `${fmt(v, 1)} % av BNP` : key === 'currency' ? `${v >= 0 ? '+' : ''}${fmt(v, 1)} % per amerikansk dollar` : `${v >= 0 ? '+' : ''}${fmt(v, 0)} %`),
      points: (v) => `${fmt(v, 1)} prosentpoeng mellom de to første`, usd: (v) => `${fmt(v, 0)} USD per innbygger`,
    },
    src: {
      vdem: () => 'V-Dem, indeks for rene valg',
      pei: (m) => `Electoral Integrity Project (PEI), ${({ legislative: 'parlamentsvalget', presidential: 'presidentvalget', referendum: 'folkeavstemningen' })[m.office] ?? 'valget'} ${m.date}`,
      rsf: () => 'RSF, World Press Freedom Index',
      fh: () => 'Freedom House, Freedom in the World',
      events: () => `GDELT slik ${BRAND.short} teller den: voldelige protester, undertrykking og væpnet vold`,
      trend: () => `GDELT slik ${BRAND.short} teller den: siste 30 dager mot de 30 før`,
      margin: (m) => `Wikipedia: ${m.article}`, turnout: (m) => `Wikipedia: ${m.article}`,
      gdp: () => 'Verdensbanken, BNP per innbygger (løpende USD)',
      debt: () => 'Verdensbanken, sentralstatens gjeld (andel av BNP)',
      currency: (m) => `Verdensbanken, offisiell valutakurs mot amerikanske dollar, ${m.from} til ${m.to}`,
    },
    span: (a, b) => `${a} til ${b}`,
    sw: 'EN', light: 'Lys', dark: 'Mørk',
  },
};
const t = () => S[prefs.lang];
function fmt(v, digits) {
  return new Intl.NumberFormat(prefs.lang === 'nb' ? 'nb-NO' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits ? Math.min(digits, 1) : 0 }).format(v);
}

let data = null;
const open = new Set();

function row(e) {
  const s = t();
  const nb = prefs.lang === 'nb';
  const isOpen = open.has(e.id);
  const button = h('button.vote-row', { type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': `d-${e.id}`, onclick: () => toggle(e.id) },
    h('span.vote-date', null, fmtDay(`${e.date}T00:00:00Z`)),
    h('span', null, h('span.vote-country', null, nb ? e.country.nb : e.country.en), h('span.vote-kind', null, electionKind(e))),
    e.score === null
      ? h('span.vote-score', null, h('span.meta', null, s.noScore))
      : h('span.vote-score', null, h('b', { class: `risk-${e.level}` }, String(e.score)), h('span.meta', null, prefs.t.riskLevel[e.level])));
  return h('li', { id: e.id }, button, isOpen ? detail(e) : null);
}

function detail(e) {
  const s = t();
  const nb = prefs.lang === 'nb';
  const w = data.method.weights;
  const missingNames = e.missing.map((id) => s.ind[id].toLowerCase()).join(', ');
  const parts = [];
  if (e.status === 'upcoming' && e.why) {
    parts.push(h('p.vote-why', null, nb ? (e.why.nb ?? e.why.en) : e.why.en),
      h('p.meta.vote-machine', null, s.machine, ' ', h('a', { href: '../metode/#guard' }, s.how)));
  }
  if (e.status === 'held') {
    parts.push(h('div.vote-result', null,
      h('p.meta', null, s.result),
      h('p', null, e.result ? (nb ? (e.result.nb ?? e.result.en) : e.result.en) : s.noResult),
      e.result ? h('p.meta.vote-machine', null, s.machine, ' ', h('a', { href: e.wiki.url, target: '_blank', rel: 'noopener' }, e.wiki.title)) : null,
      e.unrest ? h('p', null, s.unrest(e.unrest), ' ', h('b', null, e.unrest.unrest ? s.unrestYes : s.unrestNo)) : null));
  }
  parts.push(h('div.vote-big', null,
    e.score === null ? h('span.meta', null, s.noScore) : h('b', { class: `risk-${e.level}` }, String(e.score)),
    e.score === null ? null : h('span', null, `${s.of100} · ${prefs.t.riskLevel[e.level]}`)),
    h('p.meta', null, s.coverage(fmt(e.coverage, 0), missingNames)));
  const head = h('thead', null, h('tr', null, h('th', null, s.head.indicator), h('th', null, s.head.figure), h('th', null, s.head.year), h('th.num', null, s.head.risk)));
  const body = h('tbody', null, ...data.method.indicators.flatMap((id) => {
    const ind = e.indicators.find((x) => x.id === id);
    const top = h('tr', null,
      h('th.ind-name', { colspan: 3, scope: 'rowgroup' }, `${s.ind[id]} `, h('span.meta', null, s.weight(w[id]))),
      h('td.num.ind-name', null, ind?.risk === null || !ind ? '' : fmt(ind.risk, 0)));
    if (!ind || ind.risk === null) return [top, h('tr', null, h('td.ind-missing', { colspan: 4 }, s.missing))];
    return [top, ...ind.parts.map((p) => h('tr', null,
      h('td', null, h('a', { href: p.url, target: '_blank', rel: 'noopener' }, s.src[p.key]?.(p.meta ?? {}) ?? p.source)),
      h('td', null, (s.units[p.unit] ?? ((v) => fmt(v, 1)))(p.raw, p.key)),
      h('td', null, p.year.includes('/') ? s.span(...p.year.split('/').map((d) => fmtDay(`${d}T00:00:00Z`))) : p.year),
      h('td.num', null, fmt(p.risk, 0))))];
  }));
  parts.push(h('table.vote-ind', null, head, body));
  for (const b of e.background ?? []) {
    parts.push(h('div.vote-background', null,
      h('p.meta', null, s.background),
      h('p', null, s.rsfLine(new Intl.NumberFormat(prefs.lang === 'nb' ? 'nb-NO' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(b.raw)), ' ',
        h('a', { href: b.url, target: '_blank', rel: 'noopener' }, b.credit), '.'),
      h('p.meta', null, s.rsfWhy, ' ', b.licenseUrl ? h('a', { href: b.licenseUrl, target: '_blank', rel: 'noopener' }, 'CC BY-NC-ND') : null)));
  }
  parts.push(h('p.vote-links', null,
    h('a.link-button', { href: e.wiki.url, target: '_blank', rel: 'noopener' }, s.wiki),
    e.crisis ? h('span', null, `${s.crisis} `, h('a', { href: `../#crisis=${encodeURIComponent(e.crisis.id)}` }, nb ? e.crisis.nb : e.crisis.en)) : null));
  return h('div.vote-detail', { id: `d-${e.id}` }, ...parts);
}

function toggle(id) {
  if (open.has(id)) open.delete(id); else open.add(id);
  history.replaceState(null, '', open.has(id) ? `#${id}` : location.pathname);
  render();
}

/** A source's name, edition, licence or reason in the page's language, the English where there is no Norwegian. */
const loc = (x, field) => (prefs.lang === 'nb' && x[`${field}Nb`]) || x[field];

function methodBody() {
  const s = t();
  const m = data.method;
  const intro = s.methodIntro.replaceAll('{e}', String(m.levels.elevated)).replaceAll('{h}', String(m.levels.high));
  const used = data.sources.filter((x) => x.status === 'ok' && !x.background);
  const beside = data.sources.filter((x) => x.status === 'ok' && x.background);
  const skipped = data.sources.filter((x) => x.status !== 'ok');
  return [
    h('p', null, intro),
    h('dl.votes-weights', null, ...m.indicators.flatMap((id) => [h('dt', null, s.ind[id]), h('dd', null, String(m.weights[id]))])),
    h('p', null, s.lead),
    h('p.meta', null, s.sourcesH),
    h('ul', null,
      ...used.map((x) => h('li', null, h('a', { href: x.page, target: '_blank', rel: 'noopener' }, loc(x, 'name')), `, ${loc(x, 'edition')}. `,
        x.licenseUrl ? h('a', { href: x.licenseUrl, target: '_blank', rel: 'noopener' }, loc(x, 'license')) : (loc(x, 'license') ?? ''))),
      h('li', null, h('a', { href: data.worldBank.url, target: '_blank', rel: 'noopener' }, prefs.lang === 'nb' ? 'Verdensbanken' : 'World Bank'), ', API.'),
      h('li', null, 'GDELT, ', h('a', { href: '../metode/' }, prefs.lang === 'nb' ? `slik ${BRAND.short} teller den` : `as ${BRAND.short} counts it`), '.'),
      ...data.calendar.pages.map((p) => h('li', null, h('a', { href: p.url, target: '_blank', rel: 'noopener' }, `Wikipedia: ${p.title}`)))),
    beside.length ? h('p.meta', null, s.background) : null,
    beside.length ? h('ul', null, ...beside.map((x) => h('li', null, h('a', { href: x.page, target: '_blank', rel: 'noopener' }, loc(x, 'name')), `, ${loc(x, 'edition')}. ${x.credit ?? ''}. `,
      x.licenseUrl ? h('a', { href: x.licenseUrl, target: '_blank', rel: 'noopener' }, loc(x, 'license')) : (loc(x, 'license') ?? '')))) : null,
    skipped.length ? h('p.meta', null, s.skipped) : null,
    skipped.length ? h('ul', null, ...skipped.map((x) => h('li', null, h('a', { href: x.page, target: '_blank', rel: 'noopener' }, loc(x, 'name')), `: ${loc(x, 'reason')}`))) : null,
  ];
}

function render() {
  const s = t();
  document.documentElement.lang = prefs.lang;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const v = prefs.t[node.dataset.i18n];
    if (typeof v === 'string') node.textContent = v;
  }
  document.title = `${s.page} · ${BRAND.products.monitor}`;
  $('votes-title').replaceChildren(h('span', null, s.title));
  $('votes-intro').textContent = s.intro;
  $('upcoming-h').textContent = s.upcoming;
  $('held-h').textContent = s.held;
  $('method-h').textContent = s.method;
  if (!data) return;
  $('votes-updated').textContent = s.updated(data.calendar.fetchedAt ? fmtDay(data.calendar.fetchedAt) : '?', fmtDay(`${data.countsThrough}T00:00:00Z`));
  const up = data.elections.filter((e) => e.status === 'upcoming');
  const held = data.elections.filter((e) => e.status === 'held').reverse();
  $('upcoming').replaceChildren(...(up.length ? up.map(row) : [h('li', null, h('p', null, s.none))]));
  $('held').replaceChildren(...(held.length ? held.map(row) : [h('li', null, h('p', null, s.none))]));
  $('method-body').replaceChildren(...methodBody().filter(Boolean));
}

setupPrefs({ langButton: $('lang'), themeButton: $('theme'), onChange: render });
render();
getJson('elections.json').then((d) => {
  data = d;
  const id = decodeURIComponent(location.hash.slice(1));
  if (id && d.elections.some((e) => e.id === id)) open.add(id);
  render();
  if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
}).catch(() => { $('votes-updated').textContent = prefs.lang === 'nb' ? 'Valgdataene kunne ikke lastes.' : 'The election data could not be loaded.'; });

// A link to another election on the same page opens it.
window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!data || !data.elections.some((e) => e.id === id)) return;
  open.add(id);
  render();
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
});
