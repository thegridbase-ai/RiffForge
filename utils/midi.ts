import { NOTES } from '../constants';

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
