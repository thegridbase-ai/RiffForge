import { describe, it, expect } from 'vitest';
import { transposeChordLabels } from './musicTheory';
import { Chord } from '../types';

// Tab and note transposition moved to the engine (utils/libraryVoicing.ts). The removed transposeTabs
// codified two bugs: Drop mode always added 2 frets to the lowest string (wrong bass: E instead of D), and
// per-string +12 wrapping turned open strings into hidden barres (Em(add9) to G became 3 5 7 3 3 3).

const ghost: Chord = {
  id: 'melodic-1',
  name: 'Em',
  subtext: 'Em(add9)',
  notes: ['E2', 'B2', 'F#3', 'G3', 'B3', 'E4'],
  description: 'The quintessential melancholy shape.',
  fretboard: '0 2 4 0 0 0',
  baseRoot: 'E'
};

const withSubtext = (subtext: string, baseRoot = 'E'): Chord => ({ ...ghost, id: `t-${subtext}`, subtext, baseRoot });

describe('transposeChordLabels', () => {
  it('updates name and subtext (Em -> Cm)', () => {
    expect(transposeChordLabels(ghost, 'C')).toEqual({ name: 'Cm', subtext: 'Cm(add9)' });
  });

  it('keeps labels when the target equals baseRoot', () => {
    expect(transposeChordLabels(ghost, 'E')).toEqual({ name: 'Em', subtext: 'Em(add9)' });
  });

  it('transposes sharp-rooted chords (C#dim -> Ddim)', () => {
    const sharpDim: Chord = { ...ghost, id: 'test-sharp', name: 'C#dim', subtext: 'C#dim(vii)', baseRoot: 'C#' };
    expect(transposeChordLabels(sharpDim, 'D')).toEqual({ name: 'Ddim', subtext: 'Ddim(vii)' });
  });

  it('glues chord qualities to the root for generic subtexts', () => {
    expect(transposeChordLabels(withSubtext('m(add9)'), 'C').subtext).toBe('Cm(add9)');
    expect(transposeChordLabels(withSubtext('Sus4'), 'A').subtext).toBe('ASus4');
  });

  it('keeps a space before interval words so they do not read as accidentals', () => {
    expect(transposeChordLabels(withSubtext('b2'), 'E').subtext).toBe('E b2');
    expect(transposeChordLabels(withSubtext('b5/m2'), 'F#').subtext).toBe('F# b5/m2');
    expect(transposeChordLabels(withSubtext('m2 Clash'), 'E').subtext).toBe('E m2 Clash');
    expect(transposeChordLabels(withSubtext('5th'), 'G').subtext).toBe('G 5th');
    expect(transposeChordLabels(withSubtext('Octave'), 'G').subtext).toBe('G Octave');
  });

  it('does not mistake words starting with A-G for roots', () => {
    expect(transposeChordLabels(withSubtext('Dim/b2'), 'E').subtext).toBe('E Dim/b2');
  });

  it('replaces flat roots completely', () => {
    expect(transposeChordLabels(withSubtext('Bb(VI)', 'A#'), 'E').subtext).toBe('E(VI)');
    expect(transposeChordLabels(withSubtext('Bb(VI)sus2', 'A#'), 'C').subtext).toBe('C(VI)sus2');
  });
});
