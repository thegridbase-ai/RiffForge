import { describe, it, expect } from 'vitest';
import {
  findBestFingering,
  enumerateFingerings,
  physicalCostBreakdown,
  classifyShape,
  FINGER_NAMES,
  MIN_FINGER_SPACING_MM,
  THUMB_FRET_WINDOW
} from './fingering';
import { DEFAULT_HAND_PROFILE, allowedSpanMm, pairLimitFraction } from './handProfile';
import { fingertipMm, fretWireMm, spanMm } from './geometry';
import { fromRiffForgeTab } from './shape';
import { createRng } from './random';
import { PHYSICAL_TERMS, PLAYABILITY_WEIGHTS } from './weights';
import { generateVoicings } from './generateVoicings';
import { E_STANDARD, DROP_D } from './tuning';
import type { Fingering, FingeringMetrics, FingeringResult, FingerNumber, HandProfile, Shape } from './types';

const P = DEFAULT_HAND_PROFILE;
const L = P.scaleLengthMm;
const BARRE: HandProfile = { ...P, noBarre: false };
const PARTIAL: HandProfile = { ...P, allowTwoStringPartialBarre: true };
const THUMB: HandProfile = { ...P, allowThumb: true };

const tab = (text: string): Shape => {
  const shape = fromRiffForgeTab(text);
  if (!shape) throw new Error(`bad tab ${text}`);
  return shape;
};

const valid = (result: FingeringResult): Fingering => {
  if (result.ok === false) throw new Error(`expected a fingering, got ${result.reason}: ${result.detail}`);
  return result.fingering;
};

const reasonOf = (result: FingeringResult): string => (result.ok === false ? result.reason : 'OK');

const best = (text: string, profile: HandProfile = P): Fingering => valid(findBestFingering(tab(text), profile));

/**
 * Reference for the side-by-side rule: fretting fingers (thumb excluded) in hand order 1..4 each press inside
 * their own fret space, at least MIN_FINGER_SPACING_MM apart along the neck.
 */
const fitsSideBySide = (fretsInHandOrder: readonly number[], scaleLengthMm: number = L): boolean => {
  let pos = -Infinity;
  for (const fret of fretsInHandOrder) {
    pos = Math.max(fretWireMm(fret - 1, scaleLengthMm), pos + MIN_FINGER_SPACING_MM);
    if (pos > fretWireMm(fret, scaleLengthMm) + 1e-9) return false;
  }
  return true;
};

/** Frets of the distinct fretting fingers 1..4 in hand order, from a fingering. */
const handOrderFrets = (shape: Shape, fingers: readonly (FingerNumber | null)[]): number[] => {
  const fretOf = new Map<number, number>();
  fingers.forEach((finger, s) => {
    if (finger !== null && finger > 0) fretOf.set(finger, shape[s]!);
  });
  return [...fretOf.keys()].sort((a, b) => a - b).map((finger) => fretOf.get(finger)!);
};

const fretWidth = (fret: number): number => fretWireMm(fret, L) - fretWireMm(fret - 1, L);

describe('validation order', () => {
  it('rejects malformed shapes as INVALID_SHAPE', () => {
    expect(reasonOf(findBestFingering([], P))).toBe('INVALID_SHAPE');
    expect(reasonOf(findBestFingering([null, null, null, null, null, null], P))).toBe('INVALID_SHAPE');
    expect(reasonOf(findBestFingering([0, 1.5, 2, null, null, null], P))).toBe('INVALID_SHAPE');
    expect(reasonOf(findBestFingering([0, -1, 2, null, null, null], P))).toBe('INVALID_SHAPE');
  });

  it('rejects frets above profile.maxFret as FRET_RANGE', () => {
    expect(reasonOf(findBestFingering(tab('x 16 x x x x'), P))).toBe('FRET_RANGE');
    expect(reasonOf(findBestFingering(tab('x 16 x x x x'), { ...P, maxFret: 20 }))).toBe('OK');
    expect(reasonOf(findBestFingering(tab('x 15 x x x x'), P))).toBe('OK');
  });

  it('rejects open strings when the profile disallows them', () => {
    const closed = { ...P, allowOpenStrings: false };
    expect(reasonOf(findBestFingering(tab('0 2 2 1 0 0'), closed))).toBe('OPEN_STRINGS_DISALLOWED');
    expect(reasonOf(findBestFingering(tab('x 2 2 1 x x'), closed))).toBe('OK');
  });

  it('checks INVALID_SHAPE, then FRET_RANGE, then OPEN_STRINGS_DISALLOWED', () => {
    const closed = { ...P, allowOpenStrings: false };
    expect(reasonOf(findBestFingering(tab('0 16 x x x x'), closed))).toBe('FRET_RANGE');
    expect(reasonOf(findBestFingering([0, 16, -2, null, null, null], closed))).toBe('INVALID_SHAPE');
  });

  it('gives a human detail sentence on every rejection', () => {
    for (const shape of [tab('x 16 x x x x'), tab('x 1 x x 6 x'), tab('3 5 5 4 3 x'), [] as Shape]) {
      const result = findBestFingering(shape, P);
      expect(result.ok).toBe(false);
      if (result.ok === false) expect(result.detail.length).toBeGreaterThan(5);
    }
  });
});

