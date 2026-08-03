import type { Article, Story, ThemeMatch } from '../schema/article.js';
import type { Provenance } from '../schema/common.js';
import { stableId } from '../util/misc.js';

/**
 * Groups articles reporting the same event into one story. Entirely deterministic: term
 * statistics over the batch, cosine similarity, and connected components. No model decides
 * what is the same story — the brief requires clustering in code, and it is also more
 * predictable and free.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'from', 'this', 'has', 'have', 'had', 'was', 'were',
  'are', 'been', 'will', 'would', 'could', 'should', 'says', 'said', 'say', 'after', 'over',
  'into', 'about', 'more', 'than', 'its', 'his', 'her', 'their', 'they', 'them', 'but', 'not',
  'who', 'what', 'when', 'where', 'why', 'how', 'all', 'new', 'first', 'last', 'one', 'two',
  'you', 'your', 'our', 'out', 'off', 'now', 'may', 'can', 'also', 'amid', 'against', 'under',
  'between', 'during', 'while', 'because', 'been', 'being', 'other', 'some', 'such', 'only',
  'just', 'get', 'gets', 'got', 'make', 'made', 'take', 'takes', 'back', 'still', 'even',
]);

/** Below this many articles, compare every pair; 500² is ~125k cosines, a few milliseconds. */
const FULL_COMPARISON_LIMIT = 500;

export interface StoryClusterOptions {
  /** Articles further apart than this in time are never joined, however similar. */
  windowHours: number;
  /** Cosine similarity above which two articles are treated as the same story. */
  similarityThreshold: number;
  /** Only tokens rarer than this share of the batch can seed a candidate pair. */
  rareTokenMaxShare: number;
  maxArticlesPerStory: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

interface Vectorised {
  article: Article;
  /** Unit-length tf-idf vector, as token → weight. */
  vector: Map<string, number>;
  time: number;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  // Both vectors are unit length, so the dot product is the cosine.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [token, weight] of small) {
    const other = large.get(token);
    if (other !== undefined) dot += weight * other;
  }
  return dot;
}

class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }
  find(index: number): number {
    while (this.parent[index] !== index) {
      this.parent[index] = this.parent[this.parent[index] as number] as number;
      index = this.parent[index] as number;
    }
    return index;
  }
  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

export interface StoryClusterResult {
  stories: Story[];
  comparisons: number;
  /** Clusters that formed but fell outside the institute's field. */
  droppedOutOfScope: number;
}

export function clusterIntoStories(
  articles: Article[],
  classify: (articles: Article[]) => { themes: ThemeMatch[]; countries: { fips: string; name: string }[]; inScope: boolean },
  options: StoryClusterOptions,
  now: string,
): StoryClusterResult {
  if (articles.length === 0) return { stories: [], comparisons: 0, droppedOutOfScope: 0 };

  // --- term statistics over this batch -------------------------------
  const documentFrequency = new Map<string, number>();
  const tokensPerArticle = articles.map((article) => {
    // The headline carries the most signal, so its tokens are counted twice.
    const tokens = [...tokenize(article.title), ...tokenize(article.title), ...tokenize(article.summary ?? '')];
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
    return tokens;
  });

  const total = articles.length;
  const vectorised: Vectorised[] = articles.map((article, index) => {
    const counts = new Map<string, number>();
    for (const token of tokensPerArticle[index] as string[]) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    const vector = new Map<string, number>();
    let norm = 0;
    for (const [token, count] of counts) {
      const df = documentFrequency.get(token) ?? 1;
      const weight = (1 + Math.log(count)) * Math.log(1 + total / df);
      vector.set(token, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [token, weight] of vector) vector.set(token, weight / norm);
    return { article, vector, time: Date.parse(article.publishedAt) };
  });

  const windowMs = options.windowHours * 3_600_000;
  const union = new UnionFind(vectorised.length);
  let comparisons = 0;

  const consider = (a: number, b: number) => {
    const left = vectorised[a] as Vectorised;
    const right = vectorised[b] as Vectorised;
    if (Math.abs(left.time - right.time) > windowMs) return;
    comparisons += 1;
    if (cosine(left.vector, right.vector) >= options.similarityThreshold) union.union(a, b);
  };

  if (total <= FULL_COMPARISON_LIMIT) {
    // Below this size the quadratic pass costs milliseconds, and it avoids a real failure
    // mode of the index below: in a small batch every token is common, so nothing qualifies
    // as rare, no candidate pairs are produced, and identical articles never meet.
    for (let a = 0; a < total; a++) {
      for (let b = a + 1; b < total; b++) consider(a, b);
    }
  } else {
    // Two articles about the same event almost always share an uncommon token — a place or
    // a name — so only those pairs are scored rather than all of them.
    const maxDf = Math.max(2, Math.floor(total * options.rareTokenMaxShare));
    const postings = new Map<string, number[]>();
    for (let index = 0; index < vectorised.length; index++) {
      for (const token of (vectorised[index] as Vectorised).vector.keys()) {
        if ((documentFrequency.get(token) ?? 0) > maxDf) continue;
        const list = postings.get(token);
        if (list) list.push(index);
        else postings.set(token, [index]);
      }
    }

    const seen = new Set<number>();
    for (const indices of postings.values()) {
      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          const a = indices[i] as number;
          const b = indices[j] as number;
          const key = a * total + b;
          if (seen.has(key)) continue;
          seen.add(key);
          consider(a, b);
        }
      }
    }
  }

  // --- assemble ------------------------------------------------------
  const groups = new Map<number, number[]>();
  for (let index = 0; index < vectorised.length; index++) {
    const root = union.find(index);
    const group = groups.get(root);
    if (group) group.push(index);
    else groups.set(root, [index]);
  }

  const stories: Story[] = [];
  let dropped = 0;
  for (const indices of groups.values()) {
    const members = indices
      .map((index) => vectorised[index] as Vectorised)
      .sort((a, b) => a.time - b.time)
      .slice(0, options.maxArticlesPerStory);

    const classified = classify(members.map((member) => member.article));
    // Out-of-field stories are dropped here rather than before clustering: a terse headline
    // is judged together with its siblings' text, which is where the subject actually shows.
    if (!classified.inScope) {
      dropped += 1;
      continue;
    }
    stories.push(buildStory(members, classified.themes, classified.countries, now));
  }

  stories.sort(
    (a, b) => b.prominence - a.prominence || b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
  return { stories, comparisons, droppedOutOfScope: dropped };
}

