import { describe, it, expect } from 'vitest';
import { SEED_JITTER, findClosestVoicing, generateVoicings, resolveFamilyId, structurallyUnfingerable } from './generateVoicings';
import { findBestFingering } from './fingering';
import { DEFAULT_CALIBRATION, DEFAULT_HAND_PROFILE, allowedSpanMm, profileFromCalibration } from './handProfile';
import { degreeString } from './naming';
import { shapeConstraintViolation } from './playability';
import { createRng, mulberry32, seedFromString } from './random';
import { fromRiffForgeTab, shapeKey, shapeToMidi, toRiffForgeTab } from './shape';
import { DROP_D, E_STANDARD } from './tuning';
import { getFamily, matchFamily, relaxFamily } from './voicingSpec';
import type { GeneratedVoicing, GenerateParams, HandProfile, VoicingFamily } from './types';

const P = DEFAULT_HAND_PROFILE;

const gen = (over: Partial<GenerateParams> = {}) =>
  generateVoicings({ root: 'E', family: 'power5', tuning: E_STANDARD, profile: P, ...over });

/** Every playable shape, in plain sort order. */
const all = (over: Partial<GenerateParams> = {}) => gen({ limit: 100000, diversify: false, ...over });

const keys = (voicings: readonly GeneratedVoicing[]): string[] => voicings.map((v) => toRiffForgeTab(v.shape));

const fam = (id: string): VoicingFamily => {
  const family = getFamily(id);
  if (!family) throw new Error(`missing family ${id}`);
  return family;
};

const frettedCount = (v: GeneratedVoicing): number => v.shape.filter((f) => f !== null && f > 0).length;

const stringMask = (v: GeneratedVoicing): number => v.shape.reduce<number>((m, f, s) => (f === null ? m : m | (1 << s)), 0);

const nearDuplicatePairs = (voicings: readonly GeneratedVoicing[]): number => {
  let pairs = 0;
  for (let i = 0; i < voicings.length; i++) {
    for (let j = i + 1; j < voicings.length; j++) {
      const a = voicings[i].fingering.metrics.lowestFret ?? 0;
      const b = voicings[j].fingering.metrics.lowestFret ?? 0;
      if (Math.abs(a - b) <= 2 && stringMask(voicings[i]) === stringMask(voicings[j])) pairs++;
    }
  }
  return pairs;
};

describe('generateVoicings: M1 cases', () => {
  it('m_add9 at G never returns the barre 3 5 7 3 3 3 or more than 4 fretted notes', () => {
    const result = all({ root: 'G', family: 'm_add9' });
    expect(result.voicings.length).toBeGreaterThan(0);
    expect(keys(result.voicings)).not.toContain('3 5 7 3 3 3');
    for (const v of result.voicings) {
      expect(frettedCount(v)).toBeLessThanOrEqual(4);
      expect(v.fingering.barres).toEqual([]);
    }
    expect(keys(gen({ root: 'G', family: 'm_add9' }).voicings)).not.toContain('3 5 7 3 3 3');
  });

  it('Drop D power5 at D starts with 0 0 0 x x x, sounding D2 A2 D3', () => {
    const result = gen({ root: 'D', tuning: DROP_D });
    const first = result.voicings[0];
    expect(toRiffForgeTab(first.shape)).toBe('0 0 0 x x x');
    expect(first.midi).toEqual([38, 45, 50]);
    expect(first.degrees).toBe('1 5 1');
    expect(first.symbol).toBe('D5');
    expect(first.tags).toEqual(['pedalCompatible', 'usesOpenStrings', 'rootInBass', 'lowStrings']);
    expect(first.cost).toBe(0);
  });

  it('includes the all-open window', () => {
    expect(keys(all({ root: 'E', family: 'fourth' }).voicings)).toContain('0 0 x x x x');
  });

  it('Em(add9) 0 2 4 0 0 0 is a valid no-barre m_add9 voicing at E', () => {
    const fingering = findBestFingering([0, 2, 4, 0, 0, 0], P);
    expect(fingering.ok).toBe(true);
    const em = all({ root: 'E', family: 'm_add9' }).voicings.find((v) => toRiffForgeTab(v.shape) === '0 2 4 0 0 0');
    expect(em).toBeDefined();
    expect(em!.fingering.barres).toEqual([]);
    expect(em!.degrees).toBe('1 5 2 b3 5 1');
  });

  it('open E major 0 2 2 1 0 0 is a valid major voicing with three fingers', () => {
    const e = all({ root: 'E', family: 'major' }).voicings.find((v) => toRiffForgeTab(v.shape) === '0 2 2 1 0 0');
    expect(e).toBeDefined();
    expect(e!.fingering.fingers).toEqual([null, 2, 3, 1, null, null]);
    expect(e!.fingering.metrics.fingerCount).toBe(3);
  });
});