describe('all-open shapes', () => {
  it('are valid with no fingers, no barres and zero metrics', () => {
    const f = best('0 0 0 0 0 0');
    expect(f.fingers).toEqual([null, null, null, null, null, null]);
    expect(f.barres).toEqual([]);
    expect(f.metrics).toEqual({
      frettedCount: 0,
      fingerCount: 0,
      spanMm: 0,
      allowedSpanMm: 0,
      reachRatio: 0,
      pairs: [],
      maxPairRatio: 0,
      maxPairStretch: 0,
      usesPinky: false,
      usesThumb: false,
      contortions: 0,
      interiorMutes: 0,
      lowestFret: null,
      highestFret: null
    });
    expect(f.costBreakdown.total).toBe(0);
  });

  it('still counts interior mutes from the shape', () => {
    expect(best('0 x 0 x x x').metrics.interiorMutes).toBe(1);
  });
});

describe('known chord shapes (no-barre default profile)', () => {
  it('open E major 0 2 2 1 0 0: index on G#, middle and ring on the 2nd fret', () => {
    const f = best('0 2 2 1 0 0');
    expect(f.fingers).toEqual([null, 2, 3, 1, null, null]);
    expect(f.barres).toEqual([]);
    expect(f.metrics.fingerCount).toBe(3);
    expect(f.metrics.frettedCount).toBe(3);
    expect(f.metrics.usesPinky).toBe(false);
    expect(f.metrics.contortions).toBe(0);
    expect(f.metrics.lowestFret).toBe(1);
    expect(f.metrics.highestFret).toBe(2);
  });

  it('C major x 3 2 0 1 0: classic 3-2-1 fingering', () => {
    expect(best('x 3 2 0 1 0').fingers).toEqual([null, 3, 2, null, 1, null]);
  });

  it('Em(add9) 0 2 4 0 0 0 is valid without a barre', () => {
    const f = best('0 2 4 0 0 0');
    expect(f.barres).toEqual([]);
    expect(f.fingers).toEqual([null, 1, 3, null, null, null]);
  });

  it('a single note goes to the index (lexicographic tie-break among equal costs)', () => {
    expect(best('x x x 5 x x').fingers).toEqual([null, null, null, 1, null, null]);
    const all = enumerateFingerings(tab('x x x 5 x x'), P).map((f) => f.fingers[3]);
    expect(all).toEqual([1, 2, 3, 4]);
  });

  it('rejects more than four fretted notes with NEEDS_BARRE', () => {
    const result = findBestFingering(tab('3 5 5 4 3 x'), P);
    expect(reasonOf(result)).toBe('NEEDS_BARRE');
  });

  it('rejects the F barre 1 3 3 2 1 1 with NEEDS_BARRE by default', () => {
    expect(reasonOf(findBestFingering(tab('1 3 3 2 1 1'), P))).toBe('NEEDS_BARRE');
  });
});

describe('reach', () => {
  it('rejects a wide shape x 1 x x 6 x with REACH and names the numbers', () => {
    const result = findBestFingering(tab('x 1 x x 6 x'), P);
    expect(reasonOf(result)).toBe('REACH');
    if (result.ok === false) expect(result.detail).toMatch(/span \d+ mm > allowed \d+ mm/);
  });

  it('accepts index fret 1 + pinky fret 4 (the calibrated span) and rejects fret 1 + fret 5', () => {
    const f = best('x 1 x x 4 x');
    expect(f.fingers).toEqual([null, 1, null, null, 4, null]);
    expect(f.metrics.reachRatio).toBeCloseTo(1, 9);
    expect(reasonOf(findBestFingering(tab('x 1 x x 5 x'), P))).toBe('REACH');
  });

  it('scales with the stretch tolerance', () => {
    expect(reasonOf(findBestFingering(tab('x 5 x x 9 x'), P))).toBe('REACH');
    expect(reasonOf(findBestFingering(tab('x 5 x x 9 x'), { ...P, stretchTolerance: 1.1 }))).toBe('OK');
  });

  it('ignores open strings for span and reach', () => {
    const f = best('0 x x x 3 0');
    expect(f.metrics.spanMm).toBe(0);
    expect(f.metrics.reachRatio).toBe(0);
    expect(f.metrics.allowedSpanMm).toBeCloseTo(allowedSpanMm(P, 3), 9);
  });

  it('fills span and allowed span from the fingertip model', () => {
    const f = best('0 2 2 1 0 0');
    expect(f.metrics.spanMm).toBeCloseTo(spanMm(1, 2, L), 9);
    expect(f.metrics.allowedSpanMm).toBeCloseTo(allowedSpanMm(P, 1), 9);
    expect(f.metrics.reachRatio).toBeCloseTo(spanMm(1, 2, L) / allowedSpanMm(P, 1), 9);
  });
});

