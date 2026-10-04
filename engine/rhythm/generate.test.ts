import { describe, it, expect } from 'vitest';
import { generateRhythm, sanitizeRhythmParams } from './generate';
import { RHYTHM_STYLES, RHYTHM_STYLE_IDS, defaultRhythmParams } from './styles';
import { validateRhythm } from './validate';
import { patternLengthTicks } from './grid';
import { createRng } from '../random';
import type { GroupingSpec, RhythmParams, RhythmPattern } from '../types';

const SEEDS = ['a', 'b', 'c', 'riff-1', 'riff-2', 'djent', 'x9', '42', 'night', 'sludge', 'z', 'Q7'];

const expectValid = (pattern: RhythmPattern) => {
  const result = validateRhythm(pattern);
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
};

/** Slot index may only change on an accented attack; the first accented hit uses slot 0. */
const expectHarmonyOnAccents = (pattern: RhythmPattern) => {
  let current: number | null = null;
  let firstAccent = true;
  for (const e of pattern.events) {
    if (e.target.kind !== 'slot' && e.target.kind !== 'dyad') continue;
    if (!e.tie && e.accent > 0 && firstAccent) {
      expect(e.target.slot).toBe(0);
      firstAccent = false;
    }
    if (current !== null && e.target.slot !== current) {
      expect(e.tie).toBeFalsy();
      expect(e.accent).toBeGreaterThan(0);
    }
    current = e.target.slot;
  }
};

describe('RHYTHM_STYLES', () => {
  it('defines every style with a label, description and default params', () => {
    expect(RHYTHM_STYLE_IDS).toHaveLength(9);
    for (const style of RHYTHM_STYLE_IDS) {
      const info = RHYTHM_STYLES[style];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(10);
      expect(info.params.style).toBe(style);
      expect(info.params.bars).toBe(2);
      expect(info.params.slotCount).toBe(2);
    }
  });

  it('hands out independent copies of the defaults', () => {
    const a = defaultRhythmParams('fiveOverFour');
    (a.meter as { numerator: number }).numerator = 3;
    expect(defaultRhythmParams('fiveOverFour').meter.numerator).toBe(4);
    expect(RHYTHM_STYLES.fiveOverFour.params.meter.numerator).toBe(4);
  });

  it('uses downstrokes for the halftime stomp and alternate picking elsewhere', () => {
    expect(defaultRhythmParams('halftimeStomp').picking).toBe('downstrokes');
    expect(defaultRhythmParams('gallop').picking).toBe('alternate');
    expect(defaultRhythmParams('tremoloWall').picking).toBe('alternate');
  });
});

