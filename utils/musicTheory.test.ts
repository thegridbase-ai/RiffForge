import { describe, it, expect } from 'vitest';
import { transposeNote, transposeTabs, transposeChord } from './musicTheory';
import { Chord, TuningMode } from '../types';

describe('transposeNote', () => {
  it('transposes within an octave', () => {
    expect(transposeNote('E2', 3)).toBe('G2');
    expect(transposeNote('C3', 4)).toBe('E3');
  });

  it('wraps up an octave when crossing B', () => {
    expect(transposeNote('B3', 1)).toBe('C4');
    expect(transposeNote('A#2', 2)).toBe('C3');
  });

  it('wraps down an octave when transposing below C', () => {
    expect(transposeNote('C4', -1)).toBe('B3');
    expect(transposeNote('A2', -10)).toBe('B1');
  });

  it('shifts a full octave for 12 semitones', () => {
    expect(transposeNote('E2', 12)).toBe('E3');
    expect(transposeNote('F#3', -12)).toBe('F#2');
  });

  it('handles sharps', () => {
    expect(transposeNote('G#2', 3)).toBe('B2');
    expect(transposeNote('C#3', 1)).toBe('D3');
  });

  it('returns unparseable input unchanged', () => {
    expect(transposeNote('x', 5)).toBe('x');
    expect(transposeNote('Bb3', 1)).toBe('Bb3'); // flats are not in the note table
  });
});

describe('transposeTabs', () => {
  it('preserves muted strings', () => {
    expect(transposeTabs('x 3 2 0 1 0', 2, TuningMode.STANDARD)).toBe('x 5 4 2 3 2');
    expect(transposeTabs('x x 0 2 3 1', 2, TuningMode.STANDARD)).toBe('x x 2 4 5 3');
  });

  it('keeps open strings open at zero semitones in standard tuning', () => {
    expect(transposeTabs('0 2 4 0 0 0', 0, TuningMode.STANDARD)).toBe('0 2 4 0 0 0');
  });

  it('adds 2 frets on the lowest string in drop tuning', () => {
    expect(transposeTabs('0 2 4 0 0 0', 0, TuningMode.DROP)).toBe('2 2 4 0 0 0');
    expect(transposeTabs('0 2 4 0 0 0', 3, TuningMode.DROP)).toBe('5 5 7 3 3 3');
  });

  it('wraps negative frets up an octave', () => {
    expect(transposeTabs('0 2 2 1 0 0', -2, TuningMode.STANDARD)).toBe('10 0 0 11 10 10');
  });

  it('handles empty and sentinel input', () => {
    expect(transposeTabs(undefined, 2, TuningMode.STANDARD)).toBe('');
    expect(transposeTabs('TRANSPOSED', 2, TuningMode.STANDARD)).toBe('TRANSPOSED');
  });
});

describe('transposeChord', () => {
  const ghost: Chord = {
    id: 'melodic-1',
    name: 'Em',
    subtext: 'Em(add9)',
    notes: ['E2', 'B2', 'F#3', 'G3', 'B3', 'E4'],
    description: 'The quintessential melancholy shape.',
    fretboard: '0 2 4 0 0 0',
    baseRoot: 'E'
  };

  it('updates name and subtext (Em -> Cm)', () => {
    const result = transposeChord(ghost, 'C', TuningMode.STANDARD);
    expect(result.name).toBe('Cm');
    expect(result.subtext).toBe('Cm(add9)');
  });

  it('shifts all notes by the root distance', () => {
    const result = transposeChord(ghost, 'G', TuningMode.STANDARD);
    expect(result.notes).toEqual(['G2', 'D3', 'A3', 'A#3', 'D4', 'G4']);
    expect(result.fretboard).toBe('3 5 7 3 3 3');
  });

  it('keeps id stable and chord unchanged when target equals baseRoot', () => {
    const result = transposeChord(ghost, 'E', TuningMode.STANDARD);
    expect(result.id).toBe('melodic-1');
    expect(result.name).toBe('Em');
    expect(result.notes).toEqual(ghost.notes);
  });

  it('transposes sharp-rooted chords (C#dim -> Ddim)', () => {
    const sharpDim: Chord = {
      id: 'test-sharp',
      name: 'C#dim',
      subtext: 'C#dim(vii)',
      notes: ['C#3', 'E3', 'G3'],
      description: 'Leading tone tension.',
      fretboard: 'x 4 5 6 x x',
      baseRoot: 'C#'
    };
    const result = transposeChord(sharpDim, 'D', TuningMode.STANDARD);
    expect(result.name).toBe('Ddim');
    expect(result.subtext).toBe('Ddim(vii)');
    expect(result.notes).toEqual(['D3', 'F3', 'G#3']);
    expect(result.fretboard).toBe('x 5 6 7 x x');
  });

  it('prefixes the target root for generic subtexts', () => {
    const generic: Chord = { ...ghost, id: 'test-generic', subtext: 'm(add9)' };
    const result = transposeChord(generic, 'C', TuningMode.STANDARD);
    expect(result.subtext).toBe('Cm(add9)');
  });

  it('applies the drop-tuning lowest-string rule to the fretboard', () => {
    const result = transposeChord(ghost, 'E', TuningMode.DROP);
    expect(result.fretboard).toBe('2 2 4 0 0 0');
  });
});