describe('generateVoicings: output', () => {
  it('fills every field from the engine functions', () => {
    for (const [root, family, tuning] of [
      ['E', 'm_add9', E_STANDARD],
      ['A', 'phrygian', E_STANDARD],
      ['D', 'sus2', DROP_D],
      ['C', 'drone_power5', E_STANDARD]
    ] as const) {
      const result = gen({ root, family, tuning });
      expect(result.voicings.length).toBeGreaterThan(0);
      for (const v of result.voicings) {
        const rootPc = { E: 4, A: 9, D: 2, C: 0 }[root];
        expect(v.familyId).toBe(family);
        expect(v.midi).toEqual(shapeToMidi(v.shape, tuning));
        expect(v.degrees).toBe(degreeString(v.shape, tuning, rootPc));
        expect(v.degreesByString.length).toBe(6);
        expect(v.cost).toBe(v.breakdown.total);
        expect(v.breakdown.terms.length).toBe(14);
        expect(v.novelty).toBeGreaterThanOrEqual(0);
        expect(v.novelty).toBeLessThanOrEqual(1);
        expect(v.name.length).toBeGreaterThan(0);
        if (v.symbol !== null) expect(v.name).toBe(v.symbol);
        expect(matchFamily(fam(family), rootPc, v.shape, tuning).ok).toBe(true);
        expect(findBestFingering(v.shape, P)).toEqual({ ok: true, fingering: v.fingering });
      }
    }
  });

  it('tags pedal-friendly, open, root-bass and string-group shapes', () => {
    const tagsOf = (text: string, over: Partial<GenerateParams> = {}) => {
      const v = all(over).voicings.find((x) => toRiffForgeTab(x.shape) === text);
      if (!v) throw new Error(`missing ${text}`);
      return v.tags;
    };
    expect(tagsOf('x 7 9 9 x x', { root: 'E' })).toEqual(['pedalCompatible', 'rootInBass', 'middleStrings']);
    expect(tagsOf('0 2 2 x x x', { root: 'E' })).toEqual(['pedalCompatible', 'usesOpenStrings', 'rootInBass', 'lowStrings']);
    expect(tagsOf('x x x 9 12 x', { root: 'E' })).toEqual(['pedalCompatible', 'rootInBass', 'middleStrings', 'topStrings']);
    expect(tagsOf('x x x x 5 7', { root: 'E' })).toEqual(['pedalCompatible', 'rootInBass', 'topStrings']);
    // string 0 fretted: not pedal-compatible
    expect(tagsOf('5 7 7 x x x', { root: 'A' })).toEqual(['rootInBass', 'lowStrings']);
    expect(tagsOf('x x 2 4 5 0', { root: 'E', family: 'drone_power5' })).toEqual(['pedalCompatible', 'drone', 'usesOpenStrings', 'rootInBass']);
    // open low string on the 5th still counts as a pedal string
    expect(tagsOf('0 x 2 2 2 x', { root: 'A', family: 'major' })).toEqual(['pedalCompatible', 'usesOpenStrings']);
  });

  it('is deterministic, including the order', () => {
    const params: GenerateParams = { root: 'A', family: 'sus2', tuning: E_STANDARD, profile: P };
    expect(generateVoicings(params)).toEqual(generateVoicings(params));
    expect(generateVoicings({ ...params, seed: 'riff' })).toEqual(generateVoicings({ ...params, seed: 'riff' }));
    expect(generateVoicings({ ...params, sort: 'unusual' })).toEqual(generateVoicings({ ...params, sort: 'unusual' }));
  });

  it('accepts family objects and ids, root names and pitch classes', () => {
    const byId = gen({ root: 'F#', family: 'm7' });
    expect(gen({ root: 6, family: fam('m7') })).toEqual(byId);
    expect(gen({ root: 'Gb', family: 'm7' })).toEqual(byId);
    expect(() => gen({ family: 'no_such_family' })).toThrow(/no_such_family/);
    expect(() => gen({ root: 'H' })).toThrow();
  });

  it('honours limit', () => {
    expect(gen({ root: 'A', family: 'major', limit: 3 }).voicings.length).toBe(3);
    expect(gen({ root: 'A', family: 'major' }).voicings.length).toBe(12);
    expect(gen({ root: 'A', family: 'major', limit: 0 }).voicings).toEqual([]);
    expect(gen({ root: 'A', family: 'major', limit: -3 }).voicings).toEqual([]);
    expect(gen({ root: 'A', family: 'major', limit: Number.NaN }).voicings.length).toBe(12);
  });

  it('treats limit Infinity as "every playable voicing"', () => {
    const everything = gen({ root: 'E', family: 'add9', limit: Infinity, diversify: false });
    expect(everything.stats.playable).toBeGreaterThan(12);
    expect(everything.voicings.length).toBe(everything.stats.playable);
    expect(everything).toEqual(gen({ root: 'E', family: 'add9', limit: 1e9, diversify: false }));
    const spread = gen({ root: 'E', family: 'add9', limit: Infinity });
    expect(new Set(keys(spread.voicings))).toEqual(new Set(keys(everything.voicings)));
  });

  it('gives extended-range tunings meaningful novelty', () => {
    const seven = { id: 'b-standard-7', name: '7-string B standard', openMidi: [35, 40, 45, 50, 55, 59, 64] };
    const { voicings } = gen({ root: 'E', family: 'major', tuning: seven, limit: 1000, diversify: false });
    const openE = voicings.find((v) => toRiffForgeTab(v.shape) === 'x 0 2 2 1 0 0');
    expect(openE?.novelty).toBe(0);
    expect(voicings.filter((v) => v.novelty < 1).length).toBeGreaterThan(voicings.length / 2);
  });

  it('reports consistent stats', () => {
    const result = gen({ root: 'C', family: 'm_add9' });
    const { stats } = result;
    expect(stats.windows).toBe(P.maxFret + 1);
    expect(stats.combinations).toBeGreaterThanOrEqual(stats.pitchValid);
    expect(stats.pitchValid).toBeGreaterThanOrEqual(stats.playable);
    expect(stats.playable).toBeGreaterThanOrEqual(result.voicings.length);
    const rejected = Object.values(stats.rejections).reduce((s, n) => s + (n ?? 0), 0);
    expect(rejected).toBeGreaterThanOrEqual(stats.combinations - stats.playable);
    expect(result.empty).toBeUndefined();
  });
});

