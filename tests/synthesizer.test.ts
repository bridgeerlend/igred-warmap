import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { classifyTexts, compileThemes, isInScope } from '../src/core/classify/themes.js';
import { clusterIntoStories } from '../src/core/cluster/stories.js';
import { FeedFormatError, looksSubstantive, parseFeed, plainText } from '../src/core/sources/rss/parse.js';
import type { Article } from '../src/core/schema/article.js';

const config = loadConfig();
const themes = compileThemes(config.themes);

const classify = (articles: { title: string; summary?: string | undefined }[]) => {
  const result = classifyTexts(
    articles.map((article) => ({ title: article.title, body: article.summary })),
    themes,
    config.themes,
  );
  return { themes: result.themes, inScope: isInScope(result, config.themes) };
};

describe('feed parsing', () => {
  it('reads RSS 2.0', () => {
    const { items } = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>Sudan army drone attack on Darfur kills 35</title>
      <link>https://example.org/a</link>
      <description>&lt;p&gt;Rights group says&lt;/p&gt;</description>
      <pubDate>Mon, 03 Aug 2026 07:00:00 GMT</pubDate></item>
    </channel></rss>`);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://example.org/a');
    expect(items[0]?.summary).toBe('Rights group says');
    expect(items[0]?.publishedAt).toBe('2026-08-03T07:00:00.000Z');
  });

  it('reads Atom, taking the href off the alternate link', () => {
    const { items } = parseFeed(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><title>Central bank raises interest rate again</title>
      <link rel="edit" href="https://example.org/edit"/>
      <link rel="alternate" href="https://example.org/story"/>
      <published>2026-08-03T06:30:00Z</published></entry>
    </feed>`);
    expect(items[0]?.url).toBe('https://example.org/story');
  });

  it('reads RDF with a Dublin Core date', () => {
    const { items } = parseFeed(`<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <item><title>Sanctions imposed on shipping network</title>
      <link>https://example.org/c</link>
      <dc:date>2026-08-02T10:00:00Z</dc:date></item>
    </rdf:RDF>`);
    expect(items).toHaveLength(1);
  });

  it('fails loudly when a feed contains no items at all', () => {
    expect(() => parseFeed('<?xml version="1.0"?><rss><channel></channel></rss>')).toThrow(FeedFormatError);
  });

  it('counts what it dropped and why', () => {
    const { items, skipped } = parseFeed(`<?xml version="1.0"?><rss><channel>
      <item><title>A perfectly ordinary geopolitical headline here</title><link>https://example.org/ok</link><pubDate>Mon, 03 Aug 2026 07:00:00 GMT</pubDate></item>
      <item><title>No link at all in this one</title><pubDate>Mon, 03 Aug 2026 07:00:00 GMT</pubDate></item>
      <item><title>Missing its date entirely here</title><link>https://example.org/b</link></item>
    </channel></rss>`);
    expect(items).toHaveLength(1);
    expect(skipped).toEqual({ no_link: 1, no_date: 1 });
  });

  it('rejects datestamped stubs that are not headlines', () => {
    // Crisis Group publishes items titled like this; nine of them clustered into one
    // phantom story purely because they are all shaped alike.
    expect(looksSubstantive('Tehran 30 July 2026 #1')).toBe(false);
    expect(looksSubstantive('Washington 28 July 2026 #3')).toBe(false);
    expect(looksSubstantive('Sudan army drone attack on Darfur kills 35')).toBe(true);
  });

  it('strips markup out of publisher summaries', () => {
    expect(plainText('<p>Oil <b>slides</b> after&nbsp;talks</p>')).toBe('Oil slides after talks');
    expect(plainText('   ')).toBeUndefined();
  });
});

describe('theme classification', () => {
  it('does not match a term inside a longer word', () => {
    // "war" inside "warehouse" put a Chanel theft into armed conflict.
    const result = classifyTexts(
      [{ title: '4 ex-warehouse workers jailed over plot to steal items' }],
      themes,
      config.themes,
    );
    expect(result.themes.find((theme) => theme.id === 'armed_conflict')).toBeUndefined();
  });

  it('accepts a decisive headline term on its own', () => {
    const result = classifyTexts([{ title: 'Sudan army drone strike kills 35 at Darfur court' }], themes, config.themes);
    expect(result.hasStrongHeadlineTerm).toBe(true);
    expect(isInScope(result, config.themes)).toBe(true);
  });

  it('keeps ordinary news out of the field', () => {
    for (const title of [
      'Ariana Grande to take a break from public life',
      'Jasprit Bumrah ruled out of Sri Lanka Test series due to injury',
      '2 Killed as Firefighting Helicopters Collide in Greece',
    ]) {
      expect(isInScope(classifyTexts([{ title }], themes, config.themes), config.themes)).toBe(false);
    }
  });

  it('records which terms matched, so a classification can be checked', () => {
    const result = classifyTexts([{ title: 'EU imposes sanctions on shipping network' }], themes, config.themes);
    expect(result.themes[0]?.matchedTerms).toContain('sanctions');
  });

  it('covers both halves of the institute field', () => {
    const fields = new Set(config.themes.themes.map((theme) => theme.field));
    expect(fields).toEqual(new Set(['geopolitical_risk', 'economic_development']));
  });
});

