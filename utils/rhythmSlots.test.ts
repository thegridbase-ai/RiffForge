import { describe, it, expect } from 'vitest';
import {
  changeBeats,
  clickTimes,
  distinctChords,
  optimizeProgressionShapes,
  progressionFromRiffSteps,
  progressionOverrideKey,
  createRhythmSlot,
  defaultPedalMidi,
  describeCell,
  displayFingering,
  gridColumns,
  implicitPowerSlot,
  loopSeconds,
  optimizeSlotShapes,
  retuneSlot,
  rhythmLanes,
  sanitizeRhythmSlot,
  slotCandidates,
  slotsFromRiffSteps,
  toggleTargetFor,
  unitPosition,
  type RhythmSlot
} from './rhythmSlots';
import { DROP_D, E_STANDARD } from '../engine/tuning';
import { DEFAULT_HAND_PROFILE } from '../engine/handProfile';
import { generateVoicings } from '../engine/generateVoicings';
import { shapeKey, shapeToMidi } from '../engine/shape';
import { transitionCost } from '../engine/transition';
import { generateRhythm } from '../engine/rhythm/generate';
import { defaultRhythmParams } from '../engine/rhythm/styles';
import type { HitTarget, RhythmEvent, RhythmPattern } from '../engine/types';

const profile = DEFAULT_HAND_PROFILE;

const familySlot = (root: string, familyId: string, shape: (number | null)[], id = `${root}-${familyId}`): RhythmSlot => ({
  id,
  label: `${root}5`,
  root,
  source: { kind: 'family', familyId },
  shape,
  tuningId: E_STANDARD.id,
  pedalMidi: null
});

const ev = (tick: number, durationTicks: number, target: HitTarget, extra: Partial<RhythmEvent> = {}): RhythmEvent => ({
  tick,
  durationTicks,
  target,
  palmMute: false,
  accent: 0,
  pick: 'down',
  ...extra
});

const onePattern = (events: RhythmEvent[], slotCount = 2): RhythmPattern => ({
  id: 't',
  name: 'T',
  seed: 't',
  meter: { numerator: 4, denominator: 4 },
  bars: 1,
  ppq: 480,
  tags: [],
  params: { ...defaultRhythmParams('chugEngine'), bars: 1, slotCount },
  events
});

describe('defaultPedalMidi', () => {
  it('uses the open low string when it is the root or the fifth', () => {
    expect(defaultPedalMidi([0, 2, 2, null, null, null], E_STANDARD, 'E')).toBe(40);
    // E is the fifth of A
    expect(defaultPedalMidi([null, 0, 2, 2, null, null], E_STANDARD, 'A')).toBe(40);
    expect(defaultPedalMidi([0, 0, 0, null, null, null], DROP_D, 'D')).toBe(38);
  });

  it('falls back to the shape bass otherwise', () => {
    // C5 on the A string: E is the third of C, so the pedal is the C3 bass
    expect(defaultPedalMidi([null, 3, 5, 5, null, null], E_STANDARD, 'C')).toBe(48);
  });
});