describe('generateVoicings: hand profile', () => {
  it('a smaller reach removes wide shapes; a larger one adds shapes', () => {
    const small = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3 });
    const large = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 6, allowStretches: true });
    for (const family of ['m_add9', 'sus2', 'power5']) {
      const base = all({ family, root: 'A' });
      const less = all({ family, root: 'A', profile: small });
      const more = all({ family, root: 'A', profile: large });
      const baseKeys = new Set(keys(base.voicings));
      const moreKeys = new Set(keys(more.voicings));
      for (const k of keys(less.voicings)) expect(baseKeys.has(k)).toBe(true);
      for (const k of baseKeys) expect(moreKeys.has(k)).toBe(true);
      expect(less.voicings.length).toBeLessThan(base.voicings.length);
      expect(more.voicings.length).toBeGreaterThan(base.voicings.length);
      const removed = base.voicings.filter((v) => !keys(less.voicings).includes(toRiffForgeTab(v.shape)));
      expect(removed.some((v) => v.fingering.metrics.spanMm > allowedSpanMm(small, v.fingering.metrics.lowestFret ?? 0))).toBe(true);
    }
  });

  it('allowOpenStrings=false yields no open strings', () => {
    const closed: HandProfile = { ...P, allowOpenStrings: false };
    for (const family of ['power5', 'm_add9', 'phrygian']) {
      const result = all({ family, profile: closed });
      expect(result.voicings.length).toBeGreaterThan(0);
      for (const v of result.voicings) expect(v.shape).not.toContain(0);
    }
  });

  it('respects maxFret and the interior-mute limit', () => {
    const tight: HandProfile = { ...P, maxFret: 7, maxInteriorMutes: 0 };
    const result = all({ family: 'm7', root: 'A', profile: tight });
    expect(result.voicings.length).toBeGreaterThan(0);
    expect(result.stats.windows).toBe(8);
    for (const v of result.voicings) {
      expect(Math.max(...v.shape.map((f) => f ?? 0))).toBeLessThanOrEqual(7);
      expect(v.fingering.metrics.interiorMutes).toBe(0);
    }
  });
});

