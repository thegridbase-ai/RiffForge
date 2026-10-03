import { describe, it, expect } from 'vitest';
import {
  COMMON_SHAPES,
  countInteriorMutes,
  explainCost,
  nonPhysicalCost,
  noveltyScore,
  scoreTotal,
  scoreVoicing,
  shapeConstraintViolation,
  type ScoreContext
} from './playability';
import { findBestFingering } from './fingering';
import { DEFAULT_CALIBRATION, DEFAULT_HAND_PROFILE, allowedSpanMm, maxReachMm, profileFromCalibration } from './handProfile';
import { fingertipMm } from './geometry';
import { createRng } from './random';
import { fromRiffForgeTab, interiorMutes, shapeKey } from './shape';
import { E_STANDARD, DROP_D } from './tuning';
import { fromLegacyNotes, getFamily, relaxFamily } from './voicingSpec';
import { MUSICAL_TERMS, PHYSICAL_TERMS, PLAYABILITY_WEIGHTS, RIGHT_HAND_TERMS } from './weights';
import type { CostBreakdown, CostTermKey, Fingering, HandProfile, Shape, VoicingFamily } from './types';

const P = DEFAULT_HAND_PROFILE;
const L = P.scaleLengthMm;
const tip = (fret: number): number => fingertipMm(fret, L);

const tab = (text: string): Shape => {
  const shape = fromRiffForgeTab(text);
  if (!shape) throw new Error(`bad tab ${text}`);
  return shape;
};

const fingeringOf = (shape: Shape, profile: HandProfile = P): Fingering => {
  const result = findBestFingering(shape, profile);
  if (result.ok === false) throw new Error(`expected a fingering for ${shapeKey(shape)}: ${result.reason}`);
  return result.fingering;
};

const fam = (id: string): VoicingFamily => {
  const family = getFamily(id);
  if (!family) throw new Error(`missing family ${id}`);
  return family;
};

const ctxOf = (over: Partial<ScoreContext> = {}): ScoreContext => ({
  tuning: E_STANDARD,
  profile: P,
  rootPc: 4,
  distortion: true,
  context: 'strum',
  musical: true,
  ...over
});

const score = (text: string, over: Partial<ScoreContext> = {}): CostBreakdown =>
  scoreVoicing(tab(text), fingeringOf(tab(text)), ctxOf(over));

const term = (b: CostBreakdown, key: CostTermKey) => {
  const found = b.terms.find((t) => t.key === key);
  if (!found) throw new Error(`missing term ${key}`);
  return found;
};

/** Cost per term, for compact snapshot comparisons. */
const costs = (b: CostBreakdown): Record<string, number> =>
  Object.fromEntries(b.terms.map((t) => [t.key, Math.round(t.cost * 1e6) / 1e6]));

const ZERO_COSTS: Record<CostTermKey, number> = {
  reach: 0,
  pairStretch: 0,
  fingerCount: 0,
  pinky: 0,
  contortion: 0,
  interiorMutes: 0,
  position: 0,
  thumb: 0,
  barre: 0,
  stringSkips: 0,
  chugStrings: 0,
  lowMud: 0,
  doubledThird: 0,
  rootNotInBass: 0
};

const expectCosts = (b: CostBreakdown, expected: Partial<Record<CostTermKey, number>>): void => {
  const actual = costs(b);
  const want = { ...ZERO_COSTS, ...expected };
  for (const key of Object.keys(want) as CostTermKey[]) {
    expect(actual[key], key).toBeCloseTo(want[key], 6);
  }
};

const reachCost = (minFret: number, maxFret: number): number => {
  const ratio = (tip(maxFret) - tip(minFret)) / allowedSpanMm(P, minFret);
  return 3 * ratio * ratio;
};

