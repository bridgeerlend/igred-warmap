# Build order

1. **Data core — done.** UCDP conflict register and the GDELT live layer, with strict schema
   validation, deterministic clustering, and new-conflict detection proven against 60 days
   of real history plus sensitivity tests on the shipped config.
2. **Design directions — next, and blocking.** Two to three clearly different static
   explorations grounded in Lightspeed and a16z. Erlend picks one. Nothing further is built
   until a direction is locked.
3. **The map**, in the chosen direction, on top of the data core.
4. **Remaining sources**, layer by layer: NASA FIRMS, agency RSS, Bluesky, Telegram, video.
5. **The AI text step and the pull-request approval flow.**
6. **Self-healing, alert-on-failure, Dependabot, acceptance testing.**

Steps 5 and 6 are partly in place already: source isolation, last-good retention, health
tracking, alert-only-on-sustained-failure and Dependabot all shipped with step 1, because
the pipeline needed them to be trustworthy from the first run.

## Open items carried forward

- **UCDP mapping is unverified.** It could not be exercised without a token, so it is
  written defensively and fails loudly on shape mismatch. Confirm it against the live API
  as soon as the token exists.
- **UCDP country names resolve against names observed in the GDELT feed.** Unmatched names
  are reported in the run log rather than guessed; add real ones to
  `config/country-aliases.json` as they show up.
- **Detection thresholds are tuned against a 60-day window.** Revisit once a full year of
  history has accumulated and seasonality is visible.
