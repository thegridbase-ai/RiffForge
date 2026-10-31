import { describe, it, expect } from 'vitest';
import { chordColor, fittingKeys, intervalsAbove, keyCompanions, MAX_KEY_OPTIONS } from './keyCompanions';
import { resolveLibraryChord, tuningForMode } from './libraryVoicing';
import { DEFAULT_HAND_PROFILE } from '../engine/handProfile';
import { parseNoteName, parsePitchClass, pitchClass } from '../engine/pitch';
import { NOTES } from '../constants';
import { TuningMode, VibeMode } from '../types';

const E2 = 40;
const D2 = 38;

const pcsOf = (notes: string[], root: string): number[] => intervalsAbove(notes, root);

describe('intervalsAbove', () => {
  it('reads sounding notes as unique pitch classes above the root', () => {
    expect(intervalsAbove(['E2', 'B2', 'F#3', 'B3', 'E4'], 'E')).toEqual([0, 2, 7]);
    expect(intervalsAbove(['D2', 'A2', 'D3'], 'D')).toEqual([0, 7]);
    expect(intervalsAbove([], 'E')).toEqual([]);
  });
});

describe('chordColor', () => {
  it('classifies the library sounds', () => {
    expect(chordColor([0, 7])).toBe('power');
    expect(chordColor([0, 2, 7])).toBe('sus2');
    expect(chordColor([0, 5, 7])).toBe('sus4');
    expect(chordColor([0, 2, 3, 7])).toBe('add9');
    expect(chordColor([0, 3, 7, 11])).toBe('seventh');
    expect(chordColor([0, 2, 3, 5, 7, 10])).toBe('seventh');
    expect(chordColor([0, 1, 3, 6])).toBe('triad');
  });
});

describe('fittingKeys', () => {
  it('offers minor first for a sus2 on the melodic vibe, then the other keys that hold it', () => {
    expect(fittingKeys([0, 2, 7], VibeMode.MELODIC)).toEqual(['aeolian', 'dorian', 'ionian', 'harmonicMinor']);
  });

  it('puts Phrygian first on the dark vibe when it holds the chord', () => {
    expect(fittingKeys([0, 1, 7], VibeMode.DARK)[0]).toBe('phrygian');
    expect(fittingKeys([0, 7], VibeMode.DARK)[0]).toBe('phrygian');
  });

  it('only offers keys that hold every sounding note', () => {
    expect(fittingKeys([0, 3, 7, 11], VibeMode.MELODIC)).toEqual(['harmonicMinor']);
    expect(fittingKeys([0, 1, 4, 7], VibeMode.DARK)).toEqual(['phrygianDominant']);
    expect(fittingKeys([0, 4, 7, 11], VibeMode.MELODIC)).toEqual(['ionian', 'lydian']);
  });

  it('falls back to the closest keys and caps the options', () => {
    // b2 + b5 + 5 fits no seven-note mode here; the closest ones still come back
    expect(fittingKeys([0, 1, 6, 7], VibeMode.DARK).length).toBeGreaterThan(0);
    expect(fittingKeys([0, 7], VibeMode.ENERGETIC).length).toBe(MAX_KEY_OPTIONS);
  });
});

