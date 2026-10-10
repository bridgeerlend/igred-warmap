# IGRED Global Conflict Monitor

An automated global conflict map. Every figure on it carries a source, a timestamp and a
link to the original. It runs on free infrastructure and needs no routine maintenance.

Status: **all six steps complete** — the data core, the chosen design direction (Atlas),
the map, the Brief, the remaining data sources, and the acceptance list. See `docs/roadmap.md`.

## Principles enforced in code, not just documented

| Principle | Where it is enforced |
| --- | --- |
| Nothing displays without a source | `provenanceList` requires at least one entry on every published record (`src/core/schema/common.ts`) |
| No model invents facts | A model is called in exactly one place — drafting Brief paragraphs — and every figure it returns is checked against the source text before the draft survives (`guardDraft`). Clustering, deduplication, classification and detection never call one |
| No ACLED, ever | Rejected at config load (`src/core/config.ts`); the licence forbids third-party display and LLM use |
| Data never triggers a site build | The ingest workflow writes only to `data/` |
| Nothing half-written is published | Artifacts are schema-validated before write, then written via a temp file and renamed |
| One failing source cannot break the rest | Each source runs isolated; on failure its previous good data is kept and the run continues |

## Layout

```
config/     thresholds, sources, publisher whitelist, taxonomy — adding a source is a config change
src/core/   the shared data core, feeding both the map and the Brief
  schema/   zod schemas for everything read and written
  sources/  one isolated module per source
  cluster/  deterministic deduplication
  detect/   rolling baseline and anomaly scoring
  pipeline/ source isolation, health, atomic validated writes
data/       published JSON artifacts, committed hourly with full git history
site/       the map — plain HTML, CSS and ES modules, deployed to map.igred.org
site/brief/ the Brief — one dated edition each morning, same Atlas language
site/stream/ the Wire — every sourced dispatch behind both, newest first
site/atlas.css  the design foundation both products share
design/     the three design explorations that preceded the map
```

## The map

map.igred.org opens on the crisis list beside a MapLibre map drawn from Natural Earth 1:50m
(no third-party tiles), dark by default. Two columns at most: the list, or an open crisis or
country, on the left; the map on the right. A thirty-day timeline under the map drags back
day by day or plays the month in about ten seconds, and the list and figures follow it.
Crisis, country, window, date and view are all in the address.

An incident resting on one source is a hollow ring; one carried by two or more independent
outlets is filled; one an IGRED analyst has verified is magenta. Verifying is a commit: the
VERIFY link in a popup opens GitHub's new-file page with `config/verified-events/<id>.json`
filled in. Crises are ranked by corroborated incidents weighted by severity, not by raw
counts, since raw counts follow English-language media attention.

Each crisis also has its own page at `crisis/<id>/` with Open Graph tags, generated from
`config/crises.json` by `npm run crisis-pages`, which writes only when the list or the
names change (`--check` is part of the tests).

Crises are built by `npm run crises` (`src/core/crises/`), which runs after every ingest in
`.github/workflows/crises.yml` and writes only to `data/`: `crises.json`, one file per
crisis, `map-events.json` (a compact incident file so phones need not fetch 14 MB),
`countries.json` and `home.json` for igred.org. Pictures come from Wikimedia Commons only,
credited; news organisations' pictures are never used.

Each crisis carries three to five machine-written sentences in English and Norwegian,
compressed from headlines already on the page and checked by `guardDraft` in both
languages: any figure not in the sources rejects the text, and the page keeps the last text
that passed, or shows the status line alone. GitHub Models was retired on 30 July 2026, so
the summary uses any free OpenAI-compatible tier whose key is set as a repository secret
(`GEMINI_API_KEY`, `GROQ_API_KEY` or `MISTRAL_API_KEY`). With no key it simply does not run.

