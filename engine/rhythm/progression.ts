// A rhythm figure repeated over a chord progression: the pattern loops while the harmony moves through the
// progression in order, one chord per bar or half bar. Pure: no clock, no Tone.js.
import type { HitTarget, Meter, RhythmEvent, RhythmPattern } from '../types';
import { PPQ, barTicks, patternLengthTicks } from './grid';

export type ProgressionChange = 'bar' | 'halfBar';

export const MAX_PROGRESSION_CHORDS = 16;
/** Safety cap on the arranged loop; with 1, 2 or 4 bar figures and up to 16 chords it is never reached. */
export const MAX_ARRANGEMENT_BARS = 64;

export interface ProgressionArrangement {
  /** The figure repeated `passes` times. Slot targets are left as written; use slotAt for the harmony. */
  pattern: RhythmPattern;
  passes: number;
  chordCount: number;
  changeTicks: number;
  /** Progression index sounding at `tick` of the arranged loop. */
  slotAt: (tick: number) => number;
}

export const changeTicksFor = (meter: Meter, change: ProgressionChange): number =>
  change === 'bar' ? barTicks(meter) : barTicks(meter) / 2;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const clampChords = (count: number): number =>
  Math.min(MAX_PROGRESSION_CHORDS, Math.max(1, Number.isFinite(count) ? Math.floor(count) : 1));

/**
 * Repeats the figure until the progression and the figure line up again (the least common multiple of their
 * lengths), so the loop always restarts on the first chord and the first beat of the figure.
 */
export const arrangeProgression = (pattern: RhythmPattern, chordCount: number, change: ProgressionChange): ProgressionArrangement => {
  const count = clampChords(chordCount);
  const changeTicks = changeTicksFor(pattern.meter, change);
  const figureTicks = patternLengthTicks(pattern);
  const progressionTicks = count * changeTicks;
  let loopTicks = (figureTicks / gcd(figureTicks, progressionTicks)) * progressionTicks;
  if (loopTicks > MAX_ARRANGEMENT_BARS * barTicks(pattern.meter)) {
    loopTicks = Math.ceil(progressionTicks / figureTicks) * figureTicks;
  }
  const passes = Math.max(1, Math.round(loopTicks / figureTicks));

  const events: RhythmEvent[] = [];
  for (let pass = 0; pass < passes; pass++) {
    const offset = pass * figureTicks;
    for (const event of pattern.events) {
      events.push({ ...event, tick: event.tick + offset, target: { ...event.target } as HitTarget });
    }
  }

  return {
    pattern: { ...pattern, bars: pattern.bars * passes, events },
    passes,
    chordCount: count,
    changeTicks,
    slotAt: (tick: number) => Math.floor(Math.max(0, tick) / changeTicks) % count
  };
};

const isChordAttack = (e: RhythmEvent): boolean => !e.tie && (e.target.kind === 'slot' || e.target.kind === 'dyad');

/**
 * Time to change from each chord to the next one in the progression, in quarter-note beats, over the arranged
 * loop (the change from the last chord wraps to the first). It runs from the last chord attack on chord i to
 * the first chord attack on chord i+1, so pedal hits, dead notes and rests in between count as time to move.
 * Each chord keeps its tightest change. Chords that are never attacked get the length of one change.
 */
export const progressionChangeBeats = (arrangement: ProgressionArrangement): number[] => {
  const { pattern, chordCount, changeTicks, slotAt } = arrangement;
  const length = patternLengthTicks(pattern);
  const attacks = pattern.events.filter(isChordAttack).map((e) => ({ tick: e.tick, chord: slotAt(e.tick) }));
  const best: number[] = Array.from({ length: chordCount }, () => Infinity);
  if (attacks.length > 0 && chordCount > 1) {
    for (let i = 0; i < attacks.length; i++) {
      const from = attacks[i];
      const nextChord = (from.chord + 1) % chordCount;
      // Only the last attack before the harmony moves on matters
      const following = attacks[(i + 1) % attacks.length];
      if (following.chord === from.chord && attacks.length > 1) continue;
      for (let j = 1; j <= attacks.length; j++) {
        const to = attacks[(i + j) % attacks.length];
        if (to.chord !== nextChord) continue;
        const gap = i + j < attacks.length ? to.tick - from.tick : length - from.tick + to.tick;
        if (gap < best[from.chord]) best[from.chord] = gap;
        break;
      }
    }
  }
  return best.map((ticks) => (Number.isFinite(ticks) ? ticks : changeTicks) / PPQ);
};
