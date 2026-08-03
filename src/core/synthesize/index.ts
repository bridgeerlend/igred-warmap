import { loadConfig } from '../config.js';
import { classifyTexts, compileThemes, isInScope } from '../classify/themes.js';
import { clusterIntoStories } from '../cluster/stories.js';
import type { Story } from '../schema/article.js';
import { harvestRss, type FeedOutcome } from '../sources/rss/index.js';
import { PlaceTagger } from '../classify/places.js';
import { baselineArtifact } from '../schema/artifact.js';
import { readArtifact } from '../pipeline/store.js';
import { dataPaths } from '../util/paths.js';

/**
 * The news synthesiser, running on the same core as the map: the same HTTP client with its
 * retries, the same schema validation, the same source isolation, the same atomic writes.
 * It adds one source module (RSS) and two deterministic steps — clustering, then classifying
 * the cluster. No model is called anywhere in this path.
 */
export interface SynthesisResult {
  stories: Story[];
  articlesConsidered: number;
  storiesOutOfField: number;
  feeds: FeedOutcome[];
  comparisons: number;
}

export async function synthesise(now: string): Promise<SynthesisResult> {
  const config = loadConfig();
  const settings = config.stories;

  const harvest = await harvestRss(
    config.feeds,
    {
      maxItemsPerFeed: settings.harvest.maxItemsPerFeed,
      concurrency: settings.harvest.concurrency,
      maxAgeDaysByTier: {
        1: settings.harvest.maxAgeDaysByTier['1'],
        2: settings.harvest.maxAgeDaysByTier['2'],
        3: settings.harvest.maxAgeDaysByTier['3'],
      },
    },
    now,
  );

  const themes = compileThemes(config.themes);

  // Country names come from the same place the UCDP join uses — the names the feed itself
  // emits — so the two can never drift apart.
  const baseline = readArtifact(dataPaths.baseline, baselineArtifact).value;
  const observedNames = Object.fromEntries(
    Object.entries(baseline?.countries ?? {}).map(([fips, country]) => [fips, country.countryName]),
  );
  const tagger = new PlaceTagger(observedNames);

  const clustered = clusterIntoStories(
    harvest.articles,
    (articles) => {
      const result = classifyTexts(
        articles.map((article) => ({ title: article.title, body: article.summary })),
        themes,
        config.themes,
      );
      return {
        themes: result.themes,
        countries: tagger.tag(articles.map((article) => ({ title: article.title, summary: article.summary }))),
        inScope: isInScope(result, config.themes),
      };
    },
    settings.clustering,
    now,
  );

  const cutoff = new Date(Date.now() - settings.publish.windowDays * 86_400_000).toISOString();

  return {
    stories: clustered.stories
      .filter((entry) => entry.lastSeenAt >= cutoff)
      .slice(0, settings.publish.maxStories),
    articlesConsidered: harvest.articles.length,
    storiesOutOfField: clustered.droppedOutOfScope,
    feeds: harvest.feeds,
    comparisons: clustered.comparisons,
  };
}
