/**
 * The menu (src/core/nav.ts): its labels follow the page's language, read from <html lang>
 * as each page sets it, and the "Menu" button opens and closes it where the header is narrow.
 * Mirrored byte for byte into www/.
 */
const nav = document.querySelector('.site-nav');
if (nav) {
  const header = nav.closest('.has-nav') ?? nav.parentElement;
  const toggle = nav.querySelector('.nav-toggle');
  const label = () => {
    const nb = document.documentElement.lang === 'nb';
    for (const el of nav.querySelectorAll('[data-en][data-nb]')) el.textContent = nb ? el.dataset.nb : el.dataset.en;
  };
  const setOpen = (open) => {
    header.classList.toggle('nav-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
  };
  toggle?.addEventListener('click', (ev) => { ev.stopPropagation(); setOpen(!header.classList.contains('nav-open')); });
  document.addEventListener('click', (ev) => { if (!nav.contains(ev.target)) setOpen(false); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && header.classList.contains('nav-open')) { setOpen(false); toggle?.focus(); } });
  new MutationObserver(label).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  label();
}
