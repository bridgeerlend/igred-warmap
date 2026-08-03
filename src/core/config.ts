import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { configDir } from './util/paths.js';
import {
  clusteringConfig,
  feedsConfig,
  themesConfig,
  storiesConfig,
  briefConfig,
  channelsConfig,
  countryAliasesConfig,
  publishConfig,
  detectionConfig,
  publishersConfig,
  sourcesConfig,
  taxonomyConfig,
  type ClusteringConfig,
  type FeedDefinition,
  type ThemesConfig,
  type StoriesConfig,
  type BriefConfig,
  type ChannelsConfig,
  type PublishConfig,
  type DetectionConfig,
  type PublisherEntry,
  type SourceDefinition,
  type TaxonomyConfig,
} from './schema/config.js';

function load<T extends z.ZodTypeAny>(file: string, schema: T): z.infer<T> {
  const raw = readFileSync(path.join(configDir, file), 'utf-8');
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`config/${file} is invalid:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
  return parsed.data;
}

export interface AppConfig {
  sources: SourceDefinition[];
  publishersByDomain: Map<string, PublisherEntry>;
  detection: DetectionConfig;
  taxonomy: TaxonomyConfig;
  clustering: ClusteringConfig;
  publish: PublishConfig;
  countryAliases: Record<string, string>;
  feeds: FeedDefinition[];
  themes: ThemesConfig;
  stories: StoriesConfig;
  brief: BriefConfig;
  channels: ChannelsConfig;
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const sources = load('sources.json', sourcesConfig).sources;
  const publishers = load('publishers.json', publishersConfig).publishers;
  const detection = load('detection.json', detectionConfig);
  const taxonomy = load('taxonomy.json', taxonomyConfig);
  const clustering = load('clustering.json', clusteringConfig);
  const publish = load('publish.json', publishConfig);
  const countryAliases = load('country-aliases.json', countryAliasesConfig).aliases;
  const feeds = load('feeds.json', feedsConfig).feeds;
  const themes = load('themes.json', themesConfig);
  const stories = load('stories.json', storiesConfig);
  const brief = load('brief.json', briefConfig);
  const channels = load('channels.json', channelsConfig);

  if (sources.some((source) => source.id.toLowerCase().includes('acled'))) {
    throw new Error('ACLED is forbidden by licence and must never appear in the source registry.');
  }

  cached = {
    sources,
    publishersByDomain: new Map(publishers.map((entry) => [entry.domain, entry])),
    detection,
    taxonomy,
    clustering,
    publish,
    countryAliases,
    feeds,
    themes,
    stories,
    brief,
    channels,
  };
  return cached;
}

export function getSource(id: string): SourceDefinition {
  const source = loadConfig().sources.find((entry) => entry.id === id);
  if (!source) throw new Error(`Unknown source "${id}" — add it to config/sources.json`);
  return source;
}

/** Matches a URL host against the whitelist, allowing subdomains of a listed domain. */
export function lookupPublisher(host: string | undefined): PublisherEntry | undefined {
  if (!host) return undefined;
  const { publishersByDomain } = loadConfig();
  const direct = publishersByDomain.get(host);
  if (direct) return direct;
  for (const [domain, entry] of publishersByDomain) {
    if (host.endsWith(`.${domain}`)) return entry;
  }
  return undefined;
}