function makeArticle(overrides: Partial<Article> & { title: string; url: string }): Article {
  return {
    id: overrides.url,
    summary: undefined,
    publishedAt: '2026-08-03T07:00:00.000Z',
    retrievedAt: '2026-08-03T08:00:00.000Z',
    feedId: 'test',
    publisher: 'Test Publisher',
    tier: 1,
    beat: 'world',
    language: 'en',
    ...overrides,
  } as Article;
}

describe('story clustering', () => {
  const options = { windowHours: 48, similarityThreshold: 0.26, rareTokenMaxShare: 0.5, maxArticlesPerStory: 30 };

  it('groups the same event reported by several outlets', () => {
    const articles = [
      makeArticle({ title: 'Trump says new talks with Iran set to begin Monday', url: 'https://a.example/1', publisher: 'A' }),
      makeArticle({ title: 'Trump suggests new Iran talks to begin on Monday', url: 'https://b.example/2', publisher: 'B' }),
      makeArticle({ title: 'New round of Iran talks will begin Monday, Trump says', url: 'https://c.example/3', publisher: 'C' }),
    ];
    const { stories } = clusterIntoStories(articles, classify, options, '2026-08-03T08:00:00.000Z');
    expect(stories).toHaveLength(1);
    expect(stories[0]?.articleCount).toBe(3);
    expect(stories[0]?.distinctPublishers).toBe(3);
  });

  it('keeps unrelated events apart', () => {
    const articles = [
      makeArticle({ title: 'Sudan army drone strike kills dozens in Darfur', url: 'https://a.example/1' }),
      makeArticle({ title: 'Federal Reserve holds interest rate steady amid inflation', url: 'https://b.example/2' }),
    ];
    const { stories } = clusterIntoStories(articles, classify, options, '2026-08-03T08:00:00.000Z');
    expect(stories).toHaveLength(2);
  });

  it('never joins articles further apart than the window', () => {
    // A decisive headline term keeps both in the field, so this measures the time window
    // rather than the scope filter.
    const articles = [
      makeArticle({ title: 'Sudan army drone strike kills dozens in Darfur', url: 'https://a.example/1' }),
      makeArticle({
        title: 'Sudan army drone strike kills dozens in Darfur',
        url: 'https://b.example/2',
        publishedAt: '2026-07-20T07:00:00.000Z',
      }),
    ];
    const { stories } = clusterIntoStories(articles, classify, options, '2026-08-03T08:00:00.000Z');
    expect(stories).toHaveLength(2);
  });

  it('takes the headline verbatim from a real article and attributes it', () => {
    const articles = [
      makeArticle({ title: 'EU imposes sanctions on shipping network over oil exports', url: 'https://a.example/1', publisher: 'A' }),
      makeArticle({ title: 'EU sanctions shipping network moving sanctioned oil', url: 'https://b.example/2', publisher: 'B' }),
    ];
    const { stories } = clusterIntoStories(articles, classify, options, '2026-08-03T08:00:00.000Z');
    const first = stories[0];
    expect(first).toBeDefined();
    const titles = first!.articles.map((entry) => entry.title);
    expect(titles).toContain(first!.headline);
    expect(first!.articles.map((entry) => entry.url)).toContain(first!.headlineFrom.url);
  });

  it('drops clusters outside the institute field', () => {
    const articles = [
      makeArticle({ title: 'Ariana Grande to take a break from public life', url: 'https://a.example/1' }),
    ];
    const result = clusterIntoStories(articles, classify, options, '2026-08-03T08:00:00.000Z');
    expect(result.stories).toHaveLength(0);
    expect(result.droppedOutOfScope).toBe(1);
  });

  it('gives every story at least one source with a link and a timestamp', () => {
    const articles = [
      makeArticle({ title: 'Sudan army drone strike kills dozens in Darfur', url: 'https://a.example/1' }),
    ];
    const { stories } = clusterIntoStories(articles, classify, options, '2026-08-03T08:00:00.000Z');
    for (const entry of stories) {
      expect(entry.provenance.length).toBeGreaterThan(0);
      for (const source of entry.provenance) {
        expect(source.url).toMatch(/^https?:/);
        expect(source.retrievedAt).toBeTruthy();
        expect(source.sourceName).toBeTruthy();
      }
    }
  });
});
