import { describe, it, expect } from 'vitest';
import {
  PPQ,
  barTicks,
  barUnits,
  buildGroups,
  cycleGrouping,
  firstBeatTicks,
  gridUnitTicks,
  isOddMeter,
  isPolymeter,
  patternLengthTicks,
  patternUnitCount,
  resolveGrouping
} from './grid';
import { defaultRhythmParams } from './styles';
import * as rhythm from './index';
import { createRng } from '../random';
import type { Meter } from '../types';

const m = (numerator: number, denominator: 4 | 8): Meter => ({ numerator, denominator });
const rng = () => createRng('grid-test');

describe('tick math', () => {
  it('uses 480 ticks per quarter note', () => {
    expect(PPQ).toBe(480);
  });

  it('computes bar lengths as numerator * (4 / denominator) quarters', () => {
    expect(barTicks(m(4, 4))).toBe(1920);
    expect(barTicks(m(7, 8))).toBe(1680);
    expect(barTicks(m(3, 4))).toBe(1440);
    expect(barTicks(m(6, 8))).toBe(1440);
    expect(barTicks(m(5, 4))).toBe(2400);
  });

  it('maps grids to unit ticks and counts units per bar', () => {
    expect(gridUnitTicks('16th')).toBe(120);
    expect(gridUnitTicks('16th-triplet')).toBe(80);
    expect(barUnits(m(4, 4), '16th')).toBe(16);
    expect(barUnits(m(4, 4), '16th-triplet')).toBe(24);
    expect(barUnits(m(7, 8), '16th')).toBe(14);
    expect(barUnits(m(7, 8), '16th-triplet')).toBe(21);
  });

  it('derives pattern length and unit count from bars and meter', () => {
    const params = { ...defaultRhythmParams('sevenEight'), bars: 2 };
    const pattern = { bars: 2, meter: m(7, 8), params };
    expect(patternLengthTicks(pattern)).toBe(3360);
    expect(patternUnitCount(pattern)).toBe(28);
    expect(patternUnitCount({ ...pattern, params: { ...params, grid: '16th-triplet' as const } })).toBe(42);
  });

  it('treats one quarter (or a whole short bar) as the first beat', () => {
    expect(firstBeatTicks(m(4, 4))).toBe(480);
    expect(firstBeatTicks(m(7, 8))).toBe(480);
    expect(firstBeatTicks(m(1, 8))).toBe(240);
  });

  it('classifies odd meters and polymeter cycles', () => {
    expect(isOddMeter(m(7, 8))).toBe(true);
    expect(isOddMeter(m(5, 4))).toBe(true);
    expect(isOddMeter(m(4, 4))).toBe(false);
    expect(isOddMeter(m(3, 4))).toBe(false);
    expect(isOddMeter(m(9, 8))).toBe(false);
    expect(isPolymeter(defaultRhythmParams('fiveOverFour'))).toBe(true);
    expect(isPolymeter(defaultRhythmParams('chugEngine'))).toBe(false);
    expect(isPolymeter({ ...defaultRhythmParams('chugEngine'), cycleSixteenths: 8 })).toBe(false);
    expect(isPolymeter({ ...defaultRhythmParams('chugEngine'), cycleSixteenths: 32 })).toBe(false);
  });
});

