/**
 * The newsroom for reports: Decap CMS with the GitHub backend and Netlify's GitHub OAuth.
 *
 * - Reports are Markdown with front matter in www/content/reports/, built into pages and PDFs
 *   by scripts/build-reports.ts in the Netlify build.
 * - Editorial workflow: a draft is a branch (cms/...) and a pull request; only publishing
 *   merges it into main and builds the site. netlify.toml skips builds for those branches.
 * - Each building block is an editor component with a small form. It writes a fenced block,
 *   `::: name` … `:::` with YAML inside, which the build turns into the figure.
 *
 * The lists the forms choose from (crises, countries, the risk register) are read when the
 * editor opens, so the editor never offers a crisis the build does not know.
 */
const CMS = window.CMS;
const yaml = window.jsyaml;
const RAW = 'https://raw.githubusercontent.com/bridgeerlend/igred-warmap/main';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);

async function json(url, fallback) {
  try { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return await r.json(); } catch { return fallback; }
}
async function text(url, fallback) {
  try { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return await r.text(); } catch { return fallback; }
}

const [crisesConfig, countriesData, registerText] = await Promise.all([
  json(`${RAW}/config/crises.json`, { crises: [] }),
  json(`${RAW}/data/countries.json`, { countries: {} }),
  text('../content/risk-register.yml', 'risks: []'),
]);
const crisisOptions = crisesConfig.crises.map((c) => ({ label: c.nameNb, value: c.id }));
const countryOptions = Object.entries(countriesData.countries)
  .map(([fips, c]) => ({ label: c.nameNb ?? c.name, value: fips }))
  .sort((a, b) => a.label.localeCompare(b.label, 'nb'));
const register = (yaml.load(registerText)?.risks ?? []);
const riskOptions = register.map((r) => ({ label: r.nb, value: r.id }));
const crisisName = (id) => crisisOptions.find((c) => c.value === id)?.label ?? id;
const countryName = (id) => countryOptions.find((c) => c.value === id)?.label ?? id;
const riskName = (id) => riskOptions.find((r) => r.value === id)?.label ?? id;

/* ---------- fields ------------------------------------------------------------ */

const date = (name, label, extra = {}) => ({
  name, label, widget: 'datetime', format: 'YYYY-MM-DD', date_format: 'DD.MM.YYYY', time_format: false, picker_utc: true, ...extra,
});
const score = (name, label) => ({ name, label, widget: 'number', value_type: 'int', min: 1, max: 5, default: 3 });
const BLOCKS = ['figures', 'chart', 'table', 'risk', 'map', 'quote', 'footnote', 'sources'];
const markdown = (name, label, extra = {}) => ({
  name, label, widget: 'markdown', editor_components: BLOCKS, modes: ['rich_text', 'raw'],
  buttons: ['bold', 'italic', 'link', 'heading-two', 'heading-three', 'quote', 'bulleted-list', 'numbered-list'], ...extra,
});
const sourceFields = [
  { name: 'author', label: 'Forfatter', widget: 'string', required: false },
  { name: 'date', label: 'År eller dato', widget: 'string', required: false },
  { name: 'title', label: 'Tittel', widget: 'string' },
  { name: 'publisher', label: 'Utgiver', widget: 'string', required: false },
  { name: 'url', label: 'Lenke', widget: 'string', required: false },
];
const sources = { name: 'sources', label: 'Kildeliste', widget: 'list', required: false, summary: '{{fields.title}}', fields: sourceFields };
const common = (type) => [
  { name: 'title', label: 'Tittel', widget: 'string' },
  { name: 'type', label: 'Type', widget: 'hidden', default: type },
  date('date', 'Dato'),
  { name: 'version', label: 'Versjon', widget: 'string', default: '1.0', hint: 'Øk versjonen når en publisert rapport rettes, og si i teksten hva som er rettet.' },
  { name: 'authors', label: 'Forfattere', widget: 'list', default: ['Erlend B. Moe', 'Viktor Bratberg'], field: { name: 'author', label: 'Forfatter', widget: 'string' } },
  { name: 'lang', label: 'Språk', widget: 'select', default: 'nb', options: [{ label: 'Norsk', value: 'nb' }, { label: 'Engelsk', value: 'en' }] },
  { name: 'ingress', label: 'Ingress', widget: 'text', hint: 'To eller tre setninger: hva rapporten konkluderer med.' },
];
const LIKELIHOOD = [
  { label: 'Svært usannsynlig (under 10 %)', value: 'very-unlikely' },
  { label: 'Usannsynlig (10-35 %)', value: 'unlikely' },
  { label: 'Like sannsynlig (35-55 %)', value: 'even' },
  { label: 'Sannsynlig (55-80 %)', value: 'likely' },
  { label: 'Svært sannsynlig (over 80 %)', value: 'very-likely' },
];

