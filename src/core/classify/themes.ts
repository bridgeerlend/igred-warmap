import type { ThemeMatch } from '../schema/article.js';
import type { ThemesConfig } from '../schema/config.js';

/**
 * Deterministic, literal classification against a configured lexicon. No model takes part:
 * a term either appears in the text or it does not, and the terms that matched travel with
 * the result so any classification can be checked rather than trusted.
 *
 * This is also the filter that keeps the synthesiser to the institute's field. The feeds
 * carry celebrity, sport and local crime; anything that clears no theme is dropped.
 *
 * Scoring runs over a whole clustered story rather than a single article. Headlines are
 * terse — "Trump pauses attack on Iran" carries almost no matchable text on its own — and
 * judging an article alone dropped most of the real material. Its siblings supply the words.
 */
export interface CompiledTheme {
  id: string;
  label: string;
  field: 'geopolitical_risk' | 'economic_development';
  terms: { term: string; pattern: RegExp; strong: boolean }[];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Word-boundary matching, so "war" does not fire inside "warehouse" — a real false positive
 * from the live feeds ("ex-warehouse workers jailed over plot to steal Chanel items").
 */
function compileTerm(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'iu');
}

export function compileThemes(config: ThemesConfig): CompiledTheme[] {
  return config.themes.map((theme) => {
    const strong = new Set(theme.strongTerms);
    const all = [...new Set([...theme.terms, ...theme.strongTerms])];
    return {
      id: theme.id,
      label: theme.label,
      field: theme.field,
      terms: all.map((term) => ({ term, pattern: compileTerm(term), strong: strong.has(term) })),
    };
  });
}

/** One piece of text to score, with its headline separated so it can be weighted higher. */
export interface ScorableText {
  title: string;
  body?: string | undefined;
}

export interface ClassifyResult {
  themes: ThemeMatch[];
  topScore: number;
  /** A decisive term in a headline: "drone strike" or "south china sea" settles the subject. */
  hasStrongHeadlineTerm: boolean;
}

export function classifyTexts(
  texts: ScorableText[],
  themes: CompiledTheme[],
  config: ThemesConfig,
): ClassifyResult {
  const matches: ThemeMatch[] = [];
  let hasStrongHeadlineTerm = false;

  for (const theme of themes) {
    const matchedTerms = new Set<string>();
    let score = 0;

    for (const { term, pattern, strong } of theme.terms) {
      let hit = false;
      for (const text of texts) {
        const inTitle = pattern.test(text.title);
        const inBody = text.body ? pattern.test(text.body) : false;
        if (!inTitle && !inBody) continue;
        hit = true;
        score += inTitle ? config.titleWeight : 1;
        if (inTitle && strong) hasStrongHeadlineTerm = true;
      }
      if (hit) matchedTerms.add(term);
    }

    if (matchedTerms.size > 0) {
      matches.push({
        id: theme.id,
        label: theme.label,
        field: theme.field,
        matchedTerms: [...matchedTerms].sort(),
        score,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { themes: matches, topScore: matches[0]?.score ?? 0, hasStrongHeadlineTerm };
}

/**
 * Whether a story belongs to the institute's field. A decisive headline term is enough on
 * its own; otherwise the accumulated score has to clear the configured minimum.
 */
export function isInScope(result: ClassifyResult, config: ThemesConfig): boolean {
  return result.hasStrongHeadlineTerm || result.topScore >= config.minimumScore;
}
