import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import type { Story } from '../schema/article.js';
import { edition, editionIndex, type Edition, type EditionIndex } from '../schema/edition.js';
import { storiesArtifact } from '../schema/artifact.js';
import { readArtifact, writeArtifact } from '../pipeline/store.js';
import { dataPaths, editionsDir } from '../util/paths.js';

const FIELD_LABEL = {
  geopolitical_risk: 'Geopolitical risk',
  economic_development: 'Economic development',
} as const;

export class EditionAlreadyPublished extends Error {
  constructor(date: string) {
    super(
      `The edition for ${date} is already published. Editions are cited by date and must not change after the fact; delete the file deliberately if it truly needs rebuilding.`,
    );
    this.name = 'EditionAlreadyPublished';
  }
}

export const editionPath = (date: string) => path.join(editionsDir, `${date}.json`);
export const summariesPath = (date: string) => path.join(editionsDir, `${date}.summaries.json`);
export const indexPath = () => path.join(editionsDir, 'index.json');

/**
 * Groups the day's stories by field, then by their strongest theme. A story appears once,
 * under the theme that scored highest for it, so the edition reads as a structured briefing
 * rather than a flat list.
 */
export function buildSections(stories: Story[]): Edition['sections'] {
  const byField = new Map<string, Map<string, { label: string; storyIds: string[] }>>();

  for (const story of stories) {
    const top = story.themes[0];
    if (!top) continue;
    const themes = byField.get(top.field) ?? new Map();
    const entry = themes.get(top.id) ?? { label: top.label, storyIds: [] };
    entry.storyIds.push(story.id);
    themes.set(top.id, entry);
    byField.set(top.field, themes);
  }

  const sections: Edition['sections'] = [];
  // Geopolitical risk leads, then economics — the institute's own order, held stable so
  // successive editions read the same way.
  for (const field of ['geopolitical_risk', 'economic_development'] as const) {
    const themes = byField.get(field);
    if (!themes || themes.size === 0) continue;
    sections.push({
      field,
      fieldLabel: FIELD_LABEL[field],
      themes: [...themes.entries()]
        .map(([id, entry]) => ({ id, label: entry.label, storyIds: entry.storyIds }))
        .sort((a, b) => b.storyIds.length - a.storyIds.length || a.label.localeCompare(b.label)),
    });
  }
  return sections;
}

export interface BuildEditionOptions {
  date: string;
  now: string;
  /** How many stories the AI step will be offered. Only corroborated ones qualify. */
  leadCount: number;
  force?: boolean;
}

export interface BuildEditionResult {
  edition: Edition;
  path: string;
}

export function buildEdition(options: BuildEditionOptions): BuildEditionResult {
  const config = loadConfig();
  const target = editionPath(options.date);

  if (existsSync(target) && !options.force) throw new EditionAlreadyPublished(options.date);

  const source = readArtifact(dataPaths.stories, storiesArtifact).value;
  if (!source) {
    throw new Error('data/stories.json is missing or invalid — run the ingest before building an edition.');
  }

  // An edition covers the day it is published for, not everything still in the window.
  const from = new Date(`${options.date}T00:00:00.000Z`).getTime() - 24 * 3_600_000;
  const stories = source.stories
    .filter((story) => Date.parse(story.lastSeenAt) >= from)
    .sort((a, b) => b.prominence - a.prominence || b.lastSeenAt.localeCompare(a.lastSeenAt));

  if (stories.length === 0) {
    throw new Error(`No stories in the window for ${options.date} — refusing to publish an empty edition.`);
  }

  // Only stories carried by more than one outlet are offered for drafting: a paragraph
  // summarising a single article would add nothing the article does not already say.
  const leadStoryIds = stories
    .filter((story) => story.distinctPublishers >= 2)
    .slice(0, options.leadCount)
    .map((story) => story.id);

  const value: Edition = {
    artifactVersion: 1,
    date: options.date,
    generatedAt: options.now,
    coversHours: 24,
    articlesConsidered: source.articlesConsidered,
    feedsOk: source.feedsOk,
    feedsTotal: source.feedsTotal,
    leadStoryIds,
    sections: buildSections(stories),
    stories,
  };

  writeArtifact(target, edition, value);
  updateIndex(value, options.now);
  void config;
  return { edition: value, path: target };
}

function updateIndex(value: Edition, now: string): void {
  const existing = readArtifact(indexPath(), editionIndex).value;
  const entries = (existing?.editions ?? []).filter((entry) => entry.date !== value.date);

  entries.push({
    date: value.date,
    generatedAt: value.generatedAt,
    storyCount: value.stories.length,
    leadHeadline: value.stories[0]?.headline ?? '—',
  });

  const next: EditionIndex = {
    artifactVersion: 1,
    updatedAt: now,
    editions: entries.sort((a, b) => b.date.localeCompare(a.date)),
  };
  writeArtifact(indexPath(), editionIndex, next);
}
