import { describe, it, expect } from 'vitest';
import { rhythmToMidiNotes, rhythmToPlaybackEvents } from './playback';
import { generateRhythm } from './generate';
import { RHYTHM_STYLE_IDS, defaultRhythmParams } from './styles';
import { patternLengthTicks } from './grid';
import { E_STANDARD } from '../tuning';
import type { HarmonySlot, HitTarget, RhythmEvent, RhythmPattern } from '../types';

// E5 (0 2 2 x x x) and C5 on the A string (x 3 5 5 x x) with an explicit A2 pedal.
const SLOTS: HarmonySlot[] = [
  { shape: [0, 2, 2, null, null, null], pedalMidi: null },
  { shape: [null, 3, 5, 5, null, null], pedalMidi: 45 }
];

const ev = (tick: number, durationTicks: number, target: HitTarget, extra: Partial<RhythmEvent> = {}): RhythmEvent => ({
  tick,
  durationTicks,
  target,
  palmMute: false,
  accent: 0,
  pick: 'down',
  ...extra
});

const PATTERN: RhythmPattern = {
  id: 'p',
  name: 'P',
  seed: 'p',
  meter: { numerator: 4, denominator: 4 },
  bars: 1,
  ppq: 480,
  tags: [],
  params: { ...defaultRhythmParams('chugEngine'), bars: 1 },
  events: [
    ev(0, 240, { kind: 'slot', slot: 0 }, { accent: 2 }),
    ev(240, 120, { kind: 'pedal' }, { palmMute: true }),
    ev(360, 120, { kind: 'dead' }),
    ev(480, 240, { kind: 'slot', slot: 1 }, { accent: 1 }),
    ev(720, 240, { kind: 'slot', slot: 1 }, { tie: true }),
    ev(960, 120, { kind: 'pedal' }, { palmMute: true, accent: 1 }),
    ev(1080, 120, { kind: 'dyad', slot: 0 }),
    ev(1200, 120, { kind: 'slot', slot: 3 }),
    ev(1320, 120, { kind: 'slot', slot: 3 }, { tie: true }),
    ev(1440, 480, { kind: 'pedal' })
  ]
};

describe('rhythmToPlaybackEvents', () => {
  const out = rhythmToPlaybackEvents(PATTERN, SLOTS, E_STANDARD, 120);

  it('skips ties and events whose slot is missing', () => {
    expect(out.map((e) => e.tick)).toEqual([0, 240, 360, 480, 960, 1080, 1440]);
  });

  it('times events as tick / 480 * 60 / bpm', () => {
    expect(out.map((e) => e.timeSec)).toEqual([0, 0.25, 0.375, 0.5, 1, 1.125, 1.5]);
    const slow = rhythmToPlaybackEvents(PATTERN, SLOTS, E_STANDARD, 60);
    expect(slow[3].timeSec).toBeCloseTo(1, 9);
    expect(slow[3].durationSec).toBeCloseTo(1, 9);
  });

  it('plays slots through shapeToMidi, dyads as the top two notes, pedals from the active slot', () => {
    expect(out[0].midi).toEqual([40, 47, 52]);
    expect(out[1].midi).toEqual([40]);
    expect(out[3].midi).toEqual([48, 55, 60]);
    expect(out[4].midi).toEqual([45]);
    expect(out[5].midi).toEqual([47, 52]);
    expect(out[6].midi).toEqual([40]);
  });

  it('maps accents, palm mute and dead notes to velocity', () => {
    expect(out[0].velocity).toBeCloseTo(0.92, 9);
    expect(out[1].velocity).toBeCloseTo(0.525, 9);
    expect(out[2].velocity).toBeCloseTo(0.3, 9);
    expect(out[3].velocity).toBeCloseTo(0.82, 9);
    expect(out[4].velocity).toBeCloseTo(0.615, 9);
    expect(out[5].velocity).toBeCloseTo(0.7, 9);
  });

  it('shortens palm mutes to 35 percent, dead notes to 30 ms and extends ties', () => {
    expect(out[0].durationSec).toBeCloseTo(0.25, 9);
    expect(out[1].durationSec).toBeCloseTo(0.125 * 0.35, 9);
    expect(out[2].durationSec).toBeCloseTo(0.03, 9);
    expect(out[3].durationSec).toBeCloseTo(0.5, 9);
    expect(out[5].durationSec).toBeCloseTo(0.125, 9);
    expect(out[6].durationSec).toBeCloseTo(0.5, 9);
  });

  it('reports kind, palm mute and accent for the UI', () => {
    expect(out.map((e) => e.kind)).toEqual(['slot', 'pedal', 'dead', 'slot', 'pedal', 'dyad', 'pedal']);
    expect(out[1].palmMute).toBe(true);
    expect(out[3].accent).toBe(1);
  });

  it('skips slots whose shape does not fit the tuning and returns nothing for a bad bpm', () => {
    const broken: HarmonySlot[] = [{ shape: [0, 2, 2], pedalMidi: null }, SLOTS[1]];
    expect(rhythmToPlaybackEvents(PATTERN, broken, E_STANDARD, 120).map((e) => e.tick)).toEqual([240, 360, 480, 960, 1440]);
    expect(rhythmToPlaybackEvents(PATTERN, SLOTS, E_STANDARD, 0)).toEqual([]);
  });
});

