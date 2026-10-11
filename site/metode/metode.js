/**
 * The method page: two languages written out in the page, and the corrections log read from
 * data/corrections.json, so a correction appears without a site build.
 */
import { prefs, setupPrefs, $, getJson, esc, fmtDay } from '../common.js';

const LABEL = {
  en: { wrong: 'What was wrong', fixed: 'What was done', none: 'No corrections yet.' },
  nb: { wrong: 'Hva som var feil', fixed: 'Hva som ble gjort', none: 'Ingen rettelser ennå.' },
};
let corrections = [];
let crises = [];

function render() {
  const lang = prefs.lang;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const v = prefs.t[node.dataset.i18n];
    if (typeof v === 'string') node.textContent = v;
  }
  for (const art of document.querySelectorAll('article[data-lang]')) art.hidden = art.dataset.lang !== lang;
  document.title = lang === 'nb' ? 'Metode og rettelser · IGRED Global Conflict Monitor' : 'Method and corrections · IGRED Global Conflict Monitor';
  const name = (id) => { const c = crises.find((x) => x.id === id); return c ? (lang === 'nb' ? c.nameNb : c.name) : id; };
  for (const list of document.querySelectorAll('[data-corrections]')) {
    list.innerHTML = corrections.length
      ? corrections.map((c) => `<li><p class="meta">${esc(fmtDay(`${c.date}T00:00:00Z`))} · <a href="../#crisis=${encodeURIComponent(c.crisis)}">${esc(name(c.crisis))}</a></p>` +
        `<p class="label">${esc(LABEL[lang].wrong)}</p><p>${esc(c.wrong[lang] ?? c.wrong.en)}</p>` +
        `<p class="label">${esc(LABEL[lang].fixed)}</p><p>${esc(c.fixed[lang] ?? c.fixed.en)}</p></li>`).join('')
      : `<li><p>${esc(LABEL[lang].none)}</p></li>`;
  }
}

setupPrefs({ langButton: $('lang'), themeButton: $('theme'), onChange: render });
render();
Promise.all([getJson('corrections.json').catch(() => ({ corrections: [] })), getJson('crises.json').catch(() => ({ crises: [] }))])
  .then(([c, i]) => { corrections = c.corrections ?? []; crises = i.crises ?? []; render(); });