describe('slotCandidates', () => {
  it('returns diversified recipe voicings for a family slot', () => {
    const list = slotCandidates(familySlot('E', 'power5', [0, 2, 2, null, null, null]), E_STANDARD, profile);
    expect(list.length).toBeGreaterThan(1);
    expect(list.length).toBeLessThanOrEqual(13);
    for (const v of list) {
      expect(new Set(v.midi.map((m) => m % 12))).toEqual(new Set([4, 11]));
      expect(v.fingering.barres).toEqual([]);
    }
  });

  it('puts a fingerable current shape first when the generator would not return it', () => {
    // E2 B2 E3 + open E4: two interior mutes, so generation skips it, but it is easy to finger
    const current = [0, 2, 2, null, null, 0];
    const generated = generateVoicings({ root: 'E', family: 'power5', tuning: E_STANDARD, profile, limit: 300, diversify: false }).voicings;
    expect(generated.some((v) => shapeKey(v.shape) === '0 2 2 x x 0')).toBe(false);
    const list = slotCandidates(familySlot('E', 'power5', current), E_STANDARD, profile);
    expect(shapeKey(list[0].shape)).toBe('0 2 2 x x 0');
    expect(list[0].fingering.fingers.filter((f) => f !== null)).toHaveLength(2);
    expect(list.slice(1).some((v) => shapeKey(v.shape) === '0 2 2 x x 0')).toBe(false);
  });

  it('keeps candidates near the slot register', () => {
    const low = slotCandidates(familySlot('E', 'power5', [0, 2, 2, null, null, null]), E_STANDARD, profile);
    for (const v of low) expect(Math.min(...v.midi)).toBeLessThanOrEqual(40 + 7);
    const high = slotCandidates(familySlot('E', 'power5', [null, 7, 9, null, null, null]), E_STANDARD, profile);
    for (const v of high) expect(Math.abs(Math.min(...v.midi) - 52)).toBeLessThanOrEqual(7);
  });

  it('ignores an unplayable current shape', () => {
    // fret 1 to fret 13 is far outside the default reach
    const list = slotCandidates(familySlot('F', 'power5', [1, null, null, null, null, 13]), E_STANDARD, profile);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((v) => shapeKey(v.shape) === '1 x x x x 13')).toBe(false);
  });

  it('builds legacy-notes candidates relative to the base root', () => {
    const slot: RhythmSlot = {
      id: 'n',
      label: 'E5',
      root: 'E',
      source: { kind: 'notes', notes: ['E2', 'B2', 'E3'], baseRoot: 'E' },
      shape: [0, 2, 2, null, null, null],
      tuningId: E_STANDARD.id,
      pedalMidi: 40
    };
    const list = slotCandidates(slot, E_STANDARD, profile);
    expect(list.some((v) => shapeKey(v.shape) === '0 2 2 x x x')).toBe(true);
    for (const v of list) expect(Math.min(...v.midi) % 12).toBe(4);
  });
});

describe('createRhythmSlot / sanitizeRhythmSlot', () => {
  it('fills id and the default pedal', () => {
    const slot = createRhythmSlot({
      label: 'C5',
      root: 'C',
      source: { kind: 'family', familyId: 'power5' },
      shape: [null, 3, 5, 5, null, null],
      tuningId: E_STANDARD.id
    });
    expect(slot).not.toBeNull();
    expect(slot!.id).toMatch(/^slot-/);
    expect(slot!.pedalMidi).toBe(48);
  });

  it('rejects unknown tunings, wrong string counts and silent shapes', () => {
    const base = { label: 'x', root: 'E', source: { kind: 'family', familyId: 'power5' } as const };
    expect(createRhythmSlot({ ...base, shape: [0, 2, 2, null, null, null], tuningId: 'nope' })).toBeNull();
    expect(createRhythmSlot({ ...base, shape: [0, 2, 2], tuningId: E_STANDARD.id })).toBeNull();
    expect(createRhythmSlot({ ...base, shape: [null, null, null, null, null, null], tuningId: E_STANDARD.id })).toBeNull();
    expect(createRhythmSlot({ ...base, root: 'H', shape: [0, 2, 2, null, null, null], tuningId: E_STANDARD.id })).toBeNull();
  });

  it('drops malformed persisted slots and keeps valid ones', () => {
    expect(sanitizeRhythmSlot(null)).toBeNull();
    expect(sanitizeRhythmSlot({ id: 'a' })).toBeNull();
    expect(sanitizeRhythmSlot({ ...familySlot('E', 'power5', [0, 2, 2, null, null, null]), shape: [0, -1, 2, null, null, null] })).toBeNull();
    expect(sanitizeRhythmSlot({ ...familySlot('E', 'power5', [0, 2, 2, null, null, null]), source: { kind: 'notes', notes: [], baseRoot: 'E' } })).toBeNull();
    const kept = sanitizeRhythmSlot(familySlot('E', 'power5', [0, 2, 2, null, null, null]));
    expect(kept).not.toBeNull();
    expect(kept!.pedalMidi).toBeNull();
    expect(sanitizeRhythmSlot({ ...familySlot('E', 'power5', [0, 2, 2, null, null, null]), pedalMidi: 40 })!.pedalMidi).toBe(40);
  });
});

describe('retuneSlot', () => {
  it('keeps the sounding notes when moving E5 to Drop D', () => {
    const slot = familySlot('E', 'power5', [0, 2, 2, null, null, null]);
    const moved = retuneSlot(slot, DROP_D, profile);
    expect(moved).not.toBeNull();
    expect(moved!.tuningId).toBe(DROP_D.id);
    expect([...shapeToMidi(moved!.shape, DROP_D)].sort((a, b) => a - b)).toEqual([40, 47, 52]);
  });

  it('leaves a slot of the same tuning alone', () => {
    const slot = familySlot('E', 'power5', [0, 2, 2, null, null, null]);
    expect(retuneSlot(slot, E_STANDARD, profile)).toBe(slot);
  });
});