describe('generateRhythm validity', () => {
  it.each(RHYTHM_STYLE_IDS)('%s: valid for every seed with default params', (style) => {
    for (const seed of SEEDS) {
      const pattern = generateRhythm(defaultRhythmParams(style), seed);
      expectValid(pattern);
      expectHarmonyOnAccents(pattern);
      expect(pattern.events.length).toBeGreaterThan(0);
      expect(pattern.ppq).toBe(480);
      expect(pattern.id).toBe(`${style}-${seed}`);
      expect(pattern.name.startsWith(RHYTHM_STYLES[style].label)).toBe(true);
      expect(pattern.seed).toBe(seed);
    }
  });

  it.each(RHYTHM_STYLE_IDS)('%s: valid on the triplet grid, with 1 and 4 bars, 1..4 slots and anticipation', (style) => {
    const variants: Partial<RhythmParams>[] = [
      { grid: '16th-triplet' },
      { bars: 1 },
      { bars: 4 },
      { slotCount: 1 },
      { slotCount: 3 },
      { slotCount: 4, bars: 4 },
      { anticipation: true },
      { picking: 'downstrokes' },
      { density: 0, syncopation: 1, pedalRatio: 0, palmMuteRatio: 0 },
      { density: 1, syncopation: 1, pedalRatio: 1, palmMuteRatio: 1 },
      { grouping: 'random-odd' },
      { grouping: '3-3-2', cycleSixteenths: 7 },
      { meter: { numerator: 7, denominator: 8 } },
      { meter: { numerator: 5, denominator: 4 }, grid: '16th-triplet' }
    ];
    for (const variant of variants) {
      for (const seed of SEEDS.slice(0, 6)) {
        const pattern = generateRhythm({ ...defaultRhythmParams(style), ...variant }, seed);
        expectValid(pattern);
        expectHarmonyOnAccents(pattern);
      }
    }
  });

  it('keeps every event inside the pattern and slots below slotCount', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      for (const slotCount of [1, 2, 3, 4]) {
        const pattern = generateRhythm({ ...defaultRhythmParams(style), slotCount, bars: 4 }, `slots-${slotCount}`);
        const length = patternLengthTicks(pattern);
        for (const e of pattern.events) {
          expect(e.tick + e.durationTicks).toBeLessThanOrEqual(length);
          if (e.target.kind === 'slot' || e.target.kind === 'dyad') expect(e.target.slot).toBeLessThan(slotCount);
        }
      }
    }
  });

  it('uses more than one slot across a multi-bar pattern for most seeds', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      const moving = SEEDS.filter((seed) => {
        const p = generateRhythm({ ...defaultRhythmParams(style), bars: 4 }, seed);
        return new Set(p.events.flatMap((e) => (e.target.kind === 'slot' || e.target.kind === 'dyad' ? [e.target.slot] : []))).size > 1;
      });
      expect(moving.length).toBeGreaterThanOrEqual(SEEDS.length / 2);
    }
  });

  it('plays every harmony slot whenever there are at least as many accents as slots', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      for (const slotCount of [2, 3, 4]) {
        for (const bars of [1, 2, 4]) {
          for (const seed of SEEDS) {
            const p = generateRhythm({ ...defaultRhythmParams(style), slotCount, bars }, seed);
            const accents = p.events.filter((e) => !e.tie && e.accent > 0).length;
            if (accents < slotCount) continue;
            const used = new Set(p.events.flatMap((e) => (e.target.kind === 'slot' || e.target.kind === 'dyad' ? [e.target.slot] : [])));
            expect(used.size, `${style} ${seed} slots ${slotCount} bars ${bars}`).toBe(slotCount);
          }
        }
      }
    }
  });

  it('includes ties, rests, palm mutes and accents somewhere in the vocabulary', () => {
    const all = RHYTHM_STYLE_IDS.flatMap((style) => SEEDS.map((seed) => generateRhythm(defaultRhythmParams(style), seed)));
    const events = all.flatMap((p) => p.events);
    expect(events.some((e) => e.tie)).toBe(true);
    expect(events.some((e) => e.palmMute)).toBe(true);
    expect(events.some((e) => e.accent === 1)).toBe(true);
    expect(events.some((e) => e.accent === 2)).toBe(true);
    expect(events.some((e) => e.target.kind === 'dead')).toBe(true);
    const hasRest = (p: RhythmPattern) =>
      p.events.some((e, i) => e.tick + e.durationTicks < (p.events[i + 1]?.tick ?? patternLengthTicks(p)));
    expect(all.some(hasRest)).toBe(true);
  });
});

describe('generateRhythm determinism', () => {
  it('returns deep-equal patterns for equal params and seed', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      const params = defaultRhythmParams(style);
      expect(generateRhythm(params, 'same')).toEqual(generateRhythm(defaultRhythmParams(style), 'same'));
    }
  });

  it('usually differs between seeds', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      const distinct = new Set(SEEDS.slice(0, 6).map((seed) => JSON.stringify(generateRhythm(defaultRhythmParams(style), seed).events)));
      expect(distinct.size).toBeGreaterThanOrEqual(4);
    }
  });

  it('does not mutate its input params', () => {
    const params = defaultRhythmParams('gallop');
    const before = JSON.stringify(params);
    generateRhythm(params, 'pure');
    expect(JSON.stringify(params)).toBe(before);
  });
});

