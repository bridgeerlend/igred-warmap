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
    kind: { book: 'Book', article: 'Article', research: 'Research' },
    navMap: 'Map', switchLang: 'NO', dark: 'Dark', light: 'Light',
  },
  nb: {
    intro: 'Bøker, artikler og forskning verdt å lese, hver med vår egen vurdering av hva den hevder og hvor den holder.',
    argues: 'Hva den hevder', holds: 'Hvor den holder', empty: 'Listen skrives nå.',
    kind: { book: 'Bok', article: 'Artikkel', research: 'Forskning' },
    navMap: 'Kart', switchLang: 'EN', dark: 'Mørk', light: 'Lys',
  },
};
let lang = safeGet('igred-lang') === 'nb' ? 'nb' : 'en';
const t = () => STRINGS[lang];
let works = null;

function render() {
  document.documentElement.lang = lang;
  for (const n of document.querySelectorAll('[data-i18n]')) if (typeof t()[n.dataset.i18n] === 'string') n.textContent = t()[n.dataset.i18n];
  $('lang').textContent = t().switchLang;
  $('theme').textContent = document.documentElement.dataset.theme === 'dark' ? t().light : t().dark;
  $('kb-intro').textContent = t().intro;
  if (!works) return;
  if (!works.length) { $('kb-works').innerHTML = `<li class="kb-work"><p>${esc(t().empty)}</p></li>`; return; }
  $('kb-works').innerHTML = works.map((w) => {
    const title = w.url ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.title)}</a>` : esc(w.title);
    const meta = [t().kind[w.kind] ?? null, w.author, w.year].filter(Boolean).map(esc).join(' · ');
    return `<li class="kb-work"><h2>${title}</h2>${meta ? `<p class="meta">${meta}</p>` : ''}` +
      (w.argues ? `<p class="kb-label">${esc(t().argues)}</p><p>${esc(w.argues)}</p>` : '') +
      (w.holds ? `<p class="kb-label">${esc(t().holds)}</p><p>${esc(w.holds)}</p>` : '') + '</li>';
  }).join('');
}

$('lang').addEventListener('click', () => { lang = lang === 'en' ? 'nb' : 'en'; safeSet('igred-lang', lang); render(); });
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  safeSet('igred-theme-v2', root.dataset.theme);
  render();
});
fetch('../knowledge.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => {
  works = [...(d.works ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || String(a.title).localeCompare(String(b.title)));
  render();
}).catch(() => { works = []; render(); });
render();
