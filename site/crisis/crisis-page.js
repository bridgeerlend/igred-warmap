import { dataBaseUrl } from '../config.js';
import { prefs, setupPrefs, h, crisisName } from '../common.js';
import { renderCrisis } from '../crisis-view.js';

const id = new URLSearchParams(location.search).get('id') ?? '';
const page = document.getElementById('page');
let data = null;

function paint() {
  document.querySelectorAll('[data-t]').forEach((n) => { n.textContent = prefs.t[n.dataset.t]; });
  if (!data) return;
  document.title = `${crisisName(data)} · IGRED`;
  page.replaceChildren(
    h('a.back', { href: `../#${encodeURIComponent(data.id)}` }, prefs.t.backToMap),
    renderCrisis(data, { mode: 'page' }),
  );
}

setupPrefs({ langButton: document.getElementById('lang'), themeButton: document.getElementById('theme'), onChange: (w) => { if (w === 'lang') paint(); } });
paint();

try {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('bad id');
  const res = await fetch(`${dataBaseUrl()}crises/${id}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(String(res.status));
  data = await res.json();
  paint();
} catch {
  page.replaceChildren(h('p.panel-loading', null, prefs.t.crisisError, ' ', h('a', { href: '../' }, prefs.t.backToMap)));
}
