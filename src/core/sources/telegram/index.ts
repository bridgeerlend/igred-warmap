import type { SocialPost } from '../../schema/media.js';
import { fetchText } from '../../util/http.js';
import { plainText } from '../rss/parse.js';
import { stableId } from '../../util/misc.js';

/**
 * Public Telegram channels.
 *
 * Telegram has no open read API: the Bot API needs the bot to be a channel member, and the
 * client API needs a full user session. What is public is the channel preview page at
 * t.me/s/<channel>, which Telegram serves as plain HTML to anyone. That is what this reads.
 *
 * Two consequences, both real: only channels whose owner enabled the public preview can be
 * read at all, and the parsing depends on Telegram's markup, which they may change. Both
 * failure modes are contained — a channel that stops parsing reports itself and the rest of
 * the run continues.
 */
export interface TelegramOptions {
  postsPerChannel: number;
  maxAgeDays: number;
}

export interface ChannelOutcome {
  channel: string;
  ok: boolean;
  count: number;
  message?: string;
}

const MESSAGE_BLOCK = /<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"([\s\S]*?)(?=<div class="tgme_widget_message_wrap|$)/g;
const TEXT_IN_BLOCK = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/;
const TIME_IN_BLOCK = /<time[^>]+datetime="([^"]+)"/;
const OWNER_IN_BLOCK = /tgme_widget_message_owner_name[^>]*>(?:<span[^>]*>)?([^<]+)/;

export function parseChannelPage(
  html: string,
  channel: string,
): { text: string; url: string; postedAt: string; author: string }[] {
  const found: { text: string; url: string; postedAt: string; author: string }[] = [];

  for (const match of html.matchAll(MESSAGE_BLOCK)) {
    const postPath = match[1];
    const block = match[2] ?? '';
    if (!postPath) continue;

    const rawText = TEXT_IN_BLOCK.exec(block)?.[1];
    const datetime = TIME_IN_BLOCK.exec(block)?.[1];
    // Telegram renders line breaks as <br>; keep them as spaces rather than joining words.
    const text = plainText(rawText?.replace(/<br\s*\/?>/gi, ' '), 600);
    if (!text || !datetime) continue;

    const postedAt = new Date(datetime);
    if (Number.isNaN(postedAt.getTime())) continue;

    found.push({
      text,
      url: `https://t.me/${postPath}`,
      postedAt: postedAt.toISOString(),
      author: OWNER_IN_BLOCK.exec(block)?.[1]?.trim() || channel,
    });
  }

  return found;
}

export async function harvestTelegram(
  channels: { channel: string; watchKey: string }[],
  options: TelegramOptions,
  now: string,
): Promise<{ posts: SocialPost[]; outcomes: ChannelOutcome[] }> {
  const posts: SocialPost[] = [];
  const outcomes: ChannelOutcome[] = [];
  const cutoff = Date.now() - options.maxAgeDays * 86_400_000;

  for (const entry of channels) {
    try {
      const html = await fetchText(`https://t.me/s/${encodeURIComponent(entry.channel)}`, {
        timeoutMs: 20_000,
        retries: 2,
      });

      const parsed = parseChannelPage(html, entry.channel);
      if (parsed.length === 0) {
        // Almost always a channel without the public preview enabled, rather than a fault.
        outcomes.push({
          channel: entry.channel,
          ok: false,
          count: 0,
          message: 'no readable posts — the channel may not have its public preview enabled',
        });
        continue;
      }

      let count = 0;
      for (const item of parsed.slice(-options.postsPerChannel)) {
        if (Date.parse(item.postedAt) < cutoff) continue;
        posts.push({
          id: stableId('post', item.url),
          platform: 'telegram',
          watchKey: entry.watchKey,
          author: item.author,
          authorHandle: entry.channel,
          text: item.text,
          url: item.url,
          postedAt: item.postedAt,
          retrievedAt: now,
          provenance: [
            {
              sourceId: 'telegram',
              sourceName: item.author,
              sourceTier: 2,
              url: item.url,
              publisher: `t.me/${entry.channel}`,
              publishedAt: item.postedAt,
              retrievedAt: now,
            },
          ],
        });
        count += 1;
      }
      outcomes.push({ channel: entry.channel, ok: true, count });
    } catch (error) {
      outcomes.push({ channel: entry.channel, ok: false, count: 0, message: (error as Error).message.slice(0, 160) });
    }
  }

  return { posts: posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt)), outcomes };
}