describe('scoreVoicing structure', () => {
  const shapes = ['0 2 2 1 0 0', '0 2 4 0 0 0', '0 2 2 x x x', '3 x 0 0 0 3', 'x 3 2 0 1 0', '3 0 x x x x'];

  it('lists all 14 terms in weights.ts key order with buckets and weights from weights.ts', () => {
    const keys = Object.keys(PLAYABILITY_WEIGHTS);
    expect(keys).toEqual([...PHYSICAL_TERMS, ...RIGHT_HAND_TERMS, ...MUSICAL_TERMS]);
    for (const text of shapes) {
      for (const context of ['strum', 'chug'] as const) {
        for (const musical of [true, false]) {
          const b = score(text, { context, musical, family: fam('major') });
          expect(b.terms.map((t) => t.key)).toEqual(keys);
          for (const t of b.terms) {
            expect(t.bucket).toBe(PLAYABILITY_WEIGHTS[t.key].bucket);
            expect(t.weight).toBe(PLAYABILITY_WEIGHTS[t.key].weight);
            expect(t.normalized).toBeGreaterThanOrEqual(0);
            expect(t.normalized).toBeLessThanOrEqual(1);
            expect(t.cost).toBeCloseTo(t.normalized * t.weight, 12);
          }
        }
      }
    }
  });

  it('sums buckets and total from the terms', () => {
    for (const text of shapes) {
      const b = score(text, { context: 'chug', family: fam('sus2') });
      const sum = (bucket: string) => b.terms.filter((t) => t.bucket === bucket).reduce((s, t) => s + t.cost, 0);
      expect(b.physical).toBeCloseTo(sum('physical'), 12);
      expect(b.rightHand).toBeCloseTo(sum('rightHand'), 12);
      expect(b.musical).toBeCloseTo(sum('musical'), 12);
      expect(b.total).toBeCloseTo(b.physical + b.rightHand + b.musical, 12);
    }
  });

  it('keeps the physical bucket identical to the fingering breakdown', () => {
    for (const text of shapes) {
      const f = fingeringOf(tab(text));
      const b = scoreVoicing(tab(text), f, ctxOf());
      expect(b.physical).toBe(f.costBreakdown.total);
      expect(b.terms.slice(0, PHYSICAL_TERMS.length)).toEqual(f.costBreakdown.terms);
    }
  });

  it('scoreTotal and nonPhysicalCost match scoreVoicing bit for bit', () => {
    const rng = createRng('score-total');
    let checked = 0;
    for (let i = 0; i < 3000 && checked < 200; i++) {
      const shape = Array.from({ length: 6 }, () => (rng.chance(0.35) ? null : rng.int(0, 9)));
      const result = findBestFingering(shape, P);
      if (result.ok === false) continue;
      checked++;
      for (const over of [
        {},
        { context: 'chug' as const },
        { distortion: false },
        { musical: false },
        { rootPc: 0, family: fam('sus2') },
        { rootPc: 7, family: fam('major'), context: 'chug' as const }
      ]) {
        const ctx = ctxOf(over);
        const b = scoreVoicing(shape, result.fingering, ctx);
        expect(scoreTotal(shape, result.fingering, ctx)).toBe(b.total);
        expect(nonPhysicalCost(shape, ctx)).toBeCloseTo(b.rightHand + b.musical, 12);
      }
    }
    expect(checked).toBe(200);
  });

  it('countInteriorMutes matches shape.ts interiorMutes', () => {
    const rng = createRng('mutes');
    for (let i = 0; i < 300; i++) {
      const shape = Array.from({ length: rng.int(1, 8) }, () => (rng.chance(0.5) ? null : rng.int(0, 5)));
      expect(countInteriorMutes(shape)).toBe(interiorMutes(shape));
    }
  });

  it('does not alias the fingering terms', () => {
    const f = fingeringOf(tab('0 2 2 1 0 0'));
    const b = scoreVoicing(tab('0 2 2 1 0 0'), f, ctxOf());
    b.terms[0].cost = 99;
    expect(f.costBreakdown.terms[0].cost).not.toBe(99);
  });
});