const halvar = {
  name: 'halvar', label: 'Halvårsrapporter', label_singular: 'Halvårsrapport',
  folder: 'www/content/reports', create: true, extension: 'md', format: 'frontmatter',
  filter: { field: 'type', value: 'halvar' }, slug: '{{year}}-{{slug}}',
  summary: '{{title}} · {{date}}', sortable_fields: ['date', 'title'],
  preview_path: 'reports/{{slug}}/',
  fields: [
    ...common('halvar').slice(0, 1),
    { name: 'period', label: 'Periode', widget: 'string', hint: 'For eksempel «April til september 2026».' },
    ...common('halvar').slice(1),
    {
      name: 'assessments', label: 'Hovedvurderinger', label_singular: 'vurdering', widget: 'list', min: 5, max: 7,
      summary: '{{fields.likelihood}}', hint: 'Fem til sju punkter, hvert med et fast sannsynlighetsord.',
      fields: [
        { name: 'likelihood', label: 'Sannsynlighet', widget: 'select', options: LIKELIHOOD, default: 'likely' },
        markdown('text', 'Vurdering', { buttons: ['bold', 'italic', 'link'], editor_components: ['footnote'] }),
      ],
    },
    {
      name: 'risks', label: 'Risikoregister', label_singular: 'risiko', widget: 'list', summary: '{{fields.risk}}',
      hint: 'Fast liste. Score er sannsynlighet ganger konsekvens. Pila regnes ut mot forrige halvårsrapport.',
      fields: [
        { name: 'risk', label: 'Risiko', widget: 'select', options: riskOptions },
        score('likelihood', 'Sannsynlighet (1-5)'),
        score('consequence', 'Konsekvens (1-5)'),
        { name: 'previous', label: 'Score i forrige utgave', widget: 'number', value_type: 'int', min: 1, max: 25, required: false, hint: 'Bare i den første rapporten i systemet. Senere regnes den ut av seg selv.' },
        { name: 'note', label: 'Kort begrunnelse', widget: 'string', required: false },
      ],
    },
    {
      name: 'regions', label: 'Regioner', label_singular: 'region', widget: 'list', summary: '{{fields.name}}',
      fields: [
        { name: 'name', label: 'Region', widget: 'string' },
        markdown('happened', 'Hva skjedde'),
        markdown('drivers', 'Drivere'),
        markdown('next', 'Neste seks måneder'),
        { name: 'watch', label: 'Hva man bør følge med på', widget: 'list', required: false, field: { name: 'item', label: 'Punkt', widget: 'string' } },
      ],
    },
    markdown('economy', 'Økonomisk utvikling'),
    { name: 'essay', label: 'Temaessay', widget: 'object', fields: [{ name: 'title', label: 'Tema', widget: 'string' }, markdown('body', 'Essay')] },
    markdown('misses', 'Hva vi bommet på'),
    markdown('method', 'Metode og kilder'),
    sources,
  ],
};

