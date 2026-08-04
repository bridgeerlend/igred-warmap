/**
 * The map's click behaviour, tested against the published register rather than a fixture.
 *
 * This exists because of a failure that every unit test in the project passed through: each
 * incident carried its own invisible 26px target, and on a desktop plate that is nearly four
 * times the visible dot. With 55 of 57 live points inside a neighbour's target, a click was
 * resolved by document order instead of by distance, so aiming at a dot opened a different
 * incident somewhere else — which reads as a map that does not respond at all.
 *
 * The property below is the one that was violated, and the only one worth pinning: clicking
 * where an incident is drawn must open that incident.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../src/core/util/paths.js';
import { toView } from '../scripts/lib/projection.js';
import {
  GROUP_RADIUS_COARSE_PX,
  GROUP_RADIUS_FINE_PX,
  GROUP_RADIUS_PX,
  PICK_RADIUS_PX,
  groupEvents,
  groupRadiusForPointer,
  nearestMark,
} from '../site/picking.js';

interface StoredEvent {
  id: string;
  intensity: number;
  reportCount: number;
  location: { lat: number; lon: number; name: string };
}

const artifact = JSON.parse(
  readFileSync(path.join(repoRoot, 'data', 'events.json'), 'utf-8'),
) as { events: StoredEvent[] };

/** The same placement the page does on load. */
const placed = artifact.events.map((event) => {
  const [x, y] = toView(event.location.lon, event.location.lat);
  return { id: event.id, x, y, intensity: event.intensity, reportCount: event.reportCount };
});

/**
 * View units per rendered pixel, at the two framings that matter. The world view is the one
 * that was broken; the zoomed view has to keep working as marks come apart.
 */
const VIEW_WIDTH = 1000;
const worldPerPixel = VIEW_WIDTH / 1100; // desktop plate, whole world
const zoomedPerPixel = (VIEW_WIDTH * 0.1) / 1100; // zoomed ten times in

describe('the published register places at least one pile', () => {
  it('has incidents that share a spot, so the grouping is actually exercised', () => {
    expect(placed.length).toBeGreaterThan(0);
    const marks = groupEvents(placed, worldPerPixel);
    expect(marks.length).toBeLessThan(placed.length);
  });
});

