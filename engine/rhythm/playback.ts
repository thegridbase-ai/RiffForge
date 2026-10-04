// Pure conversion of a rhythm pattern plus harmony slots into timed notes. No Tone.js, no clock.
import type { HarmonySlot, HitTarget, MidiNoteEvent, PlaybackEvent, RhythmEvent, RhythmPattern, Tuning } from '../types';
import { isValidShape, shapeToMidi } from '../shape';
import { PPQ } from './grid';

export const BASE_VELOCITY = 0.7;
/** Added to the base velocity for accent 0, 1, 2. */
export const ACCENT_BOOST: readonly number[] = [0, 0.12, 0.22];
export const PALM_MUTE_VELOCITY_FACTOR = 0.75;
export const PALM_MUTE_DURATION_FACTOR = 0.35;
export const DEAD_VELOCITY = 0.3;
export const DEAD_NOTE_SEC = 0.03;
/** Dead-note length for MIDI export, where no tempo is known: a 64th, about 0.03 s at 120 BPM. */
export const DEAD_NOTE_TICKS = 30;

const slotNotes = (slot: HarmonySlot | undefined, tuning: Tuning): number[] | null =>
  slot && isValidShape(slot.shape, tuning.openMidi.length) ? shapeToMidi(slot.shape, tuning) : null;

/** slot.pedalMidi, else the slot's lowest sounding note, else the tuning's lowest open string. */
const pedalNote = (slot: HarmonySlot | undefined, tuning: Tuning): number | null => {
  if (!slot) return null;
  if (typeof slot.pedalMidi === 'number') return slot.pedalMidi;
  const notes = slotNotes(slot, tuning);
  return notes && notes.length > 0 ? Math.min(...notes) : (tuning.openMidi[0] ?? null);
};

const targetNotes = (target: HitTarget, slots: readonly HarmonySlot[], tuning: Tuning, activeSlot: number): number[] | null => {
  switch (target.kind) {
    case 'slot':
      return slotNotes(slots[target.slot], tuning);
    case 'dyad': {
      const notes = slotNotes(slots[target.slot], tuning);
      return notes ? [...notes].sort((a, b) => a - b).slice(-2) : null;
    }
    default: {
      const pedal = pedalNote(slots[activeSlot], tuning);
      return pedal === null ? null : [pedal];
    }
  }
};

interface SoundingNote {
  event: RhythmEvent;
  midi: number[];
  /** Grid duration including any ties that sustain it. */
  gridTicks: number;
}

/**
 * Pedal and dead hits use the active slot: the slot of the most recent slot/dyad hit that sounded (slot 0
 * before any). Hits whose slot is missing (or whose shape does not fit the tuning) are skipped, and a tie
 * after a skipped hit extends nothing.
 */
const resolveNotes = (pattern: RhythmPattern, slots: readonly HarmonySlot[], tuning: Tuning): SoundingNote[] => {
  const notes: SoundingNote[] = [];
  let activeSlot = 0;
  let current: SoundingNote | null = null;
  for (const event of pattern.events) {
    if (event.tie) {
      if (current) current.gridTicks += event.durationTicks;
      continue;
    }
    const midi = targetNotes(event.target, slots, tuning, activeSlot);
    if (!midi || midi.length === 0) {
      current = null;
      continue;
    }
    if (event.target.kind === 'slot' || event.target.kind === 'dyad') activeSlot = event.target.slot;
    current = { event, midi, gridTicks: event.durationTicks };
    notes.push(current);
  }
  return notes;
};

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/** Base 0.7, accents +0.12 / +0.22, palm mute x0.75, dead notes fixed at 0.3; clamped to 0..1. */
export const hitVelocity = (event: RhythmEvent): number => {
  if (event.target.kind === 'dead') return DEAD_VELOCITY;
  const boosted = BASE_VELOCITY + (ACCENT_BOOST[event.accent] ?? 0);
  return round4(Math.min(1, Math.max(0, event.palmMute ? boosted * PALM_MUTE_VELOCITY_FACTOR : boosted)));
};

/**
 * timeSec = tick / 480 * 60 / bpm. Duration = grid duration (plus ties), x0.35 when palm-muted,
 * min(0.03 s, grid) for dead notes. Returns [] for a non-positive bpm.
 */
export const rhythmToPlaybackEvents = (
  pattern: RhythmPattern,
  slots: readonly HarmonySlot[],
  tuning: Tuning,
  bpm: number
): PlaybackEvent[] => {
  if (!(bpm > 0)) return [];
  const secPerTick = 60 / (PPQ * bpm);
  return resolveNotes(pattern, slots, tuning).map(({ event, midi, gridTicks }) => {
    const gridSec = gridTicks * secPerTick;
    const durationSec =
      event.target.kind === 'dead'
        ? Math.min(DEAD_NOTE_SEC, gridSec)
        : event.palmMute
          ? gridSec * PALM_MUTE_DURATION_FACTOR
          : gridSec;
    return {
      tick: event.tick,
      timeSec: event.tick * secPerTick,
      midi: [...midi],
      velocity: hitVelocity(event),
      durationSec,
      kind: event.target.kind,
      palmMute: event.palmMute,
      accent: event.accent
    };
  });
};

/**
 * One note per distinct pitch, sorted by tick then pitch. Velocity = round(playback velocity * 127) in 1..127;
 * duration in ticks follows the playback rules (palm mute max(1, round(0.35 * d)), dead notes min(30, d)).
 */
export const rhythmToMidiNotes = (pattern: RhythmPattern, slots: readonly HarmonySlot[], tuning: Tuning): MidiNoteEvent[] =>
  resolveNotes(pattern, slots, tuning).flatMap(({ event, midi, gridTicks }) => {
    const durationTicks =
      event.target.kind === 'dead'
        ? Math.min(DEAD_NOTE_TICKS, gridTicks)
        : event.palmMute
          ? Math.max(1, Math.round(PALM_MUTE_DURATION_FACTOR * gridTicks))
          : gridTicks;
    const velocity = Math.min(127, Math.max(1, Math.round(hitVelocity(event) * 127)));
    return [...new Set(midi)]
      .sort((a, b) => a - b)
      .map((pitch) => ({ tick: event.tick, durationTicks, pitch, velocity }));
  });
