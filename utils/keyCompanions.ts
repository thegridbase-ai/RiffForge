// Chords that share a key with a locked card. The locked chord is the tonic (its root is the selected root), and
// the key is the closest mode that holds every sounding note, ranked by the vibe. Each other scale degree becomes a
// companion in the locked chord's color (power, sus, add9, seventh) where that color stays inside the key, else the
// plain diatonic triad.
import { midiToName, parseNoteName, parsePitchClass, pitchClass, pitchClassName } from '../engine/pitch';
import { Chord, VibeMode } from '../types';

export type KeyModeId =
  | 'aeolian'
  | 'dorian'
  | 'phrygian'
  | 'harmonicMinor'
  | 'phrygianDominant'
  | 'locrian'
  | 'ionian'
  | 'mixolydian'
  | 'lydian';

export const KEY_MODES: Record<KeyModeId, { label: string; steps: readonly number[] }> = {
  aeolian: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  harmonicMinor: { label: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  phrygianDominant: { label: 'Phrygian Dominant', steps: [0, 1, 4, 5, 7, 8, 10] },
  locrian: { label: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  ionian: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  mixolydian: { label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  lydian: { label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] }
};

// Which keys a vibe reaches for first when several hold the chord (a sus2 or a power chord fits many)
const VIBE_KEY_ORDER: Record<VibeMode, readonly KeyModeId[]> = {
  [VibeMode.DARK]: ['phrygian', 'aeolian', 'phrygianDominant', 'harmonicMinor', 'locrian', 'dorian', 'mixolydian', 'ionian', 'lydian'],
  [VibeMode.MELODIC]: ['aeolian', 'dorian', 'ionian', 'harmonicMinor', 'mixolydian', 'lydian', 'phrygian', 'phrygianDominant', 'locrian'],
  [VibeMode.ENERGETIC]: ['aeolian', 'phrygian', 'dorian', 'mixolydian', 'ionian', 'harmonicMinor', 'phrygianDominant', 'lydian', 'locrian']
};

export const MAX_KEY_OPTIONS = 4;

/** Sounding pitch classes above `root` (0..11), sorted and unique. Unparseable notes are skipped. */
export const intervalsAbove = (notes: readonly string[], root: string): number[] => {
  const rootPc = parsePitchClass(root) ?? 0;
  const midi = notes.map(parseNoteName).filter((m): m is number => m !== null);
  return [...new Set(midi.map((m) => pitchClass(m - rootPc)))].sort((a, b) => a - b);
};

/** Keys that leave out the fewest sounding notes, in the vibe's order; never empty. */
export const fittingKeys = (intervals: readonly number[], vibe: VibeMode): KeyModeId[] => {
  const order = VIBE_KEY_ORDER[vibe];
  const outside = (id: KeyModeId) => intervals.filter((i) => !KEY_MODES[id].steps.includes(i)).length;
  const fewest = Math.min(...order.map(outside));
  return order.filter((id) => outside(id) === fewest).slice(0, MAX_KEY_OPTIONS);
};

export type ChordColor = 'power' | 'sus2' | 'sus4' | 'add9' | 'seventh' | 'triad';

export const chordColor = (intervals: readonly number[]): ChordColor => {
  const has = (i: number) => intervals.includes(i);
  if (has(3) || has(4)) return has(10) || has(11) ? 'seventh' : has(2) ? 'add9' : 'triad';
  if (has(2) && has(7)) return 'sus2';
  if (has(5) && has(7)) return 'sus4';
  return has(7) ? 'power' : 'triad';
};

type Quality = 'major' | 'minor' | 'dim' | 'aug';

// Note recipes as semitones above the root, low to high (the first is the bass), voiced like common guitar shapes
const TRIADS: Record<Quality, number[]> = {
  major: [0, 7, 12, 16, 19],
  minor: [0, 7, 12, 15, 19],
  dim: [0, 6, 12, 15],
  aug: [0, 8, 12, 16]
};
const POWER = [0, 7, 12];
const SUS2 = [0, 7, 12, 14];
const SUS4 = [0, 7, 12, 17];
const ADD9: Partial<Record<Quality, number[]>> = { major: [0, 4, 7, 14, 16], minor: [0, 7, 12, 14, 15] };

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const qualityOf = (third: number, fifth: number): Quality =>
  third === 4 ? (fifth === 8 ? 'aug' : 'major') : fifth === 6 ? 'dim' : 'minor';

/** Roman numeral against the major scale, so it reads the same in every mode ("bVI", "ii°", "III+"). */
const romanNumeral = (degree: number, step: number, quality: Quality): string => {
  const shift = step - KEY_MODES.ionian.steps[degree];
  const accidental = shift < 0 ? 'b' : shift > 0 ? '#' : '';
  const numeral = quality === 'major' || quality === 'aug' ? NUMERALS[degree] : NUMERALS[degree].toLowerCase();
  return `${accidental}${numeral}${quality === 'dim' ? '°' : quality === 'aug' ? '+' : ''}`;
};

const degreeRole = (degree: number, step: number, quality: Quality): { name: string; description: string } => {
  switch (degree) {
    case 1:
      return {
        name: 'Supertonic',
        description:
          step === 1
            ? 'Half-step above home. Pure Phrygian menace.'
            : quality === 'dim'
              ? 'Unstable step up. Leans into the dominant.'
              : quality === 'major'
                ? 'Bright step up. Lifts the tonic.'
                : 'Step up from home. Sets up the dominant.'
      };
    case 2:
      return {
        name: 'Mediant',
        description:
          quality === 'major'
            ? 'Relative major. Opens the minor up.'
            : quality === 'aug'
              ? 'Augmented. Restless pull to the dominant.'
              : 'Soft shade of home. Shares two notes.'
      };
    case 3:
      return {
        name: 'Subdominant',
        description:
          quality === 'minor'
            ? 'Moves away from home. Dark and heavy.'
            : quality === 'major'
              ? 'Moves away from home. Wide and open.'
              : 'Tense move away from home.'
      };
    case 4:
      return {
        name: 'Dominant',
        description:
          quality === 'major'
            ? 'Strongest pull back home.'
            : quality === 'minor'
              ? 'Soft, modal pull back home.'
              : 'Unstable. Begs to resolve.'
      };
    case 5:
      return {
        name: 'Submediant',
        description:
          quality === 'major'
            ? 'Epic lift next to home. A metal staple.'
            : quality === 'minor'
              ? 'Relative minor. Darker shade of home.'
              : 'Cinematic tension next to home.'
      };
    default:
      return step === 11
        ? { name: 'Leading tone', description: 'Resolves up a half-step into home.' }
        : {
            name: 'Subtonic',
            description: quality === 'major' ? 'Big step-down cadence into home.' : 'Moody step down to home.'
          };
  }
};

/**
 * One companion per scale degree other than the tonic, as library-style chords: `notes` is the recipe and
 * `baseRoot` the companion's own root, so `resolveLibraryChord(chord, chord.baseRoot, ...)` builds the shape.
 * `lowestMidi` is the tuning's lowest open string; each root sits at its first fret position above it.
 */
export const keyCompanions = (tonic: string, intervals: readonly number[], keyId: KeyModeId, lowestMidi: number): Chord[] => {
  const tonicPc = parsePitchClass(tonic) ?? 0;
  const { steps } = KEY_MODES[keyId];
  const color = chordColor(intervals);
  const inKey = (rootStep: number, offsets: readonly number[]) =>
    offsets.every((o) => steps.includes(pitchClass(rootStep + o)));
  const above = (degree: number, by: number) => pitchClass(steps[(degree + by) % 7] - steps[degree]);

  return steps.slice(1).map((step, i) => {
    const degree = i + 1;
    const third = above(degree, 2);
    const fifth = above(degree, 4);
    const quality = qualityOf(third, fifth);

    const candidates: number[][] = [];
    if (color === 'power') candidates.push(POWER);
    if (color === 'sus2') candidates.push(SUS2);
    if (color === 'sus4') candidates.push(SUS4);
    if ((color === 'sus2' || color === 'add9') && ADD9[quality]) candidates.push(ADD9[quality] as number[]);
    // Diatonic by construction, so it always fits. An augmented degree stays a triad: maj7#5 has no common shape.
    candidates.push(color === 'seventh' && quality !== 'aug' ? [0, fifth, above(degree, 6), third + 12] : TRIADS[quality]);
    const recipe = candidates.find((offsets) => inKey(step, offsets)) as number[];

    const rootPc = pitchClass(tonicPc + step);
    const rootMidi = lowestMidi + pitchClass(rootPc - lowestMidi);
    const { name, description } = degreeRole(degree, step, quality);
    return {
      id: `key-${pitchClassName(tonicPc)}-${keyId}-${degree}`,
      name: romanNumeral(degree, step, quality),
      subtext: name,
      notes: recipe.map((o) => midiToName(rootMidi + o)),
      description,
      baseRoot: pitchClassName(rootPc)
    };
  });
};
