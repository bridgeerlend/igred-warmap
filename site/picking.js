/**
 * Which incidents share a spot, and which mark a click belongs to.
 *
 * Kept out of the page and free of the DOM so it can be tested against the real register.
 * The bug this module exists to prevent was not visible from the code: every incident used
 * to carry its own invisible 26px target, and where those overlapped — 55 of 57 points on
 * the live map — a click was resolved by document order rather than by distance. Aiming at
 * a dot opened a different incident, which to a reader is indistinguishable from a dead map.
 */

/**
 * The shape this module needs of an incident. Callers pass richer objects; only these
 * fields are read, and the mark hands the whole object back untouched.
 *
 * @typedef {{ id: string, x: number, y: number, intensity: number, reportCount: number }} Placed
 * @typedef {{ x: number, y: number, lead: Placed, events: Placed[] }} Mark
 */

/**
 * How close two incidents must be, on screen, before a reader cannot aim between them.
 *
 * Ten, measured against the live register: it leaves marks at least twelve pixels apart —
 * comfortably separable once nearest-mark picking decides the winner — while merging little
 * enough that no pile currently spans two countries. Fifteen was clean to click but lumped
 * Novorossiysk in with Kherson, and a mark should not quietly cross a border.
 */
export const GROUP_RADIUS_PX = 10;

/** How far a click may miss a mark and still count as hitting it. */
export const PICK_RADIUS_PX = 18;

/**
 * Groups incidents that fall on the same spot at the current scale.
 *
 * A mark keeps the position of its heaviest incident rather than a centroid, so it still
 * sits where something actually happened. Grouping depends on the scale, so zooming in
 * pulls a pile apart into the incidents it was hiding — that is the affordance, not a
 * bigger target.
 *
 * @param {readonly Placed[]} events
 * @param {number} perPixel view units per rendered pixel
 * @returns {Mark[]}
 */
export function groupEvents(events, perPixel) {
  const radius = GROUP_RADIUS_PX * perPixel;
  if (!(radius > 0)) return events.map((event) => ({ x: event.x, y: event.y, lead: event, events: [event] }));

  /** @type {Map<string, Mark[]>} */
  const buckets = new Map();
  /** @type {Mark[]} */
  const marks = [];
  const cellKey = (/** @type {number} */ cx, /** @type {number} */ cy) => `${cx}:${cy}`;

  // Heaviest first, so a mark takes its place, colour and size from its strongest incident.
  const ordered = [...events].sort(
    (a, b) => b.intensity - a.intensity || b.reportCount - a.reportCount || a.id.localeCompare(b.id),
  );

  for (const event of ordered) {
    const cx = Math.floor(event.x / radius);
    const cy = Math.floor(event.y / radius);
    /** @type {Mark | null} */
    let host = null;
    let hostDistance = Infinity;
    // Only the neighbouring cells can hold a mark within reach, so this stays cheap as the
    // register grows rather than going quadratic.
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const mark of buckets.get(cellKey(cx + dx, cy + dy)) ?? []) {
          const distance = Math.hypot(mark.x - event.x, mark.y - event.y);
          if (distance <= radius && distance < hostDistance) {
            hostDistance = distance;
            host = mark;
          }
        }
      }
    }
    if (host) {
      host.events.push(event);
      continue;
    }
    /** @type {Mark} */
    const mark = { x: event.x, y: event.y, lead: event, events: [event] };
    marks.push(mark);
    const key = cellKey(cx, cy);
    const existing = buckets.get(key);
    if (existing) existing.push(mark);
    else buckets.set(key, [mark]);
  }

  /*
   * One reassignment pass, so every incident ends up in the mark nearest to it.
   *
   * Greedy grouping takes the nearest mark that exists at the time, and a mark created later
   * can turn out to be closer. Left alone that reintroduces the original bug in miniature:
   * a click near an incident would open a mark that does not list it. Marks never move —
   * each keeps its lead's position — so a single pass is enough, and a lead is at zero
   * distance from its own mark and can never be pulled out of it.
   */
  for (const mark of marks) mark.events.length = 0;
  for (const event of ordered) {
    let host = marks[0];
    let hostDistance = Infinity;
    const cx = Math.floor(event.x / radius);
    const cy = Math.floor(event.y / radius);
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (const mark of buckets.get(cellKey(cx + dx, cy + dy)) ?? []) {
          const distance = Math.hypot(mark.x - event.x, mark.y - event.y);
          if (distance < hostDistance) {
            hostDistance = distance;
            host = mark;
          }
        }
      }
    }
    host?.events.push(event);
  }

  return marks;
}

/**
 * The mark nearest a position, or null if none is within reach.
 *
 * Nearest wins. Two marks can no longer both claim the same pixel, so a click resolves to
 * the thing the reader was pointing at rather than to whatever was rendered last.
 *
 * @param {readonly Mark[]} marks
 * @param {number} x
 * @param {number} y
 * @param {number} reach in the same units as the coordinates
 * @returns {Mark | null}
 */
export function nearestMark(marks, x, y, reach) {
  /** @type {Mark | null} */
  let best = null;
  let bestDistance = Infinity;
  for (const mark of marks) {
    const distance = Math.hypot(mark.x - x, mark.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = mark;
    }
  }
  return bestDistance <= reach ? best : null;
}