describe('pair limits and stretch', () => {
  it('rejects x 1 1 3 3 x with PAIR_STRETCH because the middle-ring pair binds', () => {
    const result = findBestFingering(tab('x 1 1 3 3 x'), P);
    expect(reasonOf(result)).toBe('PAIR_STRETCH');
    if (result.ok === false) expect(result.detail).toContain('middle-ring');
    expect(enumerateFingerings(tab('x 1 1 3 3 x'), P)).toEqual([]);
  });

  it('fills every pair with distance, limit, ratio, natural spacing and stretch', () => {
    const f = best('x 3 2 0 1 0');
    const allowed = allowedSpanMm(P, 1);
    expect(f.metrics.pairs.map((p) => [p.from, p.to])).toEqual([
      [1, 2],
      [2, 3]
    ]);
    const [im, mr] = f.metrics.pairs;
    expect(im.distanceMm).toBeCloseTo(fingertipMm(2, L) - fingertipMm(1, L), 9);
    expect(im.limitMm).toBeCloseTo(pairLimitFraction(P, 1, 2) * allowed, 9);
    expect(im.ratio).toBeCloseTo(im.distanceMm / im.limitMm, 9);
    expect(im.naturalMm).toBeCloseTo(fingertipMm(2, L) - fingertipMm(1, L), 9);
    expect(im.stretch).toBe(0);
    expect(mr.limitMm).toBeCloseTo(pairLimitFraction(P, 2, 3) * allowed, 9);
    expect(f.metrics.maxPairRatio).toBeCloseTo(Math.max(im.ratio, mr.ratio), 12);
    expect(f.metrics.maxPairStretch).toBe(0);
  });

  it('computes stretch beyond the relaxed one-fret-per-finger spacing', () => {
    // Forced 1-2-3-4 with the middle finger two frets above the index at fret 11.
    const f = best('x 11 13 14 15 x', P);
    expect(f.fingers).toEqual([null, 1, 2, 3, 4, null]);
    const im = f.metrics.pairs[0];
    const natural = fingertipMm(12, L) - fingertipMm(11, L);
    const distance = fingertipMm(13, L) - fingertipMm(11, L);
    expect(im.naturalMm).toBeCloseTo(natural, 9);
    expect(im.stretch).toBeCloseTo(Math.min(1, (distance - natural) / (im.limitMm - natural)), 9);
    expect(im.stretch).toBeGreaterThan(0);
    expect(f.metrics.maxPairStretch).toBeCloseTo(Math.max(...f.metrics.pairs.map((p) => p.stretch)), 12);
  });

  it('marks a cramped pair (closer than the relaxed spacing) as zero stretch', () => {
    // Index fret 2 and pinky fret 4: natural spacing for 1 -> 4 is three frets, distance only two.
    const f = valid(findBestFingering(tab('x 2 x x 4 x'), P));
    for (const pair of f.metrics.pairs) {
      if (pair.distanceMm <= pair.naturalMm) expect(pair.stretch).toBe(0);
    }
  });

  it('skips fingers by summing adjacent limits (index + pinky at the calibrated span)', () => {
    const f = best('x 1 x x 4 x');
    expect(f.metrics.pairs).toHaveLength(1);
    expect(f.metrics.pairs[0].limitMm).toBeCloseTo(pairLimitFraction(P, 1, 4) * allowedSpanMm(P, 1), 9);
  });
});

describe('contortion', () => {
  it('counts a lower-numbered finger on a higher string at the same fret', () => {
    const all = enumerateFingerings(tab('0 2 2 1 0 0'), P);
    const crossed = all.find((f) => f.fingers.join() === [null, 3, 2, 1, null, null].join());
    expect(crossed).toBeDefined();
    expect(crossed!.metrics.contortions).toBe(1);
    const term = crossed!.costBreakdown.terms.find((t) => t.key === 'contortion')!;
    expect(term.normalized).toBeCloseTo(0.5, 12);
    expect(term.cost).toBeCloseTo(0.5 * PLAYABILITY_WEIGHTS.contortion.weight, 12);
  });

  it('allows a forced contortion in barre mode (index barre on high strings, middle on string 0)', () => {
    const f = best('3 4 4 0 3 3', BARRE);
    expect(f.fingers).toEqual([2, 3, 4, null, 1, 1]);
    expect(f.barres).toEqual([{ finger: 1, fret: 3, fromString: 4, toString: 5 }]);
    expect(f.metrics.contortions).toBe(1);
  });
});