describe('generateVoicings: ranking', () => {
  it("sorts 'easiest' by cost", () => {
    const { voicings } = all({ root: 'C', family: 'add9' });
    for (let i = 1; i < voicings.length; i++) expect(voicings[i].cost).toBeGreaterThanOrEqual(voicings[i - 1].cost);
  });

  it("sorts 'unusual' by novelty, then cost", () => {
    const { voicings } = all({ root: 'C', family: 'add9', sort: 'unusual' });
    expect(voicings.length).toBeGreaterThan(5);
    for (let i = 1; i < voicings.length; i++) {
      const [a, b] = [voicings[i - 1], voicings[i]];
      expect(b.novelty).toBeLessThanOrEqual(a.novelty);
      if (b.novelty === a.novelty) expect(b.cost).toBeGreaterThanOrEqual(a.cost);
    }
    expect(voicings[0].novelty).toBeGreaterThan(voicings[voicings.length - 1].novelty);
  });

  it('a seed only reorders near-equal results, deterministically', () => {
    const plain = all({ root: 'D', family: 'sus4' });
    const seeded = all({ root: 'D', family: 'sus4', seed: 'take-2' });
    expect(new Set(keys(seeded.voicings))).toEqual(new Set(keys(plain.voicings)));
    for (let i = 1; i < seeded.voicings.length; i++) {
      expect(seeded.voicings[i].cost).toBeGreaterThanOrEqual(seeded.voicings[i - 1].cost - 0.01);
    }
    expect(all({ root: 'D', family: 'sus4', seed: 'take-2' })).toEqual(seeded);
  });

  it('diversify spreads results across positions and string sets', () => {
    let improved = 0;
    for (const [root, family] of [
      ['E', 'power5'],
      ['A', 'minor'],
      ['G', 'm_add9'],
      ['C', 'major'],
      ['D', 'sus2'],
      ['F', 'm7'],
      ['B', 'quartal'],
      ['E', 'phrygian']
    ] as const) {
      const spread = gen({ root, family });
      const plain = gen({ root, family, diversify: false });
      expect(spread.voicings.length).toBe(plain.voicings.length);
      expect(nearDuplicatePairs(spread.voicings)).toBeLessThanOrEqual(nearDuplicatePairs(plain.voicings));
      if (nearDuplicatePairs(spread.voicings) < nearDuplicatePairs(plain.voicings)) improved++;
      const full = new Set(keys(all({ root, family }).voicings));
      for (const k of keys(spread.voicings)) expect(full.has(k)).toBe(true);
      expect(spread.voicings[0]).toEqual(plain.voicings[0]);
    }
    expect(improved).toBeGreaterThan(0);
  });

  it('diversify follows the contract: +0.6 per selected voicing on the same strings within 2 frets', () => {
    for (const [root, family, sort] of [
      ['E', 'power5', 'easiest'],
      ['A', 'minor', 'easiest'],
      ['G', 'm_add9', 'easiest'],
      ['C', 'add9', 'unusual']
    ] as const) {
      const sorted = all({ root, family, sort }).voicings;
      const scoreOf = (v: GeneratedVoicing) => (sort === 'unusual' ? -v.novelty : v.cost);
      const picked: GeneratedVoicing[] = [];
      const left = [...sorted];
      while (picked.length < 12 && left.length > 0) {
        let best = 0;
        let bestScore = Infinity;
        left.forEach((c, i) => {
          const near = picked.filter(
            (p) =>
              stringMask(p) === stringMask(c) &&
              Math.abs((p.fingering.metrics.lowestFret ?? 0) - (c.fingering.metrics.lowestFret ?? 0)) <= 2
          ).length;
          const score = scoreOf(c) + 0.6 * near;
          if (score < bestScore) {
            best = i;
            bestScore = score;
          }
        });
        picked.push(left.splice(best, 1)[0]);
      }
      expect(keys(gen({ root, family, sort }).voicings), `${root} ${family}`).toEqual(keys(picked));
    }
  });

  it("the 'chug' context favours fewer, lower strings", () => {
    const weight = (vs: readonly GeneratedVoicing[]) =>
      vs.reduce((sum, v) => sum + v.midi.length + v.shape.reduce<number>((a, f, i) => (f === null ? a : a + i), 0) / v.midi.length, 0) /
      vs.length;
    let lighter = 0;
    for (const [root, family] of [['E', 'power5'], ['A', 'major'], ['E', 'minor'], ['D', 'sus4'], ['G', 'fourth']] as const) {
      const strum = gen({ root, family, diversify: false, limit: 8 }).voicings;
      const chug = gen({ root, family, diversify: false, limit: 8, context: 'chug' }).voicings;
      expect(weight(chug)).toBeLessThanOrEqual(weight(strum));
      if (weight(chug) < weight(strum)) lighter++;
      for (const v of chug) expect(v.breakdown.terms.find((t) => t.key === 'chugStrings')?.cost).toBeGreaterThan(0);
      for (const v of strum) expect(v.breakdown.terms.find((t) => t.key === 'chugStrings')?.cost).toBe(0);
    }
    expect(lighter).toBeGreaterThan(0);
  });
});

