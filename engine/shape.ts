// Shapes and the single shape -> sounding MIDI conversion, plus app adapters.
import type { Shape, Tuning } from './types';
import { pitchClass } from './pitch';

const isFret = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export const isValidShape = (shape: Shape, strings: number): boolean =>
  Array.isArray(shape) && shape.length === strings && shape.every((f) => f === null || isFret(f));

const assertShape = (shape: Shape, tuning: Tuning): void => {
  if (!isValidShape(shape, tuning.openMidi.length)) {
    throw new Error(`Shape ${JSON.stringify(shape)} does not fit a ${tuning.openMidi.length}-string tuning`);
  }
};

/** MIDI per string, low -> high; null for muted strings. */
export const shapeToMidiByString = (shape: Shape, tuning: Tuning): (number | null)[] => {
  assertShape(shape, tuning);
  return shape.map((fret, s) => (fret === null ? null : tuning.openMidi[s] + fret));
};

/**
 * The only shape -> pitch conversion in the engine. Tabs and audio must both go through it.
 * Returns sounding notes in string order (lowest string first), muted strings skipped.
 */
export const shapeToMidi = (shape: Shape, tuning: Tuning): number[] =>
  shapeToMidiByString(shape, tuning).filter((m): m is number => m !== null);

export const bassMidi = (shape: Shape, tuning: Tuning): number | null => {
  const notes = shapeToMidi(shape, tuning);
  return notes.length === 0 ? null : Math.min(...notes);
};

/** Sorted unique pitch classes sounding in the shape. */
export const shapePitchClasses = (shape: Shape, tuning: Tuning): number[] =>
  [...new Set(shapeToMidi(shape, tuning).map(pitchClass))].sort((a, b) => a - b);

export const soundingStrings = (shape: Shape): number[] =>
  shape.flatMap((fret, s) => (fret === null ? [] : [s]));

export const frettedStrings = (shape: Shape): number[] =>
  shape.flatMap((fret, s) => (fret !== null && fret > 0 ? [s] : []));

export const openStrings = (shape: Shape): number[] => shape.flatMap((fret, s) => (fret === 0 ? [s] : []));

/** Muted strings strictly between the lowest and the highest sounding string. */
export const interiorMutes = (shape: Shape): number => {
  const sounding = soundingStrings(shape);
  if (sounding.length < 2) return 0;
  const lo = sounding[0];
  const hi = sounding[sounding.length - 1];
  let count = 0;
  for (let s = lo + 1; s < hi; s++) if (shape[s] === null) count++;
  return count;
};

export const lowestFret = (shape: Shape): number | null => {
  const frets = shape.filter((f): f is number => f !== null && f > 0);
  return frets.length === 0 ? null : Math.min(...frets);
};

export const highestFret = (shape: Shape): number | null => {
  const frets = shape.filter((f): f is number => f !== null && f > 0);
  return frets.length === 0 ? null : Math.max(...frets);
};

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** RiffForge tab: space-separated, low -> high, "x" = muted. Also the canonical shape key. */
export const toRiffForgeTab = (shape: Shape): string => shape.map((f) => (f === null ? 'x' : String(f))).join(' ');

export const shapeKey = toRiffForgeTab;

/** Parses "0 2 2 x x x" (low -> high). Returns null on malformed input. */
export const fromRiffForgeTab = (tab: string): Shape | null => {
  const tokens = tab.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === '') return null;
  const shape: (number | null)[] = [];
  for (const token of tokens) {
    if (token === 'x' || token === 'X') {
      shape.push(null);
    } else if (/^\d{1,2}$/.test(token)) {
      shape.push(parseInt(token, 10));
    } else {
      return null;
    }
  }
  return shape;
};

/** Chord Explorer frets: high -> low string order, -1 = muted. */
export const toChordExplorerFrets = (shape: Shape): number[] => [...shape].reverse().map((f) => (f === null ? -1 : f));

export const fromChordExplorerFrets = (frets: readonly number[]): Shape =>
  [...frets].reverse().map((f) => (f < 0 ? null : f));