describe('fingers side by side along the neck', () => {
  it('rejects four separate fingers stacked in one fret as NEEDS_BARRE (a barre in disguise)', () => {
    for (const text of ['x 1 1 1 1 x', '1 1 1 1 x x', '8 8 8 8 x x', 'x 13 13 13 13 x']) {
      const result = findBestFingering(tab(text), P);
      expect(reasonOf(result)).toBe('NEEDS_BARRE');
      if (result.ok === false) expect(result.detail).toMatch(/side by side/);
    }
  });

  it('fits three fingers in one fret only where the fret is wide enough', () => {
    expect(best('x 0 2 2 2 0').fingers).toEqual([null, null, 1, 2, 3, null]);
    expect(reasonOf(findBestFingering(tab('x 7 7 7 x x'), P))).toBe('OK');
    for (const text of ['x 10 10 10 x x', '13 13 13 x x x', 'x 15 15 15 x x']) {
      expect(reasonOf(findBestFingering(tab(text), P))).toBe('NEEDS_BARRE');
    }
    for (let fret = 1; fret <= 15; fret++) {
      const fits = fretWidth(fret) >= 2 * MIN_FINGER_SPACING_MM;
      expect(reasonOf(findBestFingering(tab(`x ${fret} ${fret} ${fret} x x`), P))).toBe(fits ? 'OK' : 'NEEDS_BARRE');
    }
  });

  it('never fits four fingers into one fret on a 25.5 inch scale', () => {
    for (let fret = 1; fret <= 24; fret++) expect(fretWidth(fret)).toBeLessThan(3 * MIN_FINGER_SPACING_MM);
  });

  it('counts neighbouring frets: four fingers do not squeeze into two narrow frets', () => {
    expect(reasonOf(findBestFingering(tab('x 14 14 15 15 x'), P))).toBe('NEEDS_BARRE');
    expect(best('x 2 2 3 3 x').fingers).toEqual([null, 1, 2, 3, 4, null]);
    expect(best('x 12 13 14 15 x').fingers).toEqual([null, 1, 2, 3, 4, null]);
  });

  it('lets a barre take over where separate fingers do not fit', () => {
    expect(best('x 13 13 13 13 x', BARRE).barres).toEqual([{ finger: 1, fret: 13, fromString: 1, toString: 4 }]);
    // Drop D one-finger power chord high up the neck.
    expect(reasonOf(findBestFingering(tab('10 10 10 x x x'), P))).toBe('NEEDS_BARRE');
    expect(best('10 10 10 x x x', BARRE).barres).toEqual([{ finger: 1, fret: 10, fromString: 0, toString: 2 }]);
  });

  it('does not let the generator stack more fingers in a fret than fit', () => {
    const add9 = generateVoicings({ root: 8, family: 'add9', tuning: E_STANDARD, profile: P, limit: 12 });
    const shapes = add9.voicings.map((v) => v.shape.map((f) => (f === null ? 'x' : String(f))).join(' '));
    expect(shapes).not.toContain('x 1 1 1 1 x');
    expect(shapes).not.toContain('x 13 13 13 13 x');
    for (const tuning of [E_STANDARD, DROP_D]) {
      for (const family of ['add9', 'quartal', 'major', 'sus2', 'power5']) {
        for (let root = 0; root < 12; root++) {
          for (const v of generateVoicings({ root, family, tuning, profile: P, limit: 12 }).voicings) {
            expect(fitsSideBySide(handOrderFrets(v.shape, v.fingering.fingers))).toBe(true);
          }
        }
      }
    }
  });
});

