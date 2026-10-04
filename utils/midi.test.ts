import { describe, it, expect } from 'vitest';
import { noteToMidi, vlq, encodeMidi, riffToMidi, TICKS_PER_QUARTER, NOTE_ON_VELOCITY } from './midi';
import { encodeMidiNotes, rhythmToMidi } from './midi';
import { generateRhythm } from '../engine/rhythm/generate';
import { defaultRhythmParams } from '../engine/rhythm/styles';
import { E_STANDARD } from '../engine/tuning';
import type { HarmonySlot, HitTarget, RhythmEvent, RhythmPattern } from '../engine/types';

/** Tiny test-side SMF parser: reads header fields and track events with absolute tick times. */
interface ParsedEvent {
  tick: number;
  type: 'on' | 'off' | 'tempo' | 'eot';
  pitch?: number;
  velocity?: number;
  microsPerQuarter?: number;
}

const parseMidi = (bytes: Uint8Array) => {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  const u16 = (offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
  const u32 = (offset: number) =>
    (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];

  expect(ascii(0, 4)).toBe('MThd');
  const headerLength = u32(4);
  const format = u16(8);
  const ntrks = u16(10);
  const division = u16(12);

  expect(ascii(14, 4)).toBe('MTrk');
  const trackLength = u32(18);

  let pos = 22;
  let tick = 0;
  const events: ParsedEvent[] = [];

  const readVlq = () => {
    let value = 0;
    let byte;
    do {
      byte = bytes[pos++];
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    return value;
  };

  while (pos < bytes.length) {
    tick += readVlq();
    const status = bytes[pos++];
    if (status === 0xff) {
      const metaType = bytes[pos++];
      const length = readVlq();
      if (metaType === 0x51) {
        const microsPerQuarter =
          (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
        events.push({ tick, type: 'tempo', microsPerQuarter });
      } else if (metaType === 0x2f) {
        events.push({ tick, type: 'eot' });
      }
      pos += length;
      if (metaType === 0x2f) break;
    } else if ((status & 0xf0) === 0x90) {
      events.push({ tick, type: 'on', pitch: bytes[pos], velocity: bytes[pos + 1] });
      pos += 2;
    } else if ((status & 0xf0) === 0x80) {
      events.push({ tick, type: 'off', pitch: bytes[pos], velocity: bytes[pos + 1] });
      pos += 2;
    } else {
      throw new Error(`Unexpected status byte 0x${status.toString(16)} at ${pos - 1}`);
    }
  }

  return { headerLength, format, ntrks, division, trackLength, trackEnd: pos, events };
};

describe('noteToMidi', () => {
  it('maps middle C and reference pitches', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
  });

  it('maps the low guitar range', () => {
    expect(noteToMidi('E2')).toBe(40);
    expect(noteToMidi('A2')).toBe(45);
    expect(noteToMidi('D3')).toBe(50);
  });

  it('maps sharps', () => {
    expect(noteToMidi('F#3')).toBe(54);
    expect(noteToMidi('C#2')).toBe(37);
    expect(noteToMidi('G#4')).toBe(68);
  });

  it('throws on invalid note names', () => {
    expect(() => noteToMidi('Bb3')).toThrow();
    expect(() => noteToMidi('H2')).toThrow();
    expect(() => noteToMidi('x')).toThrow();
  });
});

describe('vlq', () => {
  it('encodes single-byte values', () => {
    expect(vlq(0)).toEqual([0x00]);
    expect(vlq(127)).toEqual([0x7f]);
  });

  it('encodes multi-byte values with continuation bits', () => {
    expect(vlq(128)).toEqual([0x81, 0x00]);
    expect(vlq(480)).toEqual([0x83, 0x60]);
    expect(vlq(100000)).toEqual([0x86, 0x8d, 0x20]);
  });

  it('rejects negative and non-integer input', () => {
    expect(() => vlq(-1)).toThrow();
    expect(() => vlq(1.5)).toThrow();
  });
});

describe('encodeMidi', () => {
  it('writes a valid Format 0 header with division 480', () => {
    const bytes = encodeMidi([], 120);
    // "MThd", length 6, format 0, ntrks 1, division 480 (0x01E0)
    expect([...bytes.slice(0, 14)]).toEqual([
      0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
      0x00, 0x00, 0x00, 0x01, 0x01, 0xe0
    ]);
    expect([...bytes.slice(14, 18)]).toEqual([0x4d, 0x54, 0x72, 0x6b]); // "MTrk"
  });

  it('writes the 120bpm tempo meta event at delta 0', () => {
    const bytes = encodeMidi([], 120);
    // delta 0, FF 51 03, 500000 µs = 07 A1 20
    expect([...bytes.slice(22, 29)]).toEqual([0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]);
  });

  it('rounds tempo for non-divisor bpm values', () => {
    const { events } = parseMidi(encodeMidi([], 140));
    const tempo = events.find((e) => e.type === 'tempo');
    expect(tempo?.microsPerQuarter).toBe(Math.round(60000000 / 140)); // 428571
  });

  it('ends the track with FF 2F 00 and a matching track length', () => {
    const bytes = encodeMidi([{ pitches: [60], ticks: 480 }], 120);
    expect([...bytes.slice(-3)]).toEqual([0xff, 0x2f, 0x00]);
    const declaredLength = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21];
    expect(declaredLength).toBe(bytes.length - 22); // actual track byte count
  });

  it('uses Note On velocity 96 and Note Off velocity 0 on channel 0', () => {
    const bytes = encodeMidi([{ pitches: [60], ticks: 480 }], 120);
    const { events } = parseMidi(bytes);
    const on = events.find((e) => e.type === 'on');
    const off = events.find((e) => e.type === 'off');
    expect(on).toMatchObject({ pitch: 60, velocity: NOTE_ON_VELOCITY });
    expect(off).toMatchObject({ pitch: 60, velocity: 0 });
    // Raw status bytes: 0x90 (Note On ch 0) and 0x80 (Note Off ch 0)
    expect([...bytes]).toContain(0x90);
    expect([...bytes]).toContain(0x80);
  });
});

describe('riffToMidi', () => {
  it('encodes two chord steps back-to-back as 480-tick quarter notes', () => {
    const bytes = riffToMidi(
      [{ notes: ['E2', 'B2', 'E3'] }, { notes: ['G2', 'D3', 'G3'] }],
      120
    );
    const parsed = parseMidi(bytes);

    expect(parsed.format).toBe(0);
    expect(parsed.ntrks).toBe(1);
    expect(parsed.division).toBe(TICKS_PER_QUARTER);
    expect(parsed.trackEnd).toBe(bytes.length);

    const ons = parsed.events.filter((e) => e.type === 'on');
    const offs = parsed.events.filter((e) => e.type === 'off');
    expect(ons).toHaveLength(6);
    expect(offs).toHaveLength(6);

    // Step 1: E2/B2/E3 = {40, 47, 52} all on at tick 0
    const step1Ons = ons.filter((e) => e.tick === 0);
    expect(new Set(step1Ons.map((e) => e.pitch))).toEqual(new Set([40, 47, 52]));

    // Step 1 offs land exactly one quarter later
    const step1Offs = offs.filter((e) => e.tick === 480);
    expect(new Set(step1Offs.map((e) => e.pitch))).toEqual(new Set([40, 47, 52]));

    // Step 2: G2/D3/G3 = {43, 50, 55} starts back-to-back at tick 480
    const step2Ons = ons.filter((e) => e.tick === 480);
    expect(new Set(step2Ons.map((e) => e.pitch))).toEqual(new Set([43, 50, 55]));

    // Step 2 offs at tick 960, then End of Track
    const step2Offs = offs.filter((e) => e.tick === 960);
    expect(new Set(step2Offs.map((e) => e.pitch))).toEqual(new Set([43, 50, 55]));

    const eot = parsed.events.find((e) => e.type === 'eot');
    expect(eot?.tick).toBe(960);

    // Every note sounds for exactly 480 ticks
    for (const on of ons) {
      const off = offs.find((e) => e.pitch === on.pitch && e.tick === on.tick + 480);
      expect(off).toBeDefined();
    }
  });

  it('produces a header-and-tempo-only file for an empty riff', () => {
    const parsed = parseMidi(riffToMidi([], 120));
    expect(parsed.events.map((e) => e.type)).toEqual(['tempo', 'eot']);
  });
});

/** Time signature meta (FF 58 04 nn dd cc bb) of a Format 0 file, or null. Scans the track like parseMidi. */
const readTimeSignature = (bytes: Uint8Array) => {
  let pos = 22;
  const readVlq = () => {
    let value = 0;
    let byte;
    do {
      byte = bytes[pos++];
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    return value;
  };
  while (pos < bytes.length) {
    const delta = readVlq();
    const status = bytes[pos++];
    if (status !== 0xff) return null;
    const metaType = bytes[pos++];
    const length = readVlq();
    if (metaType === 0x58) {
      return { delta, length, numerator: bytes[pos], denominator: 2 ** bytes[pos + 1], clocks: bytes[pos + 2], thirtySeconds: bytes[pos + 3] };
    }
    if (metaType === 0x2f) return null;
    pos += length;
  }
  return null;
};

/** Pairs each note-on with the next note-off of the same pitch: [onTick, duration, pitch, velocity]. */
const notesOf = (bytes: Uint8Array) => {
  const { events } = parseMidi(bytes);
  const open = new Map<number, ParsedEvent>();
  const out: { tick: number; duration: number; pitch: number; velocity: number }[] = [];
  for (const e of events) {
    if (e.type === 'on') open.set(e.pitch!, e);
    if (e.type === 'off') {
      const on = open.get(e.pitch!);
      expect(on).toBeDefined();
      out.push({ tick: on!.tick, duration: e.tick - on!.tick, pitch: e.pitch!, velocity: on!.velocity! });
      open.delete(e.pitch!);
    }
  }
  expect(open.size).toBe(0);
  return out.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
};

describe('encodeMidiNotes', () => {
  it('writes Format 0 at 480 PPQ with the tempo first', () => {
    const bytes = encodeMidiNotes([{ tick: 0, durationTicks: 120, pitch: 40, velocity: 100 }], 150);
    const parsed = parseMidi(bytes);
    expect(parsed.format).toBe(0);
    expect(parsed.ntrks).toBe(1);
    expect(parsed.division).toBe(480);
    expect(parsed.trackEnd).toBe(bytes.length);
    expect(parsed.events[0]).toMatchObject({ tick: 0, type: 'tempo', microsPerQuarter: 400000 });
    const declaredLength = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21];
    expect(declaredLength).toBe(bytes.length - 22);
  });

  it('puts note-offs before note-ons at the same tick', () => {
    const bytes = encodeMidiNotes(
      [
        { tick: 0, durationTicks: 120, pitch: 40, velocity: 100 },
        { tick: 120, durationTicks: 120, pitch: 40, velocity: 90 }
      ],
      120
    );
    const atBoundary = parseMidi(bytes).events.filter((e) => e.tick === 120);
    expect(atBoundary.map((e) => e.type)).toEqual(['off', 'on']);
    expect(notesOf(bytes)).toEqual([
      { tick: 0, duration: 120, pitch: 40, velocity: 100 },
      { tick: 120, duration: 120, pitch: 40, velocity: 90 }
    ]);
  });

  it('clamps velocities to 1..127 and skips empty notes', () => {
    const bytes = encodeMidiNotes(
      [
        { tick: 0, durationTicks: 60, pitch: 40, velocity: 0 },
        { tick: 60, durationTicks: 60, pitch: 41, velocity: 300 },
        { tick: 120, durationTicks: 60, pitch: 42, velocity: 63.6 },
        { tick: 180, durationTicks: 0, pitch: 43, velocity: 90 }
      ],
      120
    );
    expect(notesOf(bytes).map((n) => n.velocity)).toEqual([1, 127, 64]);
  });

  it('writes the time signature and extends the track to lengthTicks', () => {
    const bytes = encodeMidiNotes([{ tick: 0, durationTicks: 120, pitch: 40, velocity: 90 }], 120, {
      meter: { numerator: 7, denominator: 8 },
      lengthTicks: 1680
    });
    expect(readTimeSignature(bytes)).toEqual({ delta: 0, length: 4, numerator: 7, denominator: 8, clocks: 12, thirtySeconds: 8 });
    expect(parseMidi(bytes).events.find((e) => e.type === 'eot')?.tick).toBe(1680);
    expect(readTimeSignature(encodeMidiNotes([], 120))).toBeNull();
  });
});

describe('rhythmToMidi', () => {
  const SLOTS: HarmonySlot[] = [{ shape: [0, 2, 2, null, null, null], pedalMidi: null }];
  const ev = (tick: number, durationTicks: number, target: HitTarget, extra: Partial<RhythmEvent> = {}): RhythmEvent => ({
    tick,
    durationTicks,
    target,
    palmMute: false,
    accent: 0,
    pick: 'down',
    ...extra
  });
  const pattern: RhythmPattern = {
    id: 'm',
    name: 'M',
    seed: 'm',
    meter: { numerator: 4, denominator: 4 },
    bars: 1,
    ppq: 480,
    tags: [],
    params: { ...defaultRhythmParams('chugEngine'), bars: 1, slotCount: 1 },
    events: [
      ev(0, 240, { kind: 'slot', slot: 0 }, { accent: 2 }),
      ev(240, 120, { kind: 'pedal' }, { palmMute: true }),
      ev(360, 120, { kind: 'pedal' }),
      ev(480, 480, { kind: 'slot', slot: 0 }, { accent: 1 }),
      ev(960, 120, { kind: 'pedal' }, { palmMute: true }),
      ev(1080, 120, { kind: 'pedal' }, { palmMute: true, pick: 'up' }),
      ev(1200, 120, { kind: 'dead' })
    ]
  };
  const notes = notesOf(rhythmToMidi(pattern, SLOTS, E_STANDARD, 120));
  const at = (tick: number) => notes.filter((n) => n.tick === tick);

  it('places every voice of a chord hit on its tick', () => {
    expect(at(0).map((n) => n.pitch)).toEqual([40, 47, 52]);
    expect(at(240).map((n) => n.pitch)).toEqual([40]);
    expect([...new Set(notes.map((n) => n.tick))]).toEqual([0, 240, 360, 480, 960, 1080, 1200]);
  });

  it('makes accents louder than plain hits, strong accents loudest', () => {
    const plain = at(360)[0].velocity;
    const accent = at(480)[0].velocity;
    const strong = at(0)[0].velocity;
    expect(accent).toBeGreaterThan(plain);
    expect(strong).toBeGreaterThan(accent);
    expect(at(240)[0].velocity).toBeLessThan(plain);
  });

  it('shortens palm-muted and dead notes', () => {
    expect(at(360)[0].duration).toBe(120);
    expect(at(240)[0].duration).toBeLessThan(at(360)[0].duration);
    expect(at(240)[0].duration).toBe(42);
    expect(at(1200)[0].duration).toBeLessThanOrEqual(30);
    expect(at(480)[0].duration).toBe(480);
  });

  it('writes 4/4 and ends the track at the pattern end', () => {
    const bytes = rhythmToMidi(pattern, SLOTS, E_STANDARD, 120);
    expect(readTimeSignature(bytes)).toMatchObject({ numerator: 4, denominator: 4, clocks: 24 });
    expect(parseMidi(bytes).events.find((e) => e.type === 'eot')?.tick).toBe(1920);
  });

  it('writes 7/8 for a seven-eight pattern', () => {
    const seven = generateRhythm(defaultRhythmParams('sevenEight'), 'midi-7');
    const bytes = rhythmToMidi(seven, SLOTS.concat(SLOTS), E_STANDARD, 140);
    expect(readTimeSignature(bytes)).toMatchObject({ numerator: 7, denominator: 8, clocks: 12 });
    expect(parseMidi(bytes).events.find((e) => e.type === 'eot')?.tick).toBe(2 * 1680);
    expect(parseMidi(bytes).events.find((e) => e.type === 'tempo')?.microsPerQuarter).toBe(Math.round(60000000 / 140));
    expect(notesOf(bytes).length).toBeGreaterThan(0);
  });
});
