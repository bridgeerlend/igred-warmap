import type { Article } from '../schema/article.js';

/**
 * Tags a story with the countries it is about, so the map can show a news stream beside a
 * conflict and the Brief can be read by region.
 *
 * Deliberately conservative. A wrong country tag is worse than a missing one: it would put
 * a story on the wrong part of the map, and the whole project rests on not asserting things
 * the sources do not support. So matching is exact, word-boundary, case-sensitive on the
 * first letter, and names that are ordinary English words or common personal names are
 * skipped entirely rather than guessed at.
 */
const AMBIGUOUS = new Set([
  'Georgia', // the US state dominates English-language coverage
  'Jordan',
  'Chad',
  'Turkey',
  'Guinea',
  'Niger', // and it is one letter from Nigeria
  'Oman',
  'Mali',
  'Togo',
  'Chile',
  'China Sea',
]);

/** Names that appear in coverage but not in the feed's own place strings. */
const EXTRA_NAMES: Record<string, string[]> = {
  US: ['United States', 'America', 'Washington'],
  UK: ['United Kingdom', 'Britain'],
  RS: ['Russia', 'Moscow', 'Kremlin'],
  UP: ['Ukraine', 'Kyiv'],
  IS: ['Israel'],
  WE: ['Gaza', 'West Bank', 'Palestinian'],
  IR: ['Iran', 'Tehran'],
  CH: ['China', 'Beijing'],
  JA: ['Japan', 'Tokyo'],
  GM: ['Germany', 'Berlin'],
  FR: ['France', 'Paris'],
  SU: ['Sudan', 'Darfur', 'Khartoum'],
  SY: ['Syria'],
  LE: ['Lebanon'],
  YM: ['Yemen'],
  AF: ['Afghanistan'],
  PK: ['Pakistan'],
  IN: ['India'],
  MX: ['Mexico'],
  VE: ['Venezuela'],
  CU: ['Cuba', 'Havana'],
  SP: ['Spain'],
  MO: ['Morocco'],
  BM: ['Myanmar', 'Burma'],
  NI: ['Nigeria'],
  ET: ['Ethiopia'],
  SO: ['Somalia'],
  CG: ['Congo'],
  KS: ['South Korea'],
  KN: ['North Korea'],
  TW: ['Taiwan'],
  EG: ['Egypt'],
  IZ: ['Iraq'],
  SA: ['Saudi Arabia'],
};

export interface PlaceMatch {
  fips: string;
  name: string;
}

export class PlaceTagger {
  private readonly patterns: { fips: string; name: string; pattern: RegExp }[] = [];

  /**
   * @param observedNames country names as the feed itself spells them, keyed by FIPS —
   *   the same source the UCDP join uses, so the two cannot drift apart.
   */
  constructor(observedNames: Record<string, string>) {
    const seen = new Set<string>();
    const add = (fips: string, name: string) => {
      if (name.length < 4 || AMBIGUOUS.has(name)) return;
      const key = `${fips}|${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      this.patterns.push({
        fips,
        name,
        pattern: new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u'),
      });
    };

    for (const [fips, name] of Object.entries(observedNames)) add(fips, name);
    for (const [fips, names] of Object.entries(EXTRA_NAMES)) for (const name of names) add(fips, name);
  }

  tag(articles: Pick<Article, 'title' | 'summary'>[], limit = 4): PlaceMatch[] {
    const hits = new Map<string, { name: string; score: number }>();

    for (const article of articles) {
      for (const { fips, name, pattern } of this.patterns) {
        // Headline mentions weigh double, the same convention the theme lexicon uses.
        const inTitle = pattern.test(article.title);
        const inBody = article.summary ? pattern.test(article.summary) : false;
        if (!inTitle && !inBody) continue;
        const existing = hits.get(fips);
        const score = (inTitle ? 2 : 0) + (inBody ? 1 : 0);
        if (existing) existing.score += score;
        else hits.set(fips, { name, score });
      }
    }

    return [...hits.entries()]
      .sort((a, b) => b[1].score - a[1].score || a[1].name.localeCompare(b[1].name))
      .slice(0, limit)
      .map(([fips, entry]) => ({ fips, name: entry.name }));
  }
}
