/**
 * The knowledge base: books, articles and research worth reading, from www/knowledge.json,
 * each with the institute's own assessment of what it argues and where it holds.
 */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const STRINGS = {
  en: {
    intro: 'Books, articles and research worth reading, each with our own assessment of what it argues and where it holds.',
    argues: 'What it argues', holds: 'Where it holds', empty: 'The list is being written.',
    catalogue: 'Open Library', close: 'Close', credit: 'Covers and catalogue pages: Open Library.',
    kind: { book: 'Book', article: 'Article', research: 'Research' },
    switchLang: 'NO', dark: 'Dark', light: 'Light',
  },
  nb: {
    intro: 'Bøker, artikler og forskning verdt å lese, hver med vår egen vurdering av hva den hevder og hvor den holder.',
    argues: 'Hva den hevder', holds: 'Hvor den holder', empty: 'Listen skrives nå.',
    catalogue: 'Open Library', close: 'Lukk', credit: 'Omslag og katalogsider: Open Library.',
    kind: { book: 'Bok', article: 'Artikkel', research: 'Forskning' },
    switchLang: 'EN', dark: 'Mørk', light: 'Lys',
  },
};
let lang = safeGet('igred-lang') === 'nb' ? 'nb' : 'en';
const t = () => STRINGS[lang];
let works = null;
let topics = [];

function render() {
  document.documentElement.lang = lang;
  for (const n of document.querySelectorAll('[data-i18n]')) if (typeof t()[n.dataset.i18n] === 'string') n.textContent = t()[n.dataset.i18n];
  $('lang').textContent = t().switchLang;
  $('theme').textContent = document.documentElement.dataset.theme === 'dark' ? t().light : t().dark;
  $('kb-intro').textContent = t().intro;
  if (!works) return;
  if (!works.length) { $('kb-works').innerHTML = `<li class="kb-work"><p>${esc(t().empty)}</p></li>`; return; }
  const cover = (w, big = false) => (w.cover
    ? `<div class="kb-cover"><img src="${esc(big ? w.cover.replace('-M.jpg', '-L.jpg') : w.cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`
    : `<div class="kb-cover is-typeset"><span class="t">${esc(w.title.split(':')[0])}</span><span class="a">${esc(w.author ?? '')}</span></div>`);
  const book = (w, i) => `<li class="kb-book${w.cover ? '' : ' is-typeset'}"><button type="button" data-i="${i}" aria-label="${esc(w.title)}">${cover(w)}` +
    `<span class="t2">${esc(w.title.split(':')[0])}</span>` +
    `<span class="meta">${esc([w.author?.split(/,| and /)[0]?.replace(/\s*\(eds?\.\)/, ''), w.year].filter(Boolean).join(' · '))}${w.argues ? ' <span class="has-note">·</span>' : ''}</span></button></li>`;
  // One shelf per topic, in the order the file lists them; anything untagged comes last.
  const groups = [...topics.map((tp) => ({ label: tp[lang] ?? tp.en, items: works.filter((w) => w.topic === tp.id) })),
    { label: '', items: works.filter((w) => !topics.some((tp) => tp.id === w.topic)) }].filter((g) => g.items.length);
  $('kb-works').innerHTML = groups.map((g) =>
    `<section class="kb-shelf">${g.label ? `<h2><span>${esc(g.label)}</span><span class="meta">${g.items.length}</span></h2>` : ''}<ul class="kb-books">${
      g.items.map((w) => book(w, works.indexOf(w))).join('')}</ul></section>`).join('');
  $('kb-credit').textContent = t().credit;
  for (const btn of document.querySelectorAll('.kb-book button')) btn.addEventListener('click', () => openBook(works[Number(btn.dataset.i)]));
}

function openBook(w) {
  const dlg = $('kb-dialog');
  const big = w.cover
    ? `<div class="kb-cover"><img src="${esc(w.cover.replace('-M.jpg', '-L.jpg'))}" alt="" decoding="async" referrerpolicy="no-referrer"></div>`
    : `<div class="kb-cover is-typeset"><span class="t">${esc(w.title.split(':')[0])}</span><span class="a">${esc(w.author ?? '')}</span></div>`;
  dlg.innerHTML = `<div class="inner">${big}<div>` +
    `<h3 id="kb-dialog-title">${esc(w.title)}</h3>` +
    `<p class="meta" style="margin-top:8px">${esc([w.author, w.year].filter(Boolean).join(' · '))}</p>` +
    (w.argues ? `<p class="kb-label">${esc(t().argues)}</p><p>${esc(w.argues)}</p>` : '') +
    (w.holds ? `<p class="kb-label">${esc(t().holds)}</p><p>${esc(w.holds)}</p>` : '') +
    `<p class="actions">${w.url ? `<a class="link-button" href="${esc(w.url)}" target="_blank" rel="noopener">${esc(t().catalogue)}</a>` : '<span></span>'}` +
    `<button type="button" class="link-button quiet" id="kb-close">${esc(t().close)}</button></p></div></div>`;
  dlg.showModal();
  $('kb-close').addEventListener('click', () => dlg.close());
}
$('kb-dialog').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });

$('lang').addEventListener('click', () => { lang = lang === 'en' ? 'nb' : 'en'; safeSet('igred-lang', lang); render(); });
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  safeSet('igred-theme-v2', root.dataset.theme);
  render();
});
fetch('../knowledge.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => {
  topics = d.topics ?? [];
  works = [...(d.works ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || String(a.title).localeCompare(String(b.title)));
  render();
}).catch(() => { works = []; render(); });
render();
