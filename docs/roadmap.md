# Build order

1. **Data core — done.** UCDP conflict register and the GDELT live layer, with strict schema
   validation, deterministic clustering, and new-conflict detection proven against 60 days
   of real history plus sensitivity tests on the shipped config.
2. **Design directions — done.** Three static explorations; **C, Atlas** was chosen.
3. **The map — done.** Built in the Atlas language on top of the data core, at `site/`.
4. **The news synthesiser — done.** The Brief: one dated edition each morning at
   `site/brief/`, on the same core as the map.
5. **Remaining sources**, layer by layer: NASA FIRMS, Bluesky, Telegram, video.
6. **Self-healing, alert-on-failure, Dependabot, acceptance testing.**

The AI text step and its pull-request approval flow shipped with the Brief, ahead of the
original order, because that is where the first prose actually appears.

Steps 5 and 6 are partly in place already: source isolation, last-good retention, health
tracking, alert-only-on-sustained-failure and Dependabot all shipped with step 1, because
the pipeline needed them to be trustworthy from the first run.

## How the map stays free

The page is built once and fetches `events.json`, `conflicts.json` and `health.json` from
the repository at view time. The Pages workflow is filtered to `site/**`, so the hourly data
commits never trigger a deploy. That separation is the whole reason the project can run on
free infrastructure indefinitely.

## Responsive behaviour

The layout is not one design stretched across breakpoints:

- **Phone** — a single column read downward: label, map, detail, index.
- **Tablet** — the title shares a line with the standfirst so it stops being a screen of its
  own; the map follows, then the detail below the map you just tapped.
- **Desktop (≥1120px)** — a wall label beside a plate, together filling the viewport. The
  detail moves to the foot of the label, where a caption belongs.
- **Large (≥1700px)** — the plate keeps growing; the label centres so the extra height
  becomes air above and below rather than a void beneath.
- **Beyond 2300px** the composition centres instead of stretching to the bezels.
- **Short landscape** (a phone on its side) collapses the label beside the map.

Point radii are expressed in on-screen pixels and recomputed on zoom and resize, so a
cluster separates when you zoom in instead of inflating, and every incident keeps a 26px
touch target no matter how small the mark is.

Typography is fixed: Fraunces for titles, Inter for body and data, self-hosted and identical
everywhere. Across all five breakpoints only `font-size` changes — never the family, weight
or style.

## Open items carried forward

- **UCDP mapping is unverified.** It could not be exercised without a token, so it is
  written defensively and fails loudly on shape mismatch. Confirm it against the live API
  as soon as the token exists.
- **The map is nearly empty until UCDP is connected**, and says so in a banner. The display
  gate is the register; see the README for why the cheaper gates were rejected.
- ~~Typefaces are system stacks.~~ **Done.** Fraunces (titles) and Inter (body and data) are
  self-hosted from `site/fonts`, both SIL Open Font Licence 1.1 with the licences shipped
  alongside. Every device gets the same typography; only the size changes per screen.
  Re-fetch with `npm run fonts`.
- **Detection thresholds are tuned against a 60-day window.** Revisit once a full year of
  history has accumulated and seasonality is visible.

## The Brief

The second product, sharing the core rather than duplicating it: the same HTTP client, the
same schema validation, the same source isolation and atomic writes. It adds one source
module (RSS), story clustering, and field classification.

An edition is **immutable**. It is dated, it is meant to be cited, and a citation that
rewrites itself is worthless — the generator refuses to overwrite one that exists.

**What publishes directly, and what waits.** The edition is entirely sourced records, so it
publishes with the hourly data commits. Prose is different: it is authored, so it lives in
its own file, arrives as a pull request with the full text in the description, and reaches
the site only when merged. Nothing else waits on a human.

**How the no-invented-facts rule is enforced rather than stated.** The model sees only
headlines already fetched from the publishers. Every returned paragraph is then checked in
code: any figure not present in those headlines rejects the whole paragraph, as do links and
over-long output. `tests/edition.test.ts` pins that behaviour.

### Source findings worth keeping

The wire agencies no longer publish open feeds — Reuters 404s, AP requires a licence, AFP
has none — so the live-pulse tier is carried by international broadcasters. ISW, IMF, OECD,
UNCTAD and Chatham House return 403 to any automated client; the World Bank newsroom serves
HTML. The GDELT article API rate-limits harder than documented and is unusable on a
schedule. All of this is recorded in `config/feeds.json` rather than rediscovered later.

### Deferred deliberately

**The Signal** — a change detector over story volume per theme and country, reusing the
anomaly maths already proven for new-conflict detection. It needs weeks of accumulated
history before it can say anything, so it becomes a section of the Brief later rather than a
product now.
