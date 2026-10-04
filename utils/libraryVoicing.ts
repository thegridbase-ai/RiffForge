// Turns curated library chords into engine-generated shapes. The JSON `notes` are the musical intent
// (an interval recipe relative to `baseRoot`, in a specific register); the JSON `fretboard` is only a
// hint for where on the neck the idea lives, because most curated tabs do not sound their own notes.
import type { GeneratedVoicing, HandProfile, Shape, Tuning } from '../engine/types';
import { DROP_D, E_STANDARD } from '../engine/tuning';
import { fromLegacyNotes } from '../engine/voicingSpec';
import { findClosestVoicing } from '../engine/generateVoicings';
import { bassMidi, fromRiffForgeTab, shapeToMidi, toRiffForgeTab } from '../engine/shape';
import { midiToName, parseNoteName, parsePitchClass, pitchClass } from '../engine/pitch';
import { explainCost } from '../engine/playability';
import { handProfileHash } from '../engine/handProfile';
import { Chord, LibraryVoicing, TuningMode } from '../types';
import { libraryLabels } from './musicTheory';
import { explorerTypeForIntervals } from './chordExplorer';

/** The JSON drop files are authored in Drop D, the standard files in E Standard. */
export const tuningForMode = (mode: TuningMode): Tuning => (mode === TuningMode.DROP ? DROP_D : E_STANDARD);

const CANDIDATES = 200;

// A card shows the voicing that keeps its curated idea: same register, same density, same place on the
// neck. Engine cost only decides between equally faithful shapes. These preferences are card-only; the
// Voicing Finder ranks by the engine alone.
const REGISTER_WEIGHT = 2; // per octave between the bass and the curated bass moved to the new root
const REGISTER_CAP_OCTAVES = 2;
const NOTE_COUNT_WEIGHT = 0.5; // per note more or fewer than the curated chord
const SHAPE_WEIGHT = 1; // 0..1 distance from the curated tab moved rigidly to the new root
const POSITION_WEIGHT = 0.08; // per fret between the lowest fretted notes of the two shapes
const POSITION_CAP_FRETS = 10;

const lowestFretOf = (shape: Shape): number => {
  const fretted = shape.filter((f): f is number => f !== null && f > 0);
  return fretted.length === 0 ? 0 : Math.min(...fretted);
};

export interface LibraryResolution {
  voicing: LibraryVoicing | null;
  unplayableReason: string | null;
}

/** Semitone move from baseRoot to targetRoot in -6..5, so the idea stays near its register. */
const rootShift = (baseRoot: string, targetRoot: string): number => {
  const from = parsePitchClass(baseRoot);
  const to = parsePitchClass(targetRoot);
  if (from === null || to === null) return 0;
  const up = pitchClass(to - from);
  return up > 5 ? up - 12 : up;
};

/** The curated tab moved as a rigid block (every sounding string, opens included) by `shift` frets. */
export const moveShape = (shape: Shape, shift: number): Shape | null => {
  const sounding = shape.filter((f): f is number => f !== null);
  if (sounding.length === 0) return null;
  let delta = shift;
  while (Math.min(...sounding) + delta < 0) delta += 12;
  return shape.map((f) => (f === null ? null : f + delta));
};

/** 0..1 difference between two absolute shapes: string sets first, then fret distance per string. */
export const shapeDistance = (a: Shape, b: Shape): number => {
  if (a.length !== b.length) return 1;
  let sum = 0;
  for (let s = 0; s < a.length; s++) {
    const x = a[s];
    const y = b[s];
    if (x === null || y === null) sum += x === y ? 0 : 1;
    else sum += Math.min(1, Math.abs(x - y) / 3);
  }
  return sum / a.length;
};

const toLibraryVoicing = (
  v: GeneratedVoicing,
  tuning: Tuning,
  profile: HandProfile,
  relaxed: string[] | null,
  targetRoot: string
): LibraryVoicing => ({
  shape: [...v.shape],
  tab: toRiffForgeTab(v.shape),
  fingers: [...v.fingering.fingers],
  degreesByString: [...v.degreesByString],
  degrees: v.degrees,
  soundsAs: v.name,
  // Audio comes from the same shape as the tab
  notes: shapeToMidi(v.shape, tuning).map(midiToName),
  relaxed,
  explain: explainCost(v.breakdown, v.fingering, profile),
  // Link by what sounds, never by the curated label ("Drop Ghost" is not a D chord)
  explorer: {
    root: targetRoot,
    type: explorerTypeForIntervals(v.midi.map((m) => pitchClass(m - (parsePitchClass(targetRoot) ?? 0))))
  }
});

