import { describe, it, expect } from 'vitest';
import { mutateRhythm, regenerateRhythm } from './variation';
import { generateRhythm } from './generate';
import { RHYTHM_STYLE_IDS, defaultRhythmParams } from './styles';
import { validateRhythm } from './validate';
import { barTicks } from './grid';
import { rhythmToPlaybackEvents } from './playback';
import { E_STANDARD } from '../tuning';
import type { HarmonySlot, HitTarget, RhythmEvent, RhythmPattern } from '../types';

const SEEDS = ['a', 'b', 'c', 'riff-1', 'djent', '42'];

const expectValid = (p: RhythmPattern) => expect(validateRhythm(p).errors).toEqual([]);
const eventsInBar = (p: RhythmPattern, bar: number) =>
  p.events.filter((e) => Math.floor(e.tick / barTicks(p.meter)) === bar);

/** Ticks where the harmony slot changes on something other than an accented attack. */
const unaccentedSlotChanges = (p: RhythmPattern): number[] => {
  let current: number | null = null;
  const bad: number[] = [];
  for (const e of p.events) {
    if (e.target.kind !== 'slot' && e.target.kind !== 'dyad') continue;
    if (current !== null && e.target.slot !== current && (e.tie || e.accent === 0)) bad.push(e.tick);
    current = e.target.slot;
  }
  return bad;
};

const SLOTS: HarmonySlot[] = [
  { shape: [0, 2, 2, null, null, null], pedalMidi: 40 },
  { shape: [1, 3, 3, null, null, null], pedalMidi: 41 },
  { shape: [3, 5, 5, null, null, null], pedalMidi: 43 },
  { shape: [5, 7, 7, null, null, null], pedalMidi: 45 }
];

/** What the notes that start in these bars sound like: pitches, timing, length and velocity. */
const soundOfBars = (p: RhythmPattern, bars: readonly number[]) =>
  rhythmToPlaybackEvents(p, SLOTS, E_STANDARD, 120).filter((e) => bars.includes(Math.floor(e.tick / barTicks(p.meter))));

const LOCK_SETS = [[0], [1], [2], [1, 2]];

describe('mutateRhythm', () => {
  it('keeps validity and changes something for every style', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      for (const seed of SEEDS) {
        const base = generateRhythm(defaultRhythmParams(style), seed);
        for (const m of ['m1', 'm2', 'm3', 'm4']) {
          const mutated = mutateRhythm(base, m);
          expectValid(mutated);
          expect(mutated.events).not.toEqual(base.events);
          expect(mutated.params).toEqual(base.params);
        }
      }
    }
  });

  it('is deterministic per seed, varies across seeds and leaves the input alone', () => {
    const base = generateRhythm(defaultRhythmParams('gallop'), 'mut');
    const snapshot = JSON.stringify(base);
    expect(mutateRhythm(base, 'x')).toEqual(mutateRhythm(base, 'x'));
    const distinct = new Set(['1', '2', '3', '4', '5', '6'].map((s) => JSON.stringify(mutateRhythm(base, s).events)));
    expect(distinct.size).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('is only a small change', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      const base = generateRhythm({ ...defaultRhythmParams(style), bars: 4 }, 'small');
      const mutated = mutateRhythm(base, 'small');
      const key = (e: RhythmEvent) => JSON.stringify([e.tick, e.durationTicks, e.target, e.palmMute, e.accent, !!e.tie]);
      const before = new Set(base.events.map(key));
      const changed = mutated.events.filter((e) => !before.has(key(e))).length;
      expect(changed).toBeLessThanOrEqual(Math.ceil(base.events.length / 3));
    }
  });

  it('never makes the harmony change on an unaccented hit, also when pushes are re-rendered', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      for (const bars of [2, 4]) {
        for (const slotCount of [2, 3, 4]) {
          for (let i = 0; i < 40; i++) {
            const base = generateRhythm({ ...defaultRhythmParams(style), bars, slotCount, syncopation: 1 }, `s${i}`);
            for (const m of ['m1', 'm6']) {
              expect(unaccentedSlotChanges(mutateRhythm(base, m)), `${style} ${bars} ${slotCount} s${i} ${m}`).toEqual([]);
            }
          }
        }
      }
    }
  });

  it('can still mutate a hand-edited pattern with a single slot', () => {
    const base = generateRhythm({ ...defaultRhythmParams('chugEngine'), slotCount: 1 }, 'one');
    const mutated = mutateRhythm(base, 'one');
    expectValid(mutated);
    expect(mutated.events).not.toEqual(base.events);
  });
});

