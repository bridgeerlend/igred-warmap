/**
 * The reports pages need only the light switch: the text is built into the page, and each
 * report is written in one language.
 */
const button = document.getElementById('theme');
const root = document.documentElement;
const label = () => { button.textContent = root.dataset.theme === 'light' ? button.dataset.dark : button.dataset.light; };
button?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('igred-theme-v2', root.dataset.theme); } catch { /* private mode */ }
  label();
});
if (button) label();

// The empty list follows the reader's language as the front page decides it: a stored choice,
// else the browser's.
const soon = document.querySelector('.r-soon');
if (soon) {
  let stored = null;
  try { stored = localStorage.getItem('igred-lang'); } catch { /* private mode */ }
  const nb = stored ? stored === 'nb' : /^(nb|nn|no)/.test((navigator.language || '').toLowerCase());
  if (!nb) {
    soon.textContent = soon.dataset.en;
    const title = document.querySelector('.r-list .title span');
    if (title?.dataset.en) title.textContent = title.dataset.en;
    document.documentElement.lang = 'en';
  }
}
