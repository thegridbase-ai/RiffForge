import { describe, it, expect } from 'vitest';
import type { HarmonySlot, RhythmEvent, RhythmPattern } from '../types';
import { E_STANDARD } from '../tuning';
import { generateRhythm } from './generate';
import { defaultRhythmParams } from './styles';
import { arrangeProgression, changeTicksFor, progressionChangeBeats, MAX_PROGRESSION_CHORDS } from './progression';
import { rhythmToMidiNotes, rhythmToPlaybackEvents } from './playback';
import { patternLengthTicks } from './grid';

const ev = (tick: number, kind: 'pedal' | 'slot' | 'dead', extra: Partial<RhythmEvent> = {}): RhythmEvent => ({
  tick,
  durationTicks: 120,
  target: kind === 'slot' ? { kind: 'slot', slot: 0 } : { kind },
  palmMute: kind === 'pedal',
  accent: kind === 'slot' ? 1 : 0,
  pick: 'down',
  ...extra
});

/** One bar of 4/4: chord on beat 1, pedal chugs on the other beats. */
const figure = (bars = 1): RhythmPattern => {
  const params = { ...defaultRhythmParams('chugEngine'), bars, slotCount: 1 };
  const events: RhythmEvent[] = [];
  for (let b = 0; b < bars; b++) {
    events.push(ev(b * 1920, 'slot'), ev(b * 1920 + 480, 'pedal'), ev(b * 1920 + 960, 'pedal'), ev(b * 1920 + 1440, 'pedal'));
  }
  return { id: 'fig', name: 'Fig', seed: 's', meter: { numerator: 4, denominator: 4 }, bars, ppq: 480, events, tags: [], params };
};

// E5, G5, A5 power chords in E standard (string 0 = low E)
const E5: HarmonySlot = { shape: [0, 2, 2, null, null, null], pedalMidi: 40 };
const G5: HarmonySlot = { shape: [3, 5, 5, null, null, null], pedalMidi: 43 };
const A5: HarmonySlot = { shape: [null, 0, 2, 2, null, null], pedalMidi: 45 };

describe('arrangeProgression', () => {
  it('repeats a 1-bar figure once per chord when chords change every bar', () => {
    const arr = arrangeProgression(figure(1), 3, 'bar');
    expect(arr.passes).toBe(3);
    expect(arr.pattern.bars).toBe(3);
    expect(patternLengthTicks(arr.pattern)).toBe(3 * 1920);
    expect(arr.pattern.events).toHaveLength(12);
    expect([0, 1919, 1920, 3840, 5759].map(arr.slotAt)).toEqual([0, 0, 1, 2, 2]);
  });

  it('loops until figure and progression line up (2-bar figure, 3 chords per bar -> 6 bars)', () => {
    const arr = arrangeProgression(figure(2), 3, 'bar');
    expect(arr.passes).toBe(3);
    expect(arr.pattern.bars).toBe(6);
    expect(arr.slotAt(5 * 1920)).toBe(2);
  });

  it('changes twice per bar in half-bar mode, including odd meters', () => {
    const arr = arrangeProgression(figure(1), 4, 'halfBar');
    expect(arr.passes).toBe(2);
    expect([0, 960, 1920, 2880].map(arr.slotAt)).toEqual([0, 1, 2, 3]);
    expect(changeTicksFor({ numerator: 7, denominator: 8 }, 'halfBar')).toBe(840);
  });

  it('clamps the chord count and keeps a single chord a single pass', () => {
    expect(arrangeProgression(figure(1), 0, 'bar').chordCount).toBe(1);
    expect(arrangeProgression(figure(1), 99, 'bar').chordCount).toBe(MAX_PROGRESSION_CHORDS);
    expect(arrangeProgression(figure(2), 1, 'bar').passes).toBe(1);
  });

  it('works on generated figures and stays inside the bar cap', () => {
    const pattern = generateRhythm({ ...defaultRhythmParams('gallop'), bars: 4, slotCount: 1 }, 'prog');
    const arr = arrangeProgression(pattern, 15, 'bar');
    expect(arr.pattern.bars).toBe(60);
    expect(arr.pattern.events).toHaveLength(pattern.events.length * 15);
    const ticks = arr.pattern.events.map((e) => e.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });
});

describe('progression playback', () => {
  it('plays each bar on its own chord, and the pedal follows the bar chord', () => {
    const arr = arrangeProgression(figure(1), 3, 'bar');
    const events = rhythmToPlaybackEvents(arr.pattern, [E5, G5, A5], E_STANDARD, 120, { slotAt: arr.slotAt });
    const chords = events.filter((e) => e.kind === 'slot').map((e) => e.midi);
    expect(chords).toEqual([
      [40, 47, 52],
      [43, 50, 55],
      [45, 52, 57]
    ]);
    const pedals = events.filter((e) => e.kind === 'pedal').map((e) => e.midi[0]);
    expect(pedals).toEqual([40, 40, 40, 43, 43, 43, 45, 45, 45]);
  });

  it('without slotAt keeps the slot index behaviour', () => {
    const events = rhythmToPlaybackEvents(figure(1), [E5, G5], E_STANDARD, 120);
    expect(events.filter((e) => e.kind === 'slot').map((e) => e.midi)).toEqual([[40, 47, 52]]);
  });

  it('exports MIDI with the progression chords', () => {
    const arr = arrangeProgression(figure(1), 2, 'bar');
    const notes = rhythmToMidiNotes(arr.pattern, [E5, G5], E_STANDARD, { slotAt: arr.slotAt });
    const chordAt = (tick: number) => notes.filter((n) => n.tick === tick).map((n) => n.pitch);
    expect(chordAt(0)).toEqual([40, 47, 52]);
    expect(chordAt(1920)).toEqual([43, 50, 55]);
  });
});

describe('progressionChangeBeats', () => {
  it('measures from the last chord attack to the next chord attack', () => {
    const arr = arrangeProgression(figure(1), 3, 'bar');
    // Chord on beat 1 of each bar, pedal in between: a full bar (4 beats) to move
    expect(progressionChangeBeats(arr)).toEqual([4, 4, 4]);
  });

  it('gets tighter when the old chord rings until just before the change', () => {
    const p = figure(1);
    p.events = [ev(0, 'slot'), ev(1800, 'slot', { durationTicks: 120 })];
    const arr = arrangeProgression(p, 2, 'bar');
    // Last attack on chord 0 at 1800, chord 1 starts at 1920: a 16th
    expect(progressionChangeBeats(arr)).toEqual([0.25, 0.25]);
  });

  it('gives chords that are never attacked one change of time', () => {
    const p = figure(1);
    p.events = [ev(0, 'pedal'), ev(480, 'pedal')];
    expect(progressionChangeBeats(arrangeProgression(p, 2, 'bar'))).toEqual([4, 4]);
  });
});
