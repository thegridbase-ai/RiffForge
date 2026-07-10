import { Chord, TuningMode, VibeMode } from './types';

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

type ChordLibrary = Record<TuningMode, Record<VibeMode, Chord[]>>;

const chordCache: Partial<Record<string, Chord[]>> = {};

const fetchChords = async (tuning: TuningMode, vibe: VibeMode): Promise<Chord[]> => {
  const cacheKey = `${tuning}-${vibe}`;

  if (chordCache[cacheKey]) {
    return chordCache[cacheKey]!;
  }

  const tuningKey = tuning === TuningMode.STANDARD ? 'standard' : 'drop';
  const vibeKey = vibe.toLowerCase();

  try {
    const response = await fetch(`/chords/${tuningKey}-${vibeKey}.json`);
    if (!response.ok) {
      throw new Error(`Failed to fetch chords: ${response.status}`);
    }
    const chords = await response.json();
    chordCache[cacheKey] = chords;
    return chords;
  } catch (error) {
    console.error(`Error loading chords for ${tuning}/${vibe}:`, error);
    return [];
  }
};

const createChordLibraryProxy = (): ChordLibrary => {
  const library: ChordLibrary = {
    [TuningMode.STANDARD]: {
      [VibeMode.DARK]: [],
      [VibeMode.MELODIC]: [],
      [VibeMode.ENERGETIC]: []
    },
    [TuningMode.DROP]: {
      [VibeMode.DARK]: [],
      [VibeMode.MELODIC]: [],
      [VibeMode.ENERGETIC]: []
    }
  };

  return library;
};

export const CHORD_LIBRARY: ChordLibrary = createChordLibraryProxy();

export const loadChordLibrary = async (): Promise<ChordLibrary> => {
  const tunings = [TuningMode.STANDARD, TuningMode.DROP];
  const vibes = [VibeMode.DARK, VibeMode.MELODIC, VibeMode.ENERGETIC];

  const promises = tunings.flatMap(tuning =>
    vibes.map(async vibe => {
      const chords = await fetchChords(tuning, vibe);
      CHORD_LIBRARY[tuning][vibe] = chords;
    })
  );

  await Promise.all(promises);
  return CHORD_LIBRARY;
};

export const getChords = async (tuning: TuningMode, vibe: VibeMode): Promise<Chord[]> => {
  if (CHORD_LIBRARY[tuning][vibe].length > 0) {
    return CHORD_LIBRARY[tuning][vibe];
  }

  const chords = await fetchChords(tuning, vibe);
  CHORD_LIBRARY[tuning][vibe] = chords;
  return chords;
};