describe('generateVoicings: empty results name the binding constraint', () => {
  it('no drone string: drone 4th on C in E standard', () => {
    const result = gen({ root: 'C', family: 'drone_fourth' });
    expect(result.voicings).toEqual([]);
    expect(result.empty?.constraint).toBe('NO_DRONE_STRING');
    expect(result.empty?.message).toMatch(/drone/);
  });

  it('open strings off: a drone needs an open string', () => {
    const result = gen({ root: 'E', family: 'drone_power5', profile: { ...P, allowOpenStrings: false } });
    expect(result.voicings).toEqual([]);
    expect(result.empty?.constraint).toBe('OPEN_STRINGS');
    expect(result.empty?.message).toMatch(/open strings/);
  });

  it('needs a barre: five distinct fretted notes', () => {
    const fiveNotes: VoicingFamily = {
      id: 'six_nine',
      label: '6/9 five-note',
      description: 'test recipe',
      group: 'legacy',
      required: [0, 2, 4, 7, 9],
      optional: [],
      forbidden: [],
      bass: [0],
      minNotes: 5,
      maxNotes: 5,
      tags: []
    };
    const result = gen({ root: 'C', family: fiveNotes, profile: { ...P, allowOpenStrings: false } });
    expect(result.voicings).toEqual([]);
    expect(result.empty?.constraint).toBe('NEEDS_BARRE');
    expect(result.empty?.message).toMatch(/needs a barre/);
  });

  it('reach: a two-note power chord for a tiny hand without open strings', () => {
    const tiny: HandProfile = { ...P, reachAtLowMm: 30, reachAtHighMm: 30, allowOpenStrings: false };
    const twoNote: VoicingFamily = { ...fam('power5'), id: 'power5_two', minNotes: 2, maxNotes: 2 };
    const result = gen({ root: 'A', family: twoNote, profile: tiny });
    expect(result.voicings).toEqual([]);
    expect(result.empty?.constraint).toBe('REACH');
    expect(result.empty?.message).toMatch(/reach/);
  });

  it('pitch classes: a contradictory recipe', () => {
    const broken: VoicingFamily = { ...fam('power5'), id: 'broken', forbidden: [7] };
    const result = gen({ family: broken });
    expect(result.voicings).toEqual([]);
    expect(result.empty?.constraint).toBe('PITCH_CLASSES');
  });

  it('note count: more required notes than the recipe allows', () => {
    const broken: VoicingFamily = { ...fam('phrygian'), id: 'broken', maxNotes: 3 };
    expect(gen({ family: broken }).empty?.constraint).toBe('NOTE_COUNT');
  });

  it('max fret 3 + phrygian: every empty root names a constraint in one line', () => {
    const low: HandProfile = { ...P, maxFret: 3 };
    let empties = 0;
    for (let root = 0; root < 12; root++) {
      const result = gen({ root, family: 'phrygian', profile: low });
      if (result.voicings.length > 0) continue;
      empties++;
      expect(result.empty).toBeDefined();
      expect(result.empty?.message).not.toContain('\n');
      expect(result.empty?.message.length).toBeGreaterThan(10);
    }
    expect(empties).toBeGreaterThan(0);
  });
});

describe('findClosestVoicing', () => {
  it('returns the exact result when it has voicings', () => {
    const params: GenerateParams = { root: 'E', family: 'm_add9', tuning: E_STANDARD, profile: P };
    const closest = findClosestVoicing(params);
    expect(closest.relaxed).toBeNull();
    expect(closest.result).toEqual(generateVoicings(params));
  });

  it('walks the relaxation ladder when the exact recipe is empty', () => {
    // phrygian needs 4..6 notes with the root in the bass; maxFret 3 without open strings leaves some roots empty
    const tight: HandProfile = { ...P, maxFret: 3, allowOpenStrings: false };
    let relaxedCases = 0;
    for (let root = 0; root < 12; root++) {
      const params: GenerateParams = { root, family: 'phrygian', tuning: E_STANDARD, profile: tight };
      const exact = generateVoicings(params);
      const closest = findClosestVoicing(params);
      if (exact.voicings.length > 0) {
        expect(closest.relaxed).toBeNull();
        continue;
      }
      if (closest.relaxed === null) {
        expect(closest.result).toEqual(exact);
        continue;
      }
      relaxedCases++;
      const ladder = relaxFamily(fam('phrygian'));
      const step = ladder.find((s) => s.relaxed.join() === closest.relaxed?.join());
      expect(step).toBeDefined();
      expect(closest.result.voicings.length).toBeGreaterThan(0);
      for (const v of closest.result.voicings) {
        expect(v.familyId).toBe(step?.family.id);
        expect(v.familyId).toContain('~');
      }
      // earlier ladder steps were empty
      for (const earlier of ladder.slice(0, ladder.indexOf(step!))) {
        expect(generateVoicings({ ...params, family: earlier.family }).voicings).toEqual([]);
      }
    }
    expect(relaxedCases).toBeGreaterThan(0);
  });

  it('returns the exact empty result when nothing on the ladder works', () => {
    const params: GenerateParams = { root: 'C', family: 'drone_fourth', tuning: E_STANDARD, profile: P };
    const closest = findClosestVoicing(params);
    expect(closest.relaxed).toBeNull();
    expect(closest.result.empty?.constraint).toBe('NO_DRONE_STRING');
    expect(closest.exactEmpty).toEqual(closest.result.empty);
  });

  it('keeps the exact diagnosis next to a relaxed suggestion', () => {
    const params: GenerateParams = { root: 'D#', family: 'power5_b2', tuning: E_STANDARD, profile: { ...P, maxFret: 5, allowOpenStrings: false } };
    const exact = generateVoicings(params);
    expect(exact.voicings).toEqual([]);
    const closest = findClosestVoicing(params);
    expect(closest.relaxed).toEqual(['any bass note']);
    expect(closest.result.voicings.length).toBeGreaterThan(0);
    expect(closest.result.empty).toBeUndefined();
    expect(closest.exactEmpty).toEqual(exact.empty);
    expect(closest.exactEmpty?.constraint).toBe('MAX_FRET');
    expect(findClosestVoicing({ ...params, root: 'E', profile: P }).exactEmpty).toBeUndefined();
  });

  it('returns relaxed family ids that resolve and regenerate', () => {
    const params: GenerateParams = { root: 'D#', family: 'power5_b2', tuning: E_STANDARD, profile: { ...P, maxFret: 5, allowOpenStrings: false } };
    const closest = findClosestVoicing(params);
    expect(closest.relaxed).toEqual(['any bass note']);
    const id = closest.result.voicings[0].familyId;
    expect(id).toBe('power5_b2~anyBass');
    const resolved = resolveFamilyId(id);
    expect(resolved).toEqual(relaxFamily(fam('power5_b2'))[0].family);
    expect(resolved?.label).toBe(fam('power5_b2').label);
    expect(generateVoicings({ ...params, family: id })).toEqual(closest.result);
    expect(resolveFamilyId('power5_b2')).toBe(fam('power5_b2'));
    expect(resolveFamilyId('power5_b2~noSuchStep')).toBeUndefined();
    expect(resolveFamilyId('no_such~anyBass')).toBeUndefined();
    expect(() => generateVoicings({ ...params, family: 'power5_b2~noSuchStep' })).toThrow(/power5_b2~noSuchStep/);
  });
});