describe('keyCompanions', () => {
  it('gives Esus2 in E minor the other six degrees in its sus2 color where it stays in key', () => {
    const chords = keyCompanions('E', [0, 2, 7], 'aeolian', E2);
    expect(chords.map((c) => c.baseRoot)).toEqual(['F#', 'G', 'A', 'B', 'C', 'D']);
    expect(chords.map((c) => c.name)).toEqual(['ii°', 'bIII', 'iv', 'v', 'bVI', 'bVII']);
    // F#sus2 and Bsus2 need C#, which E minor does not have: they fall back to the triad
    expect(chords.map((c) => pcsOf(c.notes, c.baseRoot))).toEqual([
      [0, 3, 6],
      [0, 2, 7],
      [0, 2, 7],
      [0, 3, 7],
      [0, 2, 7],
      [0, 2, 7]
    ]);
  });

  it('switches the companions with the key', () => {
    const major = keyCompanions('E', [0, 2, 7], 'ionian', E2);
    expect(major.map((c) => c.baseRoot)).toEqual(['F#', 'G#', 'A', 'B', 'C#', 'D#']);
    expect(major.map((c) => c.name)).toEqual(['ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  });

  it('keeps power chords for a power chord and drops to the triad on a diminished degree', () => {
    const chords = keyCompanions('E', [0, 7], 'phrygian', E2);
    expect(chords.map((c) => c.baseRoot)).toEqual(['F', 'G', 'A', 'B', 'C', 'D']);
    expect(chords.map((c) => pcsOf(c.notes, c.baseRoot))).toEqual([
      [0, 7],
      [0, 7],
      [0, 7],
      [0, 3, 6],
      [0, 7],
      [0, 7]
    ]);
    expect(chords[0].name).toBe('bII');
  });

  it('builds diatonic sevenths for a seventh chord', () => {
    const chords = keyCompanions('E', [0, 2, 3, 5, 7, 10], 'aeolian', E2);
    expect(chords.map((c) => pcsOf(c.notes, c.baseRoot))).toEqual([
      [0, 3, 6, 10],
      [0, 4, 7, 11],
      [0, 3, 7, 10],
      [0, 3, 7, 10],
      [0, 4, 7, 11],
      [0, 4, 7, 10]
    ]);
  });

  it('puts every root at its first position above the low string, with the root in the bass', () => {
    for (const lowest of [E2, D2]) {
      for (const chord of keyCompanions('E', [0, 3, 7], 'aeolian', lowest)) {
        const midi = chord.notes.map((n) => parseNoteName(n) as number);
        const bass = Math.min(...midi);
        expect(pitchClass(bass)).toBe(parsePitchClass(chord.baseRoot));
        expect(bass).toBeGreaterThanOrEqual(lowest);
        expect(bass).toBeLessThan(lowest + 12);
      }
    }
  });

  it('labels each card with its degree function and never repeats an id', () => {
    const chords = keyCompanions('A', [0, 3, 7], 'aeolian', E2);
    expect(chords.map((c) => c.subtext)).toEqual(['Supertonic', 'Mediant', 'Subdominant', 'Dominant', 'Submediant', 'Subtonic']);
    expect(new Set(chords.map((c) => c.id)).size).toBe(6);
    expect(keyCompanions('A', [0, 3, 7], 'harmonicMinor', E2)[5].subtext).toBe('Leading tone');
  });

  it('resolves to playable shapes named on the companion root (12 roots, both tunings, every vibe default)', () => {
    const colors = [[0, 7], [0, 2, 7], [0, 5, 7], [0, 2, 3, 7], [0, 3, 7, 11], [0, 1, 3, 6]];
    for (const mode of [TuningMode.STANDARD, TuningMode.DROP]) {
      const lowest = tuningForMode(mode).openMidi[0];
      for (const root of NOTES) {
        for (const intervals of colors) {
          for (const vibe of [VibeMode.DARK, VibeMode.MELODIC, VibeMode.ENERGETIC]) {
            const key = fittingKeys(intervals, vibe)[0];
            for (const chord of keyCompanions(root, intervals, key, lowest)) {
              const resolved = resolveLibraryChord(chord, chord.baseRoot, mode, DEFAULT_HAND_PROFILE);
              expect(resolved.voicing, `${root} ${key} ${chord.name} ${mode}`).toBeDefined();
              const nameRoot = resolved.name.match(/^[A-G][#b]?/)?.[0] ?? '';
              expect(parsePitchClass(nameRoot)).toBe(parsePitchClass(chord.baseRoot));
              expect(resolved.subtext.startsWith(`${chord.name} · `)).toBe(true);
            }
          }
        }
      }
    }
  });
});