describe('scoreVoicing snapshots (E standard, default hand)', () => {
  it('open E major 0 2 2 1 0 0', () => {
    const base = { reach: reachCost(1, 2), fingerCount: 0.75, position: 0.3 / 12 };
    expectCosts(score('0 2 2 1 0 0'), base);
    expectCosts(score('0 2 2 1 0 0', { distortion: false }), base);
    // chug: 0.5 * min(1, 5/5) + 0.5 * mean index 2.5 / 5 = 0.75, weight 0.5
    expectCosts(score('0 2 2 1 0 0', { context: 'chug' }), { ...base, chugStrings: 0.375 });
    expect(score('0 2 2 1 0 0').total).toBeCloseTo(reachCost(1, 2) + 0.75 + 0.025, 9);
  });

  it('Em(add9) 0 2 4 0 0 0 with the m(add9) family', () => {
    const family = fam('m_add9');
    const f = fingeringOf(tab('0 2 4 0 0 0'));
    expect(f.fingers).toEqual([null, 1, 3, null, null, null]);
    const base = { reach: reachCost(2, 4), fingerCount: 0.5, position: (0.3 * 2) / 12 };
    expectCosts(score('0 2 4 0 0 0', { family }), base);
    expectCosts(score('0 2 4 0 0 0', { family, distortion: false }), base);
    expectCosts(score('0 2 4 0 0 0', { family, context: 'chug' }), { ...base, chugStrings: 0.375 });
  });

  it('power chord 0 2 2 x x x', () => {
    const family = fam('power5');
    const base = { fingerCount: 0.5, position: (0.3 * 2) / 12 };
    expectCosts(score('0 2 2 x x x', { family }), base);
    expectCosts(score('0 2 2 x x x', { family, distortion: false }), base);
    // chug: 0.5 * (2/5) + 0.5 * (mean index 1 / 5) = 0.3, weight 0.5
    expectCosts(score('0 2 2 x x x', { family, context: 'chug' }), { ...base, chugStrings: 0.15 });
  });

  it('G major with an interior mute 3 x 0 0 0 3', () => {
    const ctx = { rootPc: 7, family: fam('major') };
    // interiorMutes 1 -> 0.5 * 1.5; stringSkips 1 -> 0.5 * 2
    const base = { fingerCount: 0.5, interiorMutes: 0.75, position: (0.3 * 3) / 12, stringSkips: 1 };
    expectCosts(score('3 x 0 0 0 3', ctx), base);
    expectCosts(score('3 x 0 0 0 3', { ...ctx, distortion: false }), base);
    // chug: 0.5 * (4/5) + 0.5 * (mean index 14/5 / 5) = 0.68, weight 0.5
    expectCosts(score('3 x 0 0 0 3', { ...ctx, context: 'chug' }), { ...base, chugStrings: 0.34 });
  });

  it('low-register mud only counts under distortion', () => {
    // G2 (43) and A2 (45): both below E3, 2 semitones apart -> 1 pair -> 0.5 * 2
    const ctx = { rootPc: 7 };
    const muddy = score('3 0 x x x x', ctx);
    expect(term(muddy, 'lowMud').raw).toBe(1);
    expect(term(muddy, 'lowMud').cost).toBeCloseTo(1, 12);
    const clean = score('3 0 x x x x', { ...ctx, distortion: false });
    expect(term(clean, 'lowMud').raw).toBe(1);
    expect(term(clean, 'lowMud').cost).toBe(0);
    expect(clean.total).toBeCloseTo(muddy.total - 1, 12);
  });

  it('counts muddy pairs below E3 and ignores fifths, octaves and notes from E3 up', () => {
    // G2 (43), A#2 (46), D3 (50): 43-46 and 46-50 are 3rds below E3, 43-50 is a 5th -> 2 pairs -> capped at 1
    const b = score('3 1 0 x x x', { rootPc: 7 });
    expect(term(b, 'lowMud').raw).toBe(2);
    expect(term(b, 'lowMud').cost).toBeCloseTo(2, 12);
    expect(term(score('0 2 2 x x x'), 'lowMud').raw).toBe(0);
    // E3 (52) is not below the threshold
    expect(term(score('x x 2 1 x x'), 'lowMud').raw).toBe(0);
    // Drop D D2 A2 D3: a fifth, an octave and a fourth
    const dropD = scoreVoicing(tab('0 0 0 x x x'), fingeringOf(tab('0 0 0 x x x')), ctxOf({ tuning: DROP_D, rootPc: 2 }));
    expect(term(dropD, 'lowMud').raw).toBe(0);
  });

  it('costs a doubled third', () => {
    // C major x 3 2 0 1 0: E3 and E4 -> one extra third
    const b = score('x 3 2 0 1 0', { rootPc: 0, family: fam('major') });
    expect(term(b, 'doubledThird').raw).toBe(1);
    expect(term(b, 'doubledThird').cost).toBeCloseTo(0.5, 12);
    expect(term(score('0 2 2 1 0 0'), 'doubledThird').raw).toBe(0);
  });

  it('costs a non-root bass only when the family prefers a bass interval', () => {
    // Dsus2 over A: x 0 0 2 3 0 -> bass A is the fifth of D
    const ctx = { rootPc: 2 };
    expect(term(score('x 0 0 2 3 0', { ...ctx, family: fam('sus2') }), 'rootNotInBass').cost).toBeCloseTo(0.5, 12);
    expect(term(score('x x 0 2 3 0', { ...ctx, family: fam('sus2') }), 'rootNotInBass').cost).toBe(0);
    expect(term(score('x 0 0 2 3 0', { ...ctx }), 'rootNotInBass').cost).toBe(0);
    const triad = score('x 0 0 2 3 2', { ...ctx, family: fam('major') });
    expect(term(triad, 'rootNotInBass').cost).toBe(0);
  });

  it('never costs a root-position voicing as "root not in the bass" when the preferred bass is another degree', () => {
    // A legacy C/G row relaxed to any bass keeps the 5th as its preferred bass
    const slash = relaxFamily(fromLegacyNotes(['G2', 'C3', 'E3'], 'C'))[0].family;
    expect(slash.bass).toBe('any');
    expect(slash.preferredBass).toBe(7);
    const ctx = { rootPc: 0, family: slash };
    // x 3 2 0 x x = C3 E3 G3: the root is in the bass
    expect(term(score('x 3 2 0 x x', ctx), 'rootNotInBass').cost).toBe(0);
    // x x 5 5 5 x = G3 C4 E4: the root is not in the bass, but this family never asked for it there
    expect(term(score('x x 5 5 5 x', ctx), 'rootNotInBass').cost).toBe(0);
  });

  it('drops the whole musical bucket when musical is off', () => {
    const on = score('x 3 2 0 1 0', { rootPc: 0, family: fam('sus2') });
    const off = score('x 3 2 0 1 0', { rootPc: 0, family: fam('sus2'), musical: false });
    expect(on.musical).toBeGreaterThan(0);
    expect(off.musical).toBe(0);
    expect(off.total).toBeCloseTo(off.physical + off.rightHand, 12);
    for (const key of MUSICAL_TERMS) expect(term(off, key).cost).toBe(0);
  });
});