describe('implicitPowerSlot', () => {
  it('voices a power chord on the root', () => {
    const slot = implicitPowerSlot('A', E_STANDARD, profile);
    expect(slot).not.toBeNull();
    expect(new Set(shapeToMidi(slot!.shape, E_STANDARD).map((m) => m % 12))).toEqual(new Set([9, 4]));
    expect(slot!.label).toBe('A5');
  });
});

describe('slotsFromRiffSteps', () => {
  const step = (name: string, notes: string[]) => ({ name, subtext: name, notes });

  it('takes the first four distinct steps and starts on the exact sounding voicing', () => {
    const steps = [
      step('E5', ['E2', 'B2', 'E3']),
      step('E5', ['E2', 'B2', 'E3']),
      step('G5', ['G2', 'D3', 'G3']),
      step('A5', ['A2', 'E3', 'A3']),
      step('C5', ['C3', 'G3', 'C4']),
      step('D5', ['D3', 'A3', 'D4'])
    ];
    const slots = slotsFromRiffSteps(steps, E_STANDARD, profile);
    expect(slots.map((s) => s.label)).toEqual(['E5', 'G5', 'A5', 'C5']);
    expect(shapeKey(slots[0].shape)).toBe('0 2 2 x x x');
    // G2 D3 G3 sounds exactly as 3 x 0 0 x x too, and the open strings make it the cheapest exact match
    expect([...shapeToMidi(slots[1].shape, E_STANDARD)].sort((a, b) => a - b)).toEqual([43, 50, 55]);
    expect(slots[1].source).toEqual({ kind: 'notes', notes: ['G2', 'D3', 'G3'], baseRoot: 'G' });
    const distinct = steps.filter((_, k) => k !== 1);
    slots.forEach((s, i) => expect(shapeToMidi(s.shape, E_STANDARD)).toHaveLength(distinct[i].notes.length));
  });

  it('treats the same name with other notes as a different step', () => {
    const slots = slotsFromRiffSteps([step('E5', ['E2', 'B2', 'E3']), step('E5', ['E3', 'B3'])], E_STANDARD, profile);
    expect(slots).toHaveLength(2);
  });
});

describe('changeBeats', () => {
  it('measures from the last attack on a slot to the first attack on the next one, looping', () => {
    const pattern = onePattern([
      ev(0, 240, { kind: 'slot', slot: 0 }, { accent: 2 }),
      ev(240, 120, { kind: 'pedal' }),
      ev(360, 120, { kind: 'slot', slot: 0 }),
      ev(480, 480, { kind: 'dead' }),
      ev(960, 240, { kind: 'dyad', slot: 1 }, { accent: 1 }),
      ev(1200, 240, { kind: 'slot', slot: 1 }),
      ev(1440, 480, { kind: 'pedal' })
    ]);
    // slot 0: last attack 360 -> slot 1 at 960 = 600 ticks; slot 1: last attack 1200 -> wraps to 0 = 720 ticks
    expect(changeBeats(pattern, 2)).toEqual([1.25, 1.5]);
  });

  it('gives slots that never change the whole pattern', () => {
    const pattern = onePattern([ev(0, 960, { kind: 'slot', slot: 0 }), ev(960, 960, { kind: 'pedal' })], 3);
    expect(changeBeats(pattern, 3)).toEqual([4, 4, 4]);
  });

  it('takes the shortest of several changes', () => {
    const pattern = onePattern([
      ev(0, 480, { kind: 'slot', slot: 0 }, { accent: 1 }),
      ev(480, 120, { kind: 'slot', slot: 1 }, { accent: 1 }),
      ev(600, 600, { kind: 'pedal' }),
      ev(1200, 240, { kind: 'slot', slot: 0 }, { accent: 1 }),
      ev(1440, 480, { kind: 'slot', slot: 1 }, { accent: 1 })
    ]);
    // 0 -> 1 after 480 and after 240 ticks; 1 -> 0 after 720 and (looping) 480 ticks
    expect(changeBeats(pattern, 2)).toEqual([0.5, 1]);
  });
});

