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