describe('barre mode (noBarre = false)', () => {
  it('accepts the F barre 1 3 3 2 1 1 with an index barre over strings 0..5', () => {
    const f = best('1 3 3 2 1 1', BARRE);
    expect(f.barres).toEqual([{ finger: 1, fret: 1, fromString: 0, toString: 5 }]);
    expect(f.fingers).toEqual([1, 3, 4, 2, 1, 1]);
    expect(f.metrics.fingerCount).toBe(4);
    const barreTerm = f.costBreakdown.terms.find((t) => t.key === 'barre')!;
    expect(barreTerm.raw).toBe(1);
    expect(barreTerm.cost).toBeCloseTo(PLAYABILITY_WEIGHTS.barre.weight, 12);
  });

  it('never lets a barre cover an open or muted string', () => {
    for (const text of ['3 4 4 0 3 3', '3 4 4 x 3 3']) {
      for (const f of enumerateFingerings(tab(text), BARRE)) {
        for (const b of f.barres) {
          for (let s = b.fromString; s <= b.toString; s++) {
            const fret = tab(text)[s];
            expect(fret).not.toBeNull();
            expect(fret).toBeGreaterThanOrEqual(b.fret);
          }
        }
      }
    }
  });

  it('keeps fingers off strings the barre already sounds', () => {
    for (const f of enumerateFingerings(tab('1 3 3 2 1 1'), BARRE)) {
      for (const b of f.barres) {
        for (let s = b.fromString; s <= b.toString; s++) {
          if (tab('1 3 3 2 1 1')[s] === b.fret) expect(f.fingers[s]).toBe(b.finger);
        }
      }
    }
  });

  it('still prefers a barre-free fingering when one exists', () => {
    expect(best('0 2 2 1 0 0', BARRE)).toEqual(best('0 2 2 1 0 0', P));
  });

  it('rejects NEEDS_BARRE when neither the index barre nor a mini-barre leaves enough fingers', () => {
    // No two adjacent strings share a fret above the index barre, so nothing can flatten.
    expect(reasonOf(findBestFingering(tab('1 1 3 4 3 4'), BARRE))).toBe('NEEDS_BARRE');
  });

  it('plays the A-shape barre at every position (index barre plus ring mini-barre or 2-3-4)', () => {
    const ringMini = [null, 1, 3, 3, 3, 1];
    for (let n = 1; n <= 12; n++) {
      const f = best(`x ${n} ${n + 2} ${n + 2} ${n + 2} ${n}`, BARRE);
      expect(f.barres[0]).toEqual({ finger: 1, fret: n, fromString: 1, toString: 5 });
      expect([ringMini, [null, 1, 2, 3, 4, 1]]).toContainEqual(f.fingers);
      // Where three separate fingers do not fit in fret n + 2, the ring must flatten.
      if (!fitsSideBySide([n + 2, n + 2, n + 2])) {
        expect(f.fingers).toEqual(ringMini);
        expect(f.barres[1]).toEqual({ finger: 3, fret: n + 2, fromString: 2, toString: 4 });
      }
    }
    // Near the nut the two-fret index-middle gap of 2-3-4 is past the default pair limit.
    expect(best('x 1 3 3 3 1', BARRE).fingers).toEqual(ringMini);
    expect(reasonOf(findBestFingering(tab('x 5 7 7 7 5'), BARRE))).toBe('OK');
  });

  it('flattens a non-index finger only when separate fingers cannot play the shape', () => {
    // F barre: ring and pinky fit, so no mini-barre.
    expect(best('1 3 3 2 1 1', BARRE).fingers).toEqual([1, 3, 4, 2, 1, 1]);
    // Too many notes for separate fingers above a two-string index barre: the ring flattens.
    const f = best('1 1 3 3 3 3', BARRE);
    expect(f.barres[0]).toEqual({ finger: 1, fret: 1, fromString: 0, toString: 1 });
    expect(f.barres.slice(1).every((b) => b.finger !== 1)).toBe(true);
    // Every enumerated mini-barre covers two or three adjacent strings that share its fret.
    for (const shape of [tab('1 1 3 3 3 3'), tab('x 1 3 3 3 3'), tab('x 3 5 5 5 3')]) {
      const all = enumerateFingerings(shape, BARRE);
      expect(all.length).toBeGreaterThan(0);
      for (const g of all) {
        for (const b of g.barres.filter((x) => x.finger !== 1)) {
          expect(b.toString - b.fromString).toBeGreaterThanOrEqual(1);
          expect(b.toString - b.fromString).toBeLessThanOrEqual(2);
          for (let s = b.fromString; s <= b.toString; s++) expect(shape[s]).toBe(b.fret);
        }
      }
    }
  });

  it('never flattens a finger in no-barre mode', () => {
    expect(reasonOf(findBestFingering(tab('x 3 5 5 5 3'), P))).toBe('NEEDS_BARRE');
    expect(reasonOf(findBestFingering(tab('x 13 13 13 x x'), P))).toBe('NEEDS_BARRE');
  });

  it('combines an index barre with two-string partial barres when allowed', () => {
    const f = best('1 1 3 3 3 3', { ...BARRE, allowTwoStringPartialBarre: true });
    expect(f.fingers).toEqual([1, 1, 3, 3, 4, 4]);
    expect(f.barres).toEqual([
      { finger: 1, fret: 1, fromString: 0, toString: 1 },
      { finger: 3, fret: 3, fromString: 2, toString: 3 },
      { finger: 4, fret: 3, fromString: 4, toString: 5 }
    ]);
    expect(f.costBreakdown.terms.find((t) => t.key === 'barre')!.normalized).toBe(1);
  });

  it('still enforces reach in barre mode', () => {
    expect(reasonOf(findBestFingering(tab('1 6 6 x 1 1'), BARRE))).toBe('REACH');
  });
});

describe('two-string partial barre mode', () => {
  it('lets one finger cover two adjacent strings at the same fret', () => {
    const shape = tab('x 3 5 5 4 3');
    expect(reasonOf(findBestFingering(shape, P))).toBe('NEEDS_BARRE');
    const f = valid(findBestFingering(shape, PARTIAL));
    expect(f.fingers).toEqual([null, 1, 4, 4, 3, 2]);
    expect(f.barres).toEqual([{ finger: 4, fret: 5, fromString: 2, toString: 3 }]);
    expect(f.metrics.fingerCount).toBe(4);
  });

  it('does not allow non-adjacent strings to share a finger', () => {
    expect(reasonOf(findBestFingering(tab('3 5 3 5 4 x'), PARTIAL))).toBe('NEEDS_BARRE');
  });

  it('does not use a partial barre when separate fingers are cheaper', () => {
    expect(best('x 2 2 x x x', PARTIAL).barres).toEqual([]);
  });
});