describe.each([
  ['world view', worldPerPixel],
  ['zoomed in', zoomedPerPixel],
])('clicking a dot opens that dot (%s)', (_label, perPixel) => {
  const marks = groupEvents(placed, perPixel);
  const reach = PICK_RADIUS_PX * perPixel;

  it('keeps every incident, exactly once', () => {
    const ids = marks.flatMap((mark) => mark.events.map((event) => event.id));
    expect(ids).toHaveLength(placed.length);
    expect(new Set(ids).size).toBe(placed.length);
  });

  it('opens the incident under the cursor, never a neighbour', () => {
    // The regression itself: for every incident on the map, a click on where it is drawn
    // must resolve to a mark that contains it.
    const wrong = placed.filter((event) => {
      const hit = nearestMark(marks, event.x, event.y, reach);
      return !hit?.events.some((entry) => entry.id === event.id);
    });
    expect(wrong.map((event) => event.id)).toEqual([]);
  });

  it('opens the mark itself when clicked at its centre', () => {
    const wrong = marks.filter((mark) => nearestMark(marks, mark.x, mark.y, reach) !== mark);
    expect(wrong.map((mark) => mark.lead.id)).toEqual([]);
  });

  it('leaves no two marks close enough to be aimed between', () => {
    // Marks that survive grouping must be separable by eye, otherwise nearest-wins simply
    // moves the ambiguity rather than removing it.
    const tooClose: string[] = [];
    for (let i = 0; i < marks.length; i += 1) {
      for (let j = i + 1; j < marks.length; j += 1) {
        const a = marks[i]!;
        const b = marks[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < GROUP_RADIUS_PX * perPixel) {
          tooClose.push(`${a.lead.id} / ${b.lead.id}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('ignores a click in open sea', () => {
    // Clicking away from everything clears the selection rather than snapping to the map's
    // nearest incident several hundred kilometres off.
    const far = { x: placed[0]!.x + 400 * perPixel, y: placed[0]!.y + 400 * perPixel };
    expect(nearestMark(marks, far.x, far.y, reach)).toBeNull();
  });
});

describe('zooming is the remedy for a pile, up to a limit the data imposes', () => {
  it('splits marks as the reader goes in', () => {
    const wide = groupEvents(placed, worldPerPixel);
    const close = groupEvents(placed, zoomedPerPixel);
    expect(close.length).toBeGreaterThan(wide.length);
  });

  /*
   * The honest limit. GDELT geolocates to a place, not to a spot, so several incidents in
   * Gaza on different days carry the identical coordinate — 26 of the 57 live incidents sit
   * exactly on top of another. No zoom can separate points that are the same point, which is
   * why a mark has to be able to hold several incidents and list them all.
   */
  it('bottoms out at the number of distinct coordinates, not the number of incidents', () => {
    const distinct = new Set(placed.map((event) => `${event.x},${event.y}`)).size;
    expect(distinct).toBeLessThan(placed.length);
    const veryClose = groupEvents(placed, (VIEW_WIDTH * 0.001) / 1100);
    expect(veryClose).toHaveLength(distinct);
  });

  it('still accounts for every incident when they cannot be separated', () => {
    const veryClose = groupEvents(placed, (VIEW_WIDTH * 0.001) / 1100);
    const total = veryClose.reduce((sum, mark) => sum + mark.events.length, 0);
    expect(total).toBe(placed.length);
  });
});

describe('a mark sits on a real place', () => {
  it('takes its position from an incident rather than a centroid', () => {
    for (const mark of groupEvents(placed, worldPerPixel)) {
      expect([mark.x, mark.y]).toEqual([mark.lead.x, mark.lead.y]);
      expect(mark.events).toContain(mark.lead);
    }
  });

  it('leads with the heaviest incident in the pile', () => {
    for (const mark of groupEvents(placed, worldPerPixel)) {
      const heaviest = Math.max(...mark.events.map((event) => event.intensity));
      expect(mark.lead.intensity).toBe(heaviest);
    }
  });
});

describe("a fingertip is not asked to do a mouse's job", () => {
  it('separates marks further for a coarse pointer', () => {
    expect(GROUP_RADIUS_COARSE_PX).toBeGreaterThan(GROUP_RADIUS_FINE_PX);
    // With no window to ask, the fine value is the safe default.
    expect(groupRadiusForPointer()).toBe(GROUP_RADIUS_FINE_PX);
  });

  it('honours the separation it is given, exactly', () => {
    for (const radiusPx of [GROUP_RADIUS_FINE_PX, GROUP_RADIUS_COARSE_PX]) {
      const marks = groupEvents(placed, worldPerPixel, radiusPx);
      let closest = Infinity;
      for (let i = 0; i < marks.length; i += 1) {
        for (let j = i + 1; j < marks.length; j += 1) {
          closest = Math.min(closest, Math.hypot(marks[i]!.x - marks[j]!.x, marks[i]!.y - marks[j]!.y));
        }
      }
      expect(closest / worldPerPixel).toBeGreaterThanOrEqual(radiusPx - 0.001);
    }
  });

  it('leaves fewer marks the wider the separation, and loses none of them', () => {
    const fine = groupEvents(placed, worldPerPixel, GROUP_RADIUS_FINE_PX);
    const coarse = groupEvents(placed, worldPerPixel, GROUP_RADIUS_COARSE_PX);
    expect(coarse.length).toBeLessThanOrEqual(fine.length);
    for (const marks of [fine, coarse]) {
      expect(marks.reduce((sum, mark) => sum + mark.events.length, 0)).toBe(placed.length);
    }
  });
});
