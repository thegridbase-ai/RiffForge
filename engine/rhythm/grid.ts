// Tick math, grid units and accent grouping. 480 PPQ, matching utils/midi.ts.
import type { GroupingSpec, Meter, RhythmGrid, RhythmParams, RhythmPattern } from '../types';
import { createRng, type Rng } from '../random';

export const PPQ = 480;
export const SIXTEENTH_TICKS = 120;
export const TRIPLET_UNIT_TICKS = 80;
export const THIRTY_SECOND_TICKS = 60;

/** numerator * (4 / denominator) quarter notes: 4/4 = 1920, 7/8 = 1680. */
export const barTicks = (meter: Meter): number => (meter.numerator * 4 * PPQ) / meter.denominator;

export const gridUnitTicks = (grid: RhythmGrid): number => (grid === '16th-triplet' ? TRIPLET_UNIT_TICKS : SIXTEENTH_TICKS);

export const barUnits = (meter: Meter, grid: RhythmGrid): number => barTicks(meter) / gridUnitTicks(grid);

export const patternLengthTicks = (pattern: Pick<RhythmPattern, 'bars' | 'meter'>): number =>
  pattern.bars * barTicks(pattern.meter);

/** Grid cells in the whole pattern; edit helpers address events by this unit index. */
export const patternUnitCount = (pattern: Pick<RhythmPattern, 'bars' | 'meter' | 'params'>): number =>
  patternLengthTicks(pattern) / gridUnitTicks(pattern.params.grid);

/** Window that must contain an attack unless params.anticipation: one quarter (two eighths in x/8). */
export const firstBeatTicks = (meter: Meter): number => Math.min(PPQ, barTicks(meter));

type CycleParams = Pick<RhythmParams, 'meter' | 'grid' | 'cycleSixteenths'>;

/** Accent-cycle length in grid units: params.cycleSixteenths, or one bar. */
export const cycleUnits = (params: CycleParams): number => params.cycleSixteenths ?? barUnits(params.meter, params.grid);

/** The accent cycle and the bar drift against each other (neither divides the other). */
export const isPolymeter = (params: CycleParams): boolean => {
  const cycle = cycleUnits(params);
  const bar = barUnits(params.meter, params.grid);
  return cycle % bar !== 0 && bar % cycle !== 0;
};

/** 5/4, 7/8, 11/8 ... Simple triple (3/4) and compound meters (6/8, 9/8, 12/8) are not odd. */
export const isOddMeter = (meter: Meter): boolean =>
  meter.numerator % 2 === 1 && meter.numerator >= 5 && !(meter.denominator === 8 && meter.numerator % 3 === 0);

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** Beat groups of one bar: quarters in x/4; compound x/8 in dotted quarters; other x/8 as 2+2+...+3 eighths. */
const meterGroups = (meter: Meter, grid: RhythmGrid): number[] => {
  const unit = gridUnitTicks(grid);
  if (meter.denominator === 4) return Array.from({ length: meter.numerator }, () => PPQ / unit);
  const eighth = PPQ / 2 / unit;
  const n = meter.numerator;
  let eighths: number[];
  if (n % 3 === 0 && n > 3) eighths = Array.from({ length: n / 3 }, () => 3);
  else if (n === 1) eighths = [1];
  else if (n % 2 === 0) eighths = Array.from({ length: n / 2 }, () => 2);
  else eighths = [...Array.from({ length: (n - 3) / 2 }, () => 2), 3];
  return eighths.map((e) => e * eighth);
};

/** Beat-sized groups; a one-unit remainder is folded into the last two groups (5 -> 3 + 2). */
const splitEvenly = (total: number, size: number): number[] => {
  if (total <= size) return [total];
  const groups = Array.from({ length: Math.floor(total / size) }, () => size);
  const rest = total - groups.length * size;
  if (rest >= 2) groups.push(rest);
  else if (rest === 1) {
    const merged = (groups.pop() as number) + 1;
    groups.push(Math.ceil(merged / 2), Math.floor(merged / 2));
  }
  return groups;
};

/** Repeats `base` until `total` units are filled; a one-unit leftover made by truncation joins the previous group. */
const repeatToFill = (base: readonly number[], total: number): number[] => {
  const groups: number[] = [];
  let sum = 0;
  for (let i = 0; sum < total; i++) {
    const size = Math.min(base[i % base.length], total - sum);
    groups.push(size);
    sum += size;
  }
  const last = groups.length - 1;
  if (last > 0 && groups[last] === 1 && base[last % base.length] !== 1) {
    groups.pop();
    groups[last - 1] += 1;
  }
  return groups;
};

/** Seeded mix of 3s with 2s and 4s; never leaves a single unit. */
const randomOddGroups = (total: number, rng: Rng): number[] => {
  const groups: number[] = [];
  let rest = total;
  while (rest > 0) {
    if (rest <= 3) {
      groups.push(rest);
      break;
    }
    const options = [3, 2, 4].filter((g) => g <= rest && rest - g !== 1);
    const size = rng.weighted(options, options.map((g) => (g === 3 ? 0.55 : g === 2 ? 0.25 : 0.2)));
    groups.push(size);
    rest -= size;
  }
  return groups;
};

/** Partition one accent cycle of `total` grid units into accent groups. */
export const resolveGrouping = (
  spec: GroupingSpec,
  total: number,
  meter: Meter,
  grid: RhythmGrid,
  rng: Rng
): number[] => {
  if (typeof spec !== 'string') {
    const base = spec.filter((g) => Number.isInteger(g) && g > 0);
    return base.length > 0 ? repeatToFill(base, total) : resolveGrouping('even', total, meter, grid, rng);
  }
  switch (spec) {
    case '3-3-2':
      return repeatToFill([3, 3, 2], total);
    case '3-3-3-3-4':
      return repeatToFill([3, 3, 3, 3, 4], total);
    case 'random-odd':
      return randomOddGroups(total, rng);
    default:
      return total === barUnits(meter, grid) ? meterGroups(meter, grid) : splitEvenly(total, PPQ / gridUnitTicks(grid));
  }
};

type GroupingParams = Pick<RhythmParams, 'meter' | 'grid' | 'cycleSixteenths' | 'grouping'>;

/** Group lengths of one accent cycle for these params ('random-odd' is drawn from the seed). */
export const cycleGrouping = (params: GroupingParams, seed: string): number[] =>
  resolveGrouping(params.grouping, cycleUnits(params), params.meter, params.grid, createRng(seed).fork('grouping'));

export interface RhythmGroup {
  index: number;
  startUnit: number;
  length: number;
  /** Which repetition of the accent cycle this group belongs to. */
  cycle: number;
  indexInCycle: number;
  /** Cut short by the end of the pattern. */
  truncated: boolean;
}

/** Lays the cycle's groups end to end, across barlines, until bars * barUnits are filled. */
export const buildGroups = (params: GroupingParams & Pick<RhythmParams, 'bars'>, seed: string): RhythmGroup[] => {
  const total = params.bars * barUnits(params.meter, params.grid);
  const cycle = cycleUnits(params);
  const sizes = cycleGrouping(params, seed);
  const groups: RhythmGroup[] = [];
  for (let c = 0, start = 0; start < total; c++, start += cycle) {
    let offset = 0;
    for (let i = 0; i < sizes.length && start + offset < total; i++) {
      const length = Math.min(sizes[i], total - start - offset);
      groups.push({ index: groups.length, startUnit: start + offset, length, cycle: c, indexInCycle: i, truncated: length < sizes[i] });
      offset += sizes[i];
    }
  }
  return groups;
};
