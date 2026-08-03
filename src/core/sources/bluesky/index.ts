import type { SocialPost } from '../../schema/media.js';
import { fetchJson } from '../../util/http.js';
import { stableId } from '../../util/misc.js';

/**
 * Bluesky posts from curated accounts.
 *
 * The public AppView serves author feeds without authentication, so this costs nothing and
 * needs no key. Search is deliberately not used: `searchPosts` requires auth, and the brief
 * asks for a curated whitelist per conflict rather than open search anyway.
 */
const API = 'https://public.api.bsky.app/xrpc';

interface FeedResponse {
  feed?: {
    post?: {
      uri?: string;
      author?: { handle?: string; displayName?: string };
      record?: { text?: string; createdAt?: string };
      repost?: unknown;
    };
    reason?: { $type?: string };
  }[];
}

export interface BlueskyOptions {
  postsPerAccount: number;
  maxAgeDays: number;
}

export interface AccountOutcome {
  handle: string;
  ok: boolean;
  count: number;
  message?: string;
}

/** at://did/app.bsky.feed.post/rkey → the public web URL for that post. */
function webUrl(handle: string, uri: string): string | undefined {
  const rkey = uri.split('/').pop();
  return rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : undefined;
}

export async function harvestBluesky(
  accounts: { handle: string; watchKey: string }[],
  options: BlueskyOptions,
  now: string,
): Promise<{ posts: SocialPost[]; outcomes: AccountOutcome[] }> {
  const posts: SocialPost[] = [];
  const outcomes: AccountOutcome[] = [];
  const cutoff = Date.now() - options.maxAgeDays * 86_400_000;

  for (const account of accounts) {
    try {
      const response = await fetchJson<FeedResponse>(
        `${API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(account.handle)}&limit=${options.postsPerAccount}&filter=posts_no_replies`,
        { timeoutMs: 20_000, retries: 2 },
      );

      let count = 0;
      for (const entry of response.feed ?? []) {
        // Reposts are someone else's words under this account's name; only originals count.
        if (entry.reason) continue;
        const post = entry.post;
        const text = post?.record?.text?.trim();
        const createdAt = post?.record?.createdAt;
        const uri = post?.uri;
        if (!text || !createdAt || !uri) continue;

        const postedAt = new Date(createdAt);
        if (Number.isNaN(postedAt.getTime()) || postedAt.getTime() < cutoff) continue;

        const handle = post.author?.handle ?? account.handle;
        const url = webUrl(handle, uri);
        if (!url) continue;

        posts.push({
          id: stableId('post', uri),
          platform: 'bluesky',
          watchKey: account.watchKey,
          author: post.author?.displayName?.trim() || handle,
          authorHandle: handle,
          text,
          url,
          postedAt: postedAt.toISOString(),
          retrievedAt: now,
          provenance: [
            {
              sourceId: 'bluesky',
              sourceName: post.author?.displayName?.trim() || handle,
              sourceTier: 2,
              url,
              publisher: handle,
              publishedAt: postedAt.toISOString(),
              retrievedAt: now,
            },
          ],
        });
        count += 1;
      }
      outcomes.push({ handle: account.handle, ok: true, count });
    } catch (error) {
      // One account going quiet must not cost the others.
      outcomes.push({ handle: account.handle, ok: false, count: 0, message: (error as Error).message.slice(0, 160) });
    }
  }

  return { posts: posts.sort((a, b) => b.postedAt.localeCompare(a.postedAt)), outcomes };
}
