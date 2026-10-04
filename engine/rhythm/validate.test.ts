import { describe, it, expect } from 'vitest';
import { validateRhythm } from './validate';
import { defaultRhythmParams } from './styles';
import type { HitTarget, RhythmEvent, RhythmParams, RhythmPattern } from '../types';

const PEDAL: HitTarget = { kind: 'pedal' };

const hit = (tick: number, durationTicks: number, extra: Partial<RhythmEvent> = {}): RhythmEvent => ({
  tick,
  durationTicks,
  target: PEDAL,
  palmMute: true,
  accent: 0,
  pick: (tick / 120) % 2 === 0 ? 'down' : 'up',
  ...extra
});

const pattern = (events: RhythmEvent[], params: Partial<RhythmParams> = {}): RhythmPattern => ({
  id: 'test',
  name: 'Test',
  seed: 'test',
  meter: { numerator: 4, denominator: 4 },
  bars: 1,
  ppq: 480,
  events,
  tags: [],
  params: { ...defaultRhythmParams('chugEngine'), bars: 1, ...params }
});

const sixteenths = (count: number) => Array.from({ length: count }, (_, i) => hit(i * 120, 120));

describe('validateRhythm errors', () => {
  it('accepts a clean pattern', () => {
    expect(validateRhythm(pattern(sixteenths(16)))).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('flags unsorted ticks, non-positive durations, overlaps and events past the end', () => {
    expect(validateRhythm(pattern([hit(0, 120), hit(240, 120), hit(120, 120)])).errors.join(' ')).toMatch(/sorted/);
    expect(validateRhythm(pattern([hit(0, 0)])).errors.join(' ')).toMatch(/duration/);
    expect(validateRhythm(pattern([hit(0, 240), hit(120, 120)])).errors.join(' ')).toMatch(/overlap/);
    expect(validateRhythm(pattern([hit(0, 120), hit(1800, 240)])).errors.join(' ')).toMatch(/pattern length/);
    expect(validateRhythm(pattern([hit(0, 120), hit(1920, 120)])).errors.join(' ')).toMatch(/pattern length/);
  });

  it('flags a bar count or meter that disagrees with the params', () => {
    expect(validateRhythm({ ...pattern(sixteenths(4)), bars: 2 }).ok).toBe(false);
    expect(validateRhythm({ ...pattern(sixteenths(4)), meter: { numerator: 0, denominator: 4 } }).ok).toBe(false);
  });

  it('flags picks that disagree with the picking mode', () => {
    expect(validateRhythm(pattern([hit(0, 120), hit(120, 120, { pick: 'down' })])).errors.join(' ')).toMatch(/pick/);
    const allDown = sixteenths(4).map((e) => ({ ...e, pick: 'down' as const }));
    expect(validateRhythm(pattern(allDown, { picking: 'downstrokes' })).ok).toBe(true);
    expect(validateRhythm(pattern(sixteenths(4), { picking: 'downstrokes' })).ok).toBe(false);
  });

  it('requires an attack in the first beat unless anticipation is allowed', () => {
    const late = [hit(480, 120)];
    expect(validateRhythm(pattern(late)).errors.join(' ')).toMatch(/first beat/);
    expect(validateRhythm(pattern(late, { anticipation: true })).ok).toBe(true);
    const tieOnly = [hit(0, 480, { target: { kind: 'slot', slot: 0 }, palmMute: false }), hit(480, 120)];
    expect(validateRhythm(pattern(tieOnly)).ok).toBe(true);
  });

  it('flags slot indices outside slotCount', () => {
    const events = [hit(0, 120, { target: { kind: 'slot', slot: 2 } })];
    expect(validateRhythm(pattern(events, { slotCount: 2 })).errors.join(' ')).toMatch(/slot/);
    const dyad = [hit(0, 120, { target: { kind: 'dyad', slot: 1 } })];
    expect(validateRhythm(pattern(dyad, { slotCount: 1 })).ok).toBe(false);
    expect(validateRhythm(pattern(dyad, { slotCount: 2 })).ok).toBe(true);
  });

  it('flags a tie as first event and ties that do not continue the previous sound', () => {
    expect(validateRhythm(pattern([hit(0, 120, { tie: true })], { anticipation: true })).errors.join(' ')).toMatch(/tie/);
    const slot0: HitTarget = { kind: 'slot', slot: 0 };
    const good = [hit(0, 240, { target: slot0, palmMute: false }), hit(240, 240, { target: slot0, palmMute: false, tie: true })];
    expect(validateRhythm(pattern(good)).ok).toBe(true);
    const gap = [hit(0, 120, { target: slot0 }), hit(240, 240, { target: slot0, tie: true })];
    expect(validateRhythm(pattern(gap)).errors.join(' ')).toMatch(/tie/);
    const otherTarget = [hit(0, 240, { target: slot0 }), hit(240, 240, { tie: true })];
    expect(validateRhythm(pattern(otherTarget)).errors.join(' ')).toMatch(/tie/);
  });
});

describe('validateRhythm tooFastForProfile', () => {
  it('warns above the tempo where the fastest notes exceed the comfortable sixteenth tempo', () => {
    const p = pattern(sixteenths(16));
    expect(validateRhythm(p, { bpm: 110, comfortableSixteenthBpm: 110 }).warnings).toEqual([]);
    const fast = validateRhythm(p, { bpm: 111, comfortableSixteenthBpm: 110 });
    expect(fast.ok).toBe(true);
    expect(fast.warnings).toHaveLength(1);
    expect(fast.warnings[0]).toMatchObject({ code: 'tooFastForProfile', minIoiTicks: 120, bpmLimit: 110 });
  });

  it('scales the limit with the smallest inter-onset interval', () => {
    const eighths = pattern(Array.from({ length: 8 }, (_, i) => hit(i * 240, 240)));
    expect(validateRhythm(eighths, { bpm: 220, comfortableSixteenthBpm: 110 }).warnings).toEqual([]);
    expect(validateRhythm(eighths, { bpm: 221, comfortableSixteenthBpm: 110 }).warnings[0].bpmLimit).toBe(220);
    const thirtySeconds = pattern(Array.from({ length: 4 }, (_, i) => hit(i * 60, 60, { pick: i % 2 === 0 ? 'down' : 'up' })));
    const w = validateRhythm(thirtySeconds, { bpm: 60, comfortableSixteenthBpm: 110 }).warnings[0];
    expect(w).toMatchObject({ minIoiTicks: 60, bpmLimit: 55 });
    const triplets = pattern(Array.from({ length: 6 }, (_, i) => hit(i * 80, 80)).map((e, i) => ({ ...e, pick: i % 2 === 0 ? 'down' : 'up' })));
    expect(validateRhythm(triplets, { bpm: 74, comfortableSixteenthBpm: 110 }).warnings[0].bpmLimit).toBe(73);
  });

  it('ignores ties when measuring the inter-onset interval', () => {
    const slot0: HitTarget = { kind: 'slot', slot: 0 };
    const events = [
      hit(0, 120, { target: slot0, palmMute: false }),
      hit(120, 120, { target: slot0, palmMute: false, tie: true }),
      hit(240, 240)
    ];
    const w = validateRhythm(pattern(events), { bpm: 300, comfortableSixteenthBpm: 110 }).warnings[0];
    expect(w.minIoiTicks).toBe(240);
  });

  it('defaults to the default hand profile tempo and needs a bpm to warn', () => {
    const p = pattern(sixteenths(16));
    expect(validateRhythm(p, { bpm: 115 }).warnings).toHaveLength(1);
    expect(validateRhythm(p).warnings).toEqual([]);
  });
});
