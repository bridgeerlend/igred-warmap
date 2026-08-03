import { describe, expect, it } from 'vitest';
import { guardDraft } from '../src/core/edition/draft.js';
import { buildSections } from '../src/core/edition/build.js';

/**
 * The guard is the mechanism that turns "a model never invents facts" from a principle into
 * something enforced. It runs on every draft before the text reaches the repository, so its
 * behaviour is pinned here rather than trusted.
 */
const SOURCES = [
  'Al Jazeera: Sudan army drone attack on Darfur kills 35, rights group says',
  'France 24: Sudan army drone strike kills 35 at Darfur court, rights group says',
].join('\n');

describe('guardDraft', () => {
  it('accepts a paragraph that only compresses the sources', () => {
    const draft =
      'Two outlets report that a Sudanese army drone attack on a court in Darfur killed 35 people, according to a rights group.';
    expect(guardDraft(draft, SOURCES, 90)).toEqual({ ok: true });
  });

  it('rejects a figure that is not in the sources', () => {
    // The single most likely way a model would introduce a fact.
    const draft = 'A Sudanese army drone attack on a court in Darfur killed 35 people and wounded 120 others.';
    const result = guardDraft(draft, SOURCES, 90);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('120');
  });

  it('reads thousands separators as the same number', () => {
    const sources = 'Reuters: Displacement reaches 1,200 families in the region';
    expect(guardDraft('Some 1,200 families have been displaced.', sources, 90).ok).toBe(true);
    expect(guardDraft('Some 1200 families have been displaced.', sources, 90).ok).toBe(true);
  });

  it('ignores a trailing full stop when comparing figures', () => {
    expect(guardDraft('The toll stands at 35.', SOURCES, 90).ok).toBe(true);
  });

  it('rejects invented links', () => {
    const result = guardDraft('Read more at https://example.org/report about the attack.', SOURCES, 90);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('contains a link');
  });

  it('rejects an over-long paragraph', () => {
    const draft = new Array(200).fill('word').join(' ');
    expect(guardDraft(draft, SOURCES, 90).ok).toBe(false);
  });

  it('rejects empty output', () => {
    expect(guardDraft('   ', SOURCES, 90)).toEqual({ ok: false, reason: 'empty' });
  });

  it('allows a paragraph with no figures at all', () => {
    expect(guardDraft('Several outlets report a drone attack on a court in Darfur.', SOURCES, 90).ok).toBe(true);
  });
});

describe('buildSections', () => {
  const story = (id: string, field: 'geopolitical_risk' | 'economic_development', themeId: string, label: string) =>
    ({
      id,
      headline: `Headline ${id}`,
      headlineFrom: { publisher: 'A', url: `https://a.example/${id}` },
      themes: [{ id: themeId, label, field, matchedTerms: ['x'], score: 5 }],
      countries: [],
      firstSeenAt: '2026-08-03T06:00:00.000Z',
      lastSeenAt: '2026-08-03T06:00:00.000Z',
      articleCount: 1,
      distinctPublishers: 1,
      tiers: [1] as (1 | 2 | 3)[],
      prominence: 1,
      articles: [
        { title: `Headline ${id}`, url: `https://a.example/${id}`, publisher: 'A', tier: 1 as const, publishedAt: '2026-08-03T06:00:00.000Z' },
      ],
      provenance: [
        { sourceId: 'rss:a', sourceName: 'A', sourceTier: 1 as const, url: `https://a.example/${id}`, retrievedAt: '2026-08-03T06:00:00.000Z' },
      ],
    });

  it('puts geopolitical risk before economics, and holds that order', () => {
    const sections = buildSections([
      story('1', 'economic_development', 'macro_finance', 'Macroeconomics'),
      story('2', 'geopolitical_risk', 'armed_conflict', 'Armed conflict'),
    ]);
    expect(sections.map((section) => section.field)).toEqual(['geopolitical_risk', 'economic_development']);
  });

  it('files a story once, under its strongest theme', () => {
    const sections = buildSections([
      story('1', 'geopolitical_risk', 'armed_conflict', 'Armed conflict'),
      story('2', 'geopolitical_risk', 'armed_conflict', 'Armed conflict'),
      story('3', 'geopolitical_risk', 'diplomacy', 'Diplomacy'),
    ]);
    const themes = sections[0]!.themes;
    expect(themes.map((theme) => theme.storyIds.length)).toEqual([2, 1]);
    expect(themes.flatMap((theme) => theme.storyIds)).toHaveLength(3);
  });

  it('omits a field with nothing in it rather than printing an empty heading', () => {
    const sections = buildSections([story('1', 'geopolitical_risk', 'armed_conflict', 'Armed conflict')]);
    expect(sections).toHaveLength(1);
  });
});

describe('reading the model reply', () => {
  /**
   * Reasoning models return their scratchpad and their answer as separate parts, the
   * scratchpad flagged `thought: true`. Joining every part produced pages of bullet-point
   * planning where a paragraph was expected, so the split is pinned here.
   */
  const answerFrom = (parts: { text?: string; thought?: boolean }[]) =>
    parts.filter((part) => part.thought !== true).map((part) => part.text ?? '').join('').trim();

  it('takes the answer and discards the reasoning', () => {
    expect(
      answerFrom([
        { text: '* Task: compress the coverage.\n* Constraint: 90 words.', thought: true },
        { text: 'A rights group says a drone attack killed 35 at a Darfur court.' },
      ]),
    ).toBe('A rights group says a drone attack killed 35 at a Darfur court.');
  });

  it('returns nothing when the model only ever produced reasoning', () => {
    expect(answerFrom([{ text: '* Task: compress the coverage.', thought: true }])).toBe('');
  });

  it('handles a reply with no reasoning part at all', () => {
    expect(answerFrom([{ text: 'A plain answer.' }])).toBe('A plain answer.');
  });
});
