/**
 * igred.org — the institute page.
 *
 * Static, no data fetching, nothing to maintain. English and Norwegian, light and dark,
 * sharing the stored theme and language with the map and the Brief so moving between the
 * three does not reset your choice.
 *
 * Every claim here is the institute's own. Where something does not exist yet — the opening
 * film, the reports, the knowledge base — the page says so rather than inventing a date.
 */

const STRINGS = {
  en: {
    wordmarkFull: 'Institute for Geopolitical Risk and Economic Development',
    heroLine1: 'Geopolitical risk',
    heroLine2: 'and economic development',
    heroStandfirst:
      'An independent analysis body monitoring geopolitical risk and economic development worldwide — with sourced, verifiable analysis.',
    filmCaption: 'Opening film to follow',

    whatHeading: 'What IGRED is',
    whatBody1:
      'IGRED monitors where political risk and economic conditions meet, and what that means for the countries and sectors exposed to both.',
    whatBody2:
      'Everything we publish carries its sources. Each figure names where it came from, when it was collected, and links to the original, so a reader can check the work rather than take it on trust.',

    productsHeading: 'What we publish',
    kindLive: 'Live · updated hourly',
    kindDaily: 'Daily · one dated edition',
    kindTwiceYearly: 'Twice a year',
    kindOngoing: 'Ongoing',

    mapName: 'Global Conflict Monitor',
    mapBody:
      'An open map of armed conflict worldwide. Every incident carries the outlet that reported it, the date and a link to the original, with a satellite heat layer beneath — labelled as thermal detections, never as attacks.',
    briefName: 'The IGRED Brief',
    briefBody:
      'A daily synthesis of geopolitical risk and economic development, grouped by field and theme. Each edition is dated and fixed once published, so it can be cited and will read the same next year.',
    reportsName: 'Half-yearly reports',
    reportsBody:
      'Longer assessments of geopolitical risk, published twice a year using the same framework each time so findings can be compared across editions.',
    baseName: 'Knowledge base',
    baseBody:
      'Books, articles and research worth reading, each with the institute’s own assessment of what it argues and where it holds.',

    peopleHeading: 'Who is behind it',
    role: 'Co-Founder & Analyst',

    footerNote: 'Independent. Sourced. Open.',
  },

  nb: {
    wordmarkFull: 'Institutt for Geopolitisk Risiko og Økonomisk Utvikling',
    heroLine1: 'Geopolitisk risiko',
    heroLine2: 'og økonomisk utvikling',
    heroStandfirst:
      'Et uavhengig analysemiljø som overvåker geopolitisk risiko og økonomisk utvikling globalt — med kildebelagt, etterprøvbar analyse.',
    filmCaption: 'Åpningsfilm kommer',

    whatHeading: 'Hva IGRED er',
    whatBody1:
      'IGRED overvåker der politisk risiko og økonomiske forhold møtes, og hva det betyr for landene og sektorene som er utsatt for begge.',
    whatBody2:
      'Alt vi publiserer bærer kildene sine. Hvert tall oppgir hvor det kommer fra, når det ble hentet, og lenker til originalen, slik at en leser kan etterprøve arbeidet i stedet for å måtte stole på det.',

    productsHeading: 'Hva vi publiserer',
    kindLive: 'Sanntid · oppdateres hver time',
    kindDaily: 'Daglig · én datert utgave',
    kindTwiceYearly: 'To ganger i året',
    kindOngoing: 'Løpende',

    mapName: 'Global Conflict Monitor',
    mapBody:
      'Et åpent kart over væpnet konflikt i verden. Hver hendelse bærer redaksjonen som meldte den, datoen og en lenke til originalen, med et satellittmålt varmelag under — merket som varmedeteksjoner, aldri som angrep.',
    briefName: 'The IGRED Brief',
    briefBody:
      'En daglig syntese av geopolitisk risiko og økonomisk utvikling, gruppert etter felt og tema. Hver utgave er datert og står fast når den er publisert, slik at den kan siteres og leses likt om et år.',
    reportsName: 'Halvårsrapporter',
    reportsBody:
      'Grundigere vurderinger av geopolitisk risiko, publisert to ganger i året med samme rammeverk hver gang, slik at funn kan sammenlignes mellom utgaver.',
    baseName: 'Kunnskapsbase',
    baseBody:
      'Bøker, artikler og forskning verdt å lese, hver med instituttets egen vurdering av hva den hevder og hvor den holder.',

    peopleHeading: 'Hvem som står bak',
    role: 'Co-Founder & Analyst',

    footerNote: 'Uavhengig. Kildebelagt. Åpent.',
  },
};

const state = { lang: 'en' };
const $ = (id) => document.getElementById(id);
const t = () => STRINGS[state.lang];

function render() {
  const strings = t();

  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = strings[node.dataset.i18n];
    if (typeof value === 'string') node.textContent = value;
  }

  document.documentElement.lang = state.lang;
  $('lang').textContent = state.lang === 'en' ? 'NO' : 'EN';
  $('lang').setAttribute('aria-label', state.lang === 'en' ? 'Bytt til norsk' : 'Switch to English');
  document.title = `IGRED — ${strings.wordmarkFull}`;
}

function wire() {
  const root = document.documentElement;

  // Shared with the map and the Brief, so moving between the three keeps your choice.
  const storedTheme = localStorage.getItem('igred-theme');
  root.dataset.theme = storedTheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const syncTheme = () => { $('theme').textContent = root.dataset.theme === 'dark' ? 'Light' : 'Dark'; };
  syncTheme();
  $('theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('igred-theme', root.dataset.theme);
    syncTheme();
  });

  const storedLang = localStorage.getItem('igred-lang');
  if (storedLang === 'nb' || storedLang === 'en') state.lang = storedLang;
  $('lang').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'nb' : 'en';
    localStorage.setItem('igred-lang', state.lang);
    render();
  });
}

wire();
render();
