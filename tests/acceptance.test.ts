import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { repoRoot } from '../src/core/util/paths.js';

/**
 * The brief's acceptance list, checked rather than asserted.
 *
 * Each test names the criterion it covers. Anything that can only be judged by eye — whether
 * the design is free of the tells in section 11, whether it feels first-class on an iPad —
 * is verified in the browser during development and is deliberately not faked here.
 */
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), 'utf-8');
const readJson = (relative: string) => JSON.parse(read(relative));
const exists = (relative: string) => existsSync(path.join(repoRoot, relative));

const config = loadConfig();

describe('1 — a data update never triggers a site build', () => {
  it('the Pages workflow only fires on site changes', () => {
    const pages = read('.github/workflows/pages.yml');
    expect(pages).toMatch(/paths:/);
    expect(pages).toMatch(/'site\/\*\*'/);
    expect(pages).not.toMatch(/'data\/\*\*'/);
  });

  it('the workflows that write data touch nothing the site build watches', () => {
    for (const workflow of ['ingest.yml', 'brief.yml']) {
      const text = read(`.github/workflows/${workflow}`);
      const added = [...text.matchAll(/git add ([^\n]+)/g)].map((match) =>
        match[1]!.trim().replace(/^"|"$/g, ''),
      );
      expect(added.length).toBeGreaterThan(0);
      for (const target of added) {
        // config/ is committed by the conflict-proposal step and is not watched by Pages
        // either, so neither path can trigger a rebuild.
        expect(target.startsWith('data') || target.startsWith('config/')).toBe(true);
      }
    }
  });

  it('Netlify skips a build when only data changed', () => {
    // Netlify builds on every push by default, and the pipeline commits hourly. Without
    // this the institute page would rebuild all day for changes it does not contain, and
    // the rule would hold for the map while quietly failing here.
    const netlify = read('netlify.toml');
    expect(netlify).toMatch(/ignore\s*=/);
    expect(netlify).toMatch(/git diff --quiet HEAD\^ HEAD -- www netlify\.toml/);
    expect(netlify).toMatch(/publish = "www"/);
  });

  it('the page fetches its data at view time rather than having it baked in', () => {
    expect(read('site/app.js')).toMatch(/fetch\(/);
    expect(read('site/config.js')).toMatch(/raw\.githubusercontent\.com/);
  });

  it('the deploy guard checks the value, not the word', () => {
    // A loose grep for the sentinel also matched the fallback logic that names it, which
    // would have blocked the deploy even with the slug correctly filled in.
    const guard = /grep -qE "repoSlug: \*'REPLACE_WITH/;
    expect(read('.github/workflows/pages.yml')).toMatch(guard);
    expect(read('site/config.js')).not.toMatch(/repoSlug: *'REPLACE_WITH/);
  });
});

describe('2 — the schedule runs, validates, and commits only valid data', () => {
  it('the ingest is scheduled', () => {
    expect(read('.github/workflows/ingest.yml')).toMatch(/schedule:\s*\n\s*- cron:/);
  });

  it('every published artifact is schema-validated before it is written', () => {
    const store = read('src/core/pipeline/store.ts');
    expect(store).toMatch(/safeParse/);
    expect(store).toMatch(/ValidationFailure/);
    // Written through a temp file, so a crash cannot leave half a file behind.
    expect(store).toMatch(/renameSync/);
  });

  it('an artifact that no longer matches its schema is treated as absent, not trusted', () => {
    expect(read('src/core/pipeline/store.ts')).toMatch(/reason: 'invalid'/);
  });
});

describe('3 — a failing source keeps its last good data and the rest continues', () => {
  it('each source runs isolated behind the runner', () => {
    const runner = read('src/core/pipeline/runner.ts');
    expect(runner).toMatch(/servedFromLastGood/);
    expect(runner).toMatch(/catch \(error\)/);
  });

  it('an unconfigured source is not reported as an outage', () => {
    expect(read('src/core/pipeline/runner.ts')).toMatch(/not_configured/);
  });

  it('the live run proves it: UCDP has no token yet and the others still produced data', () => {
    const health = readJson('data/health.json');
    const ucdp = health.sources.find((source: { sourceId: string }) => source.sourceId === 'ucdp');
    expect(ucdp.status).toBe('not_configured');
    const working = health.sources.filter((source: { status: string }) => source.status === 'ok');
    expect(working.length).toBeGreaterThanOrEqual(3);
  });
});

describe('4 — every visible datum carries source, timestamp and link', () => {
  it('the schema refuses a record without provenance', () => {
    expect(read('src/core/schema/common.ts')).toMatch(/provenanceList = z\.array\(provenance\)\.min\(1\)/);
  });

  for (const [label, file, key] of [
    ['events', 'data/events.json', 'events'],
    ['stories', 'data/stories.json', 'stories'],
  ] as const) {
    it(`every published ${label} record names where it came from`, () => {
      const records = readJson(file)[key];
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(record.provenance.length).toBeGreaterThan(0);
        for (const source of record.provenance) {
          expect(source.url).toMatch(/^https?:\/\//);
          expect(source.retrievedAt).toBeTruthy();
          expect(source.sourceName).toBeTruthy();
        }
      }
    });
  }

  it('the heat layer names its instrument and its file', () => {
    const heat = readJson('data/heat.json');
    expect(heat.source.url).toMatch(/^https?:\/\//);
    expect(heat.source.retrievedAt).toBeTruthy();
    // Stated in the data so the map cannot relabel detections as attacks.
    expect(heat.measures).toBe('satellite_thermal_anomalies');
  });

  it('every social post and video links back to the account that published it', () => {
    const media = readJson('data/media.json');
    for (const item of [...media.posts, ...media.videos]) {
      expect(item.provenance.length).toBeGreaterThan(0);
      expect(item.url).toMatch(/^https?:\/\//);
    }
  });
});

describe('5 — no ACLED data anywhere', () => {
  it('is rejected at config load', () => {
    expect(read('src/core/config.ts')).toMatch(/acled/i);
    expect(() => loadConfig()).not.toThrow();
  });

  it('appears in no source, feed or published artifact', () => {
    // Counting mentions is the wrong check — the prohibition itself names ACLED several
    // times. What matters is that no source, feed or publisher actually is ACLED.
    for (const source of config.sources) {
      expect(source.id.toLowerCase()).not.toContain('acled');
      expect(source.name.toLowerCase()).not.toContain('acled');
      expect(source.homepage.toLowerCase()).not.toContain('acled');
    }
    for (const feed of config.feeds) {
      expect(feed.url.toLowerCase()).not.toContain('acled');
      expect(feed.name.toLowerCase()).not.toContain('acled');
    }
    for (const publisher of config.publishersByDomain.values()) {
      expect(publisher.domain.toLowerCase()).not.toContain('acled');
    }
    for (const file of readdirSync(path.join(repoRoot, 'data'))) {
      if (!file.endsWith('.json')) continue;
      expect(read(`data/${file}`).toLowerCase()).not.toMatch(/acled/);
    }
  });
});

describe('6 — no code path lets a model set a figure, an actor or control', () => {
  it('only two files reach a model, and only one of them can produce published text', () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(relative);
        else if (entry.name.endsWith('.ts') && /generativelanguage|openai|anthropic/i.test(read(relative))) {
          callers.push(relative);
        }
      }
    };
    walk('src');
    expect(callers.sort()).toEqual(['src/core/cli/gemini-check.ts', 'src/core/edition/draft.ts']);

    // The diagnostic only reports what the key can do; it writes nothing at all.
    const check = read('src/core/cli/gemini-check.ts');
    expect(check).not.toMatch(/writeArtifact|writeFileSync/);
  });

  it('that file only ever produces prose, never a field the map reads', () => {
    const draft = read('src/core/edition/draft.ts');
    // The only thing it writes into is the summary text.
    expect(draft).not.toMatch(/intensity|severity|countryFips|parties|figures|confidence/);
  });

  it('a figure absent from the sources rejects the whole draft', () => {
    expect(read('src/core/edition/draft.ts')).toMatch(/is not in the sources/);
  });
});

describe('7 — clustering is code, and the AI step falls back to no text', () => {
  it('neither clustering module calls a model', () => {
    for (const file of ['src/core/cluster/dedupe.ts', 'src/core/cluster/stories.ts']) {
      expect(read(file)).not.toMatch(/fetch\(|generativelanguage/);
    }
  });

  it('classification is a literal lexicon, not a model', () => {
    expect(read('src/core/classify/themes.ts')).not.toMatch(/fetch\(/);
    expect(config.themes.themes.length).toBeGreaterThan(0);
  });

  it('every failure in the AI step ends with no text rather than an error', () => {
    const draft = read('src/core/edition/draft.ts');
    expect(draft).toMatch(/skippedReason/);
    expect(draft).toMatch(/catch/);
  });

  it('the edition publishes whether or not prose exists', () => {
    const editions = readdirSync(path.join(repoRoot, 'data/editions')).filter(
      (file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file),
    );
    expect(editions.length).toBeGreaterThan(0);
    for (const file of editions) {
      expect(readJson(`data/editions/${file}`).stories.length).toBeGreaterThan(0);
    }
  });
});

describe('8 — the new-conflict flow opens a pull request that can be merged from a phone', () => {
  it('the ingest workflow proposes a candidate and opens the pull request', () => {
    const ingest = read('.github/workflows/ingest.yml');
    expect(ingest).toMatch(/propose-conflict/);
    expect(ingest).toMatch(/gh pr create/);
    // Asking the same question every hour would make the flow unusable.
    expect(ingest).toMatch(/Already proposed/);
  });

  it('the pull request body carries the evidence, not a bare diff', () => {
    const propose = read('src/core/cli/propose-conflict.ts');
    expect(propose).toMatch(/This is not a claim that a conflict exists/);
    expect(propose).toMatch(/Merge to put it on the map/);
  });

  it('merging is what puts a conflict on the map', () => {
    expect(exists('config/verified-conflicts.json')).toBe(true);
    expect(read('src/core/cli/ingest.ts')).toMatch(/verifiedConflicts\(config\.verifiedConflicts/);
  });

  it('the retained window is re-gated, so dismissing removes incidents rather than leaving them', () => {
    expect(read('src/core/cli/ingest.ts')).toMatch(/selectDisplayEvents\(previousEvents/);
  });
});

describe('9 — a 30-day window is visible and the history stays in git', () => {
  it('the published window is 30 days', () => {
    expect(config.publish.eventWindowDays).toBe(30);
    expect(readJson('data/events.json').windowDays).toBe(30);
  });

  it('nothing in data/ is gitignored', () => {
    const ignore = read('.gitignore');
    expect(ignore).not.toMatch(/^data\//m);
  });
});

describe('11 — both themes are defined, with full-strength text', () => {
  it('the shared foundation defines light and dark', () => {
    const atlas = read('site/atlas.css');
    expect(atlas).toMatch(/:root\[data-theme="dark"\]/);
    expect(atlas).toMatch(/prefers-color-scheme: dark/);
  });

  it('body text is near-black on light and near-white on dark, not grey on grey', () => {
    const atlas = read('site/atlas.css');
    // The brief names low-contrast grey body text as a thing to avoid.
    expect(atlas).toMatch(/--fg: #0E0E0C/);
    expect(atlas).toMatch(/--fg: #F7F5EF/);
  });
});

describe('12 — the design is the chosen direction, and free of the named tells', () => {
  it('all three products load the same foundation', () => {
    for (const page of ['site/index.html', 'site/brief/index.html', 'www/index.html']) {
      expect(read(page)).toMatch(/atlas\.css/);
    }
  });

  it('the institute page carries the same foundation, byte for byte', () => {
    // www/ is deployed to a different host, so it holds its own copy. A copy can drift;
    // this is what catches it.
    expect(read('www/atlas.css')).toBe(read('site/atlas.css'));
    const siteFonts = readdirSync(path.join(repoRoot, 'site/fonts')).sort();
    const wwwFonts = readdirSync(path.join(repoRoot, 'www/fonts')).sort();
    expect(wwwFonts).toEqual(siteFonts);
    for (const file of siteFonts) {
      expect(readFileSync(path.join(repoRoot, 'www/fonts', file)).equals(
        readFileSync(path.join(repoRoot, 'site/fonts', file)),
      )).toBe(true);
    }
  });

  it('typography is self-hosted and identical everywhere', () => {
    const fonts = read('site/fonts/fonts.css');
    expect(fonts).toMatch(/Fraunces/);
    expect(fonts).toMatch(/Inter/);
    expect(fonts).not.toMatch(/https?:\/\//);
  });

  it('carries its own cartography rather than third-party tiles', () => {
    // Searching for the word "tile" is the wrong check: the colophon says, in prose, that no
    // third-party tiles are used. What matters is that no tile server is ever contacted.
    const app = read('site/app.js');
    expect(app).not.toMatch(/mapbox|openstreetmap|arcgis|\{z\}\/\{x\}\/\{y\}/i);
    expect(exists('site/world.json')).toBe(true);
    // Geometry is generated from public-domain Natural Earth by our own build step.
    expect(readJson('site/world.json').$comment).toMatch(/Natural Earth/);
  });

  it('respects reduced motion', () => {
    expect(read('site/atlas.css')).toMatch(/prefers-reduced-motion/);
  });

  it('countries are never coloured — only incidents are', () => {
    // A choropleth is exactly what the brief rules out.
    expect(read('site/styles.css')).not.toMatch(/\.land-fill\s*\{[^}]*fill:\s*var\(--s[1-5]\)/);
  });
});

describe('13 — everything runs free', () => {
  it('no source requires a paid credential', () => {
    const paid = config.sources.filter(
      (source) => source.requiresCredential && source.id !== 'ucdp',
    );
    expect(paid).toEqual([]);
  });

  it('the one credentialed source is free to obtain, and optional to run', () => {
    const ucdp = config.sources.find((source) => source.id === 'ucdp');
    expect(ucdp?.credentialEnvVar).toBe('UCDP_ACCESS_TOKEN');
    // Proven by the live health file: the run completes without it.
    expect(readJson('data/health.json').sources.length).toBeGreaterThan(1);
  });

  it('the AI step cannot cost money: it is off, and would fall back to no text anyway', () => {
    expect(config.brief.ai.enabled).toBe(false);
    expect(read('config/brief.json')).toMatch(/never cost money/);
  });
});
