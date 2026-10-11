import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeness, parseCalendar, previousFrom, typesOf } from '../src/core/elections/calendar.js';
import { combine, indicator, risk, type Part } from '../src/core/elections/score.js';
import { checkSentence } from '../src/core/elections/why.js';
import { repoRoot } from '../src/core/util/paths.js';

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf-8');

describe('the electoral calendar', () => {
  const page = [
    '==October==',
    "* 4 October: [[Elections in Brazil|Brazil]], [[2026 Brazilian general election|President (1st round), Chamber of Deputies and Senate]]<ref>TSE</ref>",
    '* 9–10 October: [[Elections in the Czech Republic|Czech Republic]], [[2026 Czech Senate election|Senate (1st round)]]',
    '* 25 October:',
    '** [[Elections in Bulgaria|Bulgaria]], [[2026 Bulgarian presidential election|President]]',
    '** [[Elections in Brazil|Brazil]], [[2026 Brazilian general election|President (2nd round)]]',
    '==December==',
    '* 9 December: [[Elections in Fiji|Fiji]], [[2026 Fijian constitutional referendum|Constitutional referendum]]',
    '==Indirect elections==',
    '* 6 October: [[Elections in Kosovo|Kosovo]], [[2026 Kosovan presidential election|President]]',
  ].join('\n');

  it('reads dates, countries, offices and rounds, and stops at the indirect elections', () => {
    const e = parseCalendar(page, 2026);
    expect(e.map((x) => `${x.date} ${x.countryName} ${x.types.join('+')}${x.round ? ` r${x.round}` : ''}`)).toEqual([
      '2026-10-04 Brazil president+parliament r1',
      '2026-10-09 Czech Republic parliament r1',
      '2026-10-25 Bulgaria president',
      '2026-10-25 Brazil president r2',
      '2026-12-09 Fiji referendum',
    ]);
    expect(e[1]!.dateEnd).toBe('2026-10-10');
    expect(e[0]!.article).toBe('2026 Brazilian general election');
  });

  it('takes the office from the calendar label before the article title', () => {
    expect(typesOf('President (2nd round)', '2026 Brazilian general election')).toEqual(['president']);
    expect(typesOf('Riigikogu', '2027 Estonian parliamentary election')).toEqual(['parliament']);
  });

  it('finds the previous election and its turnout and margin, written either way', () => {
    expect(previousFrom('\n| previous_election = 2022 Kenyan general election\n')).toBe('2022 Kenyan general election');
    expect(previousFrom('\n| previous_election = [[2021 Bulgarian general election|2021]]\n')).toBe('2021 Bulgarian general election');
    expect(closeness('\n| turnout = 79.05%<ref>x</ref>\n| percentage1 = 50.90%\n| percentage2 = 49.10%\n')).toEqual({ turnout: 79.05, margin: 1.8 });
    expect(closeness('\n| turnout = \n| percentage1 = \n')).toEqual({ turnout: null, margin: null });
  });
});

describe('the election risk score', () => {
  const part = (key: string, r: number): Part => ({ key, source: 's', url: 'u', year: '2025', raw: 1, unit: 'x', risk: r });
  const weights = { quality: 20, unrest: 15, press: 15, now: 25, close: 10, economy: 15 };
  const levels = { elevated: 35, high: 60 };

  it('is the weighted mean of the indicators that have data, saying how much weight it rests on', () => {
    const inds = [indicator('quality', [part('vdem', 60), part('pei', 40)]), indicator('unrest', []), indicator('press', [part('rsf', 50)]),
      indicator('now', [part('events', 80)]), indicator('close', [part('margin', 30)]), indicator('economy', [part('gdp', 70)])];
    const s = combine(inds, weights, levels);
    // (50*20 + 50*15 + 80*25 + 30*10 + 70*15) / 85
    expect(s.score).toBe(Math.round((1000 + 750 + 2000 + 300 + 1050) / 85));
    expect(s.coverage).toBe(85);
    expect(s.missing).toEqual(['unrest']);
    expect(s.level).toBe('high');
  });

  it('gives no score on less than half the weight', () => {
    const s = combine([indicator('now', [part('events', 90)]), indicator('close', [part('margin', 90)])], weights, levels);
    expect(s.score).toBeNull();
    expect(s.coverage).toBe(35);
  });

  it('turns each source figure into a risk the documented way', () => {
    const scales = JSON.parse(read('config/elections.json')).scales;
    expect(risk.vdem(0.25)).toBe(75);
    expect(risk.inverse100(62)).toBe(38);
    expect(risk.margin(0, scales)).toBe(100);
    expect(risk.margin(20, scales)).toBe(0);
    expect(risk.turnout(40, scales)).toBe(100);
    expect(risk.trend(10, 10)).toBe(50);
    expect(risk.trend(21, 10)).toBe(100);
    expect(risk.debt(60, scales)).toBe(50);
  });
});