describe('regenerateRhythm', () => {
  it('keeps every event of the locked bars exactly and stays valid', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      for (const seed of SEEDS) {
        const base = generateRhythm({ ...defaultRhythmParams(style), bars: 4 }, seed);
        for (const locked of [[0], [1], [3], [0, 2], [1, 2]]) {
          const next = regenerateRhythm(base, `${seed}-new`, locked);
          expectValid(next);
          for (const bar of locked) expect(eventsInBar(next, bar)).toEqual(eventsInBar(base, bar));
          expect(next.seed).toBe(`${seed}-new`);
        }
      }
    }
  });

  it('changes the unlocked bars for most seeds', () => {
    let changed = 0;
    for (const seed of SEEDS) {
      const base = generateRhythm(defaultRhythmParams('chugEngine'), seed);
      const next = regenerateRhythm(base, `${seed}-other`, [0]);
      if (JSON.stringify(eventsInBar(next, 1)) !== JSON.stringify(eventsInBar(base, 1))) changed++;
    }
    expect(changed).toBeGreaterThanOrEqual(SEEDS.length - 1);
  });

  it('equals a fresh generation when nothing is locked and the original when everything is', () => {
    const base = generateRhythm(defaultRhythmParams('gallop'), 'base');
    expect(regenerateRhythm(base, 'fresh', [])).toEqual(generateRhythm(defaultRhythmParams('gallop'), 'fresh'));
    expect(regenerateRhythm(base, 'fresh', [0, 1]).events).toEqual(base.events);
    expect(regenerateRhythm(base, 'fresh', [7, -1, 0.5])).toEqual(generateRhythm(defaultRhythmParams('gallop'), 'fresh'));
  });

  it('changes the harmony only on accented attacks, also at the edges of locked bars', () => {
    const five = regenerateRhythm(generateRhythm(defaultRhythmParams('fiveOverFour'), 'd8'), 'e8', [0]);
    expect(unaccentedSlotChanges(five)).toEqual([]);
    for (const style of RHYTHM_STYLE_IDS) {
      for (const slotCount of [2, 3, 4]) {
        for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const base = generateRhythm({ ...defaultRhythmParams(style), bars: 4, slotCount }, `h${i}`);
          for (const locked of LOCK_SETS) {
            const next = regenerateRhythm(base, `h${i}-new`, locked);
            expect(unaccentedSlotChanges(next), `${style} h${i} slots ${slotCount} locked ${locked}`).toEqual([]);
          }
        }
      }
    }
  });

  it('turns a fresh push whose head fell in a locked bar back into an accented downbeat', () => {
    const base = generateRhythm({ ...defaultRhythmParams('gallop'), bars: 4, slotCount: 3 }, 'q21');
    const next = regenerateRhythm(base, 'w21', [0]);
    expectValid(next);
    const downbeat = next.events.find((e) => e.tick === 1920);
    expect(downbeat?.tie).toBeUndefined();
    expect(downbeat?.accent).toBe(2);
    expect(next.events.some((e) => e.tie && e.palmMute)).toBe(false);
  });

  it('keeps the sound of the locked bars: pedal pitch, pushes and their ties', () => {
    const push = generateRhythm(defaultRhythmParams('chugEngine'), 'orig2');
    const kept = regenerateRhythm(push, 'new2', [0]);
    expect(kept.events.find((e) => e.tick === 1920)).toMatchObject({ tie: true });
    expect(soundOfBars(kept, [0])).toEqual(soundOfBars(push, [0]));
    for (const style of RHYTHM_STYLE_IDS) {
      for (const i of [0, 1, 2, 3, 4, 5]) {
        const base = generateRhythm({ ...defaultRhythmParams(style), bars: 4, slotCount: 4 }, `orig${i}`);
        for (const locked of LOCK_SETS) {
          const next = regenerateRhythm(base, `new${i}`, locked);
          expect(soundOfBars(next, locked), `${style} orig${i} locked ${locked}`).toEqual(soundOfBars(base, locked));
        }
      }
    }
  });

  it('recovers a pattern whose slotCount was lowered by hand', () => {
    const base = generateRhythm({ ...defaultRhythmParams('syncopatedStabs'), slotCount: 4 }, 'k1');
    const stale: RhythmPattern = { ...base, params: { ...base.params, slotCount: 2 } };
    expect(validateRhythm(stale).ok).toBe(false);
    expectValid(regenerateRhythm(stale, 'z', [0]));
    const folded = regenerateRhythm(stale, 'z', [0, 1]);
    expectValid(folded);
    const mutated = mutateRhythm(stale, 'z');
    expectValid(mutated);
    expect(mutated.events).not.toEqual(folded.events);
  });

  it('keeps the source of a tie that sustains into a locked bar', () => {
    const slot1: HitTarget = { kind: 'slot', slot: 1 };
    const base: RhythmPattern = {
      ...generateRhythm(defaultRhythmParams('chugEngine'), 'tie'),
      events: [
        { tick: 0, durationTicks: 1800, target: { kind: 'slot', slot: 0 }, palmMute: false, accent: 2, pick: 'down' },
        { tick: 1800, durationTicks: 120, target: slot1, palmMute: false, accent: 1, pick: 'up' },
        { tick: 1920, durationTicks: 240, target: slot1, palmMute: false, accent: 0, pick: 'down', tie: true },
        { tick: 2160, durationTicks: 1680, target: { kind: 'pedal' }, palmMute: true, accent: 0, pick: 'down' }
      ]
    };
    expectValid(base);
    for (const seed of SEEDS) {
      const next = regenerateRhythm(base, seed, [1]);
      expectValid(next);
      expect(eventsInBar(next, 1)).toEqual(eventsInBar(base, 1));
      expect(next.events.find((e) => e.tick === 1800)).toMatchObject({ target: slot1, accent: 1 });
    }
  });
});