describe('optimizeSlotShapes', () => {
  const slots = [
    familySlot('E', 'power5', [0, 2, 2, null, null, null], 'a'),
    familySlot('G', 'power5', [3, 5, 5, null, null, null], 'b'),
    familySlot('A', 'power5', [5, 7, 7, null, null, null], 'c')
  ];
  const pattern = generateRhythm({ ...defaultRhythmParams('gallop'), slotCount: 3 }, 'opt-seed');

  it('returns one recipe voicing per slot and a readable hardest change', () => {
    const out = optimizeSlotShapes(slots, pattern, E_STANDARD, profile, 140);
    expect(out.shapes).toHaveLength(3);
    expect(out.fingerings).toHaveLength(3);
    const pcs = [[4, 11], [7, 2], [9, 4]];
    out.shapes.forEach((shape, i) => {
      expect(new Set(shapeToMidi(shape, E_STANDARD).map((m) => m % 12))).toEqual(new Set(pcs[i]));
    });
    expect(out.text).toMatch(/^Hardest change: slot \d -> \d, .* \(cost \d+\.\d\)$/);
    expect(Number.isFinite(out.result.maxCost)).toBe(true);
  });

  it('is never worse than the best path with the candidates own fingerings (brute force)', () => {
    const out = optimizeSlotShapes(slots, pattern, E_STANDARD, profile, 140);
    const beats = changeBeats(pattern, 3);
    const cands = slots.map((s) => slotCandidates(s, E_STANDARD, profile));
    const time = (i: number) => (beats[i] * 60) / 140;
    let best = Infinity;
    for (const a of cands[0]) {
      for (const b of cands[1]) {
        for (const c of cands[2]) {
          const scale = profile.scaleLengthMm;
          const worst = Math.max(
            transitionCost(a, b, { scaleLengthMm: scale, timeSec: time(0) }).cost,
            transitionCost(b, c, { scaleLengthMm: scale, timeSec: time(1) }).cost,
            transitionCost(c, a, { scaleLengthMm: scale, timeSec: time(2) }).cost
          );
          best = Math.min(best, worst);
        }
      }
    }
    expect(out.result.maxCost).toBeLessThanOrEqual(best + 1e-9);
  });

  it('describes a single slot as having no change', () => {
    const single = optimizeSlotShapes([slots[0]], generateRhythm({ ...defaultRhythmParams('gallop'), slotCount: 1 }, 's'), E_STANDARD, profile, 120);
    expect(single.text).toBe('Hardest change: none (one chord)');
  });

  it('throws when a slot has no playable voicing', () => {
    const broken: RhythmSlot = { ...slots[0], source: { kind: 'family', familyId: 'no-such-family' }, shape: [1, null, null, null, null, 13] };
    expect(() => optimizeSlotShapes([broken, slots[1]], pattern, E_STANDARD, profile, 120)).toThrow(/Slot 1/);
  });
});

describe('displayFingering', () => {
  it('fingers playable shapes and returns null for silent ones', () => {
    expect(displayFingering([0, 2, 2, null, null, null], E_STANDARD, profile)?.fingers.filter((f) => f !== null)).toHaveLength(2);
    expect(displayFingering([null, null, null, null, null, null], E_STANDARD, profile)).toBeNull();
  });
});

describe('transport timing', () => {
  it('clicks on quarters in 4/4 and eighths in 7/8, strong on bar starts', () => {
    const fourFour = generateRhythm(defaultRhythmParams('gallop'), 'a');
    const clicks = clickTimes(fourFour, 120);
    expect(clicks).toHaveLength(8);
    expect(clicks.filter((c) => c.strong).map((c) => c.timeSec)).toEqual([0, 2]);
    const seven = generateRhythm(defaultRhythmParams('sevenEight'), 'a');
    const sevenClicks = clickTimes(seven, 120);
    expect(sevenClicks).toHaveLength(14);
    expect(sevenClicks[1].timeSec).toBeCloseTo(0.25, 9);
    expect(sevenClicks.filter((c) => c.strong).map((c) => c.timeSec)).toEqual([0, 1.75]);
    expect(loopSeconds(seven, 120)).toBeCloseTo(3.5, 9);
  });
});