describe('thumb mode', () => {
  it('lets the thumb fret string 0 so a fifth note fits (2 x 4 4 3 5)', () => {
    const shape = tab('2 x 4 4 3 5');
    expect(reasonOf(findBestFingering(shape, P))).toBe('NEEDS_BARRE');
    const f = valid(findBestFingering(shape, THUMB));
    expect(f.fingers).toEqual([0, null, 2, 3, 1, 4]);
    expect(f.metrics.usesThumb).toBe(true);
    expect(f.metrics.fingerCount).toBe(5);
    // Thumb excluded from reach: span runs from fret 3 to fret 5.
    expect(f.metrics.spanMm).toBeCloseTo(spanMm(3, 5, L), 9);
    expect(f.metrics.allowedSpanMm).toBeCloseTo(allowedSpanMm(P, 3), 9);
    expect(f.metrics.pairs.every((p) => p.from >= 1)).toBe(true);
    expect(f.costBreakdown.terms.find((t) => t.key === 'thumb')!.cost).toBeCloseTo(PLAYABILITY_WEIGHTS.thumb.weight, 12);
  });

  it(`keeps the thumb within ${THUMB_FRET_WINDOW} fret of the lowest finger`, () => {
    const result = findBestFingering(tab('1 x 4 4 3 5'), THUMB);
    expect(reasonOf(result)).toBe('NEEDS_BARRE');
    if (result.ok === false) expect(result.detail).toContain('thumb');
  });

  it('uses the thumb when it relieves a long reach (2 x x 3 4 5)', () => {
    const f = best('2 x x 3 4 5', THUMB);
    expect(f.fingers).toEqual([0, null, null, 1, 2, 3]);
    expect(best('2 x x 3 4 5', P).fingers).toEqual([1, null, null, 2, 3, 4]);
  });

  it('never puts the thumb on any string but string 0', () => {
    for (const f of enumerateFingerings(tab('x 2 x 3 4 5'), THUMB)) {
      expect(f.fingers.includes(0)).toBe(false);
    }
  });
});

describe('physical cost breakdown', () => {
  it('always lists the nine physical terms in PHYSICAL_TERMS order with weights.ts weights', () => {
    for (const text of ['0 0 0 0 0 0', '0 2 2 1 0 0', 'x 3 2 0 1 0']) {
      const { costBreakdown } = best(text);
      expect(costBreakdown.terms.map((t) => t.key)).toEqual([...PHYSICAL_TERMS]);
      for (const term of costBreakdown.terms) {
        expect(term.bucket).toBe('physical');
        expect(term.weight).toBe(PLAYABILITY_WEIGHTS[term.key].weight);
        expect(term.cost).toBeCloseTo(term.normalized * term.weight, 12);
        expect(term.normalized).toBeGreaterThanOrEqual(0);
        expect(term.normalized).toBeLessThanOrEqual(1);
      }
      const sum = costBreakdown.terms.reduce((acc, t) => acc + t.cost, 0);
      expect(costBreakdown.total).toBeCloseTo(sum, 12);
      expect(costBreakdown.physical).toBe(costBreakdown.total);
      expect(costBreakdown.rightHand).toBe(0);
      expect(costBreakdown.musical).toBe(0);
    }
  });

  it('normalizes open E major as documented', () => {
    const f = best('0 2 2 1 0 0');
    const n = Object.fromEntries(f.costBreakdown.terms.map((t) => [t.key, t.normalized]));
    expect(n.reach).toBeCloseTo(f.metrics.reachRatio ** 2, 12);
    expect(n.pairStretch).toBe(0);
    expect(n.fingerCount).toBeCloseTo(0.75, 12);
    expect(n.pinky).toBe(0);
    expect(n.contortion).toBe(0);
    expect(n.interiorMutes).toBe(0);
    expect(n.position).toBeCloseTo(1 / 12, 12);
    expect(n.thumb).toBe(0);
    expect(n.barre).toBe(0);
  });

  it('maps raw metrics through the documented formulas and clamps to 0..1', () => {
    const metrics: FingeringMetrics = {
      frettedCount: 5,
      fingerCount: 5,
      spanMm: 50,
      allowedSpanMm: 100,
      reachRatio: 0.5,
      pairs: [],
      maxPairRatio: 0.9,
      maxPairStretch: 0.4,
      usesPinky: true,
      usesThumb: true,
      contortions: 3,
      interiorMutes: 1,
      lowestFret: 18,
      highestFret: 20
    };
    const barres = [
      { finger: 1 as const, fret: 18, fromString: 0, toString: 1 },
      { finger: 3 as const, fret: 20, fromString: 2, toString: 3 }
    ];
    const fingers: (FingerNumber | null)[] = [0, 1, 3, 3, 2, null];
    const b = physicalCostBreakdown([18, 18, 20, 20, 19, null], fingers, barres, metrics);
    const byKey = Object.fromEntries(b.terms.map((t) => [t.key, t]));
    expect(byKey.reach.normalized).toBeCloseTo(0.25, 12);
    expect(byKey.pairStretch.normalized).toBeCloseTo(0.16, 12);
    expect(byKey.fingerCount.raw).toBe(5);
    expect(byKey.fingerCount.normalized).toBe(1);
    expect(byKey.pinky.normalized).toBe(1);
    expect(byKey.contortion.raw).toBe(3);
    expect(byKey.contortion.normalized).toBe(1);
    expect(byKey.interiorMutes.normalized).toBeCloseTo(0.5, 12);
    expect(byKey.position.raw).toBe(18);
    expect(byKey.position.normalized).toBe(1);
    expect(byKey.thumb.normalized).toBe(1);
    expect(byKey.barre.raw).toBe(2);
    expect(byKey.barre.normalized).toBe(1);
  });

  it('uses position 0 when there is no fretted note', () => {
    const metrics = best('0 0 0 0 0 0').metrics;
    const b = physicalCostBreakdown([0, 0, 0, 0, 0, 0], new Array<FingerNumber | null>(6).fill(null), [], metrics);
    expect(b.terms.find((t) => t.key === 'position')!.raw).toBe(0);
  });

  it('is the cost the best fingering minimizes', () => {
    for (const text of ['0 2 2 1 0 0', 'x 3 2 0 1 0', 'x 5 7 7 6 x', '1 3 3 2 1 1']) {
      for (const profile of [P, BARRE, PARTIAL, THUMB]) {
        const all = enumerateFingerings(tab(text), profile);
        if (all.length === 0) continue;
        const result = valid(findBestFingering(tab(text), profile));
        expect(result).toEqual(all[0]);
        for (let i = 1; i < all.length; i++) {
          expect(all[i].costBreakdown.total).toBeGreaterThanOrEqual(all[i - 1].costBreakdown.total);
        }
        for (const f of all) {
          expect(f.costBreakdown).toEqual(physicalCostBreakdown(tab(text), f.fingers, f.barres, f.metrics));
        }
      }
    }
  });
});

