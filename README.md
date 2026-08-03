# IGRED Global Conflict Monitor

An automated global conflict map. Every figure on it carries a source, a timestamp and a
link to the original. It runs on free infrastructure and needs no routine maintenance.

Status: **steps 1–3 of 6 complete** — the data core, the chosen design direction (Atlas),
and the map itself. See `docs/roadmap.md`.

## Principles enforced in code, not just documented

| Principle | Where it is enforced |
| --- | --- |
| Nothing displays without a source | `provenanceList` requires at least one entry on every published record (`src/core/schema/common.ts`) |
| No model invents facts | No model is called anywhere in this codebase. Clustering, deduplication and detection are deterministic |
| No ACLED, ever | Rejected at config load (`src/core/config.ts`); the licence forbids third-party display and LLM use |
| Data never triggers a site build | The ingest workflow writes only to `data/` |
| Nothing half-written is published | Artifacts are schema-validated before write, then written via a temp file and renamed |
| One failing source cannot break the rest | Each source runs isolated; on failure its previous good data is kept and the run continues |

## Layout

```
config/     thresholds, sources, publisher whitelist, taxonomy — adding a source is a config change
src/core/   the shared data core; the news synthesiser will sit on this same core
  schema/   zod schemas for everything read and written
  sources/  one isolated module per source
  cluster/  deterministic deduplication
  detect/   rolling baseline and anomaly scoring
  pipeline/ source isolation, health, atomic validated writes
data/       published JSON artifacts, committed hourly with full git history
site/       the map — plain HTML, CSS and ES modules, deployed to map.igred.org
design/     the three design explorations that preceded the map
```

## The map

`site/` is deployed to map.igred.org by a workflow filtered to `site/**`. The page is built
once and fetches its data from the repository at view time, so the hourly data commits
never trigger a deploy — that separation is what keeps the whole thing free.

```bash
npm run serve          # http://localhost:4321/site/
npm run site:snapshot  # one self-contained file for offline review
```

## Data sources

| Source | Role | Credential |
| --- | --- | --- |
| GDELT 2.0 | Live pulse, every 15 minutes. Treated as a news-activity stream, never as verified events | none |
| UCDP | Verified backbone. Decides which conflicts exist and supplies verified figures | free token |

Later steps add NASA FIRMS, agency RSS, Bluesky, Telegram and curated video.

## Commands

```bash
npm run verify         # typecheck + tests
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

**This makes the UCDP token load-bearing.** Without it the register is empty and almost
nothing displays.