describe('grid labels', () => {
  it('counts 16ths as 1 e & a and triplets as 1 trip let', () => {
    const fourFour = { numerator: 4, denominator: 4 } as const;
    expect(unitPosition(5, fourFour, '16th')).toMatchObject({ bar: 1, beat: 2, sub: 'e', isBeatStart: false });
    expect(unitPosition(16, fourFour, '16th')).toMatchObject({ bar: 2, beat: 1, sub: '', label: '1', isBarStart: true });
    expect([0, 1, 2, 3].map((u) => unitPosition(u, fourFour, '16th').label)).toEqual(['1', 'e', '&', 'a']);
    expect([0, 1, 2, 3, 4, 5, 6].map((u) => unitPosition(u, fourFour, '16th-triplet').label)).toEqual([
      '1', 'trip', 'let', '&', 'trip', 'let', '2'
    ]);
  });

  it('counts eighths in 7/8', () => {
    const seven = { numerator: 7, denominator: 8 } as const;
    expect(unitPosition(13, seven, '16th')).toMatchObject({ bar: 1, beat: 7, sub: '&' });
    expect(unitPosition(14, seven, '16th')).toMatchObject({ bar: 2, beat: 1, isBarStart: true });
    expect([0, 1, 2, 3].map((u) => unitPosition(u, seven, '16th-triplet').label)).toEqual(['1', 'trip', 'let', '2']);
  });

  it('builds lanes pedal, slots, dead', () => {
    expect(rhythmLanes(2, ['E5']).map((l) => l.label)).toEqual(['Pedal', '1 E5', 'Slot 2', 'Dead']);
  });

  it('describes cells for screen readers', () => {
    const pattern = onePattern([
      ev(0, 240, { kind: 'dyad', slot: 0 }, { accent: 2 }),
      ev(240, 120, { kind: 'pedal' }, { palmMute: true, accent: 1 }),
      ev(360, 120, { kind: 'pedal' }, { palmMute: true, pick: 'up' }),
      ev(480, 240, { kind: 'slot', slot: 1 }, { accent: 1 }),
      ev(720, 240, { kind: 'slot', slot: 1 }, { tie: true })
    ]);
    const columns = gridColumns(pattern);
    expect(columns).toHaveLength(16);
    const lanes = rhythmLanes(2);
    const meter = pattern.meter;
    const at = (unit: number, lane: number) => describeCell(unitPosition(unit, meter, '16th'), lanes[lane], columns[unit]);
    expect(at(0, 1)).toBe('Bar 1, beat 1, slot 1, dyad, strong accent, down');
    expect(at(1, 1)).toBe('Bar 1, beat 1, e, slot 1, held');
    expect(at(2, 0)).toBe('Bar 1, beat 1, &, pedal, palm muted, accent, down');
    expect(at(3, 0)).toBe('Bar 1, beat 1, a, pedal, palm muted, up');
    expect(at(3, 1)).toBe('Bar 1, beat 1, a, slot 1, empty');
    expect(at(6, 2)).toBe('Bar 1, beat 2, &, slot 2, tied');
    expect(at(12, 0)).toBe('Bar 1, beat 4, pedal, rest');
  });

  it('toggles the cell event target when the lane owns it', () => {
    const pattern = onePattern([ev(0, 240, { kind: 'dyad', slot: 0 }, { accent: 2 })]);
    const columns = gridColumns(pattern);
    const lanes = rhythmLanes(2);
    expect(toggleTargetFor(lanes[1], columns[0])).toEqual({ kind: 'dyad', slot: 0 });
    expect(toggleTargetFor(lanes[2], columns[0])).toEqual({ kind: 'slot', slot: 1 });
    expect(toggleTargetFor(lanes[0], columns[4])).toEqual({ kind: 'pedal' });
  });
});

