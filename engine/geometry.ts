// Neck geometry. Distances are millimetres along the neck from the nut.

export const MM_PER_INCH = 25.4;

/** Fender-style 25.5" scale. */
export const DEFAULT_SCALE_LENGTH_MM = 25.5 * MM_PER_INCH;

export const SCALE_LENGTH_PRESETS: readonly { id: string; label: string; mm: number }[] = [
  { id: '24.75', label: '24.75"', mm: 24.75 * MM_PER_INCH },
  { id: '25.5', label: '25.5"', mm: 25.5 * MM_PER_INCH },
  { id: '26.5', label: '26.5"', mm: 26.5 * MM_PER_INCH },
  { id: '27', label: '27"', mm: 27 * MM_PER_INCH }
];

/** Model: the fingertip presses 70 percent of the way from the previous fret wire to this one. */
export const FINGERTIP_FRACTION = 0.7;

/** Approximate centre-to-centre string spacing at mid-neck. Used only for minor lateral costs. */
export const DEFAULT_STRING_SPACING_MM = 10.5;

/** Distance from the nut to fret wire n: d(n) = L - L / 2^(n/12). */
export const fretWireMm = (fret: number, scaleLengthMm: number): number =>
  scaleLengthMm - scaleLengthMm / Math.pow(2, fret / 12);

/** Fingertip position for a note at `fret`; 0 for open strings. */
export const fingertipMm = (fret: number, scaleLengthMm: number): number => {
  if (fret <= 0) return 0;
  const prev = fretWireMm(fret - 1, scaleLengthMm);
  return prev + FINGERTIP_FRACTION * (fretWireMm(fret, scaleLengthMm) - prev);
};

/** Fingertip distance between two fretted notes (order-independent). */
export const spanMm = (fretA: number, fretB: number, scaleLengthMm: number): number =>
  Math.abs(fingertipMm(fretB, scaleLengthMm) - fingertipMm(fretA, scaleLengthMm));

/** Highest fret reachable from `fromFret` within `reachMm` of fingertip travel (>= fromFret). */
export const highestReachableFret = (
  fromFret: number,
  reachMm: number,
  scaleLengthMm: number,
  limitFret = 36
): number => {
  const start = Math.max(1, fromFret);
  const origin = fingertipMm(start, scaleLengthMm);
  let fret = start;
  while (fret + 1 <= limitFret && fingertipMm(fret + 1, scaleLengthMm) - origin <= reachMm + 1e-9) {
    fret++;
  }
  return fret;
};
