import type { VideoItem } from '../../schema/media.js';
import { fetchText } from '../../util/http.js';
import { parseFeed } from '../rss/parse.js';
import { stableId } from '../../util/misc.js';

/**
 * Curated YouTube channels via their public Atom feed.
 *
 * No API key and no quota: every channel exposes `feeds/videos.xml`. Only the title and a
 * link are kept — the video itself is embedded from YouTube at view time, never copied,
 * which is both lawful and free.
 */
export interface YoutubeOptions {
  videosPerChannel: number;
  maxAgeDays: number;
}

export interface ChannelOutcome {
  channelId: string;
  ok: boolean;
  count: number;
  message?: string;
}

/** The watch URL is the only place the feed exposes the id needed for an embed. */
function videoIdFrom(url: string): string | undefined {
  return /[?&]v=([\w-]{6,})/.exec(url)?.[1];
}

export async function harvestYoutube(
  channels: { channelId: string; name: string; watchKey: string }[],
  options: YoutubeOptions,
  now: string,
): Promise<{ videos: VideoItem[]; outcomes: ChannelOutcome[] }> {
  const videos: VideoItem[] = [];
  const outcomes: ChannelOutcome[] = [];
  const cutoff = Date.now() - options.maxAgeDays * 86_400_000;

  for (const channel of channels) {
    try {
      const xml = await fetchText(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel.channelId)}`,
        { timeoutMs: 20_000, retries: 2 },
      );

      const { items } = parseFeed(xml);
      let count = 0;

      for (const item of items.slice(0, options.videosPerChannel)) {
        if (Date.parse(item.publishedAt) < cutoff) continue;
        const videoId = videoIdFrom(item.url);
        if (!videoId) continue;

        videos.push({
          id: stableId('vid', videoId),
          watchKey: channel.watchKey,
          title: item.title,
          channel: channel.name,
          videoId,
          url: item.url,
          publishedAt: item.publishedAt,
          retrievedAt: now,
          provenance: [
            {
              sourceId: 'youtube',
              sourceName: channel.name,
              sourceTier: 2,
              url: item.url,
              publisher: channel.name,
              publishedAt: item.publishedAt,
              retrievedAt: now,
            },
          ],
        });
        count += 1;
      }
      outcomes.push({ channelId: channel.channelId, ok: true, count });
    } catch (error) {
      outcomes.push({
        channelId: channel.channelId,
        ok: false,
        count: 0,
        message: (error as Error).message.slice(0, 160),
      });
    }
  }

  return { videos: videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), outcomes };
}