describe('rhythmToMidiNotes', () => {
  const notes = rhythmToMidiNotes(PATTERN, SLOTS, E_STANDARD);

  it('emits one note per pitch with tick durations following the same rules', () => {
    expect(notes).toEqual([
      { tick: 0, durationTicks: 240, pitch: 40, velocity: 117 },
      { tick: 0, durationTicks: 240, pitch: 47, velocity: 117 },
      { tick: 0, durationTicks: 240, pitch: 52, velocity: 117 },
      { tick: 240, durationTicks: 42, pitch: 40, velocity: 67 },
      { tick: 360, durationTicks: 30, pitch: 40, velocity: 38 },
      { tick: 480, durationTicks: 480, pitch: 48, velocity: 104 },
      { tick: 480, durationTicks: 480, pitch: 55, velocity: 104 },
      { tick: 480, durationTicks: 480, pitch: 60, velocity: 104 },
      { tick: 960, durationTicks: 42, pitch: 45, velocity: 78 },
      { tick: 1080, durationTicks: 120, pitch: 47, velocity: 89 },
      { tick: 1080, durationTicks: 120, pitch: 52, velocity: 89 },
      { tick: 1440, durationTicks: 480, pitch: 40, velocity: 89 }
    ]);
  });

  it('keeps every velocity in 1..127 and every note inside the pattern', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      const pattern = generateRhythm(defaultRhythmParams(style), `midi-${style}`);
      const all = rhythmToMidiNotes(pattern, SLOTS, E_STANDARD);
      expect(all.length).toBeGreaterThan(0);
      for (const n of all) {
        expect(n.velocity).toBeGreaterThanOrEqual(1);
        expect(n.velocity).toBeLessThanOrEqual(127);
        expect(n.durationTicks).toBeGreaterThan(0);
        expect(n.tick + n.durationTicks).toBeLessThanOrEqual(patternLengthTicks(pattern));
      }
    }
  });
});

describe('generated patterns', () => {
  it('produce sorted playback with sound for every attack when all slots exist', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      const pattern = generateRhythm(defaultRhythmParams(style), `play-${style}`);
      const out = rhythmToPlaybackEvents(pattern, SLOTS, E_STANDARD, 140);
      expect(out).toHaveLength(pattern.events.filter((e) => !e.tie).length);
      for (let i = 1; i < out.length; i++) expect(out[i].timeSec).toBeGreaterThan(out[i - 1].timeSec);
      expect(out.every((e) => e.midi.length > 0 && e.velocity > 0 && e.velocity <= 1)).toBe(true);
    }
  });
});