const analyse = {
  name: 'analyse', label: 'Analyser', label_singular: 'Analyse',
  folder: 'www/content/reports', create: true, extension: 'md', format: 'frontmatter',
  filter: { field: 'type', value: 'analyse' }, slug: '{{year}}-{{month}}-{{slug}}',
  summary: '{{title}} · {{date}}', sortable_fields: ['date', 'title'],
  preview_path: 'reports/{{slug}}/',
  fields: [...common('analyse'), markdown('body', 'Tekst'), sources],
};

/* ---------- building blocks ----------------------------------------------------- */

const clean = (data) => Object.fromEntries(Object.entries(data ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
const fence = (id) => new RegExp(`^::: ${id}\\n([\\s\\S]*?)\\n:::(?=\\n|$)`);
const fmtDate = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
const card = (label, detail) => `<div style="border-left:2px solid #E85A2C;padding:8px 12px;margin:8px 0;font:13px Inter,sans-serif"><b style="letter-spacing:.12em;text-transform:uppercase;font-size:11px">${label}</b><br>${detail}</div>`;
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function block(id, label, fields, preview, shape = (d) => d) {
  CMS.registerEditorComponent({
    id, label, fields,
    pattern: fence(id),
    fromBlock: (match) => { try { return yaml.load(match[1]) ?? {}; } catch { return {}; } },
    toBlock: (data) => `::: ${id}\n${yaml.dump(clean(shape(data)), { lineWidth: -1 }).trim()}\n:::`,
    toPreview: (data) => card(label, preview(data ?? {})),
  });
}

block('chart', 'Graf', [
  { name: 'crisis', label: 'Krise', widget: 'select', options: crisisOptions, required: false, hint: 'Velg en krise, eller la stå tom og velg et land.' },
  { name: 'country', label: 'Land', widget: 'select', options: countryOptions, required: false },
  date('from', 'Fra'),
  date('to', 'Til'),
  { name: 'title', label: 'Tittel (valgfri)', widget: 'string', required: false },
  { name: 'note', label: 'Merknad (valgfri)', widget: 'string', required: false },
], (d) => `${esc(d.crisis ? crisisName(d.crisis) : countryName(d.country))}, væpnede hendelser per uke, ${fmtDate(d.from)} til ${fmtDate(d.to)}`,
(d) => (d.crisis ? { ...d, country: undefined } : d));

block('map', 'Lite kart', [
  { name: 'crisis', label: 'Krise', widget: 'select', options: crisisOptions, required: false },
  { name: 'country', label: 'Land', widget: 'select', options: countryOptions, required: false },
  date('from', 'Fra', { required: false }),
  date('to', 'Til', { required: false }),
  { name: 'caption', label: 'Bildetekst', widget: 'string', required: false },
], (d) => `${esc(d.crisis ? crisisName(d.crisis) : countryName(d.country))}${d.from ? `, hendelser ${fmtDate(d.from)} til ${fmtDate(d.to)}` : ''}`,
(d) => (d.crisis ? { ...d, country: undefined } : d));

block('figures', 'Nøkkeltall', [
  { name: 'items', label: 'Tall', label_singular: 'tall', widget: 'list', max: 4, summary: '{{fields.value}} {{fields.label}}', fields: [
    { name: 'value', label: 'Tall', widget: 'string' },
    { name: 'label', label: 'Hva tallet er', widget: 'string' },
    { name: 'source', label: 'Kilde', widget: 'string' },
  ] },
], (d) => (d.items ?? []).map((i) => `<b>${esc(i.value)}</b> ${esc(i.label)}`).join(' · '));

block('table', 'Tabell', [
  { name: 'caption', label: 'Tittel', widget: 'string', required: false },
  { name: 'data', label: 'Tabell', widget: 'text', hint: 'Lim inn fra Excel, Google Sheets, Word eller Docs. Én rad per linje; kolonnene skilles med tabulator, semikolon eller loddrett strek.' },
  { name: 'header', label: 'Første rad er overskrifter', widget: 'boolean', default: true },
  { name: 'source', label: 'Kilde', widget: 'string', required: false },
], (d) => `${esc(d.caption || 'Tabell')}, ${String(d.data ?? '').split('\n').filter(Boolean).length} rader`);

block('risk', 'Risikoscore', [
  { name: 'risk', label: 'Risiko', widget: 'select', options: riskOptions },
  score('likelihood', 'Sannsynlighet (1-5)'),
  score('consequence', 'Konsekvens (1-5)'),
  { name: 'previous', label: 'Score i forrige utgave', widget: 'number', value_type: 'int', min: 1, max: 25, required: false },
  { name: 'note', label: 'Kommentar', widget: 'string', required: false },
], (d) => `${esc(riskName(d.risk))}: ${(d.likelihood ?? 0) * (d.consequence ?? 0)} av 25`);

block('quote', 'Sitat', [
  { name: 'text', label: 'Sitat', widget: 'text', hint: 'Ordrett, uten anførselstegn.' },
  { name: 'who', label: 'Hvem', widget: 'string' },
  { name: 'role', label: 'Tittel eller rolle', widget: 'string', required: false },
  { name: 'source', label: 'Kilde', widget: 'string', required: false },
  { name: 'url', label: 'Lenke til kilden', widget: 'string', required: false },
], (d) => `«${esc(d.text)}» ${esc(d.who)}`);

block('sources', 'Kildeliste', [
  { name: 'title', label: 'Overskrift', widget: 'string', required: false, default: 'Kilder' },
  { name: 'items', label: 'Kilder', widget: 'list', summary: '{{fields.title}}', fields: sourceFields },
], (d) => `${(d.items ?? []).length} kilder`);

// A footnote is a definition, "[^id]: text"; the number in the text is written as [^id].
CMS.registerEditorComponent({
  id: 'footnote', label: 'Fotnote',
  fields: [
    { name: 'id', label: 'Merke', widget: 'string', hint: 'Skriv [^merke] i teksten der fotnotetallet skal stå, for eksempel [^1]. Tallene settes av seg selv.' },
    { name: 'text', label: 'Fotnote', widget: 'string' },
  ],
  pattern: /^\[\^([^\]\s]+)\]:[ \t]*(.+)/,
  fromBlock: (m) => ({ id: m[1], text: m[2] }),
  toBlock: (d) => `[^${d.id ?? '1'}]: ${d.text ?? ''}`,
  toPreview: (d) => card('Fotnote', `[${esc(d.id)}] ${esc(d.text)}`),
});

/* ---------- preview and start ------------------------------------------------------ */

CMS.registerPreviewStyle('../fonts/fonts.css');
CMS.registerPreviewStyle('../atlas.css');
CMS.registerPreviewStyle('../reports.css');

CMS.init({
  config: {
    load_config_file: false,
    locale: 'nb_no',
    // On a laptop, `npx decap-server` lets the editor write to the working copy instead.
    local_backend: local,
    backend: {
      name: 'github',
      repo: 'bridgeerlend/igred-warmap',
      branch: 'main',
      base_url: 'https://api.netlify.com',
      auth_endpoint: 'auth',
      site_id: 'igred.org',
      squash_merges: true,
      commit_messages: {
        create: 'Reports: new {{collection}} "{{slug}}"',
        update: 'Reports: update {{collection}} "{{slug}}"',
        delete: 'Reports: delete {{collection}} "{{slug}}"',
        uploadMedia: 'Reports: upload "{{path}}"',
        deleteMedia: 'Reports: delete "{{path}}"',
      },
    },
    publish_mode: 'editorial_workflow',
    site_url: 'https://igred.org',
    display_url: 'https://igred.org/reports/',
    logo_url: '/favicon.svg',
    media_folder: 'www/content/reports/media',
    public_folder: '/content/reports/media',
    collections: [halvar, analyse],
  },
});