describe('COMMON_SHAPES', () => {
  it('holds valid, unique 6-string shapes including the open chords and movable forms', () => {
    const keys = COMMON_SHAPES.map(shapeKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const shape of COMMON_SHAPES) {
      expect(shape.length).toBe(6);
      expect(shape.some((f) => f !== null)).toBe(true);
    }
    for (const text of ['0 2 2 1 0 0', 'x 3 2 0 1 0', '3 2 0 0 0 3', 'x x 0 2 3 2', '1 3 3 x x x', '1 3 3 2 1 1', 'x 1 3 3 2 1']) {
      expect(keys).toContain(text);
    }
  });
});

describe('noveltyScore', () => {
  it('is 0 for open E major and every common shape', () => {
    expect(noveltyScore(tab('0 2 2 1 0 0'))).toBe(0);
    for (const shape of COMMON_SHAPES) expect(noveltyScore(shape)).toBe(0);
  });

  it('matches movable references at any position', () => {
    expect(noveltyScore(tab('5 7 7 x x x'))).toBe(0);
    expect(noveltyScore(tab('x 7 9 9 8 7'))).toBe(0);
  });

  it('matches open-string references only as written', () => {
    expect(noveltyScore(tab('x 3 2 0 1 0'))).toBe(0);
    expect(noveltyScore(tab('x 5 4 0 3 0'))).toBeGreaterThan(0);
  });

  it('scores a weird cluster high', () => {
    // open strings ringing under a high fretted cluster
    expect(noveltyScore(tab('0 x 9 7 0 8'))).toBeGreaterThanOrEqual(0.5);
    expect(noveltyScore(tab('x 9 8 x 7 x'))).toBeGreaterThan(0.4);
    // close to the root-5 dominant shell x 1 x 1 3 x
    expect(noveltyScore(tab('x 9 x 8 10 x'))).toBeCloseTo(0.5 / 6, 12);
  });

  it('uses the signature distance: one string one fret off a reference costs 0.5 / 6', () => {
    const weird = tab('x 9 8 x 7 x');
    expect(noveltyScore(tab('x 10 8 x 7 x'), [weird])).toBeCloseTo(0.5 / 6, 12);
    expect(noveltyScore(tab('x 10 8 x 7 x'), [tab('x 4 3 x 2 x')])).toBeCloseTo(0.5 / 6, 12);
    // two frets off saturates at 1 for that string; a muted vs sounding string is 1
    expect(noveltyScore(tab('x 11 8 x 7 x'), [weird])).toBeCloseTo(1 / 6, 12);
    expect(noveltyScore(tab('x 9 8 x 7 7'), [weird])).toBeCloseTo(1 / 6, 12);
    // open-string references compare frets as written
    expect(noveltyScore(tab('0 x 9 7 0 9'), [tab('0 x 9 7 0 8')])).toBeCloseTo(0.5 / 6, 12);
  });

  it('treats extra reference shapes as known', () => {
    const weird = tab('x 9 8 x 7 x');
    expect(noveltyScore(weird, [weird])).toBe(0);
    expect(noveltyScore(weird, [tab('x 4 3 x 2 x')])).toBe(0);
    expect(noveltyScore(tab('0 x 9 7 0 8'), [tab('0 x 4 2 0 3')])).toBeGreaterThan(0);
  });

  it('compares extended-range shapes against references aligned to the top strings', () => {
    // 7-string B E A D G B E: open E major with the low B muted is the open E major shape
    expect(noveltyScore([null, 0, 2, 2, 1, 0, 0])).toBe(0);
    expect(noveltyScore([null, null, 3, 2, 0, 1, 0])).toBe(0);
    // movable references keep matching at any position
    expect(noveltyScore([null, 5, 7, 7, null, null, null])).toBe(0);
    // a sounding low string the reference does not have counts as one differing string
    expect(noveltyScore([0, 0, 2, 2, 1, 0, 0])).toBeCloseTo(1 / 7, 12);
    expect(noveltyScore([null, null, 0, 2, 2, 1, 0, 0])).toBe(0);
    // extra references of another length are aligned the same way
    expect(noveltyScore([null, 9, 8, null, 7, null, null], [tab('9 8 x 7 x x')])).toBe(0);
  });

  it('stays within 0..1 and is deterministic', () => {
    const rng = createRng('novelty');
    for (let i = 0; i < 300; i++) {
      const shape = Array.from({ length: 6 }, () => (rng.chance(0.3) ? null : rng.int(0, 15)));
      if (shape.every((f) => f === null)) continue;
      const n = noveltyScore(shape);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(noveltyScore(shape)).toBe(n);
    }
  });
});

