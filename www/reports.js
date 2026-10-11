/**
 * The reports pages follow the reader's language, the same choice as the rest of the site
 * (localStorage "igred-lang", else the browser's). Every fixed text carries both languages
 * as data-nb and data-en; what a report says keeps its own lang and is never swapped.
 */
const root = document.documentElement;
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const stored = safeGet('igred-lang');
let lang = stored === 'nb' || stored === 'en' ? stored : /^(nb|nn|no)/.test((navigator.language || '').toLowerCase()) ? 'nb' : 'en';

const langButton = document.getElementById('lang');
const themeButton = document.getElementById('theme');

function paint() {
  root.lang = lang;
  for (const el of document.querySelectorAll('[data-nb][data-en]')) el.textContent = lang === 'nb' ? el.dataset.nb : el.dataset.en;
  if (langButton) {
    langButton.textContent = lang === 'nb' ? 'EN' : 'NO';
    langButton.setAttribute('aria-label', lang === 'nb' ? 'Switch to English' : 'Bytt til norsk');
  }
  if (themeButton) themeButton.textContent = root.dataset.theme === 'light' ? (lang === 'nb' ? 'Mørk' : 'Dark') : (lang === 'nb' ? 'Lys' : 'Light');
}

langButton?.addEventListener('click', () => { lang = lang === 'nb' ? 'en' : 'nb'; safeSet('igred-lang', lang); paint(); });
themeButton?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  safeSet('igred-theme-v2', root.dataset.theme);
  paint();
});
paint();