describe('resolveGrouping', () => {
  it("'even' follows the beat: quarters in x/4, 2+2+3 eighths in 7/8", () => {
    expect(resolveGrouping('even', 16, m(4, 4), '16th', rng())).toEqual([4, 4, 4, 4]);
    expect(resolveGrouping('even', 14, m(7, 8), '16th', rng())).toEqual([4, 4, 6]);
    expect(resolveGrouping('even', 24, m(4, 4), '16th-triplet', rng())).toEqual([6, 6, 6, 6]);
    expect(resolveGrouping('even', 21, m(7, 8), '16th-triplet', rng())).toEqual([6, 6, 9]);
    expect(resolveGrouping('even', 10, m(5, 8), '16th', rng())).toEqual([4, 6]);
    expect(resolveGrouping('even', 12, m(6, 8), '16th', rng())).toEqual([6, 6]);
  });

  it("'even' splits a polymeter cycle without leaving one-unit groups", () => {
    expect(resolveGrouping('even', 5, m(4, 4), '16th', rng())).toEqual([3, 2]);
    expect(resolveGrouping('even', 9, m(4, 4), '16th', rng())).toEqual([4, 3, 2]);
    expect(resolveGrouping('even', 6, m(4, 4), '16th', rng())).toEqual([4, 2]);
    expect(resolveGrouping('even', 3, m(4, 4), '16th', rng())).toEqual([3]);
  });

  it('repeats the named groupings to fill the cycle', () => {
    expect(resolveGrouping('3-3-2', 16, m(4, 4), '16th', rng())).toEqual([3, 3, 2, 3, 3, 2]);
    expect(resolveGrouping('3-3-3-3-4', 16, m(4, 4), '16th', rng())).toEqual([3, 3, 3, 3, 4]);
    expect(resolveGrouping('3-3-2', 14, m(7, 8), '16th', rng())).toEqual([3, 3, 2, 3, 3]);
  });

  it('uses explicit groups as-is, repeated, merging a truncated single unit', () => {
    expect(resolveGrouping([3, 2], 5, m(4, 4), '16th', rng())).toEqual([3, 2]);
    expect(resolveGrouping([3, 2], 16, m(4, 4), '16th', rng())).toEqual([3, 2, 3, 2, 3, 3]);
    expect(resolveGrouping([1, 2], 4, m(4, 4), '16th', rng())).toEqual([1, 2, 1]);
    expect(resolveGrouping([0, -2], 16, m(4, 4), '16th', rng())).toEqual([4, 4, 4, 4]);
  });

  it("'random-odd' mixes 3s with 2s and 4s, sums to the cycle and is seeded", () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      for (const cycle of [5, 7, 11, 16, 21]) {
        const groups = resolveGrouping('random-odd', cycle, m(4, 4), '16th', createRng(seed));
        expect(groups.reduce((s, g) => s + g, 0)).toBe(cycle);
        expect(groups.every((g) => g >= 2 && g <= 4)).toBe(true);
        expect(groups).toEqual(resolveGrouping('random-odd', cycle, m(4, 4), '16th', createRng(seed)));
      }
    }
    const withThrees = ['a', 'b', 'c', 'd', 'e', 'f'].filter((seed) =>
      resolveGrouping('random-odd', 16, m(4, 4), '16th', createRng(seed)).includes(3)
    );
    expect(withThrees.length).toBeGreaterThanOrEqual(4);
  });
});

describe('buildGroups', () => {
  it('keeps one-bar cycles aligned with the bar (7/8 as 2+2+3)', () => {
    const params = defaultRhythmParams('sevenEight');
    expect(cycleGrouping(params, 'x')).toEqual([4, 4, 6]);
    const groups = buildGroups(params, 'x');
    expect(groups.map((g) => g.startUnit)).toEqual([0, 4, 8, 14, 18, 22]);
    expect(groups.map((g) => g.length)).toEqual([4, 4, 6, 4, 4, 6]);
    expect(groups.map((g) => g.cycle)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('repeats a 5-unit cycle across the barline until the bars are full', () => {
    const params = defaultRhythmParams('fiveOverFour');
    const groups = buildGroups(params, 'x');
    const cycleStarts = groups.filter((g) => g.indexInCycle === 0).map((g) => g.startUnit);
    expect(cycleStarts).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(groups.reduce((s, g) => s + g.length, 0)).toBe(32);
    const last = groups[groups.length - 1];
    expect(last).toMatchObject({ startUnit: 30, length: 2, truncated: true, indexInCycle: 0 });
  });

  it('covers every unit exactly once for any grouping', () => {
    for (const grouping of ['even', '3-3-2', '3-3-3-3-4', 'random-odd', [5, 3]] as const) {
      const params = { ...defaultRhythmParams('chugEngine'), grouping, bars: 3 };
      const groups = buildGroups(params, 'cover');
      let expected = 0;
      for (const g of groups) {
        expect(g.startUnit).toBe(expected);
        expected += g.length;
      }
      expect(expected).toBe(48);
    }
  });
});

describe('public rhythm API', () => {
  it('exposes the accent groups and the cell and slot-count helpers a grid UI needs', () => {
    expect(rhythm.buildGroups).toBe(buildGroups);
    for (const name of ['eventsInUnit', 'setSlotCount', 'eventAtUnit']) expect(rhythm).toHaveProperty(name);
    const group: rhythm.RhythmGroup = buildGroups(defaultRhythmParams('gallop'), 'api')[0];
    expect(group).toMatchObject({ startUnit: 0, cycle: 0, indexInCycle: 0 });
  });
});