describe('explainCost', () => {
  const explain = (text: string, over: Partial<ScoreContext> = {}): string[] => {
    const profile = over.profile ?? P;
    const f = fingeringOf(tab(text), profile);
    return explainCost(scoreVoicing(tab(text), f, ctxOf(over)), f, profile);
  };

  it('describes open E major in short phrases', () => {
    const lines = explain('0 2 2 1 0 0');
    expect(lines[0]).toBe('3 fingers');
    const ratio = (tip(2) - tip(1)) / allowedSpanMm(P, 1);
    expect(lines).toContain(`reach ${Math.round(ratio * 100)} percent of your comfort`);
    expect(lines.some((l) => l.includes('pinky'))).toBe(false);
  });

  it('measures reach against the comfortable reach, not the stretch allowance', () => {
    const stretchy = profileFromCalibration({ ...DEFAULT_CALIBRATION, allowStretches: true });
    expect(stretchy.stretchTolerance).toBeGreaterThan(1);
    // C4 + C#5 (b2 dyad on C): 102 mm at fret 5, inside the 1.1 stretch allowance but beyond the 93.5 mm comfort
    const span = tip(9) - tip(5);
    expect(span).toBeGreaterThan(maxReachMm(stretchy, 5));
    expect(span).toBeLessThanOrEqual(allowedSpanMm(stretchy, 5));
    const lines = explain('x x x 5 x 9', { profile: stretchy, rootPc: 0 });
    const pct = Math.round((span / maxReachMm(stretchy, 5)) * 100);
    expect(pct).toBe(109);
    expect(lines).toContain(`reach ${pct} percent of your comfort (a stretch)`);
    // 96 mm at fret 6 against 92 mm of comfort: printed 95 percent before, 104 percent now
    expect(explain('x x 10 6 x x', { profile: stretchy, rootPc: 0 })).toContain('reach 104 percent of your comfort (a stretch)');
    // inside the comfortable reach the phrase stays plain
    expect(explain('x x 7 6 x x', { profile: stretchy, rootPc: 0 }).find((l) => l.startsWith('reach'))).toMatch(
      /^reach \d+ percent of your comfort$/
    );
  });

  it('without a profile, names the allowed reach instead of claiming comfort', () => {
    const stretchy = profileFromCalibration({ ...DEFAULT_CALIBRATION, allowStretches: true });
    const f = fingeringOf(tab('x x x 5 x 9'), stretchy);
    const lines = explainCost(scoreVoicing(tab('x x x 5 x 9'), f, ctxOf({ profile: stretchy, rootPc: 0 })), f);
    expect(lines).toContain(`reach ${Math.round(f.metrics.reachRatio * 100)} percent of your allowed reach`);
    expect(lines.some((l) => l.includes('comfort'))).toBe(false);
  });

  it('does not report "root not in the bass" for a root-position voicing of a slash-bass recipe', () => {
    const slash = relaxFamily(fromLegacyNotes(['G2', 'C3', 'E3'], 'C'))[0].family;
    expect(explain('x 3 2 0 x x', { rootPc: 0, family: slash })).not.toContain('root not in the bass');
  });

  it('names interior mutes, skipped strings, pinky, mud, doubled thirds and the bass', () => {
    expect(explain('3 x 0 0 0 3', { rootPc: 7 })).toEqual(expect.arrayContaining(['2 fingers', '1 interior mute', '1 skipped string for the picking hand']));
    expect(explain('3 0 x x x x', { rootPc: 7 })).toContain('1 muddy low interval under gain');
    expect(explain('x 3 2 0 1 0', { rootPc: 0 })).toContain('doubled third');
    expect(explain('x 0 0 2 3 0', { rootPc: 2, family: fam('sus2') })).toContain('root not in the bass');
    expect(explain('x 2 4 4 x x', { rootPc: 11 })).toEqual(expect.arrayContaining(['3 fingers', 'uses pinky']));
    expect(explain('0 0 0 0 0 0')).toContain('open strings only');
  });

  it('never claims a voicing is safe', () => {
    const rng = createRng('explain');
    let checked = 0;
    for (let i = 0; i < 400 && checked < 150; i++) {
      const shape = Array.from({ length: 6 }, () => (rng.chance(0.4) ? null : rng.int(0, 7)));
      const result = findBestFingering(shape, P);
      if (result.ok === false) continue;
      for (const context of ['strum', 'chug'] as const) {
        const lines = explainCost(scoreVoicing(shape, result.fingering, ctxOf({ context })), result.fingering);
        for (const line of lines) {
          expect(line.toLowerCase()).not.toContain('safe');
          expect(line.length).toBeGreaterThan(0);
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('shapeConstraintViolation', () => {
  it('returns null for shapes inside the profile', () => {
    expect(shapeConstraintViolation(tab('0 2 2 1 0 0'), P)).toBeNull();
    expect(shapeConstraintViolation(tab('x 15 x x x x'), P)).toBeNull();
    expect(shapeConstraintViolation(tab('3 x 0 0 0 3'), P)).toBeNull();
  });

  it('flags max fret, open strings and interior mutes, in that order', () => {
    const closed = { ...P, allowOpenStrings: false };
    expect(shapeConstraintViolation(tab('x 16 x x x x'), P)).toBe('MAX_FRET');
    expect(shapeConstraintViolation(tab('0 2 2 1 0 0'), closed)).toBe('OPEN_STRINGS');
    expect(shapeConstraintViolation(tab('0 x x 2 x x'), P)).toBe('INTERIOR_MUTES');
    expect(shapeConstraintViolation(tab('0 x x 2 x x'), { ...P, maxInteriorMutes: 2 })).toBeNull();
    expect(shapeConstraintViolation(tab('0 x x 16 x x'), closed)).toBe('MAX_FRET');
    expect(shapeConstraintViolation(tab('0 x x 2 x x'), closed)).toBe('OPEN_STRINGS');
  });
});
