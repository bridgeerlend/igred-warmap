/**
 * The one menu on every page of both sites, in this order, with the language and light
 * switches after it. `npm run brand` stamps it into the static pages; the crisis pages and the
 * reports are built with it. The labels are in both languages in the markup, and nav.js shows
 * the one the page is in.
 */
export type NavKey = 'map' | 'brief' | 'wire' | 'reports' | 'elections' | 'method';

export const NAV: { key: NavKey; href: string; en: string; nb: string }[] = [
  { key: 'map', href: 'https://map.igred.org/', en: 'Map', nb: 'Kart' },
  { key: 'brief', href: 'https://map.igred.org/brief/', en: 'Brief', nb: 'Brief' },
  { key: 'wire', href: 'https://map.igred.org/stream/', en: 'Wire', nb: 'Wire' },
  { key: 'reports', href: 'https://igred.org/reports/', en: 'Reports', nb: 'Rapporter' },
  { key: 'elections', href: 'https://map.igred.org/valg/', en: 'Elections', nb: 'Valg' },
  { key: 'method', href: 'https://map.igred.org/metode/', en: 'Method', nb: 'Metode' },
];

/** The menu: a "Menu" button where the header is narrow, the items, then language and light. */
export function navHtml(active: NavKey | null, indent = '  '): string {
  const i = `${indent}  `;
  const items = NAV.map((n) => `${i}  <a class="link-button" href="${n.href}" data-en="${n.en}" data-nb="${n.nb}"${n.key === active ? ' aria-current="true"' : ''}>${n.en}</a>`);
  return [
    `<nav class="controls site-nav" aria-label="Menu">`,
    `${i}<button type="button" class="link-button nav-toggle" aria-expanded="false" aria-controls="nav-items" data-en="Menu" data-nb="Meny">Menu</button>`,
    `${i}<div class="nav-items" id="nav-items">`,
    ...items,
    `${i}  <button type="button" class="link-button" id="lang">NO</button>`,
    `${i}  <button type="button" class="link-button" id="theme">Light</button>`,
    `${i}</div>`,
    `${indent}</nav>`,
  ].join('\n');
}
