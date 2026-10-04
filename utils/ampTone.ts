// Pure helpers for the "New" amp model: waveshaper curves, chord-aware drive, seeded humanize and strum order.
// No Tone.js here, so everything is testable in node; services/ampChain.ts builds the audio graph from these.

export type AmpModel = 'classic' | 'modern';
export const AMP_MODELS: readonly AmpModel[] = ['classic', 'modern'];
export const DEFAULT_AMP_MODEL: AmpModel = 'modern';
export const AMP_STORAGE_KEY = 'riffforge:amp:v1';

export const parseAmpModel = (raw: unknown): AmpModel =>
  AMP_MODELS.includes(raw as AmpModel) ? (raw as AmpModel) : DEFAULT_AMP_MODEL;

export const CURVE_LENGTH = 8192;

/**
 * Soft-clip transfer curve for a WaveShaper over inputs -1..1: tanh(drive * x + bias) - tanh(bias), scaled so
 * the larger side peaks at 1. The bias makes it asymmetric (even harmonics, like a biased tube stage); the
 * subtraction keeps silence silent, and a DC-blocking filter after the stage removes the offset that remains.
 */
export const saturationCurve = (drive: number, bias = 0, length = CURVE_LENGTH): Float32Array => {
  const offset = Math.tanh(bias);
  const f = (x: number) => Math.tanh(drive * x + bias) - offset;
  const peak = Math.max(Math.abs(f(1)), Math.abs(f(-1))) || 1;
  const curve = new Float32Array(length);
  for (let i = 0; i < length; i++) curve[i] = f((i / (length - 1)) * 2 - 1) / peak;
  return curve;
};

/** Below this note (G3) a third through high gain turns to mud: the difference tones land in the bass. */
const LOW_THIRD_LIMIT = 55;
export const MAX_DRIVE_TRIM_DB = -6;

/**
 * Pre-gain trim in dB for a chord into the high-gain stages. Distortion multiplies notes into each other
 * (intermodulation), so chords with many notes, low thirds or seconds get less drive to stay readable. Power
 * chords and single notes keep the full drive.
 */
export const chordDriveTrimDb = (midi: readonly number[]): number => {
  const notes = [...new Set(midi.filter(Number.isFinite))].sort((a, b) => a - b);
  if (notes.length <= 1) return 0;
  let lowThird = false;
  let cluster = false;
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const gap = notes[j] - notes[i];
      if ((gap === 3 || gap === 4) && notes[i] < LOW_THIRD_LIMIT) lowThird = true;
      if (gap === 1 || gap === 2) cluster = true;
    }
  }
  const trim = -Math.max(0, notes.length - 3) * 1.5 - (lowThird ? 3 : 0) - (cluster ? 1.5 : 0);
  return Math.max(MAX_DRIVE_TRIM_DB, trim) || 0;
};

/** Deterministic hash of an integer to 0..1 (mulberry32 step). */
const unit = (seed: number): number => {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const HUMANIZE_CENTS = 3;
export const HUMANIZE_SECONDS = 0.002;

export interface Humanize {
  /** Detune, within +-3 cents. */
  cents: number;
  /** Timing offset, within +-2 ms. */
  seconds: number;
}

/** Small, repeatable pitch and timing offsets for one string of one hit (same hit, same offsets every loop). */
export const humanize = (hit: number, string: number): Humanize => ({
  cents: (unit(hit * 7919 + string * 104729 + 1) * 2 - 1) * HUMANIZE_CENTS,
  seconds: (unit(hit * 15485863 + string * 32452843 + 2) * 2 - 1) * HUMANIZE_SECONDS
});

/** Velocity 0.82..0.98 for the n-th strummed chord, repeatable (no Math.random). */
export const strumVelocity = (n: number): number => 0.82 + unit(n * 2654435761) * 0.16;

/** Notes in pick order: a downstroke hits the low string first, an upstroke the high string first. */
export const strumOrder = <T,>(lowToHigh: readonly T[], pick: 'down' | 'up'): T[] =>
  pick === 'up' ? [...lowToHigh].reverse() : [...lowToHigh];

/** Frequency in Hz of a MIDI note detuned by `cents`. */
export const detunedFrequency = (midi: number, cents: number): number => 440 * 2 ** ((midi - 69 + cents / 100) / 12);
