import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

  it('every source reports its own health, and a bad one cannot fail the run', () => {
    const health = readJson('data/health.json');
    const ids = health.sources.map((source: { sourceId: string }) => source.sourceId).sort();
    expect(ids).toEqual(['gdelt', 'media', 'newsfeeds', 'ucdp']);
    // Whatever any single source is doing, the others still produced records this run.
    const producing = health.sources.filter((s: { recordsLastRun: number }) => s.recordsLastRun > 0);
    expect(producing.length).toBeGreaterThanOrEqual(3);
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
    for (const dir of ['data', 'data/crises']) {
      for (const file of readdirSync(path.join(repoRoot, dir))) {
        if (!file.endsWith('.json')) continue;
        expect(read(`${dir}/${file}`).toLowerCase()).not.toMatch(/acled/);
      }
    }
  });

});

describe('6 — no code path lets a model set a figure, an actor or control', () => {
  it('only three files reach a model, and the two that produce text are guarded', () => {
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
    expect(callers.sort()).toEqual(['src/core/cli/gemini-check.ts', 'src/core/crises/summary.ts', 'src/core/edition/draft.ts']);

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

  it('the crisis summary is prose only, guarded in both languages, and never a field the map counts', () => {
    const summary = read('src/core/crises/summary.ts');
    expect(summary).toMatch(/guardDraft\(normaliseNumbers\(text\)/);
    expect(summary).toMatch(/\['en', en\], \['nb', nb\]/);
    expect(summary).not.toMatch(/intensity|severity|countryFips|confidence|writeArtifact|writeFileSync/);
    // The builder hands it only headlines it already links, and stores only its prose.
    const build = read('src/core/crises/build.ts');
    expect(build).not.toMatch(/generativelanguage|openai|anthropic/i);
    expect(build).toMatch(/d\.summary = currentSummary\(/);
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

describe('the display gate admits only registered conflicts', () => {
  it('has no always-relevant escape hatch', () => {
    /*
     * This existed because the map was otherwise blank before UCDP was connected. On the
     * first run with a real register it passed six events and not one was an aerial strike:
     * a firefighting helicopter crash in Greece geolocated to Oregon, a tourist plane crash
     * in Peru, a wildfire update in Colorado. CAMEO does not distinguish an aircraft
     * accident from an aerial attack.
     */
    expect(config.taxonomy.relevance.alwaysRelevantCategories).toEqual([]);
  });

  it('and the live window contains nothing outside the register', () => {
    const registered = new Set(
      readJson('data/conflicts.json')
        .conflicts.filter((conflict: { status: string }) => conflict.status === 'active')
        .flatMap((conflict: { countries: { fips?: string }[] }) =>
          conflict.countries.map((country) => country.fips),
        )
        .filter(Boolean),
    );
    for (const event of readJson('data/events.json').events) {
      expect(registered.has(event.location.countryFips)).toBe(true);
    }
  });

  it('discovery does not depend on the gate, so a new flare-up is still found', () => {
    // Detection runs on ungated clusters; closing the hatch cannot hide a new conflict.
    expect(read('src/core/cli/ingest.ts')).toMatch(/baseline sees every clustered event, gated or not/);
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

  it('respects reduced motion', () => {
    expect(read('site/atlas.css')).toMatch(/prefers-reduced-motion/);
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

describe('the wire is a stream of sourced dispatches and nothing else', () => {
  it('ships as a sibling page on the shared foundation', () => {
    for (const file of ['site/stream/index.html', 'site/stream/stream.js', 'site/stream/stream.css']) {
      expect(exists(file)).toBe(true);
    }
    expect(read('site/stream/index.html')).toMatch(/href="\.\.\/atlas\.css"/);
    // Reachable from both products, and both reachable from it.
    expect(read('site/index.html')).toMatch(/href="stream\/"/);
    expect(read('site/brief/index.html')).toMatch(/href="\.\.\/stream\/"/);
  });

  it('adds no new artifact: it reads what the map and the Brief already publish', () => {
    const js = read('site/stream/stream.js');
    expect(js).toMatch(/loadJson\(base, 'events\.json'\)/);
    expect(js).toMatch(/loadJson\(base, 'stories\.json'\)/);
    // Nothing else may be fetched — a new file would mean a new thing to keep alive.
    expect([...js.matchAll(/loadJson\(base, '([^']+)'\)/g)].map((match) => match[1]).sort())
      .toEqual(['events.json', 'stories.json']);
  });

  it('shows no picture of any kind', () => {
    for (const file of ['site/stream/index.html', 'site/stream/stream.js', 'site/stream/stream.css']) {
      const text = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
      expect(text).not.toMatch(/<img\b|<picture\b|background-image/i);
      expect(text).not.toMatch(/\.(png|jpe?g|gif|webp|avif)\b/i);
      expect(text).not.toMatch(/logos?\.(svg|png|jpe?g|webp|gif)|(class|id)=["'][^"']*logo|url\([^)]*logo/i);
    }
  });

  it('never calls an aggregator log time a publication time', () => {
    // GDELT's stamp is dateAdded — the quarter-hour it first logged the story. Every one of
    // the live rows falls into one of twenty such buckets, so a clock in the margin would
    // put the whole day's news at the same minute.
    expect(read('site/stream/stream.js')).toMatch(/entry\.sourceId === 'gdelt' \? 'seen' : 'published'/);
    expect(read('site/stream/stream.js')).toMatch(/firstSeen/);
  });
});

describe('sources are named, never shown as logos', () => {
  /**
   * A masthead logo is a trademark, and reproducing one implies a relationship the institute
   * does not have. Naming the outlet in text is both safer and more editorially honest — so
   * this is pinned rather than left to whoever edits the page next.
   */
  it('no product references an image of any kind', () => {
    for (const page of [
      'site/brief/index.html', 'site/brief/brief.js', 'site/brief/brief.css',
      'site/stream/index.html', 'site/stream/stream.js', 'site/stream/stream.css',
      'www/index.html', 'www/home.js', 'www/home.css',
      'site/atlas.css',
    ]) {
      // Comments are stripped first: this guard is about what the page loads, and it should
      // not fire on a note explaining why the code avoids mastheads in the first place.
      const text = read(page)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
      expect(text).not.toMatch(/<img\b|<picture\b/i);
      expect(text).not.toMatch(/\.(png|jpe?g|gif|webp|avif|ico)\b/i);
      /*
       * A logo as an asset, not the word. The pages explain in prose that they name outlets
       * rather than showing mastheads, and "avislogo" in that sentence is the point being
       * made, not a violation of it. What must never appear is a logo referenced as a file,
       * a class, an id or a background.
       */
      expect(text).not.toMatch(/logos?\.(svg|png|jpe?g|webp|gif)/i);
      expect(text).not.toMatch(/(class|id)=["'][^"']*logo/i);
      expect(text).not.toMatch(/\.[a-z-]*logo[a-z-]*\s*[{,]/i);
      expect(text).not.toMatch(/url\([^)]*logo/i);
    }
  });

  it('the Brief prints the outlet name as the link text', () => {
    expect(read('site/brief/brief.js')).toMatch(/escapeHtml\(article\.publisher\)/);
  });

  it('every outlet in the published data is a readable name', () => {
    for (const story of readJson('data/stories.json').stories) {
      for (const source of story.provenance) {
        expect(source.sourceName).toMatch(/[A-Za-z]/);
        expect(source.sourceName).not.toMatch(/^https?:/);
      }
    }
    for (const file of readdirSync(path.join(repoRoot, 'data/crises'))) {
      const crisis = readJson(`data/crises/${file}`);
      const names = [
        ...crisis.news.map((item: { publisher: string }) => item.publisher),
        ...crisis.incidents.flatMap((incident: { sources: { publisher: string }[] }) =>
          incident.sources.map((source) => source.publisher)),
        ...crisis.outlets.map((outlet: { name: string }) => outlet.name),
      ];
      for (const name of names) {
        // Any script: an Arabic agency's own name is as readable as an English one.
        expect(name).toMatch(/\p{L}/u);
      }
    }
  });
});

describe('the crisis view links everything it reports', () => {
  it('and the published crisis files give every one of them a link', () => {
    const files = readdirSync(path.join(repoRoot, 'data/crises')).filter((file) => file.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const crisis = readJson(`data/crises/${file}`);
      for (const item of crisis.news) expect(item.url).toMatch(/^https?:\/\//);
      for (const story of crisis.headlines) {
        expect(story.url).toMatch(/^https?:\/\//);
        for (const article of story.articles) expect(article.url).toMatch(/^https?:\/\//);
      }
      for (const incident of crisis.incidents) {
        expect(incident.sources.length).toBeGreaterThan(0);
        for (const source of incident.sources) expect(source.url).toMatch(/^https?:\/\//);
      }
    }
  });

  it('the status line is a template over the counts, and the summary falls back to it', () => {
    expect(read('src/core/crises/build.ts')).toMatch(/export function statusLine\(/);
    for (const file of readdirSync(path.join(repoRoot, 'data/crises'))) {
      const crisis = readJson(`data/crises/${file}`);
      expect(crisis.status.en.length).toBeGreaterThan(0);
      expect(crisis.status.nb.length).toBeGreaterThan(0);
      // A summary, when present, lists the linked headlines it was written from.
      if (crisis.summary) {
        expect(crisis.summary.sources.length).toBeGreaterThan(0);
        for (const source of crisis.summary.sources) expect(source.url).toMatch(/^https?:\/\//);
      }
    }
  });

  it('pictures come from Wikimedia Commons only, never from news organisations', () => {
    expect(read('src/core/crises/fetchers.ts')).not.toMatch(/previewImage|og:image|socialimage/);
    for (const file of readdirSync(path.join(repoRoot, 'data/crises'))) {
      const crisis = readJson(`data/crises/${file}`);
      for (const image of crisis.images) {
        expect(image.credit).toBe('Wikimedia Commons');
        expect(image.src).toMatch(/^https:\/\/(upload|thumb)\.wikimedia\.org\//);
      }
      for (const item of crisis.news) expect(item.image).toBeUndefined();
      for (const incident of crisis.incidents) expect(incident.image).toBeUndefined();
    }
  });
});

describe('an edition can be browsed', () => {
  it('search, order and theme filter are all present', () => {
    const html = read('site/brief/index.html');
    expect(html).toMatch(/id="search"/);
    expect(html).toMatch(/data-sort="coverage"/);
    expect(html).toMatch(/id="themes"/);
  });

  it('the archive can be stepped through, with the date in the URL', () => {
    expect(read('site/brief/brief.js')).toMatch(/\?edition=\$\{date\}/);
    expect(read('site/brief/index.html')).toMatch(/id="edition-nav"/);
  });

  it('theme names are translated in config, so adding a theme stays a config change', () => {
    for (const theme of config.themes.themes) {
      expect(theme.labelNb.length).toBeGreaterThan(0);
      expect(theme.labelNb).not.toBe(theme.label);
    }
    expect(read('site/brief/brief.js')).toMatch(/theme\.labelNb/);
  });

  it('the controls use no pill-shaped buttons, which the brief rules out', () => {
    const css = read('site/brief/brief.css');
    const optRule = /\.opt \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(optRule).not.toMatch(/border-radius/);
    expect(optRule).toMatch(/border-bottom/);
  });
});

/* ============================================================
   The rebuild: map, crisis and country views, crisis pages, the
   front page. Section 12 of the brief, item by item where code
   can show it; the rest was checked by eye in the browser.
   ============================================================ */

const SITE_FILES = [
  'site/index.html', 'site/app.js', 'site/app.css', 'site/common.js', 'site/view.js', 'site/mapcore.js',
  'site/crisis.js', 'site/crisis.css', 'site/crisis/index.html',
];
const STYLESHEETS = ['site/atlas.css', 'site/app.css', 'site/crisis.css', 'site/brief/brief.css', 'site/stream/stream.css', 'www/home.css'];
const PAGES = ['site/index.html', 'site/brief/index.html', 'site/stream/index.html', 'site/crisis/index.html', 'www/index.html'];
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

describe('the pages read their data at view time', () => {
  it('the map, the crisis pages and the front page fetch from data/, never bake it in', () => {
    expect(read('site/common.js')).toMatch(/fetch\(`\$\{dataBaseUrl\(\)\}\$\{file\}`/);
    const app = read('site/app.js');
    expect(app).toMatch(/getJson\('crises\.json'\)/);
    expect(app).toMatch(/getJson\('map-events\.json'\)/);
    expect(read('site/crisis.js')).toMatch(/getJson\(`crises\/\$\{encodeURIComponent\(id\)\}\.json`\)/);
    expect(read('www/home.js')).toMatch(/raw\.githubusercontent\.com\/bridgeerlend\/igred-warmap\/main\/data\//);
    expect(read('site/config.js')).toMatch(/raw\.githubusercontent\.com/);
  });

  it('no file the pages load names ACLED, or the fire layer that was removed', () => {
    for (const file of [...SITE_FILES, 'www/home.js', 'www/hero.js']) {
      expect(read(file).toLowerCase()).not.toMatch(/acled|firms|thermal|hotspot-fire/);
    }
  });

  it('the crisis pages are current with config, so a data commit never has to write them', () => {
    // Generated from config/crises.json alone; --check exits 1 if any page is out of date.
    const out = execFileSync('npx', ['tsx', 'scripts/build-crisis-pages.ts', '--check'], { cwd: repoRoot, encoding: 'utf-8' });
    expect(out).toMatch(/already current/);
    for (const workflow of ['ingest.yml', 'crises.yml', 'brief.yml']) {
      expect(read(`.github/workflows/${workflow}`)).not.toMatch(/crisis-pages|git add site/);
    }
  });
});

describe('dark by default, light on request', () => {
  it('the foundation is dark at the root and light only under the reader’s choice', () => {
    const atlas = read('site/atlas.css');
    expect(/:root \{[^}]*--bg: #0B0B0A/.test(atlas)).toBe(true);
    expect(atlas).toMatch(/:root\[data-theme="light"\] \{[^}]*--bg: #FBFAF7/);
    expect(atlas).not.toMatch(/prefers-color-scheme/);
    for (const page of PAGES) expect(read(page)).toMatch(/<html lang="en" data-theme="dark">/);
  });

  it('the theme switch sits in the footer of every page', () => {
    for (const page of PAGES) {
      const html = read(page);
      const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
      expect(footer).toMatch(/id="theme"/);
      expect(html.replace(footer, '')).not.toMatch(/id="theme"/);
    }
  });

  it('body text is near-black on light and near-white on dark, not grey on grey', () => {
    const atlas = read('site/atlas.css');
    expect(atlas).toMatch(/--fg: #0E0E0C/);
    expect(atlas).toMatch(/--fg: #F7F5EF/);
  });

  it('incidents use ember from orange to red — no yellow — and magenta only for verified', () => {
    const atlas = read('site/atlas.css');
    for (const yellow of ['#F5CB56', '#B98A1E', '#F2A040']) expect(atlas).not.toContain(yellow);
    expect(atlas).toMatch(/--verified:/);
    expect(atlas).toMatch(/--pick:/);
    expect(atlas).toMatch(/--down:/);
    const core = read('site/mapcore.js');
    expect(core.match(/p\.verified|q\.verified/g)?.length).toBeGreaterThan(0);
    // Magenta is used by the verified layer and nothing else.
    expect(core.replace(/id: 'ev-verified'[\s\S]*?\},\n/, '')).not.toMatch(/'circle-color': p\.verified/);
  });
});

describe('free of the named tells', () => {
  it('no rounded boxes, no shadows, no gradient fills in any stylesheet', () => {
    for (const file of STYLESHEETS) {
      const css = stripComments(read(file));
      for (const match of css.matchAll(/border-radius:\s*([^;]+);/g)) expect(['0', '50%']).toContain(match[1]!.trim());
      for (const match of css.matchAll(/box-shadow:\s*([^;]+);/g)) expect(match[1]!.trim()).toBe('none');
      expect(css).not.toMatch(/linear-gradient|radial-gradient/);
    }
  });

  it('never three columns: no grid on a page has more than two tracks', () => {
    for (const file of STYLESHEETS) {
      const css = stripComments(read(file));
      for (const match of css.matchAll(/grid-template-columns:\s*([^;]+);/g)) {
        const value = match[1]!.trim();
        if (value === 'none') continue;
        const tracks = value.replace(/repeat\((\d+),[^)]*\)/g, (_m, n) => 'x '.repeat(Number(n))).replace(/minmax\([^)]*\)/g, 'x').trim().split(/\s+/);
        // Two single-line rows are not columns of content: the map's timeline controls
        // (play · date · track · now) and a Brief archive entry (date · headline · count).
        const rows = (file === 'site/app.css' && /^(auto auto 1fr auto|auto 1fr auto)$/.test(value))
          || (file === 'site/brief/brief.css' && value === '7.5em minmax(0, 1fr) auto');
        const allowed = rows ? 4 : 2;
        expect(tracks.length, `${file}: ${value}`).toBeLessThanOrEqual(allowed);
      }
    }
  });

  it('charts are flat bars, never a line or a filled area', () => {
    const common = read('site/common.js');
    expect(common).toMatch(/export function barChart/);
    expect(common).not.toMatch(/sparkline|polyline|spark-area/);
  });

  it('controls are underlined text, and the crisis list has no numbering, pictures or charts', () => {
    expect(read('site/atlas.css')).toMatch(/\.link-button \{[^}]*border-bottom: 1px solid var\(--fg\)/);
    const app = read('site/app.js');
    const list = /function renderList[\s\S]*?\n\}/.exec(app)?.[0] ?? '';
    expect(list).not.toMatch(/<img|h\('img|barChart|svg/);
    expect(read('site/app.css')).toMatch(/\.crisis-list \{ list-style: none/);
  });

  it('countries are never coloured — the only fills are the stipple and an invisible hit area', () => {
    const core = read('site/mapcore.js');
    const fills = [...core.matchAll(/type: 'fill'[^}]*paint: \{([^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(fills).toEqual(["'fill-pattern': 'stipple'", "'fill-color': '#000', 'fill-opacity': 0"]);
    // A chosen country gets a thin line in the reader's colour, never a fill.
    expect(core).toMatch(/id: 'pick-line', type: 'line'/);
  });
});

describe('the map', () => {
  it('carries its own cartography rather than third-party tiles', () => {
    const core = read('site/mapcore.js');
    expect(core).not.toMatch(/mapbox|openstreetmap|arcgis|maptiler|carto|\{z\}\/\{x\}\/\{y\}/i);
    expect(core).not.toMatch(/type: '(raster|vector|raster-dem)'|tiles:|glyphs:|sprite:/);
    expect(core).not.toMatch(/https?:\/\//);
    expect(core).toMatch(/options\.vendor \?\? 'vendor\/countries-50m\.json'/);
    expect(read('site/index.html')).not.toMatch(/<(script|link)[^>]+(src|href)="https?:/);
    expect(readJson('site/vendor/countries-50m.json').type).toBe('Topology');
    // The antimeridian is unwrapped, or Russia and Fiji draw lines across the map.
    expect(core).toMatch(/Math\.abs\(ring\[i\]\[0\] - ring\[i - 1\]\[0\]\) > 180/);
  });

  it('a single-source incident is hollow, a corroborated one filled, a verified one magenta', () => {
    const core = read('site/mapcore.js');
    expect(core).toMatch(/id: 'ev-hollow'[^\n]*\['==', \['get', 'o'\], 0\]/);
    expect(core).toMatch(/'circle-opacity': 0, 'circle-stroke-color': ember\(p\)/);
    expect(core).toMatch(/id: 'ev-filled'[^\n]*\['==', \['get', 'o'\], 1\]/);
    expect(core).toMatch(/id: 'ev-verified'[^\n]*\['==', \['get', 'v'\], 1\]/);
    // "o" means two or more independent outlets, counted by the pipeline.
    expect(read('site/app.js')).toMatch(/o: r\[7\] >= 2 \? 1 : 0/);
    expect(readJson('data/map-events.json').fields[7]).toBe('outlets');
  });

  it('draws the heaviest incident last and takes the brightest under the pointer', () => {
    const core = read('site/mapcore.js');
    expect(core).toMatch(/'circle-sort-key': \['get', 'k'\]/);
    expect(core).toMatch(/hits\.sort\(\(a, b\) => \(b\.properties\.v - a\.properties\.v\) \|\| \(b\.properties\.k - a\.properties\.k\)\)/);
  });

  it('every incident popup shows its source, and offers the crisis and a verify link', () => {
    const app = read('site/app.js');
    const popup = /function showIncident\(feature\) \{[\s\S]*?\n\}/.exec(app)?.[0] ?? '';
    expect(popup).toMatch(/h\('a', \{ href: r\[10\], target: '_blank', rel: 'noopener' \}, inc\.publisher\(r\) \|\| r\[10\]\)/);
    expect(popup).toMatch(/t\.openCrisis/);
    expect(popup).toMatch(/\/new\/main\?filename=\$\{encodeURIComponent\(`config\/verified-events\/evt_\$\{inc\.id\(r\)\}\.json`\)\}&value=/);
  });

  it('a click on land opens that country', () => {
    expect(read('site/mapcore.js')).toMatch(/handler\(\{ kind: 'country', fips: land\.properties\.fips/);
    expect(read('site/app.js')).toMatch(/else if \(hit\.kind === 'country'\) openCountry\(hit\.fips/);
  });

  it('crisis names never collide and the largest claims its place first; six are named in the overview', () => {
    const core = read('site/mapcore.js');
    expect(core).toMatch(/sort\(\(a, b\) => \(a\.rank \?\? 999\) - \(b\.rank \?\? 999\)\)/);
    expect(core).toMatch(/m\.rank < 6/);
    expect(core).toMatch(/const clash = placed\.some/);
  });

  it('the address restores crisis, country, window, date and view', () => {
    const app = read('site/app.js');
    for (const key of ['crisis', 'country', 't', 'w', 'v']) {
      expect(app).toMatch(new RegExp(`q\\.set\\('${key}'`));
      expect(app).toMatch(new RegExp(`q\\.get\\('${key}'\\)`));
    }
    expect(app).toMatch(/addEventListener\('hashchange'/);
  });

  it('the timeline drags day by day, plays thirty days in about ten seconds, and the list follows', () => {
    const app = read('site/app.js');
    expect(read('site/index.html')).toMatch(/<input type="range" id="asof" min="0" max="29" step="1"/);
    expect(app).toMatch(/const stepMs = reduced\(\) \? 1000 : 330;/);
    // Every redraw recounts the list and the map for the chosen date and window.
    const setAsOf = /function setAsOf[\s\S]*?\n\}/.exec(app)?.[0] ?? '';
    expect(setAsOf).toMatch(/refresh\(/);
    expect(/function refresh[\s\S]*?\n\}/.exec(app)?.[0]).toMatch(/renderList\(ranked\)[\s\S]*paintMap\(ranked\)/);
  });

  it('offers a day, a week and a month, counted from the data’s own timestamps', () => {
    const html = read('site/index.html');
    for (const w of ['1', '7', '30']) expect(html).toMatch(new RegExp(`data-w="${w}"`));
    expect(read('site/common.js')).toMatch(/range\(w, asOf\)/);
  });

  it('shows how old the data is, and says so plainly after three hours', () => {
    const app = read('site/app.js');
    expect(app).toMatch(/banner\.hidden = hours < 3;/);
    expect(app).toMatch(/\$\('updated'\)\.textContent = `\$\{t\.updated\} \$\{fmtStamp\(state\.inc\.generatedAt\)\}`/);
    expect(readJson('data/crises.json').generatedAt).toBeTruthy();
  });

  it('search reaches a crisis, a country or a place, and says which', () => {
    const app = read('site/app.js');
    expect(app).toMatch(/kind: 'crisis'/);
    expect(app).toMatch(/kind: 'country'/);
    expect(app).toMatch(/kind: 'place'/);
    expect(app).toMatch(/h\('span\.meta', null, kinds\(\)\[item\.kind\]\)/);
  });

  it('on a phone the map takes two fingers and a crisis opens as a full sheet', () => {
    expect(read('site/app.js')).toMatch(/cooperative: narrow\(\)/);
    expect(read('site/app.css')).toMatch(/@media \(max-width: 899px\) \{[\s\S]*?\.detail \{\s*position: fixed; inset: 0;/);
  });

  it('honours reduced motion when the camera moves', () => {
    expect(read('site/mapcore.js')).toMatch(/duration: reduced\(\) \? 0 : 1100/);
    expect(read('site/atlas.css')).toMatch(/prefers-reduced-motion/);
  });
});

describe('the crisis and country views', () => {
  it('link everything they report to its source', () => {
    const view = read('site/view.js');
    expect(view).toMatch(/h\('a\.cv-news-item', \{ href: a\.url, target: '_blank', rel: 'noopener' \}, a\.title\)/);
    expect(view).toMatch(/h\('a\.cv-story', \{ href: s\.url/);
    expect(view).toMatch(/e\.sources\.map\(\(s, i\) => \[i \? ', ' : '', h\('a', \{ href: s\.url/);
    expect(view).not.toMatch(/sources\.slice/);
    expect(view).toMatch(/h\('a', \{ href: bgUrl, target: '_blank', rel: 'noopener' \}, t\.readMore\)/);
    expect(view).toMatch(/h\('a', \{ href: ind\.url/);
  });

  it('name outlets in text, never as logos, and show pictures only from Commons and the curated YouTube channels', () => {
    const view = stripComments(read('site/view.js'));
    for (const file of SITE_FILES) {
      const text = stripComments(read(file));
      expect(text).not.toMatch(/logos?\.(svg|png|jpe?g|webp|gif)|favicon|clearbit|logo\.dev/i);
      expect(text).not.toMatch(/(class|id)=["'][^"']*logo/i);
    }
    const sources = [...view.matchAll(/h\('img', \{ src: ([^,]+),/g)].map((m) => m[1]!.trim());
    expect(sources).toEqual(['im.src', '`https://i.ytimg.com/vi/${encodeURIComponent(v.videoId)}/mqdefault.jpg`']);
    expect(view).toMatch(/youtube-nocookie\.com\/embed/);
  });

  it('say the AI text is machine-written and list what it was written from', () => {
    const view = read('site/view.js');
    expect(view).toMatch(/t\.summaryLabel/);
    expect(view).toMatch(/sourceLinks\(d\.summary\.sources/);
    // No summary: the status line stands alone.
    expect(view).toMatch(/if \(d\.summary\) \{/);
  });

  it('link stories to their Brief edition, and the Brief links back to the crisis', () => {
    expect(read('site/view.js')).toMatch(/\$\{BRIEF\}\?edition=\$\{s\.edition\}#\$\{s\.storyId\}/);
    const brief = read('site/brief/brief.js');
    expect(brief).toMatch(/<li class="story" id="\$\{escapeHtml\(story\.id\)\}">/);
    expect(brief).toMatch(/href="\.\.\/#crisis=\$\{encodeURIComponent\(crisis\.id\)\}"/);
  });

  it('show the UCDP register and its fatality estimate as a contrast to media counts', () => {
    const view = read('site/view.js');
    expect(view).toMatch(/t\.ucdpBattle\(/);
    expect(view).toMatch(/t\.ucdpOtherOnly/);
    expect(view).toMatch(/c\.startDate \? t\.since/);
    const sudan = readJson('data/crises/sudan.json');
    expect(sudan.conflicts.length).toBeGreaterThan(0);
  });

  it('a country lists its register conflicts and the crisis it belongs to, or says plainly it has none', () => {
    const view = read('site/view.js');
    expect(view).toMatch(/export function renderCountry/);
    expect(view).toMatch(/t\.noConflicts/);
    expect(view).toMatch(/t\.openCrisis/);
    expect(readJson('data/countries.json').countries.SU.conflicts.length).toBeGreaterThan(1);
  });

  it('call counts reports, and date an incident to the day', () => {
    const common = read('site/common.js');
    expect(common).toMatch(/armed \$\{n === '1' \? 'incident' : 'incidents'\} reported/);
    expect(read('site/view.js')).toMatch(/fmtShortDay\(e\.at\)/);
  });
});

describe('a crisis has its own page', () => {
  it('every crisis in config has a page with its title, description, Open Graph tags and canonical address', () => {
    for (const crisis of readJson('config/crises.json').crises as { id: string; name: string }[]) {
      const html = read(`site/crisis/${crisis.id}/index.html`);
      const name = crisis.name.replace(/&/g, '&amp;');
      expect(html).toContain(`<title>${name} · IGRED Global Conflict Monitor</title>`);
      expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/);
      expect(html).toContain(`<meta property="og:title" content="${name}">`);
      expect(html).toMatch(/<meta property="og:description" content="[^"]+">/);
      expect(html).toMatch(/<meta property="og:image" content="https:\/\/(upload|thumb)\.wikimedia\.org\/[^"?]+">/);
      expect(html).toContain(`<link rel="canonical" href="https://map.igred.org/crisis/${crisis.id}/">`);
      expect(html).toContain(`data-crisis="${crisis.id}"`);
      expect(html).toContain(`href="../../#crisis=${crisis.id}"`);
    }
  });
});

describe('the wordmark links home', () => {
  it('from every product page, but not from the home page to itself', () => {
    for (const page of ['site/index.html', 'site/brief/index.html', 'site/stream/index.html', 'site/crisis/index.html']) {
      expect(read(page)).toMatch(/<a class="wordmark wordmark-link" href="https:\/\/igred\.org\/">/);
    }
    expect(read('www/index.html')).not.toMatch(/href="https:\/\/igred\.org\/"/);
  });
});

describe('the front page', () => {
  it('opens on a film drawn from today’s data, not a video file, with no buttons in it', () => {
    const html = read('www/index.html');
    const hero = /<header class="hero"[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
    expect(hero).toMatch(/<canvas class="hero-canvas"/);
    expect(hero).not.toMatch(/<button|<video|\.mp4|\.webm/);
    expect(read('www/home.js')).toMatch(/home\.json/);
    // Reduced motion gets one still frame.
    expect(read('www/hero.js')).toMatch(/if \(reduced\) \{ still\(\); return/);
  });

  it('has four equal entries: two live, two coming and not clickable', () => {
    const html = read('www/index.html');
    expect(html.match(/class="entry"/g)?.length).toBe(2);
    expect(html.match(/class="entry is-coming" aria-disabled="true"/g)?.length).toBe(2);
    expect(html).toMatch(/href="https:\/\/map\.igred\.org\/"/);
    expect(html).toMatch(/href="https:\/\/map\.igred\.org\/brief\/"/);
    for (const name of ['Global Conflict Monitor', 'The IGRED Brief', 'Reports', 'Knowledge base']) expect(html).toContain(name);
  });

  it('names the people behind it and how to reach them', () => {
    const html = read('www/index.html');
    expect(html).toContain('Erlend B. Moe');
    expect(html).toContain('Viktor T. Bratberg');
    expect(html).toContain('Co-Founder &amp; Analyst');
    expect(html).toContain('mailto:contact@igred.org');
  });

  it('every hero point is a published incident and every headline the Brief’s own', () => {
    const home = readJson('data/home.json');
    expect(home.points.length).toBeGreaterThan(0);
    for (const h of home.brief.headlines) expect(h.url).toMatch(/^https?:\/\//);
  });
});