`site/` is deployed to map.igred.org by a workflow filtered to `site/**`, and `www/` to
igred.org by Netlify, which skips builds that do not touch `www/`. Both fetch their data at
view time, so the hourly data commits never trigger a deploy.

```bash
npm run serve          # map at /site/, Brief at /site/brief/, Wire at /site/stream/, igred.org at /www/
npm run crises         # rebuild the crisis files (--offline: from cache, no network)
npm run crisis-pages   # regenerate site/crisis/<id>/ after changing config/crises.json
npm run edition        # publish today's Brief
```

## The Brief

The second product on the same core. One dated edition each morning, immutable once
published so it can be cited, with stories grouped by field and theme and every story
carrying the outlets that reported it.

Prose appears under a story only where a paragraph was drafted from the listed sources and
approved by hand. The guard that enforces this is in code, not in the prompt: any figure the
model produces that is absent from the source headlines rejects the paragraph outright.

## Data sources

| Source | Role | Credential |
| --- | --- | --- |
| GDELT 2.0 | Live pulse, every 15 minutes. Treated as a news-activity stream, never as verified events | none |
| UCDP | Verified backbone. Decides which conflicts exist and supplies verified figures | free token |

| Curated feeds (RSS) | The Brief's main food: broadcasters as live pulse, quality papers for depth, institutions for context | none |
| Bluesky | Curated accounts, including Reuters and AP whose RSS is gone | none |
| Telegram | Public channel posts. List ships empty: choosing conflict channels is an editorial call | none |
| YouTube | Curated channels via Atom. Titles and links only; video is embedded, never copied | none |

## Commands

```bash
npm run verify         # typecheck + tests, including the acceptance list
npm run ingest         # one pipeline run
npm run backfill -- --days 60
npm run detect-report  # detection diagnostic and backtest
```

## How new conflicts are found

UCDP updates monthly, so a fresh flare-up will not appear there for weeks. Detection
watches each country's own recent norm for armed-incident volume and flags sustained
departures from it.

A detection is never a claim that a conflict exists. It produces a candidate whose claim
field is fixed to `abnormal_conflict_coverage_detected`, awaiting human confirmation.

Three design decisions here came from testing against live data rather than from theory:

- **Detection scores armed incidents only.** Scoring all conflict-coded volume flagged
  protest waves as emerging conflicts on 13 of 20 backtested days.
- **The current day is excluded.** It is still being ingested, so its count is always short
  and including it hid real escalations.
- **`excludeRecentDays` must be at least `sustainedWindowDays`.** Otherwise the days being
  scored also sit inside the baseline they are scored against, and a sustained flare-up
  raises its own median until it looks normal. Enforced in the config schema.

With the shipped thresholds, 30 days of real history produce zero candidates — correct,
since no new war began in that window. Because "correctly quiet" and "broken" look
identical from the outside, `tests/detection-sensitivity.test.ts` runs the real shipped
config against realistic escalation shapes to prove it still fires.

## What the display gate does, and why it is strict

An event reaches the map only if the verified register lists its country as actively at
war, or the event type is inherently military. Two cheaper gates were tried against live
data and dropped:

- **Corroboration count** — routine US police shootings cleared it easily.
- **CAMEO actor-type codes** — they are assigned by word matching, so an article about a
  labour strike scored actor type `REB` on the word "rebellion".

Neither separates war from crime. Detection deliberately runs *ungated*, because a new
conflict by definition appears in a country the register does not know about yet.

**This makes the UCDP token load-bearing**, and it is now connected: 1,578 conflicts, 223 of
them active across 48 countries.

The gate has no exceptions. An earlier version let inherently military event types through
wherever they occurred, since the map was otherwise blank. The first run with a real register
showed what that admitted: six events, none of them aerial strikes — a firefighting
helicopter crash in Greece geolocated to Oregon, a tourist plane crash in Peru, a wildfire
update in Colorado. CAMEO does not distinguish an aircraft accident from an aerial attack.
