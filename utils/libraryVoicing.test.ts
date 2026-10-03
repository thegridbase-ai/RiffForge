import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLibraryChord, resolveLibraryVoicing, moveShape, shapeDistance, tuningForMode } from './libraryVoicing';
import { DEFAULT_HAND_PROFILE, profileFromCalibration, DEFAULT_CALIBRATION } from '../engine/handProfile';
import { fromRiffForgeTab, shapeToMidi } from '../engine/shape';
import { midiToName, pitchClass, parsePitchClass, parseNoteName } from '../engine/pitch';
import { findBestFingering } from '../engine/fingering';
import { NOTES } from '../constants';
import { Chord, TuningMode } from '../types';

const CHORD_DIR = join(__dirname, '..', 'public', 'chords');

const loadFile = (file: string): Chord[] => JSON.parse(readFileSync(join(CHORD_DIR, file), 'utf8'));

const allEntries = (): { file: string; mode: TuningMode; chord: Chord }[] =>
  readdirSync(CHORD_DIR)
    .filter((f) => f.endsWith('.json'))
    .flatMap((file) => {
      const mode = file.startsWith('drop') ? TuningMode.DROP : TuningMode.STANDARD;
      return loadFile(file).flatMap((chord) =>
        [chord, ...(chord.relatedChords ?? [])].map((c) => ({ file, mode, chord: c }))
      );
    });

const find = (file: string, id: string): Chord => {
  const entry = allEntries().find((e) => e.file === file && e.chord.id === id);
  if (!entry) throw new Error(`missing ${file} ${id}`);
  return entry.chord;
};

describe('tuningForMode', () => {
  it('maps the two app tunings', () => {
    expect(tuningForMode(TuningMode.STANDARD).id).toBe('e-standard');
    expect(tuningForMode(TuningMode.DROP).id).toBe('drop-d');
  });
});

describe('resolveLibraryChord', () => {
  it('gives Drop D power chords a D bass in Drop D (no +2 on the low string)', () => {
    const power = find('drop-energetic.json', 'drop-energetic-1');
    const resolved = resolveLibraryChord(power, 'D', TuningMode.DROP, DEFAULT_HAND_PROFILE);
    expect(resolved.fretboard).toBe('0 0 0 x x x');
    expect(resolved.notes).toEqual(['D2', 'A2', 'D3']);
  });

  it('derives tab and audio from the same shape', () => {
    const ghost = find('standard-melodic.json', 'melodic-1');
    const resolved = resolveLibraryChord(ghost, 'G', TuningMode.STANDARD, DEFAULT_HAND_PROFILE);
    const shape = fromRiffForgeTab(resolved.fretboard!)!;
    expect(resolved.notes).toEqual(shapeToMidi(shape, tuningForMode(TuningMode.STANDARD)).map(midiToName));
    expect(resolved.voicing!.tab).toBe(resolved.fretboard);
    expect(resolved.fretboard).not.toBe('3 5 7 3 3 3');
  });

  it('keeps ids, descriptions and related chords, and moves labels to the root', () => {
    const omen = find('standard-dark.json', 'dark-1');
    const resolved = resolveLibraryChord(omen, 'F#', TuningMode.STANDARD, DEFAULT_HAND_PROFILE);
    expect(resolved.id).toBe('dark-1');
    expect(resolved.description).toBe(omen.description);
    expect(resolved.relatedChords).toBe(omen.relatedChords);
    expect(resolved.subtext).toBe('F# m2 Clash');
  });

  it('honours the recipe: the Omen is root, b2 and 5 with the root in the bass', () => {
    const omen = find('standard-dark.json', 'dark-1');
    for (const root of NOTES) {
      const { voicing } = resolveLibraryVoicing(omen, root, tuningForMode(TuningMode.STANDARD), DEFAULT_HAND_PROFILE);
      expect(voicing).not.toBeNull();
      const midi = voicing!.notes.map((n) => parseNoteName(n)!);
      const rootPc = parsePitchClass(root)!;
      expect(new Set(midi.map((m) => pitchClass(m - rootPc)))).toEqual(new Set([0, 1, 7]));
      expect(pitchClass(Math.min(...midi) - rootPc)).toBe(0);
      expect(voicing!.degrees.split(' ')[0]).toBe('1');
    }
  });

  it('resolves every library entry at every root to a no-barre shape whose audio equals its tab', () => {
    let unplayable = 0;
    let relaxed = 0;
    let total = 0;
    for (const { mode, chord } of allEntries()) {
      for (const root of NOTES) {
        total++;
        const resolved = resolveLibraryChord(chord, root, mode, DEFAULT_HAND_PROFILE);
        if (!resolved.voicing) {
          unplayable++;
          expect(resolved.unplayableReason).toBeTruthy();
          expect(resolved.notes).toEqual([]);
          continue;
        }
        if (resolved.voicing.relaxed) relaxed++;
        const shape = fromRiffForgeTab(resolved.fretboard!)!;
        expect(resolved.notes).toEqual(shapeToMidi(shape, tuningForMode(mode)).map(midiToName));
        const fingering = findBestFingering(shape, DEFAULT_HAND_PROFILE);
        expect(fingering.ok).toBe(true);
        if (fingering.ok === true) expect(fingering.fingering.barres).toEqual([]);
        expect(shape.filter((f) => f !== null && f > 0).length).toBeLessThanOrEqual(4);
      }
    }
    expect(total).toBe(252 * 12);
    // Every curated recipe must be playable somewhere on the neck for the default hand
    expect(unplayable).toBe(0);
    console.info(`library: ${total} resolutions, ${relaxed} relaxed, ${unplayable} unplayable`);
  });

  it('follows the hand profile: a tiny reach without open strings can make a card unplayable with a reason', () => {
    const tiny = {
      ...profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3, highPinkyFret: 9 }),
      allowOpenStrings: false,
      maxFret: 4
    };
    const phrygian = find('standard-dark.json', 'dark-2');
    const resolved = resolveLibraryChord(phrygian, 'A#', TuningMode.STANDARD, tiny);
    if (!resolved.voicing) {
      expect(resolved.unplayableReason).toMatch(/\w/);
      expect(resolved.fretboard).toBeUndefined();
    } else {
      expect(resolved.voicing.shape.every((f) => f !== 0)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const omen = find('drop-dark.json', 'drop-dark-1');
    const a = resolveLibraryChord(omen, 'C', TuningMode.DROP, DEFAULT_HAND_PROFILE);
    const b = resolveLibraryChord({ ...omen }, 'C', TuningMode.DROP, { ...DEFAULT_HAND_PROFILE });
    expect(b).toEqual(a);
  });
});

describe('card helpers', () => {
  it('moves a curated tab as a rigid block, wrapping up an octave only as a whole', () => {
    expect(moveShape([0, 2, 2, null, null, null], 3)).toEqual([3, 5, 5, null, null, null]);
    expect(moveShape([0, 2, 2, null, null, null], -2)).toEqual([10, 12, 12, null, null, null]);
    expect(moveShape([null, null, null, null, null, null], 3)).toBeNull();
  });

  it('measures shape distance by string set first, then frets', () => {
    expect(shapeDistance([3, 5, 5, null, null, null], [3, 5, 5, null, null, null])).toBe(0);
    expect(shapeDistance([3, 5, null, null, null, null], [3, 5, 5, null, null, null])).toBeCloseTo(1 / 6, 9);
    expect(shapeDistance([null, null, null, 0, 3, null], [3, 5, 5, null, null, null])).toBeCloseTo(5 / 6, 9);
  });
});
