import { z } from 'zod';
import { isoDate, isoDateTime } from './common.js';
import { story } from './article.js';

/**
 * One morning's Brief. Once written, an edition never changes: it carries a date, it is
 * meant to be cited, and a citation that silently rewrites itself is worthless. The
 * generator refuses to overwrite an existing edition rather than quietly updating it.
 *
 * AI paragraphs are deliberately NOT part of this file. The edition is all sourced material
 * and publishes directly; prose is drafted separately and only appears once approved.
 */
export const editionSection = z.strictObject({
  field: z.enum(['geopolitical_risk', 'economic_development']),
  fieldLabel: z.string().min(1),
  themes: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        storyIds: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

export const edition = z.strictObject({
  artifactVersion: z.literal(1),
  /** The edition's identity. Also its URL and the thing you cite. */
  date: isoDate,
  generatedAt: isoDateTime,
  /** The window the edition covers, ending at generatedAt. */
  coversHours: z.number().int().positive(),
  articlesConsidered: z.number().int().min(0),
  feedsOk: z.number().int().min(0),
  feedsTotal: z.number().int().min(0),
  /** Story ids the AI step was asked to draft for, in order of prominence. */
  leadStoryIds: z.array(z.string().min(1)),
  sections: z.array(editionSection),
  stories: z.array(story).min(1),
});
export type Edition = z.infer<typeof edition>;

export const editionIndex = z.strictObject({
  artifactVersion: z.literal(1),
  updatedAt: isoDateTime,
  editions: z
    .array(
      z.strictObject({
        date: isoDate,
        generatedAt: isoDateTime,
        storyCount: z.number().int().min(0),
        leadHeadline: z.string().min(1),
      }),
    )
    .default([]),
});
export type EditionIndex = z.infer<typeof editionIndex>;

/**
 * Drafted prose for an edition, kept in its own file so the approval pull request contains
 * only the words a human needs to read — not a diff of the whole edition.
 */
export const editionSummaries = z.strictObject({
  artifactVersion: z.literal(1),
  date: isoDate,
  generatedAt: isoDateTime,
  model: z.string().min(1),
  summaries: z
    .array(
      z.strictObject({
        storyId: z.string().min(1),
        /** Repeated here purely so the pull request is readable on a phone. */
        headline: z.string().min(1),
        text: z.string().min(1),
        /** Exactly the material the model was given. Nothing else was available to it. */
        sourcesGiven: z.array(z.url()).min(1),
      }),
    )
    .default([]),
});
export type EditionSummaries = z.infer<typeof editionSummaries>;