describe('progressionFromRiffSteps', () => {
  const step = (key: string, name: string, notes: string[], shape?: (number | null)[], tuningId = E_STANDARD.id) => ({
    key,
    name,
    subtext: '',
    notes,
    shape,
    tuningId: shape ? tuningId : undefined
  });

  it('keeps every step in order, repeats included, on the exact shape it was added with', () => {
    const chords = progressionFromRiffSteps(
      [
        step('a', 'E5', ['E2', 'B2', 'E3'], [0, 2, 2, null, null, null]),
        step('b', 'G5', ['G2', 'D3', 'G3'], [3, 5, 5, null, null, null]),
        step('c', 'E5', ['E2', 'B2', 'E3'], [0, 2, 2, null, null, null])
      ],
      E_STANDARD,
      profile
    );
    expect(chords.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(chords.map((c) => c.shape)).toEqual([
      [0, 2, 2, null, null, null],
      [3, 5, 5, null, null, null],
      [0, 2, 2, null, null, null]
    ]);
    expect(chords.map((c) => c.root)).toEqual(['E', 'G', 'E']);
    expect(chords[0].pedalMidi).toBe(40);
  });

  it('re-voices a step whose shape belongs to another tuning to the same notes', () => {
    const [chord] = progressionFromRiffSteps([step('a', 'E5', ['E2', 'B2', 'E3'], [0, 2, 2, null, null, null])], DROP_D, profile);
    expect(shapeToMidi(chord.shape, DROP_D).sort((x, y) => x - y)).toEqual([40, 47, 52]);
    expect(chord.tuningId).toBe(DROP_D.id);
  });

  it('derives a voicing for older steps without a shape, and ignores a shape that does not sound the notes', () => {
    const chords = progressionFromRiffSteps(
      [step('a', 'Em', ['E2', 'B2', 'E3', 'G3']), step('b', 'G5', ['G2', 'D3', 'G3'], [0, 2, 2, null, null, null])],
      E_STANDARD,
      profile
    );
    expect(shapeToMidi(chords[0].shape, E_STANDARD).sort((x, y) => x - y)).toEqual([40, 47, 52, 55]);
    expect(shapeToMidi(chords[1].shape, E_STANDARD).sort((x, y) => x - y)).toEqual([43, 50, 55]);
  });

  it('lets a lab-only voicing win for its step and tuning', () => {
    const overrides = { [progressionOverrideKey('a', E_STANDARD.id)]: [12, 14, 14, null, null, null] };
    const [chord] = progressionFromRiffSteps([step('a', 'E5', ['E2', 'B2', 'E3'], [0, 2, 2, null, null, null])], E_STANDARD, profile, overrides);
    expect(chord.shape).toEqual([12, 14, 14, null, null, null]);
    const [drop] = progressionFromRiffSteps([step('a', 'E5', ['E2', 'B2', 'E3'], [0, 2, 2, null, null, null])], DROP_D, profile, overrides);
    expect(drop.shape).not.toEqual([12, 14, 14, null, null, null]);
  });

  it('skips steps without readable notes and caps the progression at 16 chords', () => {
    const many = Array.from({ length: 20 }, (_, i) => step(`s${i}`, 'E5', ['E2', 'B2', 'E3'], [0, 2, 2, null, null, null]));
    expect(progressionFromRiffSteps([step('x', '??', ['nope']), ...many], E_STANDARD, profile)).toHaveLength(16);
  });
});

describe('distinctChords', () => {
  it('keeps the first of each chord in order, up to four', () => {
    const chord = (id: string, label: string, shape: (number | null)[]) => familySlot('E', 'power5', shape, id) && { ...familySlot('E', 'power5', shape, id), label };
    const list = [
      chord('a', 'E5', [0, 2, 2, null, null, null]),
      chord('b', 'G5', [3, 5, 5, null, null, null]),
      chord('c', 'E5', [0, 2, 2, null, null, null]),
      chord('d', 'A5', [5, 7, 7, null, null, null]),
      chord('e', 'C5', [8, 10, 10, null, null, null]),
      chord('f', 'D5', [10, 12, 12, null, null, null])
    ];
    expect(distinctChords(list).map((c) => c.id)).toEqual(['a', 'b', 'd', 'e']);
  });
});

describe('optimizeProgressionShapes', () => {
  it('returns one voicing per chord and names the hardest chord change', () => {
    const chords = progressionFromRiffSteps(
      [
        { key: 'a', name: 'E5', subtext: '', notes: ['E2', 'B2', 'E3'] },
        { key: 'b', name: 'G5', subtext: '', notes: ['G2', 'D3', 'G3'] },
        { key: 'c', name: 'A5', subtext: '', notes: ['A2', 'E3', 'A3'] }
      ],
      E_STANDARD,
      profile
    );
    const pattern = generateRhythm({ ...defaultRhythmParams('gallop'), slotCount: 1 }, 'prog');
    const out = optimizeProgressionShapes(chords, pattern, 'bar', E_STANDARD, profile, 140);
    expect(out.shapes).toHaveLength(3);
    expect(out.fingerings).toHaveLength(3);
    expect(out.text).toMatch(/^Hardest change: chord \d -> \d/);
  });
});

describe('chord lane', () => {
  it('has a single Chord lane when a progression decides the chord by bar', () => {
    expect(rhythmLanes(1, ['E5'], true).map((l) => [l.id, l.label, l.short])).toEqual([
      ['pedal', 'Pedal', 'Ped'],
      ['slot-0', 'Chord', 'Ch'],
      ['dead', 'Dead', 'Dead']
    ]);
  });
});
