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
    const map = read('site/map.js');
    expect(map).toMatch(/import \{ dataBaseUrl \} from '\.\/config\.js'/);
    expect(map).toMatch(/fetch\(`\$\{base\}\$\{path\}`/);
    expect(map).toMatch(/getJson\('crises\.json'\)/);
    expect(map).toMatch(/getJson\('map-events\.json'\)/);
    // The standalone crisis page reads its file the same way.
    expect(read('site/crisis/crisis-page.js')).toMatch(/fetch\(`\$\{dataBaseUrl\(\)\}crises\//);
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

  it('is named by no file the map loads', () => {
    for (const file of [
      'site/map.js', 'site/crisis-view.js', 'site/common.js', 'site/index.html',
      'site/crisis/index.html', 'site/crisis/crisis-page.js',
    ]) {
      expect(read(file).toLowerCase()).not.toMatch(/acled/);
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

  it('the map defines its own colours for both themes', () => {
    // map.js reads these from the stylesheet, so a theme without them would draw a blank map.
    const css = read('site/map.css');
    expect(css).toMatch(/:root\[data-theme="dark"\] \{[^}]*--map-sea/);
    expect(css).toMatch(/prefers-color-scheme: dark\)[\s\S]*?--map-sea/);
    expect(read('site/map.js')).toMatch(/if \(what === 'theme'\) \{ repaintMap\(\)/);
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
    const map = read('site/map.js');
    expect(map).not.toMatch(/mapbox|openstreetmap|arcgis|maptiler|carto|\{z\}\/\{x\}\/\{y\}/i);
    // The style is built in the page: every source is inline GeoJSON, none is a tile source
    // or a remote style, and the file names no external host at all.
    expect(map).toMatch(/style: buildStyle\(world\)/);
    expect(map).not.toMatch(/type: '(raster|vector|raster-dem)'|tiles:|glyphs:|sprite:/);
    const sources = /sources: \{([\s\S]*?)\n {4}\},/.exec(map)?.[1] ?? '';
    expect([...sources.matchAll(/type: '([a-z-]+)'/g)].map((match) => match[1])).toEqual(['geojson', 'geojson']);
    expect(map).not.toMatch(/https?:\/\//);
    // The renderer and the borders are vendored and served from the site itself.
    expect(map).toMatch(/fetch\('vendor\/countries-50m\.json'\)/);
    expect(read('site/index.html')).toMatch(/<script src="vendor\/maplibre-gl\.js"><\/script>/);
    expect(read('site/index.html')).not.toMatch(/<(script|link)[^>]+(src|href)="https?:/);
    expect(readJson('site/vendor/countries-50m.json').type).toBe('Topology');
    // Borders are Natural Earth (via world-atlas), and the page says so.
    expect(read('site/common.js')).toMatch(/Natural Earth \(public domain\)/);
  });

  it('respects reduced motion', () => {
    expect(read('site/atlas.css')).toMatch(/prefers-reduced-motion/);
  });

  it('countries are never coloured — only incidents are', () => {
    // A choropleth is exactly what the brief rules out. Land is one colour; the only other
    // fill is the open crisis's own countries, never a scale.
    const map = read('site/map.js');
    const fills = [...map.matchAll(/'fill-color': ([^,}]+)/g)].map((match) => match[1]!.trim());
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) expect(fill).toMatch(/^p\.(land|focus)$/);
    expect(map).not.toMatch(/'fill-color',\s*\[/);
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

describe('satellite thermal detections are gone, not merely switched off', () => {
  /**
   * A fire is not a conflict event. The layer was built, labelled carefully as detections
   * rather than attacks, and taken out anyway: it fell outside the institute's mandate and
   * competed with the sourced incidents for attention. Pinned so it cannot drift back in as
   * a hidden flag or a stray token.
   */
  it('leaves no source, schema, artifact or layer behind', () => {
    for (const file of [
      'src/core/cli/ingest.ts', 'src/core/util/paths.ts', 'config/sources.json',
      'site/atlas.css', 'site/index.html', 'site/map.js', 'site/map.css',
      'site/crisis-view.js', 'site/crisis.css', 'site/common.js',
      'site/crisis/index.html', 'site/crisis/crisis-page.js', 'site/crisis/crisis-page.css',
      'src/core/crises/build.ts', 'src/core/crises/fetchers.ts', 'src/core/cli/crises.ts',
    ]) {
      // Word-bounded: "confirms" is not a satellite, and the guard should not say it is.
      expect(read(file)).not.toMatch(/\b(firms|thermal|heat)\b/i);
    }
    expect(existsSync(path.join(repoRoot, 'src/core/sources/firms'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'src/core/schema/heat.ts'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'data/heat.json'))).toBe(false);
  });
});

describe('the reader can tell an incident from the background', () => {
  it('promises a click only where there is an incident to take', () => {
    const map = read('site/map.js');
    expect(map).toMatch(/map\.on\('mousemove', 'dots', \(\) => \{ map\.getCanvas\(\)\.style\.cursor = 'pointer'/);
    expect(map).toMatch(/map\.on\('mouseleave', 'dots', \(\) => \{ map\.getCanvas\(\)\.style\.cursor = ''/);
  });

  it('draws the heaviest incident last, so it is never buried', () => {
    expect(read('site/map.js')).toMatch(/features\.sort\(\(a, b\) => a\.properties\.k - b\.properties\.k\)/);
  });

  it('never transitions font-size, which stalls and freezes the value', () => {
    for (const file of ['site/map.css', 'site/crisis.css', 'site/crisis/crisis-page.css']) {
      expect(read(file)).not.toMatch(/transition:[^;]*font-size/);
    }
  });
});

describe('a click on the map opens what was clicked', () => {
  /**
   * Overlapping incidents were once resolved by document order, which the reader cannot see.
   * The map now queries the incident layer under the pointer and takes the most widely
   * reported one, with one handler on the layer rather than a target per point.
   */
  it('resolves selection from the layer, preferring the brightest incident', () => {
    const map = read('site/map.js');
    expect(map).toMatch(/map\.on\('click', 'dots', \(ev\) => \{/);
    expect(map).toMatch(/\[\.\.\.ev\.features\]\.sort\(\(a, b\) => b\.properties\.k - a\.properties\.k\)\[0\]/);
  });

  it('gives no incident an invisible target of its own', () => {
    expect(read('site/map.js')).not.toMatch(/class: 'hit'|'\.hit'|h\('[a-z]*\.hit/);
    expect(read('site/map.css')).not.toMatch(/\.hit\s*\{/);
  });

  it('answers the click at the point itself', () => {
    expect(read('site/map.js')).toMatch(/new maplibregl\.Popup\([\s\S]*?\.setLngLat\(feature\.geometry\.coordinates\)/);
  });

  it('every incident popup shows a link to its source', () => {
    const map = read('site/map.js');
    const popup = /function showIncident\(feature\) \{[\s\S]*?\n\}/.exec(map)?.[0] ?? '';
    expect(popup).toMatch(/h\('a', \{ href: r\[9\], target: '_blank', rel: 'noopener' \}, r\[10\] \|\| r\[9\]\)/);
    // The popup renders the link only when the row has one, so the data must always have one.
    const { events } = readJson('data/map-events.json');
    expect(events.length).toBeGreaterThan(0);
    for (const row of events) {
      expect(row[9]).toMatch(/^https?:\/\//);
      expect(String(row[10]).length).toBeGreaterThan(0);
    }
  });

  it('a crisis opens beside the map, framed, with its address in the URL', () => {
    expect(read('site/index.html')).toMatch(/<div class="panel" id="panel" hidden>/);
    const map = read('site/map.js');
    const open = /async function openCrisis\([\s\S]*?\n\}/.exec(map)?.[0] ?? '';
    expect(open).toMatch(/panel\.hidden = false/);
    expect(open).toMatch(/flyToCrisis\(c\)/);
    expect(open).toMatch(/history\.replaceState\(null, '', `#\$\{encodeURIComponent\(id\)\}`\)/);
    expect(open).toMatch(/renderCrisis\(d, \{/);
  });

  it('honours reduced motion when it flies to a crisis', () => {
    expect(read('site/map.js')).toMatch(/duration: matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches \? 0/);
  });
});

describe('the reader can narrow the time window', () => {
  it('offers a day, a week and a month, and filters by the data\'s own timestamps', () => {
    const html = read('site/index.html');
    for (const days of ['1', '7', '30']) expect(html).toMatch(new RegExp(`data-days="${days}"`));
    const map = read('site/map.js');
    expect(map).toMatch(/const cutoff = Date\.now\(\) \/ 60000 - state\.days \* 1440;/);
    expect(map).toMatch(/if \(r\[0\] < cutoff\) continue;/);
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

  it('the map and the crisis view never show an outlet as a logo', () => {
    /*
     * The crisis view does show pictures: preview images the outlets published with their
     * articles, each linked to that article, and video thumbnails. What it never shows is a
     * masthead, so these files get the logo checks only.
     */
    for (const page of [
      'site/index.html', 'site/map.js', 'site/map.css', 'site/common.js',
      'site/crisis-view.js', 'site/crisis.css',
      'site/crisis/index.html', 'site/crisis/crisis-page.js', 'site/crisis/crisis-page.css',
    ]) {
      const text = read(page)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
      expect(text).not.toMatch(/logos?\.(svg|png|jpe?g|webp|gif)/i);
      expect(text).not.toMatch(/(class|id)=["'][^"']*logo/i);
      expect(text).not.toMatch(/\.[a-z-]*logo[a-z-]*\s*[{,]/i);
      expect(text).not.toMatch(/url\([^)]*logo/i);
      expect(text).not.toMatch(/favicon|clearbit|logo\.dev/i);
    }
    // The outlet appears as its name, in text.
    const view = read('site/crisis-view.js');
    expect(view).toMatch(/`\$\{a\.publisher\}, \$\{ago\(a\.publishedAt\)\}`/);
    expect(view).toMatch(/h\('a', \{ href: s\.url, target: '_blank', rel: 'noopener' \}, s\.publisher\)/);
    expect(view).toMatch(/h\('li', null, o\.name,/);
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
  it('every news item, story, incident source and background opens at its source', () => {
    const view = read('site/crisis-view.js');
    expect(view).toMatch(/h\('a\.cv-news-item', \{ href: a\.url, target: '_blank', rel: 'noopener'/);
    expect(view).toMatch(/h\('a\.cv-story', \{ href: s\.url/);
    expect(view).toMatch(/s\.articles\.map\(\(a\) =>\s*h\('li', null, h\('a', \{ href: a\.url/);
    // No slice on an incident's sources: each shows all of them.
    expect(view).toMatch(/e\.sources\.map\(\(s, i\) => \[i \? ', ' : '', h\('a', \{ href: s\.url/);
    expect(view).not.toMatch(/sources\.slice/);
    expect(view).toMatch(/h\('a', \{ href: bgUrl, target: '_blank', rel: 'noopener' \}, t\.readMore\)/);
    expect(view).toMatch(/h\('a', \{ href: ind\.url/);
  });

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

  it('the situation text is a template over the counts, not a model', () => {
    expect(read('site/common.js')).toMatch(/No language model writes this text/);
    for (const file of readdirSync(path.join(repoRoot, 'src/core/crises'))) {
      expect(read(`src/core/crises/${file}`)).not.toMatch(/generativelanguage|openai|anthropic/i);
    }
  });
});

describe('the wordmark links home', () => {
  it('from the map and the Brief, but not from the home page to itself', () => {
    for (const page of ['site/index.html', 'site/crisis/index.html']) {
      expect(read(page)).toMatch(/<a class="bar-mark" href="https:\/\/igred\.org\/">/);
    }
    expect(read('site/brief/index.html')).toMatch(/<a class="wordmark wordmark-link" href="https:\/\/igred\.org\/">/);
    expect(read('www/index.html')).not.toMatch(/wordmark-link|bar-mark/);
  });

  it('and is reachable by keyboard', () => {
    const atlas = read('site/atlas.css');
    expect(atlas).toMatch(/a\.wordmark-link:focus-visible/);
    // The map's mark is a plain link, so the foundation's focus ring applies, and the map
    // stylesheet does not take it away.
    expect(atlas).toMatch(/^:focus-visible \{ outline: 2px solid/m);
    expect(read('site/map.css')).not.toMatch(/\.bar-mark[^{]*\{[^}]*outline:\s*(none|0)/);
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

describe('an incident carries the context the data supports', () => {
  it('a crisis shows the register’s conflicts for its countries', () => {
    const view = read('site/crisis-view.js');
    expect(view).toMatch(/section\(t\.conflicts, t\.conflictsNote, conflicts\(d\.conflicts\)\)/);
    expect(read('site/common.js')).toMatch(/Active conflicts in the Uppsala Conflict Data Program register for these countries/);
  });

  it('never presents GDELT’s own actor codes as the actors involved', () => {
    /*
     * They are assigned by word matching and are routinely wrong in a way that reads as
     * fact: the live feed has "SCHOOL" as the initiator of an armed clash in Gaza and
     * "JORDAN" as the initiator of one in Tehran.
     */
    for (const file of ['site/map.js', 'site/crisis-view.js']) {
      expect(read(file)).not.toMatch(/\.actors\b/);
    }

    // The data still carries them — this is a display decision, not a data loss.
    const events = readJson('data/events.json').events;
    expect(events.some((event: { actors: unknown[] }) => event.actors.length > 0)).toBe(true);
  });

  it('says counts are reports, not verified events', () => {
    expect(read('site/common.js')).toMatch(/Counts are reports of incidents, not verified events or casualties/);
  });

  it('states the day of an incident without implying an hour', () => {
    const map = read('site/map.js');
    expect(map).toMatch(/fmtDate\(new Date\(r\[0\] \* 60000\)\.toISOString\(\)\)/);
    expect(map).not.toMatch(/fmtDate\([^)]*\), true\)/);
    expect(read('site/crisis-view.js')).toMatch(/fmtDate\(e\.at\)\)/);
  });
});

describe('search reaches a crisis or a place', () => {
  it('searches both, and says which kind each result is', () => {
    expect(read('site/index.html')).toMatch(/id="search"/);
    const map = read('site/map.js');
    expect(map).toMatch(/kind: 'crisis'/);
    expect(map).toMatch(/kind: 'place'/);
  });

  it('every crisis can be centred, framed and opened', () => {
    const { crises } = readJson('data/crises.json');
    expect(crises.length).toBeGreaterThan(0);
    for (const crisis of crises) {
      expect(crisis.center).toHaveLength(2);
      expect(crisis.bbox).toHaveLength(4);
      expect(exists(`data/crises/${crisis.id}.json`)).toBe(true);
    }
  });

  it('every crisis country can be highlighted on the map', () => {
    const map = read('site/map.js');
    const table = /const FIPS_TO_ISO_N = \{([\s\S]*?)\};/.exec(map)?.[1] ?? '';
    const known = new Set([...table.matchAll(/([A-Z]{2}): '\d{3}'/g)].map((match) => match[1]));
    const missing = readJson('data/crises.json').crises
      .flatMap((crisis: { fips: string[] }) => crisis.fips)
      .filter((fips: string) => !known.has(fips));
    expect(missing).toEqual([]);
  });
});
