import { NOTES } from '../constants';
import type { HarmonySlot, Meter, MidiNoteEvent, RhythmPattern, Tuning } from '../engine/types';
import { rhythmToMidiNotes } from '../engine/rhythm/playback';
import { patternLengthTicks } from '../engine/rhythm/grid';

/**
 * Minimal Standard MIDI File (SMF) writer — Format 0, single track.
 * No external dependencies; produces bytes per the SMF 1.0 spec.
 */

export const TICKS_PER_QUARTER = 480;
export const NOTE_ON_VELOCITY = 96;

/** Convert a note name like "C4", "E2", "F#3" to a MIDI note number (C4 = 60). */
export const noteToMidi = (note: string): number => {
  const match = note.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) {
    throw new Error(`Invalid note: ${note}`);
  }
  const [, name, octaveStr] = match;
  const index = NOTES.indexOf(name);
  if (index === -1) {
    throw new Error(`Invalid note: ${note}`);
  }
  return (parseInt(octaveStr, 10) + 1) * 12 + index;
};

/** Encode a non-negative integer as a MIDI variable-length quantity. */
export const vlq = (n: number): number[] => {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid VLQ value: ${n}`);
  }
  const bytes = [n & 0x7f];
  let rest = n >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return bytes;
};

const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** One block chord: MIDI pitches sounding together for `ticks` ticks. */
export interface MidiChordEvent {
  pitches: number[];
  ticks: number;
}

/** Encode a Format 0 single-track SMF from a list of back-to-back chord events. */
export const encodeMidi = (events: MidiChordEvent[], bpm: number): Uint8Array => {
  const track: number[] = [];

  // Tempo meta event at delta 0: FF 51 03 <µs per quarter note>
  const microsPerQuarter = Math.round(60000000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03, ...u32(microsPerQuarter).slice(1));

  // Delta carried forward by events with no pitches (rests)
  let carry = 0;
  for (const event of events) {
    if (event.pitches.length === 0) {
      carry += event.ticks;
      continue;
    }
    // Note On for every pitch in the chord (simultaneous)
    event.pitches.forEach((pitch, i) => {
      track.push(...vlq(i === 0 ? carry : 0), 0x90, pitch & 0x7f, NOTE_ON_VELOCITY);
    });
    carry = 0;
    // Note Off: first after the chord duration, the rest at delta 0
    event.pitches.forEach((pitch, i) => {
      track.push(...vlq(i === 0 ? event.ticks : 0), 0x80, pitch & 0x7f, 0x00);
    });
  }

  // End of Track: FF 2F 00
  track.push(...vlq(carry), 0xff, 0x2f, 0x00);

  const bytes: number[] = [
    ...ascii('MThd'),
    ...u32(6),
    ...u16(0), // format 0
    ...u16(1), // one track
    ...u16(TICKS_PER_QUARTER),
    ...ascii('MTrk'),
    ...u32(track.length),
    ...track
  ];

  return new Uint8Array(bytes);
};

/** Convert riff steps (one chord per quarter note, back-to-back) into an SMF. */
export const riffToMidi = (steps: { notes: string[] }[], bpm: number): Uint8Array => {
  const events: MidiChordEvent[] = steps.map((step) => ({
    pitches: step.notes.map(noteToMidi),
    ticks: TICKS_PER_QUARTER
  }));
  return encodeMidi(events, bpm);
};

// ---------------------------------------------------------------------------
// Note-level encoding (Rhythm Lab)
// ---------------------------------------------------------------------------

export interface EncodeMidiNotesOptions {
  /** Writes a time signature meta event (FF 58) at tick 0. */
  meter?: Meter;
  /** Places End of Track here when it is later than the last note-off, so loops keep trailing rests. */
  lengthTicks?: number;
}

const clampVelocity = (velocity: number): number =>
  Number.isFinite(velocity) ? Math.min(127, Math.max(1, Math.round(velocity))) : NOTE_ON_VELOCITY;

/** FF 58 04 nn dd cc bb: numerator, log2(denominator), MIDI clocks per click (quarter = 24), 8 32nds per quarter. */
const timeSignatureMeta = (meter: Meter): number[] => {
  const log2 = Math.round(Math.log2(meter.denominator));
  const clocksPerClick = Math.round((24 * 4) / meter.denominator);
  return [0xff, 0x58, 0x04, meter.numerator & 0xff, log2 & 0xff, clocksPerClick & 0xff, 0x08];
};

/**
 * Format 0 single-track SMF from absolute-tick notes (480 PPQ): tempo meta, optional time signature, then
 * notes sorted by tick with note-offs before note-ons at the same tick (so a re-attacked pitch is released
 * first). Velocities are rounded and clamped to 1..127; zero-length and negative-tick notes are skipped.
 */
export const encodeMidiNotes = (notes: MidiNoteEvent[], bpm: number, opts: EncodeMidiNotesOptions = {}): Uint8Array => {
  const tempoBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
  const track: number[] = [];
  track.push(0x00, 0xff, 0x51, 0x03, ...u32(Math.round(60000000 / tempoBpm)).slice(1));
  if (opts.meter) track.push(0x00, ...timeSignatureMeta(opts.meter));

  type Message = { tick: number; on: boolean; pitch: number; velocity: number };
  const messages: Message[] = [];
  for (const note of notes) {
    const tick = Math.round(note.tick);
    const duration = Math.round(note.durationTicks);
    if (!Number.isFinite(tick) || !Number.isFinite(duration) || tick < 0 || duration <= 0) continue;
    const pitch = Math.min(127, Math.max(0, Math.round(note.pitch)));
    messages.push({ tick, on: true, pitch, velocity: clampVelocity(note.velocity) });
    messages.push({ tick: tick + duration, on: false, pitch, velocity: 0 });
  }
  messages.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on) || a.pitch - b.pitch);

  let last = 0;
  for (const m of messages) {
    track.push(...vlq(m.tick - last), m.on ? 0x90 : 0x80, m.pitch & 0x7f, m.velocity & 0x7f);
    last = m.tick;
  }
  const end = Math.max(last, Number.isFinite(opts.lengthTicks) ? Math.round(opts.lengthTicks as number) : 0);
  track.push(...vlq(end - last), 0xff, 0x2f, 0x00);

  return new Uint8Array([
    ...ascii('MThd'),
    ...u32(6),
    ...u16(0),
    ...u16(1),
    ...u16(TICKS_PER_QUARTER),
    ...ascii('MTrk'),
    ...u32(track.length),
    ...track
  ]);
};

/** A rhythm pattern voiced by its harmony slots as an SMF, with the pattern's meter and full loop length. */
export const rhythmToMidi = (pattern: RhythmPattern, slots: HarmonySlot[], tuning: Tuning, bpm: number): Uint8Array =>
  encodeMidiNotes(rhythmToMidiNotes(pattern, slots, tuning), bpm, {
    meter: pattern.meter,
    lengthTicks: patternLengthTicks(pattern)
  });
