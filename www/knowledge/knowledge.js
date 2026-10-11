/**
 * The knowledge base: what the people behind IGRED have read and recommend, from
 * www/knowledge.json. Plain lists; nothing here is fetched from anywhere else.
 */
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const STRINGS = {
  en: { books: 'Top five books', films: 'Top five films', other: 'Top five, anything else', read: 'Everything we have read',
    title: 'Title', by: 'By', year: 'Year', readBy: 'Read by', empty: 'The lists are being written.', navMap: 'Map', navAbout: 'About',
    switchLang: 'NO', dark: 'Dark', light: 'Light' },
  nb: { books: 'Topp fem bøker', films: 'Topp fem filmer', other: 'Topp fem, alt annet', read: 'Alt vi har lest',
    title: 'Tittel', by: 'Av', year: 'År', readBy: 'Lest av', empty: 'Listene skrives nå.', navMap: 'Kart', navAbout: 'Om oss',
    switchLang: 'EN', dark: 'Mørk', light: 'Lys' },
};
let lang = safeGet('igred-lang') === 'nb' ? 'nb' : 'en';
const t = () => STRINGS[lang];
let data = null;

function item(x) {
  const title = x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title);
  const meta = [x.by, x.year].filter(Boolean).map(esc).join(', ');
  return `<li><span class="kb-title">${title}</span>${meta ? ` <span class="meta">${meta}</span>` : ''}${x.note ? `<span class="kb-note">${esc(x.note)}</span>` : ''}</li>`;
}

function render() {
  document.documentElement.lang = lang;
  for (const n of document.querySelectorAll('[data-i18n]')) if (typeof t()[n.dataset.i18n] === 'string') n.textContent = t()[n.dataset.i18n];
  $('lang').textContent = t().switchLang;
  $('theme').textContent = document.documentElement.dataset.theme === 'dark' ? t().light : t().dark;
  if (!data) return;
  const people = data.people ?? [];
  const any = people.some((p) => Object.values(p.top ?? {}).some((l) => l.length)) || (data.read ?? []).length;
  if (!any) { $('kb-top').innerHTML = `<p class="kb-empty">${esc(t().empty)}</p>`; $('kb-read').innerHTML = ''; return; }
  $('kb-top').innerHTML = `<div class="kb-people">${people.map((p) => `<section class="kb-person"><h2>${esc(p.name)}</h2>${
    ['books', 'films', 'other'].filter((k) => (p.top?.[k] ?? []).length).map((k) => `<h3 class="kb-h">${esc(t()[k])}</h3><ol class="kb-list">${p.top[k].slice(0, 5).map(item).join('')}</ol>`).join('')
  }</section>`).join('')}</div>`;
  const read = [...(data.read ?? [])].sort((a, b) => String(a.title).localeCompare(String(b.title)));
  $('kb-read').innerHTML = read.length
    ? `<h3 class="kb-h">${esc(t().read)}</h3><table><thead><tr><th>${esc(t().title)}</th><th>${esc(t().by)}</th><th>${esc(t().year)}</th><th>${esc(t().readBy)}</th></tr></thead><tbody>${
      read.map((x) => `<tr><td class="kb-title">${esc(x.title)}</td><td>${esc(x.by)}</td><td class="meta">${esc(x.year ?? '')}</td><td class="meta">${esc((x.readBy ?? []).join(', '))}</td></tr>`).join('')}</tbody></table>`
    : '';
}

$('lang').addEventListener('click', () => { lang = lang === 'en' ? 'nb' : 'en'; safeSet('igred-lang', lang); render(); });
$('theme').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  safeSet('igred-theme-v2', root.dataset.theme);
  render();
});
fetch('../knowledge.json', { cache: 'no-cache' }).then((r) => r.json()).then((d) => { data = d; render(); }).catch(() => render());
render();