/** Every shape over frets 0..maxFret with allowed pitch classes, filtered by the engine's own validators. */
const bruteForce = (family: VoicingFamily, rootPc: number, tuning: typeof E_STANDARD, profile: HandProfile): Set<string> => {
  const allowed = new Set([...family.required, ...family.optional]);
  const options = tuning.openMidi.map((open) => {
    const list: (number | null)[] = [null];
    for (let f = 0; f <= profile.maxFret; f++) if (allowed.has((((open + f - rootPc) % 12) + 12) % 12)) list.push(f);
    return list;
  });
  const found = new Set<string>();
  const shape: (number | null)[] = new Array(tuning.openMidi.length).fill(null);
  const walk = (s: number): void => {
    if (s === shape.length) {
      if (matchFamily(family, rootPc, shape, tuning).ok !== true) return;
      if (shapeConstraintViolation(shape, profile) !== null) return;
      if (findBestFingering(shape, profile).ok !== true) return;
      found.add(toRiffForgeTab(shape));
      return;
    }
    for (const f of options[s]) {
      shape[s] = f;
      walk(s + 1);
    }
    shape[s] = null;
  };
  walk(0);
  return found;
};

describe('generateVoicings: completeness against brute force', () => {
  const profiles: [string, HandProfile][] = [
    ['default', P],
    ['thumb', { ...P, allowThumb: true }],
    ['partial barre', { ...P, allowTwoStringPartialBarre: true }],
    ['barre mode', { ...P, noBarre: false }],
    ['small reach, no mutes', { ...profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3 }), maxInteriorMutes: 0 }],
    ['stretch, 2 mutes, no open', { ...profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 6, allowStretches: true, allowOpenStrings: false }), maxInteriorMutes: 2 }],
    ['max fret 9', { ...P, maxFret: 9 }]
  ];
  const combos: [typeof E_STANDARD, string, number][] = [
    [E_STANDARD, 'power5', 4],
    [E_STANDARD, 'm_add9', 7],
    [DROP_D, 'phrygian', 2],
    [E_STANDARD, 'quartal', 9],
    [E_STANDARD, 'cluster_m2', 0],
    [DROP_D, 'drone_sus2', 2],
    [E_STANDARD, 'major', 6],
    [DROP_D, 'power5_b2', 11]
  ];

  for (const [name, profile] of profiles) {
    it(`finds exactly the valid shapes (${name})`, () => {
      for (const [tuning, familyId, root] of combos) {
        const family = fam(familyId);
        const expected = bruteForce(family, root, tuning, profile);
        const actual = keys(all({ root, family, tuning, profile }).voicings);
        expect(new Set(actual), `${tuning.id} ${familyId} ${root}`).toEqual(expected);
        expect(actual.length).toBe(expected.size);
      }
    }, 30_000);
  }
});

