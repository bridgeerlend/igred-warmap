# Build order

1. **Data core — done.** UCDP conflict register and the GDELT live layer, with strict schema
   validation, deterministic clustering, and new-conflict detection proven against 60 days
   of real history plus sensitivity tests on the shipped config.
2. **Design directions — done.** Three static explorations; **C, Atlas** was chosen.
3. **The map — done.** Built in the Atlas language on top of the data core, at `site/`.
4. **The news synthesiser — done.** The Brief: one dated edition each morning at
   `site/brief/`, on the same core as the map.
5. **Remaining sources — done.** FIRMS heat layer, curated Bluesky, Telegram and YouTube,
   and news tagged by country so each conflict has a stream beside it.
6. **Self-healing, alert-on-failure, Dependabot, acceptance testing — done.**

The AI text step and its pull-request approval flow shipped with the Brief, ahead of the
original order, because that is where the first prose actually appears.

## The acceptance list

`tests/acceptance.test.ts` checks the brief's criteria mechanically — 39 tests, each named
for the criterion it covers — so "it meets the list" is a thing the suite proves rather than
a claim. Anything only judgeable by eye is verified in the browser and deliberately not
faked there.

Writing it caught four imprecise checks of my own, the most telling being a search for the
word "tile" that tripped on the colophon sentence saying no third-party tiles are used.

## The new-conflict loop

Detection previously stopped at a JSON file nobody read. It now completes:

1. Sustained abnormal armed-incident coverage produces a candidate.
2. The hourly run proposes it and opens a pull request — evidence table, the incidents
   behind it, and the reporting, written out so it reads on a phone. It states plainly that
   this is not a claim a conflict exists.
3. Merging adds the entry to `config/verified-conflicts.json`, which puts the conflict in
   the register and its incidents on the map.
4. Closing dismisses it, and the country stays quiet for the cooldown.

Two things had to be built for that to actually work. Incidents in countries awaiting a
decision are **buffered** rather than dropped, because a reviewer confirms on the strength of
what has already happened — without it the map stayed empty for an hour and the evidence was
nowhere to be seen. And the retained window is **re-gated every run** rather than appended
to: an incident that passed the gate once used to stay for thirty days even after its country
left the register, so dismissing a candidate would have left its incidents on the map for a
month.

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

- ~~UCDP mapping is unverified.~~ **Done, and it was wrong.** First contact with the live API
  found the non-state dataset names its parties `side_a_name` / `side_b_name` rather than
  `side_a` / `side_b`, so every non-state row failed validation and was silently discarded —
  75 of the 223 active conflicts, exactly the militia and cartel violence the brief asks for.
  `tests/ucdp.test.ts` now pins all three dataset shapes against rows copied from the live
  service.
- ~~The map is nearly empty until UCDP is connected.~~ **Connected.** 1,578 conflicts, 223
  active across 48 countries.
- **The always-relevant escape hatch is closed.** It let inherently military event types onto
  the map wherever they occurred, because before the register the map was otherwise blank.
  With a real register it only admitted noise: on the first connected run it passed six
  events and not one was an aerial strike — a firefighting helicopter crash in Greece
  geolocated to Oregon, a tourist plane crash in Peru, a wildfire update in Colorado. CAMEO
  does not distinguish an aircraft accident from an aerial attack. Discovery is unaffected:
  detection runs ungated.
- **AI prose is off.** The key's project has no Gemini allowance, so the Brief publishes
  sourced records without prose — a valid edition. `npm run gemini:check` names a working
  model once the project has quota; then set `ai.enabled` back to true.
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

## The remaining sources

Each is an isolated module behind the same runner, so one going down costs only itself.

| Source | What it gives | Cost |
| --- | --- | --- |
| NASA FIRMS | Satellite thermal detections, aggregated onto a 0.25° grid | free, **no key** |
| Bluesky | Posts from curated accounts, including Reuters and AP | free, no auth |
| Telegram | Public channel posts | free, preview-enabled channels only |
| YouTube | Curated channels via their Atom feed | free, no key |

**FIRMS needs no MAP_KEY.** The documented API does, but the same global 24-hour products
are published as keyless CSV. One fewer thing to set up.

**The heat layer is labelled in the data, not just in the design.** Its artifact carries
`measures: "satellite_thermal_anomalies"` and the map states in both languages that these
are heat signatures, not attacks — a fire may be shelling, a burning depot or land
clearance, and the instrument cannot tell them apart. It draws beneath the incidents, in a
flatter colour, with its own toggle.

**Bluesky puts the wire agencies back.** Reuters and AP have no open RSS any more, but their
Bluesky accounts are public and readable without authentication. Search is not used —
`searchPosts` needs auth, and the brief asks for a curated whitelist rather than open search
in any case.

**Telegram ships with an empty list on purpose.** There is no open read API; what is public
is the channel preview page, which only works for channels whose owner enabled it. More
importantly, public channels covering active conflicts are overwhelmingly partisan, and
choosing them is an editorial judgement for IGRED, not for whoever wrote the parser. The
module is built and tested; the list waits for a decision.

**News is tagged by country** so a conflict can show its own stream. Tagging is conservative
by design: exact, word-boundary, and names that are ordinary English words or common
personal names — Georgia, Jordan, Chad, Turkey, Niger — are skipped rather than guessed at.
A wrong tag would put a story on the wrong part of the map.