describe('grids and meters', () => {
  it('places 16th-grid events on 120 ticks (60 inside tremolo cells)', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      for (const seed of SEEDS.slice(0, 4)) {
        const pattern = generateRhythm(defaultRhythmParams(style), seed);
        const step = style === 'tremoloWall' ? 60 : 120;
        expect(pattern.events.every((e) => e.tick % step === 0 && e.durationTicks % step === 0)).toBe(true);
        expect(pattern.tags).not.toContain('triplet');
      }
    }
  });

  it('places triplet-grid events on 80-tick units and tags them', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      const pattern = generateRhythm({ ...defaultRhythmParams(style), grid: '16th-triplet' }, 'trip');
      expect(pattern.events.every((e) => e.tick % 80 === 0 && e.durationTicks % 80 === 0)).toBe(true);
      expect(pattern.tags).toContain('triplet');
    }
  });

  it('builds 7/8 bars of 1680 ticks grouped 2+2+3', () => {
    const pattern = generateRhythm(defaultRhythmParams('sevenEight'), 'odd');
    expect(pattern.meter).toEqual({ numerator: 7, denominator: 8 });
    expect(patternLengthTicks(pattern)).toBe(3360);
    expect(pattern.events[pattern.events.length - 1].tick).toBeLessThan(3360);
    expect(pattern.cycleTicks).toBeUndefined();
    expect(pattern.tags).toContain('odd-meter');
  });

  it('sets cycleTicks 600 for the five-over-four polymeter and drifts its accents across the barline', () => {
    const pattern = generateRhythm(defaultRhythmParams('fiveOverFour'), 'poly');
    expect(pattern.cycleTicks).toBe(600);
    expect(pattern.tags).toContain('polymeter');
    const strong = pattern.events.filter((e) => e.accent === 2).map((e) => e.tick);
    expect(strong).toEqual([0, 600, 1200, 1800, 2400, 3000, 3600]);
    const barOffsets = (bar: number) => strong.filter((t) => Math.floor(t / 1920) === bar).map((t) => t % 1920);
    expect(barOffsets(0)).toEqual([0, 600, 1200, 1800]);
    expect(barOffsets(1)).toEqual([480, 1080, 1680]);
  });
});

describe('generateRhythm fuzz', () => {
  it('stays valid for 300 seeded random parameter combinations', () => {
    const rng = createRng('fuzz');
    const groupings: GroupingSpec[] = ['even', '3-3-2', '3-3-3-3-4', 'random-odd', [3, 2], [2, 2, 3], [5]];
    for (let i = 0; i < 300; i++) {
      const params: RhythmParams = {
        ...defaultRhythmParams(rng.pick(RHYTHM_STYLE_IDS)),
        meter: { numerator: rng.int(1, 13), denominator: rng.pick([4, 8] as const) },
        bars: rng.int(1, 5),
        grid: rng.pick(['16th', '16th-triplet'] as const),
        grouping: rng.pick(groupings),
        density: rng.next(),
        syncopation: rng.next(),
        pedalRatio: rng.next(),
        palmMuteRatio: rng.next(),
        slotCount: rng.int(1, 4),
        picking: rng.pick(['alternate', 'downstrokes'] as const),
        anticipation: rng.chance(0.3),
        ...(rng.chance(0.3) ? { cycleSixteenths: rng.int(2, 13) } : {})
      };
      const pattern = generateRhythm(params, `fuzz-${i}`);
      expectValid(pattern);
      expectHarmonyOnAccents(pattern);
    }
  });
});

describe('sanitizeRhythmParams', () => {
  it('clamps out-of-range params into a usable, valid pattern', () => {
    const wild = {
      ...defaultRhythmParams('chugEngine'),
      bars: 0,
      slotCount: 9,
      density: 3,
      syncopation: -1,
      pedalRatio: Number.NaN,
      cycleSixteenths: 1
    } as RhythmParams;
    const clean = sanitizeRhythmParams(wild);
    expect(clean).toMatchObject({ bars: 1, slotCount: 4, density: 1, syncopation: 0, pedalRatio: 0 });
    expect(clean.cycleSixteenths).toBeUndefined();
    const pattern = generateRhythm(wild, 'wild');
    expect(pattern.params).toEqual(clean);
    expectValid(pattern);
  });
});