describe('structurallyUnfingerable (pre-check before the exhaustive fingering search)', () => {
  const wide: HandProfile = {
    ...P,
    noBarre: false,
    allowTwoStringPartialBarre: true,
    allowThumb: true,
    stretchTolerance: 1.5,
    reachAtLowMm: 160,
    reachAtHighMm: 160,
    maxFret: 24,
    maxInteriorMutes: 4
  };
  const profiles: [string, HandProfile][] = [
    ['default', P],
    ['thumb', { ...P, allowThumb: true }],
    ['partial barre', { ...P, allowTwoStringPartialBarre: true }],
    ['partial barre + thumb', { ...P, allowTwoStringPartialBarre: true, allowThumb: true }],
    ['barre mode', { ...P, noBarre: false }],
    ['barre mode + thumb', { ...P, noBarre: false, allowThumb: true }],
    ['wide, every option', wide]
  ];

  it('only flags shapes the fingering search rejects as NEEDS_BARRE, and flags most structural misses', () => {
    const rng = createRng('unfingerable');
    for (const [name, profile] of profiles) {
      let flagged = 0;
      let structuralMisses = 0;
      for (let i = 0; i < 4000; i++) {
        const base = rng.int(1, 11);
        const shape = Array.from({ length: 6 }, () => (rng.chance(0.25) ? null : rng.chance(0.15) ? 0 : base + rng.int(0, 4)));
        if (shape.every((f) => f === null)) continue;
        const result = findBestFingering(shape, profile);
        if (structurallyUnfingerable(shape, profile)) {
          flagged++;
          expect(result, `${name} ${toRiffForgeTab(shape)}`).toMatchObject({ ok: false, reason: 'NEEDS_BARRE' });
        } else if (result.ok === false && /do not fit \d+ fingers|but only \d+ fingers|need the thumb/.test(result.detail)) {
          structuralMisses++;
        }
      }
      expect(flagged, name).toBeGreaterThan(0);
      expect(structuralMisses, name).toBeLessThan(flagged);
    }
  });

  it('flags the classic barre shapes in no-barre mode only', () => {
    for (const text of ['1 3 3 2 1 1', 'x 1 3 3 3 1', '3 5 7 3 3 3']) {
      const shape = fromRiffForgeTab(text)!;
      expect(structurallyUnfingerable(shape, P), text).toBe(true);
      expect(structurallyUnfingerable(shape, { ...P, noBarre: false }), text).toBe(false);
    }
    expect(structurallyUnfingerable(fromRiffForgeTab('0 2 2 1 0 0')!, P)).toBe(false);
    expect(structurallyUnfingerable(fromRiffForgeTab('3 x 0 0 0 3')!, P)).toBe(false);
  });

  it('keeps generation exact for a barre, partial-barre, thumb and wide-stretch profile', () => {
    const profile: HandProfile = { ...wide, maxFret: 8 };
    for (const [tuning, familyId, root] of [
      [E_STANDARD, 'm_add9', 7],
      [DROP_D, 'add9', 7],
      [E_STANDARD, 'major', 0],
      [DROP_D, 'phrygian', 2]
    ] as const) {
      const family = fam(familyId);
      const expected = bruteForce(family, root, tuning, profile);
      expect(new Set(keys(all({ root, family, tuning, profile }).voicings)), `${tuning.id} ${familyId}`).toEqual(expected);
    }
  }, 60_000);
});