/**
 * The headline is never written by us. It is the title of the most representative article in
 * the group — the one closest to the group's centre — carried verbatim and attributed.
 */
function pickHeadlineArticle(members: Vectorised[]): Vectorised {
  if (members.length === 1) return members[0] as Vectorised;

  const centroid = new Map<string, number>();
  for (const member of members) {
    for (const [token, weight] of member.vector) {
      centroid.set(token, (centroid.get(token) ?? 0) + weight);
    }
  }
  let norm = 0;
  for (const weight of centroid.values()) norm += weight * weight;
  norm = Math.sqrt(norm) || 1;
  for (const [token, weight] of centroid) centroid.set(token, weight / norm);

  let best = members[0] as Vectorised;
  let bestScore = -1;
  for (const member of members) {
    const score = cosine(member.vector, centroid);
    // Ties break towards the earliest report, then the lower tier, for stability.
    if (
      score > bestScore + 1e-9 ||
      (Math.abs(score - bestScore) <= 1e-9 && member.time < best.time)
    ) {
      best = member;
      bestScore = Math.max(bestScore, score);
    }
  }
  return best;
}

function prominenceFrom(distinctPublishers: number, tierCount: number): number {
  const base =
    distinctPublishers >= 8 ? 5 : distinctPublishers >= 5 ? 4 : distinctPublishers >= 3 ? 3 : distinctPublishers >= 2 ? 2 : 1;
  // Carried across all three tiers means the wires, the papers and the institutions all
  // touched it — broader than the same count within one tier.
  return Math.min(5, tierCount >= 3 ? base + 1 : base);
}

function buildStory(
  members: Vectorised[],
  themes: ThemeMatch[],
  countries: { fips: string; name: string }[],
  now: string,
): Story {
  const headlineMember = pickHeadlineArticle(members);
  const publishers = new Set(members.map((member) => member.article.publisher));
  const tiers = [...new Set(members.map((member) => member.article.tier))].sort();

  const provenance: Provenance[] = members.map((member) => ({
    sourceId: `rss:${member.article.feedId}`,
    sourceName: member.article.publisher,
    sourceTier: member.article.tier,
    url: member.article.url,
    publisher: member.article.publisher,
    publishedAt: member.article.publishedAt,
    retrievedAt: member.article.retrievedAt,
  }));

  return {
    id: stableId('story', headlineMember.article.url),
    headline: headlineMember.article.title,
    headlineFrom: { publisher: headlineMember.article.publisher, url: headlineMember.article.url },
    themes,
    countries,
    firstSeenAt: members[0]?.article.publishedAt ?? now,
    lastSeenAt: members.at(-1)?.article.publishedAt ?? now,
    articleCount: members.length,
    distinctPublishers: publishers.size,
    tiers,
    prominence: prominenceFrom(publishers.size, tiers.length),
    articles: members.map((member) => ({
      title: member.article.title,
      url: member.article.url,
      publisher: member.article.publisher,
      tier: member.article.tier,
      publishedAt: member.article.publishedAt,
    })),
    provenance,
  };
}
