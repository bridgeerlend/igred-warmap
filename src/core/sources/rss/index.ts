import type { Article } from '../../schema/article.js';
import type { FeedDefinition } from '../../schema/config.js';
import { fetchText } from '../../util/http.js';
import { stableId } from '../../util/misc.js';
import { parseFeed } from './parse.js';

export interface FeedOutcome {
  feedId: string;
  ok: boolean;
  itemCount: number;
  message?: string;
  skipped: Record<string, number>;
}

export interface RssHarvest {
  articles: Article[];
  feeds: FeedOutcome[];
}

export interface RssOptions {
  maxItemsPerFeed: number;
  /**
   * Per tier, because publishing rhythm differs by role. Broadcasters churn hourly, while a
   * think tank may post twice a month — a single short window silently emptied tier 3.
   */
  maxAgeDaysByTier: Record<1 | 2 | 3, number>;
  concurrency: number;
}

async function harvestFeed(
  feed: FeedDefinition,
  options: RssOptions,
  now: string,
): Promise<{ articles: Article[]; outcome: FeedOutcome }> {
  try {
    const xml = await fetchText(feed.url, {
      timeoutMs: 20_000,
      retries: 2,
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8' },
    });
    const { items, skipped } = parseFeed(xml);
    const cutoff = Date.now() - options.maxAgeDaysByTier[feed.tier] * 86_400_000;

    const articles = items
      .filter((item) => Date.parse(item.publishedAt) >= cutoff)
      .slice(0, options.maxItemsPerFeed)
      .map((item) => ({
        // Keyed on the URL: the same article reached twice must not become two records.
        id: stableId('art', item.url),
        title: item.title,
        ...(item.summary ? { summary: item.summary } : {}),
        url: item.url,
        publishedAt: item.publishedAt,
        retrievedAt: now,
        feedId: feed.id,
        publisher: feed.name,
        tier: feed.tier,
        beat: feed.beat,
        language: feed.language,
      }));

    return { articles, outcome: { feedId: feed.id, ok: true, itemCount: articles.length, skipped } };
  } catch (error) {
    // One publisher going down must not cost us the other nineteen.
    return {
      articles: [],
      outcome: {
        feedId: feed.id,
        ok: false,
        itemCount: 0,
        message: (error as Error).message.slice(0, 200),
        skipped: {},
      },
    };
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await worker(items[index] as T);
      }
    }),
  );
  return results;
}

export async function harvestRss(
  feeds: FeedDefinition[],
  options: RssOptions,
  now: string,
): Promise<RssHarvest> {
  const results = await mapWithConcurrency(feeds, options.concurrency, (feed) =>
    harvestFeed(feed, options, now),
  );

  // The same URL can appear in two feeds from one publisher; keep the earliest sighting.
  const byId = new Map<string, Article>();
  for (const result of results) {
    for (const candidate of result.articles) {
      const existing = byId.get(candidate.id);
      if (!existing || candidate.publishedAt < existing.publishedAt) byId.set(candidate.id, candidate);
    }
  }

  const outcomes = results.map((result) => result.outcome);
  const working = outcomes.filter((outcome) => outcome.ok).length;
  if (working === 0) {
    throw new Error(`All ${feeds.length} feeds failed — treating as a source outage, not as an empty news day.`);
  }

  return {
    articles: [...byId.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    feeds: outcomes,
  };
}
