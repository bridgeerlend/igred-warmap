import { loadConfig } from '../config.js';
import type { MediaArtifact } from '../schema/media.js';
import { harvestBluesky } from '../sources/bluesky/index.js';
import { harvestTelegram } from '../sources/telegram/index.js';
import { harvestYoutube } from '../sources/youtube/index.js';

/**
 * Curated posts and videos, gathered from the whitelists in config/channels.json.
 *
 * Three platforms, three failure modes, all contained: an account that goes quiet, a
 * Telegram channel without a public preview, and a channel id that stops resolving are each
 * reported individually while the rest of the run continues.
 */
export interface MediaOptions {
  postsPerAccount: number;
  videosPerChannel: number;
  maxAgeDays: number;
}

export interface MediaResult {
  posts: MediaArtifact['posts'];
  videos: MediaArtifact['videos'];
  accountsOk: number;
  accountsTotal: number;
  failures: string[];
}

export async function harvestMedia(options: MediaOptions, now: string): Promise<MediaResult> {
  const { watches } = loadConfig().channels;

  const blueskyAccounts = watches.flatMap((watch) =>
    watch.bluesky.map((handle) => ({ handle, watchKey: watch.key })),
  );
  const telegramChannels = watches.flatMap((watch) =>
    watch.telegram.map((channel) => ({ channel, watchKey: watch.key })),
  );
  const youtubeChannels = watches.flatMap((watch) =>
    watch.youtube.map((channel) => ({ ...channel, watchKey: watch.key })),
  );

  const [bluesky, telegram, youtube] = await Promise.all([
    harvestBluesky(blueskyAccounts, { postsPerAccount: options.postsPerAccount, maxAgeDays: options.maxAgeDays }, now),
    harvestTelegram(telegramChannels, { postsPerChannel: options.postsPerAccount, maxAgeDays: options.maxAgeDays }, now),
    harvestYoutube(youtubeChannels, { videosPerChannel: options.videosPerChannel, maxAgeDays: options.maxAgeDays }, now),
  ]);

  const outcomes = [
    ...bluesky.outcomes.map((o) => ({ id: `bluesky:${o.handle}`, ok: o.ok, message: o.message })),
    ...telegram.outcomes.map((o) => ({ id: `telegram:${o.channel}`, ok: o.ok, message: o.message })),
    ...youtube.outcomes.map((o) => ({ id: `youtube:${o.channelId}`, ok: o.ok, message: o.message })),
  ];

  const total = outcomes.length;
  const ok = outcomes.filter((entry) => entry.ok).length;

  // Every curated account failing at once is an outage, not an empty news day.
  if (total > 0 && ok === 0) {
    throw new Error(`All ${total} curated accounts failed — treating as a source outage.`);
  }

  return {
    posts: [...bluesky.posts, ...telegram.posts].sort((a, b) => b.postedAt.localeCompare(a.postedAt)),
    videos: youtube.videos,
    accountsOk: ok,
    accountsTotal: total,
    failures: outcomes.filter((entry) => !entry.ok).map((entry) => `${entry.id}: ${entry.message ?? 'failed'}`),
  };
}
