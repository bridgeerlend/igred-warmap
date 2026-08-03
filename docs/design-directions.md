# Three design directions

Step 2 of the build order. Design is locked visually before the map is built, so these are
static explorations to choose between — not a direction already committed to.

Build them with `npm run design`, review with `npm run design:serve`.

## Shared across all three

All three are built on the same foundations, so the comparison is about the visual system
and nothing else:

- **Real incidents.** One live day of GDELT — 1,309 clustered incidents — through this
  project's own pipeline. Nothing is invented.
- **Own cartography.** Natural Earth 1:110m (public domain), projected with the Natural
  Earth projection and drawn as SVG. No third-party tiles anywhere, as the brief requires.
- **Countries carry no colour.** Only incidents do. The land is neutral in every direction.
- **One warm intensity scale**, plus magenta reserved exclusively for IGRED-verified.
- **Light and dark**, each designed rather than inverted, with a toggle.
- **Redundant encoding.** Intensity is carried by colour, size and opacity together, and
  verified incidents get a ring as well as the accent hue — so neither rests on colour
  alone. Nothing depends on a red/green distinction.
- **Motion with a reason.** A short pulse as fresh reports land, a calm dim-the-rest on
  selection, and nothing else. All of it honours `prefers-reduced-motion`.

## A — Dispatch

The map as the front page of a serious bulletin. Newsprint grey ground, an academic serif,
datelines in small caps, hairline rules doing all the dividing. The map is framed as a plate,
the way an atlas engraving sits on a page. No boxes, no cards, no rounded corners anywhere.

The ground is deliberately grey rather than the warm cream this kind of page usually reaches
for — uncoated newsstock is grey, and a cool ground makes the ember scale read hotter.

**Reads as:** journalism. Closest to a16z's editorial register.

## B — Instrument

The map as a monitoring instrument rather than a dashboard. The graticule is structure, not
decoration; incidents are reticles whose rings appear only above a threshold, so the map
stays quiet; calibration ticks frame the plot; every number is monospaced and aligned. The
header is a running status line, not a row of KPI tiles.

**Reads as:** measurement. The most "operational" of the three.

## C — Atlas

Monumental and quiet. Enormous Didot display type against very small precise data — the
scale contrast is the signature. The landmass is a stipple pattern, so it reads as an
engraving rather than a fill. Almost no interface furniture: detail appears only when a
point is selected.

**Reads as:** a gallery wall. The most distinctive, and the least conventional.

## What is still standing in

- **The active-conflict country set is a placeholder** until the UCDP register is connected.
  Without it the mockups would be 29% US domestic crime, which is what the raw feed looks
  like before the register gate and would misrepresent the product.
- **The magenta points are illustrative.** Nothing has been verified by hand yet.
- **Typefaces are system stacks** chosen for character (Hoefler Text, Didot, monospace).
  A licensed pairing gets specified once a direction is chosen — the explorations should not
  depend on fonts we have not licensed.
- **Mobile shows the whole world at once.** The real map needs zoom and pan on small screens;
  that is map behaviour, not visual direction, so it is out of scope here.

## After a direction is chosen

Step 3 builds the map for real in the chosen language, on top of the step 1 data core.
