import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCALE_LENGTH_MM,
  SCALE_LENGTH_PRESETS,
  fretWireMm,
  fingertipMm,
  spanMm,
  highestReachableFret
} from './geometry';

const L = DEFAULT_SCALE_LENGTH_MM;

describe('fret wire distance', () => {
  it('uses 647.7 mm as the default scale', () => {
    expect(L).toBeCloseTo(647.7, 6);
  });

  it('puts the 12th fret at half the scale length', () => {
    expect(Math.abs(fretWireMm(12, L) - L / 2)).toBeLessThan(0.01);
    expect(Math.abs(fretWireMm(24, L) - (3 * L) / 4)).toBeLessThan(0.01);
    expect(fretWireMm(0, L)).toBe(0);
  });

  it('grows monotonically with shrinking fret widths', () => {
    for (let n = 1; n < 24; n++) {
      const width = fretWireMm(n, L) - fretWireMm(n - 1, L);
      const nextWidth = fretWireMm(n + 1, L) - fretWireMm(n, L);
      expect(nextWidth).toBeLessThan(width);
    }
  });
});

describe('fingertip model', () => {
  it('is 0 for open strings and sits behind the wire', () => {
    expect(fingertipMm(0, L)).toBe(0);
    const tip = fingertipMm(5, L);
    expect(tip).toBeGreaterThan(fretWireMm(4, L));
    expect(tip).toBeLessThan(fretWireMm(5, L));
  });

  it('matches the documented reference spans at 25.5"', () => {
    expect(spanMm(1, 4, L)).toBeCloseTo(98.98, 1);
    expect(spanMm(7, 11, L)).toBeCloseTo(90.77, 1);
  });

  it('makes fret 12 -> 17 shorter than fret 1 -> 4', () => {
    expect(spanMm(12, 17, L)).toBeLessThan(spanMm(1, 4, L));
  });

  it('scales with scale length', () => {
    const short = SCALE_LENGTH_PRESETS.find((p) => p.id === '24.75')!.mm;
    const long = SCALE_LENGTH_PRESETS.find((p) => p.id === '27')!.mm;
    expect(spanMm(1, 4, short)).toBeLessThan(spanMm(1, 4, long));
  });
});

describe('highestReachableFret', () => {
  it('reaches fret 4 from fret 1 with the default low reach', () => {
    expect(highestReachableFret(1, spanMm(1, 4, L), L)).toBe(4);
    expect(highestReachableFret(1, spanMm(1, 4, L) - 1, L)).toBe(3);
  });

  it('covers more frets higher up the neck for the same reach', () => {
    const reach = spanMm(1, 4, L);
    expect(highestReachableFret(12, reach, L) - 12).toBeGreaterThan(3);
  });

  it('respects the fret limit', () => {
    expect(highestReachableFret(20, 500, L, 22)).toBe(22);
  });
});
