// Each style must carry its characteristic figure for every seed, not just on average.
import { describe, it, expect } from 'vitest';
import { generateRhythm } from './generate';
import { defaultRhythmParams } from './styles';
import { cycleGrouping } from './grid';
import type { RhythmEvent, RhythmPattern, RhythmStyleId } from '../types';

const SEEDS = ['a', 'b', 'c', 'riff-1', 'riff-2', 'djent', 'x9', '42', 'night', 'sludge', 'z', 'Q7', 'grind', 'doom'];

const gen = (style: RhythmStyleId, seed: string) => generateRhythm(defaultRhythmParams(style), seed);
const attacks = (p: RhythmPattern): RhythmEvent[] => p.events.filter((e) => !e.tie);
const isSlotHit = (e: RhythmEvent) => e.target.kind === 'slot' || e.target.kind === 'dyad';

describe.each(SEEDS)('style characteristics (seed %s)', (seed) => {
  it('chugEngine: a run of palm-muted pedal 16ths and accented chord stabs', () => {
    const p = gen('chugEngine', seed);
    const ev = p.events;
    const run = ev.some(
      (e, i) =>
        i + 2 < ev.length &&
        [e, ev[i + 1], ev[i + 2]].every((x) => !x.tie && x.target.kind === 'pedal' && x.palmMute) &&
        ev[i + 1].tick - e.tick === 120 &&
        ev[i + 2].tick - ev[i + 1].tick === 120
    );
    expect(run).toBe(true);
    expect(attacks(p).some((e) => e.accent > 0 && isSlotHit(e) && !e.palmMute)).toBe(true);
  });

  it('gallop: an 8th + 16th + 16th figure on the beat', () => {
    const ev = gen('gallop', seed).events;
    const found = ev.some(
      (e, i) =>
        i + 2 < ev.length &&
        !e.tie &&
        !ev[i + 1].tie &&
        !ev[i + 2].tie &&
        e.tick % 480 === 0 &&
        e.durationTicks === 240 &&
        ev[i + 1].tick - e.tick === 240 &&
        ev[i + 2].tick - ev[i + 1].tick === 120
    );
    expect(found).toBe(true);
  });

  it('reverseGallop: a 16th + 16th + 8th figure on the beat', () => {
    const ev = gen('reverseGallop', seed).events;
    const found = ev.some(
      (e, i) =>
        i + 2 < ev.length &&
        !e.tie &&
        !ev[i + 1].tie &&
        !ev[i + 2].tie &&
        e.tick % 480 === 0 &&
        ev[i + 1].tick - e.tick === 120 &&
        ev[i + 2].tick - ev[i + 1].tick === 120 &&
        ev[i + 2].durationTicks === 240
    );
    expect(found).toBe(true);
  });

  it('displacedThrees: accented chords on units 0, 3, 6, 9 and 12 of every bar', () => {
    const p = gen('displacedThrees', seed);
    for (let bar = 0; bar < p.bars; bar++) {
      const accented = attacks(p)
        .filter((e) => e.accent > 0 && Math.floor(e.tick / 1920) === bar)
        .map((e) => (e.tick % 1920) / 120);
      expect(accented).toEqual([0, 3, 6, 9, 12]);
    }
  });

  it('halftimeStomp: accented chords on beats 1 and 3, sparse, all downstrokes', () => {
    const p = gen('halftimeStomp', seed);
    for (let bar = 0; bar < p.bars; bar++) {
      for (const offset of [0, 960]) {
        const e = p.events.find((x) => x.tick === bar * 1920 + offset);
        expect(e && !e.tie && e.accent > 0 && isSlotHit(e)).toBe(true);
      }
      expect(attacks(p).filter((e) => Math.floor(e.tick / 1920) === bar).length).toBeLessThanOrEqual(8);
    }
    expect(p.events.every((e) => e.pick === 'down')).toBe(true);
  });

  it('tremoloWall: 32nd (60-tick) onsets on dyads', () => {
    const p = gen('tremoloWall', seed);
    expect(p.events.some((e) => !e.tie && e.target.kind === 'dyad' && e.tick % 120 === 60 && e.durationTicks === 60)).toBe(true);
    expect(p.tags).toContain('tremolo');
  });

  it('syncopatedStabs: off-beat accented stabs and rests', () => {
    const p = gen('syncopatedStabs', seed);
    expect(attacks(p).some((e) => e.accent > 0 && isSlotHit(e) && e.tick % 480 !== 0)).toBe(true);
    const rest = p.events.some((e, i) => i + 1 < p.events.length && e.tick + e.durationTicks < p.events[i + 1].tick);
    expect(rest).toBe(true);
    expect(p.tags).toContain('syncopated');
  });

  it('sevenEight: 1680-tick bars in 2+2+3 with a strong accent on each downbeat only', () => {
    const p = gen('sevenEight', seed);
    expect(cycleGrouping(p.params, p.seed)).toEqual([4, 4, 6]);
    expect(p.events.filter((e) => e.accent === 2).map((e) => e.tick)).toEqual([0, 1680]);
    expect(p.events.every((e) => e.tick < 3360)).toBe(true);
  });

  it('fiveOverFour: strong accents every 5 sixteenths, crossing the barline', () => {
    const p = gen('fiveOverFour', seed);
    expect(p.cycleTicks).toBe(600);
    const strong = p.events.filter((e) => e.accent === 2).map((e) => e.tick / 120);
    expect(strong).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });
});

describe('style tags', () => {
  it('tags patterns with their style vocabulary', () => {
    expect(gen('gallop', 't').tags).toContain('gallop');
    expect(gen('reverseGallop', 't').tags).toContain('gallop');
    expect(gen('halftimeStomp', 't').tags).toContain('halftime');
    expect(gen('sevenEight', 't').tags).toContain('odd-meter');
    expect(gen('fiveOverFour', 't').tags).toContain('polymeter');
    expect(gen('tremoloWall', 't').tags).toContain('tremolo');
    expect(gen('syncopatedStabs', 't').tags).toContain('syncopated');
    const tags = gen('chugEngine', 't').tags;
    expect(new Set(tags).size).toBe(tags.length);
  });
});