describe('classifyShape', () => {
  it('classifies the F barre as needing a barre with an index barre fingering', () => {
    const c = classifyShape(tab('1 3 3 2 1 1'), P);
    expect(c.needsBarre).toBe(true);
    expect(reasonOf(c.noBarre)).toBe('NEEDS_BARRE');
    expect(valid(c.withBarre).barres).toEqual([{ finger: 1, fret: 1, fromString: 0, toString: 5 }]);
  });

  it('classifies open shapes as barre-free in both modes', () => {
    const c = classifyShape(tab('0 2 2 1 0 0'), BARRE);
    expect(c.needsBarre).toBe(false);
    expect(valid(c.noBarre).fingers).toEqual([null, 2, 3, 1, null, null]);
    expect(valid(c.withBarre).barres).toEqual([]);
  });

  it('flags a shape that only a barre makes playable for this hand', () => {
    const c = classifyShape(tab('x 1 1 3 3 x'), P);
    expect(reasonOf(c.noBarre)).toBe('PAIR_STRETCH');
    expect(valid(c.withBarre).barres).toEqual([{ finger: 1, fret: 1, fromString: 1, toString: 2 }]);
    expect(c.needsBarre).toBe(true);
  });

  it('does not blame a barre when the shape is simply out of reach', () => {
    const c = classifyShape(tab('x 1 x x 6 x'), P);
    expect(reasonOf(c.noBarre)).toBe('REACH');
    expect(reasonOf(c.withBarre)).toBe('REACH');
    expect(c.needsBarre).toBe(false);
  });

  it('classifies the A-shape barre x 3 5 5 5 3 as playable with a barre', () => {
    const c = classifyShape(tab('x 3 5 5 5 3'), P);
    expect(c.needsBarre).toBe(true);
    expect(reasonOf(c.noBarre)).toBe('NEEDS_BARRE');
    expect(valid(c.withBarre).barres[0]).toEqual({ finger: 1, fret: 3, fromString: 1, toString: 5 });
  });

  it('applies reach limits in barre mode too', () => {
    const c = classifyShape(tab('1 6 6 x 1 1'), P);
    expect(c.needsBarre).toBe(true);
    expect(reasonOf(c.withBarre)).toBe('REACH');
  });
});

