import { z } from 'zod';
import { isoDateTime, provenanceList } from './common.js';

/**
 * Posts and videos from curated accounts.
 *
 * Nothing here is republished content: a post carries its text because the account wrote it
 * publicly, and a video carries only its title and a link. Images and video files are never
 * copied — the brief forbids reusing news imagery, so this layer links and embeds rather
 * than hosting.
 */
export const socialPost = z.strictObject({
  id: z.string().min(1),
  platform: z.enum(['bluesky', 'telegram']),
  /** Which curated watch list this account belongs to. */
  watchKey: z.string().min(1),
  author: z.string().min(1),
  authorHandle: z.string().min(1),
  text: z.string().min(1),
  url: z.url(),
  postedAt: isoDateTime,
  retrievedAt: isoDateTime,
  provenance: provenanceList,
});
export type SocialPost = z.infer<typeof socialPost>;

export const videoItem = z.strictObject({
  id: z.string().min(1),
  watchKey: z.string().min(1),
  title: z.string().min(1),
  channel: z.string().min(1),
  /** Kept separate so the page can build a privacy-friendly embed URL itself. */
  videoId: z.string().min(1),
  url: z.url(),
  publishedAt: isoDateTime,
  retrievedAt: isoDateTime,
  provenance: provenanceList,
});
export type VideoItem = z.infer<typeof videoItem>;

export const mediaArtifact = z.strictObject({
  artifactVersion: z.literal(1),
  generatedAt: isoDateTime,
  windowDays: z.number().int().positive(),
  accountsOk: z.number().int().min(0),
  accountsTotal: z.number().int().min(0),
  posts: z.array(socialPost),
  videos: z.array(videoItem),
});
export type MediaArtifact = z.infer<typeof mediaArtifact>;