/** Chord Explorer target from a curated recipe (notes relative to baseRoot), moved to the selected root. */
export const curatedExplorerTarget = (chord: Pick<Chord, 'notes' | 'baseRoot'>, targetRoot: string): LibraryVoicing['explorer'] => {
  const base = parsePitchClass(chord.baseRoot) ?? 0;
  const midi = chord.notes.map(parseNoteName).filter((m): m is number => m !== null);
  return { root: targetRoot, type: midi.length > 0 ? explorerTypeForIntervals(midi.map((m) => pitchClass(m - base))) : undefined };
};

const cache = new Map<string, LibraryResolution>();

export const resolveLibraryVoicing = (
  chord: Pick<Chord, 'notes' | 'baseRoot' | 'fretboard'>,
  targetRoot: string,
  tuning: Tuning,
  profile: HandProfile
): LibraryResolution => {
  const key = [chord.notes.join(','), chord.baseRoot, chord.fretboard ?? '', targetRoot, tuning.id, handProfileHash(profile)].join('|');
  const cached = cache.get(key);
  if (cached) return cached;

  let resolution: LibraryResolution;
  try {
    const family = fromLegacyNotes(chord.notes, chord.baseRoot);
    const base = { root: targetRoot, tuning, profile, distortion: true, limit: CANDIDATES, diversify: false };
    // Exact recipe first, then the engine's musical relaxation ladder (the hand profile is never relaxed)
    const { result, relaxed, exactEmpty } = findClosestVoicing({ ...base, family });

    if (result.voicings.length === 0) {
      resolution = {
        voicing: null,
        unplayableReason: exactEmpty?.message ?? result.empty?.message ?? 'No playable shape for your hand profile.'
      };
    } else {
      const shift = rootShift(chord.baseRoot, targetRoot);
      const curatedMidi = chord.notes.map(parseNoteName).filter((m): m is number => m !== null);
      let targetBass = Math.min(...curatedMidi) + shift;
      while (targetBass < tuning.openMidi[0]) targetBass += 12;
      const parsed = chord.fretboard ? fromRiffForgeTab(chord.fretboard) : null;
      const moved = parsed && parsed.length === tuning.openMidi.length ? moveShape(parsed, shift) : null;

      const score = (v: GeneratedVoicing) => {
        const bass = bassMidi(v.shape, tuning) ?? targetBass;
        return (
          v.cost +
          REGISTER_WEIGHT * Math.min(REGISTER_CAP_OCTAVES, Math.abs(bass - targetBass) / 12) +
          NOTE_COUNT_WEIGHT * Math.abs(v.midi.length - curatedMidi.length) +
          (moved
            ? SHAPE_WEIGHT * shapeDistance(v.shape, moved) +
              POSITION_WEIGHT * Math.min(POSITION_CAP_FRETS, Math.abs(lowestFretOf(v.shape) - lowestFretOf(moved)))
            : 0)
        );
      };
      // Candidates arrive in a deterministic order; keep the first on ties
      const best = result.voicings.reduce((a, b) => (score(b) < score(a) ? b : a));
      resolution = { voicing: toLibraryVoicing(best, tuning, profile, relaxed, targetRoot), unplayableReason: null };
    }
  } catch {
    resolution = { voicing: null, unplayableReason: 'This library entry has no readable notes.' };
  }

  cache.set(key, resolution);
  return resolution;
};

/**
 * A curated chord as displayed for the selected root and tuning. The title (`name`) is the engine's name for what
 * sounds; the curated nickname and descriptive subtext become the secondary line, so a title can never contradict
 * the sound. Tab and audio notes come from one engine shape. Ids are untouched so favorites keep working.
 */
export const resolveLibraryChord = (
  chord: Chord,
  targetRoot: string,
  tuningMode: TuningMode,
  profile: HandProfile
): Chord => {
  const { nickname, detail } = libraryLabels(chord, targetRoot);
  const { voicing, unplayableReason } = resolveLibraryVoicing(chord, targetRoot, tuningForMode(tuningMode), profile);
  return {
    ...chord,
    name: voicing ? voicing.soundsAs : nickname,
    subtext: voicing ? [nickname, detail].filter(Boolean).join(' · ') : detail,
    notes: voicing ? voicing.notes : [],
    fretboard: voicing ? voicing.tab : undefined,
    voicing: voicing ?? undefined,
    unplayableReason: unplayableReason ?? undefined,
    // Without a shape, link by the curated sound at the selected root, never by the nickname
    explorer: voicing ? undefined : curatedExplorerTarget(chord, targetRoot)
  };
};