describe('exhaustive search matches a brute-force reference (no-barre default profile)', () => {
  // Independent reimplementation of the rules over all 4^k finger functions.
  const reference = (shape: Shape, profile: HandProfile): { valid: string[]; reason: string } => {
    const notes = shape.flatMap((f, s) => (f !== null && f > 0 ? [{ s, f }] : []));
    if (notes.length > 4) return { valid: [], reason: 'NEEDS_BARRE' };
    const out: string[] = [];
    let crossingFree = false;
    let fits = false;
    let reachOk = false;
    const total = 4 ** notes.length;
    for (let code = 0; code < total; code++) {
      const fingers = notes.map((_, i) => 1 + (Math.floor(code / 4 ** i) % 4));
      if (new Set(fingers).size !== fingers.length) continue;
      const fretOf = new Map(fingers.map((finger, i) => [finger, notes[i].f]));
      const order = [...fretOf.keys()].sort((a, b) => a - b);
      if (order.some((finger, i) => i > 0 && fretOf.get(finger)! < fretOf.get(order[i - 1])!)) continue;
      crossingFree = true;
      if (!fitsSideBySide(order.map((finger) => fretOf.get(finger)!), profile.scaleLengthMm)) continue;
      fits = true;
      if (notes.length > 0) {
        const lo = Math.min(...notes.map((n) => n.f));
        const hi = Math.max(...notes.map((n) => n.f));
        const allowed = allowedSpanMm(profile, lo);
        if (spanMm(lo, hi, profile.scaleLengthMm) > allowed + 1e-9) continue;
        reachOk = true;
        const pairOk = order.every((finger, i) => {
          if (i === 0) return true;
          const a = order[i - 1];
          const distance = fingertipMm(fretOf.get(finger)!, profile.scaleLengthMm) - fingertipMm(fretOf.get(a)!, profile.scaleLengthMm);
          const limit = pairLimitFraction(profile, a as FingerNumber, finger as FingerNumber) * allowed;
          return distance / limit <= 1 + 1e-9;
        });
        if (!pairOk) continue;
      } else {
        reachOk = true;
      }
      const perString = shape.map(() => 'x');
      notes.forEach((n, i) => (perString[n.s] = String(fingers[i])));
      out.push(perString.join(''));
    }
    const reason =
      out.length > 0 ? 'OK' : !crossingFree ? 'FINGER_CROSSING' : !fits ? 'NEEDS_BARRE' : !reachOk ? 'REACH' : 'PAIR_STRETCH';
    return { valid: out.sort(), reason };
  };

  const key = (f: Fingering): string => f.fingers.map((x) => (x === null ? 'x' : String(x))).join('');

  it('finds exactly the legal assignments and the same rejection reason on 400 random shapes', () => {
    const rng = createRng('fingering-reference');
    let validCount = 0;
    for (let n = 0; n < 400; n++) {
      const window = rng.int(1, 10);
      const shape: (number | null)[] = Array.from({ length: 6 }, () => {
        const r = rng.next();
        if (r < 0.35) return null;
        if (r < 0.5) return 0;
        return rng.int(window, window + 5);
      });
      if (!shape.some((f) => f !== null)) shape[0] = 0;
      const ref = reference(shape, P);
      const all = enumerateFingerings(shape, P);
      expect(all.map(key).sort()).toEqual(ref.valid);
      expect(reasonOf(findBestFingering(shape, P))).toBe(ref.reason);
      if (ref.reason === 'OK') validCount++;
    }
    // Make sure the sample exercises both outcomes.
    expect(validCount).toBeGreaterThan(50);
    expect(validCount).toBeLessThan(380);
  });

  it('never returns a barre, a repeated finger, a crossing or a broken limit in no-barre mode', () => {
    const rng = createRng('fingering-invariants');
    for (let n = 0; n < 300; n++) {
      const w = rng.int(1, 11);
      const shape = Array.from({ length: 6 }, () => (rng.chance(0.4) ? null : rng.int(w, w + 4)));
      if (shape.every((f) => f === null)) continue;
      const result = findBestFingering(shape, P);
      if (!result.ok) continue;
      const { fingers, barres, metrics } = result.fingering;
      expect(barres).toEqual([]);
      const used = fingers.filter((f) => f !== null);
      expect(new Set(used).size).toBe(used.length);
      expect(used.every((f) => f! >= 1 && f! <= 4)).toBe(true);
      const byFinger = fingers
        .map((f, s) => ({ f, fret: shape[s] }))
        .filter((x) => x.f !== null)
        .sort((a, b) => a.f! - b.f!);
      for (let i = 1; i < byFinger.length; i++) expect(byFinger[i].fret!).toBeGreaterThanOrEqual(byFinger[i - 1].fret!);
      expect(metrics.reachRatio).toBeLessThanOrEqual(1 + 1e-9);
      for (const pair of metrics.pairs) expect(pair.ratio).toBeLessThanOrEqual(1 + 1e-9);
      expect(fitsSideBySide(byFinger.map((x) => x.fret!))).toBe(true);
    }
  });
});

describe('determinism and naming', () => {
  it('returns deep-equal results for repeated calls', () => {
    for (const text of ['0 2 2 1 0 0', '1 3 3 2 1 1', 'x 1 1 3 3 x', 'x 3 5 5 4 3']) {
      for (const profile of [P, BARRE, PARTIAL, THUMB]) {
        expect(findBestFingering(tab(text), profile)).toEqual(findBestFingering(tab(text), profile));
        expect(enumerateFingerings(tab(text), profile)).toEqual(enumerateFingerings(tab(text), profile));
      }
    }
  });

  it('names fingers 0..4', () => {
    expect(FINGER_NAMES).toEqual(['thumb', 'index', 'middle', 'ring', 'pinky']);
  });
});

describe('performance', () => {
  it('runs 10,000 findBestFingering calls on typical 3-4 note shapes in under 500 ms', () => {
    const shapes = [
      '0 2 2 1 0 0',
      'x 3 2 0 1 0',
      '0 2 4 0 0 0',
      'x 5 7 7 x x',
      '3 5 5 x x x',
      'x x 7 9 10 x',
      'x 12 14 14 x x',
      '5 x 7 7 5 x',
      'x 1 1 3 3 x',
      'x 7 9 9 8 x',
      '3 x 4 5 x x',
      'x x 10 12 13 12'
    ].map(tab);
    for (let i = 0; i < 2000; i++) findBestFingering(shapes[i % shapes.length], P);
    const start = performance.now();
    let valid = 0;
    for (let i = 0; i < 10000; i++) if (findBestFingering(shapes[i % shapes.length], P).ok) valid++;
    const elapsed = performance.now() - start;
    expect(valid).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });
});