describe('the sentence about each election', () => {
  const material = 'Calendar: 2026-10-25: Bulgaria, President.\nWikipedia, "2026 Bulgarian presidential election": Presidential elections will be held in Bulgaria on 25 October 2026 to elect the successor of Rumen Radev, who is term-limited.';
  it('passes a single sourced sentence and refuses judgement, invented names and a second sentence', () => {
    expect(checkSentence('Bulgaria elects a successor to Rumen Radev, who is term-limited, on 25 October 2026.', material, 32).ok).toBe(true);
    expect(checkSentence('Bulgaria holds a pivotal vote to replace Rumen Radev.', material, 32).reason).toMatch(/judgement/);
    expect(checkSentence('Bulgaria elects a successor to Rumen Radev, backed by Boyko Borisov.', material, 32).reason).toMatch(/Boyko Borisov/);
    expect(checkSentence('Bulgaria votes on 25 October 2026. Rumen Radev is term-limited.', material, 32).reason).toMatch(/2 sentences/);
  });
});

describe('the election page and its data', () => {
  const data = JSON.parse(read('data/elections.json'));

  it('every figure behind a score names its source, link and year', () => {
    expect(data.elections.length).toBeGreaterThan(10);
    for (const e of data.elections) {
      expect(e.wiki.url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
      for (const ind of e.indicators) for (const p of ind.parts) {
        expect(p.source).toBeTruthy();
        expect(p.url).toMatch(/^https:\/\//);
        expect(p.year).toMatch(/\d{4}/);
        expect(Number.isFinite(p.raw)).toBe(true);
      }
      if (e.score !== null) expect(e.coverage).toBeGreaterThanOrEqual(50);
    }
  });

  it('records each yearly dataset with its licence, and says which could not be downloaded and why', () => {
    const manifest = JSON.parse(read('data/elections/sources/manifest.json')).sources;
    for (const id of ['vdem', 'pei', 'rsf', 'fh', 'geonames']) {
      expect(manifest[id].status).toBe('ok');
      expect(manifest[id].license).toBeTruthy();
      expect(manifest[id].edition).toBeTruthy();
    }
    for (const id of ['nelda', 'ecav', 'idea']) {
      expect(manifest[id].status).toBe('skipped');
      expect(manifest[id].reason.length).toBeGreaterThan(20);
    }
  });

  it('the calendar is read weekly in its own workflow; the score daily; data only', () => {
    const wf = read('.github/workflows/elections.yml');
    expect(wf).toMatch(/run: npm run elections/);
    expect(wf).toMatch(/git add data\n/);
    expect(JSON.parse(read('config/elections.json')).calendarRefreshDays).toBe(7);
  });

  it('the map has an elections layer under Trade and energy, and the crisis panel lists upcoming elections', () => {
    const app = read('site/app.js');
    expect(app.indexOf('t.tradeLayer')).toBeLessThan(app.indexOf('t.electionsLayer'));
    expect(read('site/mapcore.js')).toMatch(/id: 'elec', type: 'circle', source: 'elections', layout: \{ visibility: 'none' \}/);
    expect(read('site/view.js')).toMatch(/section\(t\.upcomingElections/);
    expect(read('site/valg/index.html')).toMatch(/<script type="module" src="valg\.js"><\/script>/);
  });
});
