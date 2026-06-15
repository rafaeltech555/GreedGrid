/** Smallest fraction of total size a single track may shrink to (10%). */
export const MIN_TRACK_FR_RATIO = 0.1;

/**
 * Redistribute size between two adjacent tracks when a splitter is dragged.
 *
 * `boundary` is the index of the gutter between `tracks[boundary]` and
 * `tracks[boundary + 1]`. `deltaFr` is how much (in `fr` units) to move from the
 * right track to the left one (negative moves the other way). Both neighbours are
 * clamped so neither drops below `minRatio` of the row/column's total `fr`, so a
 * track can never collapse to zero or go negative. The total `fr` sum is
 * preserved, so other tracks are unaffected.
 */
export function resizeTrack(
  tracks: number[],
  boundary: number,
  deltaFr: number,
  minRatio = MIN_TRACK_FR_RATIO,
): number[] {
  if (boundary < 0 || boundary >= tracks.length - 1) return tracks;

  const total = tracks.reduce((a, b) => a + b, 0);
  const min = total * minRatio;
  const a = tracks[boundary];
  const b = tracks[boundary + 1];

  // Clamp the delta so both neighbours stay >= min.
  let d = deltaFr;
  d = Math.min(d, b - min); // don't shrink the right track below min
  d = Math.max(d, min - a); // don't shrink the left track below min

  const next = tracks.slice();
  next[boundary] = a + d;
  next[boundary + 1] = b - d;
  return next;
}
