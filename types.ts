import type { FingerNumber } from './engine/types';

/** An engine-generated shape for a library card. Tab and audio both derive from `shape`. */
export interface LibraryVoicing {
  shape: (number | null)[];
  /** RiffForge tab, low -> high ("0 2 2 x x x"). */
  tab: string;
  fingers: (FingerNumber | null)[];
  degreesByString: (string | null)[];
  /** Degrees of the sounding notes, low -> high pitch. */
  degrees: string;
  /** Honest name from the sounding notes. */
  soundsAs: string;
  /** Sounding note names (sharps), from shapeToMidi. */
  notes: string[];
  /** Musical relaxations applied to fit the hand, or null when the recipe is exact. */
  relaxed: string[] | null;
  explain: string[];
}

export interface Chord {
  id: string;
  name: string;
  subtext: string;
  /** In the JSON: the curated note recipe. On a resolved card: the sounding notes of `voicing`. */
  notes: string[];
  description: string;
  fretboard?: string;
  baseRoot: string; // The root note of the original voicing (e.g., 'E' for Opeth chord)
  relatedChords?: Chord[]; // Child chords that harmonically work with this parent
  /** Present on resolved cards that have a playable shape. */
  voicing?: LibraryVoicing;
  /** Present on resolved cards without a playable shape for the current hand profile. */
  unplayableReason?: string;
}

export enum TuningMode {
  STANDARD = 'STANDARD',
  DROP = 'DROP'
}

export enum VibeMode {
  DARK = 'DARK',
  MELODIC = 'MELODIC',
  ENERGETIC = 'ENERGETIC'
}