/** The contract's selection, replayed on every playable voicing in plain sort order. */
const contractPicks = (sorted: readonly GeneratedVoicing[], over: Partial<GenerateParams>, limit: number): string[] => {
  const jitter = (v: GeneratedVoicing): number =>
    over.seed === undefined ? 0 : mulberry32(seedFromString(over.seed + shapeKey(v.shape)))() * SEED_JITTER;
  const primary = (v: GeneratedVoicing): number => (over.sort === 'unusual' ? -v.novelty : v.cost) + jitter(v);
  if (over.diversify === false) return keys(sorted.slice(0, limit));
  const picked: GeneratedVoicing[] = [];
  const left = [...sorted];
  while (picked.length < limit && left.length > 0) {
    let best = 0;
    let bestScore = Infinity;
    left.forEach((c, i) => {
      const near = picked.filter(
        (p) =>
          stringMask(p) === stringMask(c) &&
          Math.abs((p.fingering.metrics.lowestFret ?? 0) - (c.fingering.metrics.lowestFret ?? 0)) <= 2
      ).length;
      const score = primary(c) + 0.6 * near;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    picked.push(left.splice(best, 1)[0]);
  }
  return keys(picked);
};

describe('generateVoicings: heavy hand profiles (lazy fingering search)', () => {
  const heavyCalibration = profileFromCalibration({
    ...DEFAULT_CALIBRATION,
    lowPinkyFret: 7,
    highPinkyFret: 13,
    allowStretches: true,
    noBarre: false,
    maxFret: 24
  });
  const extreme: HandProfile = {
    ...P,
    noBarre: false,
    allowTwoStringPartialBarre: true,
    allowThumb: true,
    stretchTolerance: 1.5,
    reachAtLowMm: 160,
    reachAtHighMm: 160,
    maxFret: 24,
    maxInteriorMutes: 4
  };

  it('returns exactly the voicings an exhaustive search selects', () => {
    let lazyRuns = 0;
    const cases = [
      ['heavy calibration', heavyCalibration, E_STANDARD, 'add9', 7, [{}, { seed: 'take-3' }, { sort: 'unusual' as const }]],
      ['heavy calibration', heavyCalibration, DROP_D, 'major', 4, [{}, { sort: 'unusual' as const }]],
      ['extreme, max fret 12', { ...extreme, maxFret: 12 }, DROP_D, 'm_add9', 2, [{}, { seed: 'take-3' }, { sort: 'unusual' as const }]],
      ['extreme, max fret 12', { ...extreme, maxFret: 12 }, E_STANDARD, 'sus2', 9, [{}]]
    ] as const;
    for (const [profileName, profile, tuning, family, root, overs] of cases) {
      for (const over of overs) {
        const base = { root, family, tuning, profile, ...over };
        const every = all(base);
        for (const variant of [{}, { diversify: false }, { limit: 1 }, { limit: 30 }]) {
          const params = { ...base, ...variant };
          const result = gen(params);
          const where = `${profileName} ${tuning.id} ${family} ${root} ${JSON.stringify(over)} ${JSON.stringify(variant)}`;
          expect(keys(result.voicings), where).toEqual(contractPicks(every.voicings, params, params.limit ?? 12));
          expect(result.stats.combinations, where).toBe(every.stats.combinations);
          expect(result.stats.pitchValid, where).toBe(every.stats.pitchValid);
          if (result.stats.playable < every.stats.playable) lazyRuns++;
        }
        const none = gen({ ...base, limit: 0 });
        expect(none.voicings).toEqual([]);
        expect(none.empty).toBeUndefined();
      }
    }
    expect(lazyRuns).toBeGreaterThan(20);
  }, 120_000);

  it('stays deterministic, including the order and the stats', () => {
    const params: GenerateParams = { root: 'G', family: 'add9', tuning: DROP_D, profile: extreme, seed: 'riff' };
    expect(generateVoicings(params)).toEqual(generateVoicings(params));
    expect(generateVoicings({ ...params, sort: 'unusual' })).toEqual(generateVoicings({ ...params, sort: 'unusual' }));
  });

  it('meets the time budget on the heaviest profiles', () => {
    const timeAll = (profile: HandProfile, families: readonly string[], tunings = [E_STANDARD, DROP_D]): number[] => {
      for (let i = 0; i < 8; i++) generateVoicings({ root: i, family: families[i % families.length], tuning: E_STANDARD, profile });
      const times: number[] = [];
      for (const tuning of tunings) {
        for (const family of families) {
          for (let root = 0; root < 12; root++) {
            const t0 = performance.now();
            generateVoicings({ root, family, tuning, profile });
            times.push(performance.now() - t0);
          }
        }
      }
      return times.sort((a, b) => a - b);
    };
    const pct = (times: number[], p: number): number => times[Math.min(times.length - 1, Math.floor(times.length * p))];
    // Every calibration answer at its widest (barres on, stretches on, max fret 24): median about 6 ms, max about 18 ms
    const calibrated = timeAll(heavyCalibration, ['add9', 'm_add9', 'sus2', 'sus4', 'major', 'phrygian', 'power5_b2']);
    expect(pct(calibrated, 0.5)).toBeLessThan(15);
    expect(pct(calibrated, 0.95)).toBeLessThan(30);
    // Every option on and the widest hand, heaviest recipes: median about 35 ms, max about 90 ms here (400-700 ms
    // before the lazy search); generous bounds so a loaded machine does not fail the run
    const widest = timeAll(extreme, ['add9', 'm_add9'], [DROP_D]);
    expect(pct(widest, 0.5)).toBeLessThan(120);
    expect(pct(widest, 1)).toBeLessThan(400);
  }, 60_000);
});

describe('generateVoicings: keys', () => {
  it('never returns duplicate shapes', () => {
    const { voicings } = all({ root: 'B', family: 'minor' });
    const list = voicings.map((v) => shapeKey(v.shape));
    expect(new Set(list).size).toBe(list.length);
  });
});
