# Build order

1. **Data core — done.** UCDP conflict register and the GDELT live layer, with strict schema
   validation, deterministic clustering, and new-conflict detection proven against 60 days
   of real history plus sensitivity tests on the shipped config.
2. **Design directions — done.** Three static explorations; **C, Atlas** was chosen.
3. **The map — done.** Built in the Atlas language on top of the data core, at `site/`.
4. **Remaining sources**, layer by layer: NASA FIRMS, agency RSS, Bluesky, Telegram, video.
5. **The AI text step and the pull-request approval flow.**
6. **Self-healing, alert-on-failure, Dependabot, acceptance testing.**

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

## Open items carried forward

- **UCDP mapping is unverified.** It could not be exercised without a token, so it is
  written defensively and fails loudly on shape mismatch. Confirm it against the live API
  as soon as the token exists.
- **The map is nearly empty until UCDP is connected**, and says so in a banner. The display
  gate is the register; see the README for why the cheaper gates were rejected.
- **Typefaces are system stacks.** Didot and Avenir Next carry the Atlas direction on Apple
  devices but fall back elsewhere. A licensed pairing should be embedded as a woff2 data URI
  before launch.
- **Detection thresholds are tuned against a 60-day window.** Revisit once a full year of
  history has accumulated and seasonality is visible.
