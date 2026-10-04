import { describe, it, expect } from 'vitest';
import { degreesByString, degreeString, chordSymbol, nameVoicing } from './naming';
import { getFamily, fromLegacyNotes } from './voicingSpec';
import type { Shape, VoicingFamily } from './types';
import { E_STANDARD, DROP_D } from './tuning';
import { createRng } from './random';
import { pitchClassName, pitchClass, intervalName } from './pitch';
import { shapeToMidi, bassMidi } from './shape';

const x = null;
const C = 0;
const D = 2;
const E = 4;

const fam = (id: string): VoicingFamily => {
  const family = getFamily(id);
  if (!family) throw new Error(`missing family ${id}`);
  return family;
};

describe('degreesByString', () => {
  it('labels each string relative to the root, null when muted', () => {
    expect(degreesByString([x, 3, 2, 0, 1, 0], E_STANDARD, C)).toEqual([null, '1', '3', '5', '1', '3']);
    expect(degreesByString([0, 1, x, x, x, x], E_STANDARD, E)).toEqual(['1', 'b5', null, null, null, null]);
  });

  it('follows the tuning (Drop D low string)', () => {
    expect(degreesByString([0, 0, 0, x, x, x], DROP_D, D)).toEqual(['1', '5', '1', null, null, null]);
    expect(degreesByString([0, 0, 0, x, x, x], E_STANDARD, D)).toEqual(['2', '5', '1', null, null, null]);
  });
});

describe('degreeString', () => {
  it('lists sounding notes low -> high using the pitch.ts degree table', () => {
    // E2 B2 F3
    expect(degreeString([0, 2, 3, x, x, x], E_STANDARD, E)).toBe('1 5 b2');
    expect(degreeString([0, 2, 2, 1, 0, 0], E_STANDARD, E)).toBe('1 5 1 3 5 1');
  });

  it('keeps octave doublings', () => {
    expect(degreeString([0, 2, 2, x, x, x], E_STANDARD, E)).toBe('1 5 1');
    expect(degreeString([0, 0, 0, x, x, x], DROP_D, D)).toBe('1 5 1');
  });

  it('sorts by pitch, not by string', () => {
    // String 0 fret 7 is B2, above the open A2 on string 1.
    expect(degreeString([7, 0, x, x, x, x], E_STANDARD, E)).toBe('4 5');
    expect(degreeString([1, x, 2, x, x, x], E_STANDARD, E)).toBe('b2 1');
  });

  it('is empty for a fully muted shape', () => {
    expect(degreeString([x, x, x, x, x, x], E_STANDARD, E)).toBe('');
  });
});

describe('chordSymbol templates', () => {
  const templates: [string, number[]][] = [
    ['5', [0, 7]],
    ['5(b9)', [0, 1, 7]],
    ['', [0, 4, 7]],
    ['m', [0, 3, 7]],
    ['dim', [0, 3, 6]],
    ['aug', [0, 4, 8]],
    ['sus2', [0, 2, 7]],
    ['sus4', [0, 5, 7]],
    ['7', [0, 4, 7, 10]],
    ['m7', [0, 3, 7, 10]],
    ['maj7', [0, 4, 7, 11]],
    ['mMaj7', [0, 3, 7, 11]],
    ['m7b5', [0, 3, 6, 10]],
    ['dim7', [0, 3, 6, 9]],
    ['7sus4', [0, 5, 7, 10]],
    ['6', [0, 4, 7, 9]],
    ['m6', [0, 3, 7, 9]],
    ['add9', [0, 2, 4, 7]],
    ['m(add9)', [0, 2, 3, 7]],
    ['(addb9)', [0, 1, 4, 7]],
    ['7(b9)', [0, 1, 4, 7, 10]],
    ['9', [0, 2, 4, 7, 10]],
    ['m9', [0, 2, 3, 7, 10]],
    ['maj9', [0, 2, 4, 7, 11]],
    ['m11', [0, 2, 3, 5, 7, 10]]
  ];

  it.each(templates)('matches %j exactly in root position', (symbol, intervals) => {
    expect(chordSymbol(C, intervals, 0)).toEqual({ symbol, omissions: [] });
  });

  it('ignores order, duplicates and octave-wrapped intervals', () => {
    expect(chordSymbol(C, [7, 4, 0, 7, 12, 16, -5], 0)).toEqual({ symbol: '', omissions: [] });
    expect(chordSymbol(E, [10, 0, 4, 10, 0], null).symbol).toBe('7(no5)');
  });
});

describe('chordSymbol omissions', () => {
  const sym = (intervals: number[], bass: number | null = 0): string | null => chordSymbol(C, intervals, bass).symbol;

  it('marks a missing perfect fifth', () => {
    expect(chordSymbol(C, [0, 4, 10], 0)).toEqual({ symbol: '7(no5)', omissions: ['(no5)'] });
    expect(sym([0, 5, 10])).toBe('7sus4(no5)');
    expect(sym([0, 3, 10])).toBe('m7(no5)');
    expect(sym([0, 4, 11])).toBe('maj7(no5)');
    expect(sym([0, 2, 4])).toBe('add9(no5)');
    expect(sym([0, 2, 3])).toBe('m(add9)(no5)');
    expect(sym([0, 1, 4])).toBe('(addb9)(no5)');
    expect(sym([0, 1, 4, 10])).toBe('7(b9)(no5)');
    expect(sym([0, 4, 9])).toBe('6(no5)');
  });

  it('marks a missing third only where the symbol does not claim a quality', () => {
    expect(chordSymbol(C, [0, 7, 10], 0)).toEqual({ symbol: '7(no3)', omissions: ['(no3)'] });
    expect(sym([0, 7, 11])).toBe('maj7(no3)');
    // m7b5 without its third would need a quality the notes no longer show.
    expect(sym([0, 6, 10])).toBeNull();
  });

  it('never drops a flat or sharp fifth: that would erase the quality', () => {
    expect(sym([0, 3, 9])).toBe('m6(no5)');
    expect(sym([0, 4])).toBeNull();
  });

  it('marks a missing root without inventing another root', () => {
    expect(chordSymbol(C, [4, 7, 10], 4)).toEqual({ symbol: '7(no root)/E', omissions: ['(no root)'] });
    expect(sym([3, 7, 10], 3)).toBe('m7(no root)/D#');
    expect(sym([2, 4, 10], 2)).toBe('9(no5)(no root)/D');
    expect(sym([4, 7, 10], null)).toBe('7(no root)');
    // Two pitch classes are too thin for a rootless symbol.
    expect(sym([4, 7], 4)).toBeNull();
    expect(sym([4, 10], 4)).toBeNull();
  });

  it('needs at least three pitch classes once anything is omitted', () => {
    expect(sym([0, 3])).toBeNull();
    expect(sym([0, 10])).toBeNull();
  });
});

describe('chordSymbol slash bass and non-chords', () => {
  it('appends the bass when it is not the root, spelled with sharps', () => {
    expect(chordSymbol(C, [0, 4, 7], 4)).toEqual({ symbol: '/E', omissions: [] });
    expect(chordSymbol(C, [0, 4, 7], 7).symbol).toBe('/G');
    expect(chordSymbol(E, [0, 7], 7).symbol).toBe('5/B');
    expect(chordSymbol(10, [0, 3, 7], 3).symbol).toBe('m/C#');
    expect(chordSymbol(C, [0, 4, 7], null).symbol).toBe('');
  });

  it('counts the bass as sounding even if the caller left it out of the intervals', () => {
    expect(chordSymbol(C, [0, 4], 7).symbol).toBe('/G');
  });

  it('gives dyads and clusters no symbol', () => {
    for (const intervals of [[0, 1], [0, 6], [0, 5], [0, 2], [0, 3], [0, 4], [0, 11], [0, 1, 2], [0, 1, 2, 3]]) {
      expect(chordSymbol(E, intervals, 0), JSON.stringify(intervals)).toEqual({ symbol: null, omissions: [] });
    }
  });

  it('gives nothing for empty or single pitch classes', () => {
    expect(chordSymbol(E, [], null)).toEqual({ symbol: null, omissions: [] });
    expect(chordSymbol(E, [0, 0, 12], 0)).toEqual({ symbol: null, omissions: [] });
    expect(chordSymbol(E, [3], 3)).toEqual({ symbol: null, omissions: [] });
  });

  it('gives no symbol to unknown sets', () => {
    expect(chordSymbol(C, [0, 4, 8, 11], 0).symbol).toBeNull();
    expect(chordSymbol(C, [0, 3, 5, 10], 0).symbol).toBeNull();
    expect(chordSymbol(C, [0, 3, 4, 7], 0).symbol).toBeNull();
  });
});

describe('nameVoicing', () => {
  it('names open chords with the full symbol', () => {
    expect(nameVoicing([0, 2, 2, 1, 0, 0], E_STANDARD, E)).toEqual({
      symbol: 'E',
      name: 'E',
      degrees: '1 5 1 3 5 1',
      degreesByString: ['1', '5', '1', '3', '5', '1']
    });
    expect(nameVoicing([x, 3, 2, 0, 1, 0], E_STANDARD, C).name).toBe('C');
    expect(nameVoicing([0, 2, 4, 0, 0, 0], E_STANDARD, E)).toMatchObject({
      symbol: 'Em(add9)',
      degrees: '1 5 2 b3 5 1'
    });
  });

  it('adds the slash bass for inversions', () => {
    const v = nameVoicing([0, 3, 2, 0, 1, x], E_STANDARD, C);
    expect(v.symbol).toBe('C/E');
    expect(v.degrees).toBe('3 1 3 5 1');
  });

  it('names power chords, including Drop D', () => {
    expect(nameVoicing([0, 2, 2, x, x, x], E_STANDARD, E).symbol).toBe('E5');
    expect(nameVoicing([0, 2, 3, x, x, x], E_STANDARD, E)).toMatchObject({ symbol: 'E5(b9)', degrees: '1 5 b2' });
    expect(nameVoicing([0, 0, 0, x, x, x], DROP_D, D)).toMatchObject({ symbol: 'D5', name: 'D5', degrees: '1 5 1' });
    expect(nameVoicing([3, 3, 3, x, x, x], DROP_D, 5).symbol).toBe('F5');
  });

  it('describes dyads without a chord symbol', () => {
    expect(nameVoicing([0, x, 3, x, x, x], E_STANDARD, E)).toMatchObject({
      symbol: null,
      name: 'E + F (minor 2nd)',
      degrees: '1 b2'
    });
    expect(nameVoicing([0, 1, 2, x, x, x], E_STANDARD, E)).toMatchObject({
      symbol: null,
      name: 'E tritone dyad',
      degrees: '1 b5 1'
    });
    expect(nameVoicing([0, 0, x, x, x, x], E_STANDARD, E).name).toBe('E + A (perfect 4th)');
  });

  it('describes clusters by their degrees', () => {
    // E3 F4 F#4
    expect(nameVoicing([x, x, 2, x, 6, 2], E_STANDARD, E)).toMatchObject({
      symbol: null,
      name: 'E cluster (1 b2 2)',
      degrees: '1 b2 2'
    });
  });

  it('names the interval that sounds when a dyad is inverted', () => {
    // F2 E3: the root sits a major 7th above the bass, not a minor 2nd.
    expect(nameVoicing([1, x, 2, x, x, x], E_STANDARD, E)).toMatchObject({
      symbol: null,
      name: 'E over F (major 7th)',
      degrees: 'b2 1'
    });
    // A2 E3 and A2 E3 A3: a perfect 5th up from the bass.
    expect(nameVoicing([x, 0, 2, x, x, x], E_STANDARD, E).name).toBe('E over A (perfect 5th)');
    expect(nameVoicing([x, 0, 2, 2, x, x], E_STANDARD, E).name).toBe('E over A (perfect 5th)');
    // C#3 C4 for a b2 dyad on C
    expect(nameVoicing([9, x, 10, x, x, x], E_STANDARD, C).name).toBe('C over C# (major 7th)');
    // F#2 D#3 on D#
    expect(nameVoicing([2, 6, x, x, x, x], E_STANDARD, 3).name).toBe('D# over F# (major 6th)');
    // Drop D: D#2 B2 D#3 on B
    expect(nameVoicing([1, 2, 1, x, x, x], DROP_D, 11).name).toBe('B over D# (minor 6th)');
    // The tritone is its own inversion.
    expect(nameVoicing([x, 1, 2, x, x, x], E_STANDARD, E).name).toBe('E tritone dyad over A#');
  });

  it('names the sounding interval of every two-pitch-class dyad up from its bass', () => {
    const rng = createRng('dyad-intervals');
    let checked = 0;
    for (let n = 0; n < 3000; n++) {
      const tuning = rng.chance(0.5) ? E_STANDARD : DROP_D;
      const shape: Shape = tuning.openMidi.map(() => (rng.chance(0.6) ? null : rng.int(0, 12)));
      const root = rng.int(0, 11);
      const midi = shapeToMidi(shape, tuning);
      const pcs = [...new Set(midi.map(pitchClass))];
      if (pcs.length !== 2 || !pcs.includes(root)) continue;
      const bass = pitchClass(bassMidi(shape, tuning) as number);
      const upper = pcs.find((pc) => pc !== bass) as number;
      const sounding = pitchClass(upper - bass);
      if (sounding === 6) continue;
      const v = nameVoicing(shape, tuning, root);
      if (v.symbol !== null) continue;
      expect(v.name, `${JSON.stringify(shape)} on ${root}`).toContain(`(${intervalName(sounding)})`);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('names rootless voicings against the caller root only', () => {
    // E3 G3 A#4 over an intended C
    expect(nameVoicing([x, x, 2, 0, x, 6], E_STANDARD, C)).toMatchObject({
      symbol: 'C7(no root)/E',
      degrees: '3 5 b7'
    });
    // F4 B4 over an intended E: no symbol, plain description
    expect(nameVoicing([x, x, x, x, 6, 7], E_STANDARD, E)).toMatchObject({
      symbol: null,
      name: 'F + B (b2 5 of E, no root)'
    });
  });

  it('handles single notes, octaves and silence', () => {
    expect(nameVoicing([0, x, x, x, x, x], E_STANDARD, E).name).toBe('E single note');
    expect(nameVoicing([0, x, 2, x, x, x], E_STANDARD, E).name).toBe('E octaves');
    // E4 on two strings is a unison, not an octave.
    expect(nameVoicing([x, x, x, x, 5, 0], E_STANDARD, E).name).toBe('E single note');
    expect(nameVoicing([x, x, x, x, x, 3], E_STANDARD, E).name).toBe('G (b3 of E, no root)');
    expect(nameVoicing([x, x, x, x, x, x], E_STANDARD, E)).toEqual({
      symbol: null,
      name: 'No notes',
      degrees: '',
      degreesByString: [null, null, null, null, null, null]
    });
  });

  it('uses the family label only when the shape really matches the family', () => {
    const shape: Shape = [0, 0, 0, 0, x, x]; // E A D G
    expect(nameVoicing(shape, E_STANDARD, E).name).toBe('E voicing (1 b3 4 b7)');
    expect(nameVoicing(shape, E_STANDARD, E, fam('quartal'))).toMatchObject({
      symbol: null,
      name: 'E Quartal (1 b3 4 b7)'
    });
    expect(nameVoicing(shape, E_STANDARD, E, fam('power5')).name).toBe('E voicing (1 b3 4 b7)');
    const legacy = fromLegacyNotes(['E2', 'A2', 'D3', 'G3'], 'E');
    expect(nameVoicing(shape, E_STANDARD, E, legacy).name).toBe('E voicing (1 b3 4 b7)');
  });

  it('says Quartal only when the notes sound as stacked fourths', () => {
    // E2 A3 D4 G4: an 11th then two fourths still stacks fourths.
    expect(nameVoicing([0, 12, 12, 12, x, x], E_STANDARD, E, fam('quartal')).name).toBe('E Quartal (1 b3 4 b7)');
    // Drop D G#3 B3 C#4 F#4: the b3 sits right above the root, gaps m3 M2 P4.
    const notStacked: Shape = [x, 11, 11, 11, 0, x];
    expect(nameVoicing(notStacked, DROP_D, 8, fam('quartal'))).toMatchObject({
      symbol: null,
      name: 'G# voicing (1 b3 4 b7)',
      degrees: '1 b3 4 b7'
    });
  });

  it('says cluster only when a close second sounds', () => {
    // E3 F4 F#4: the F-F# semitone is packed.
    expect(nameVoicing([x, x, 2, x, 6, 2], E_STANDARD, E, fam('cluster_m2')).name).toBe('E m2 cluster (1 b2 2)');
    // E2 F#3 F4: gaps of 14 and 11 semitones, no second anywhere.
    const spread: Shape = [0, 9, x, 10, x, x];
    expect(nameVoicing(spread, E_STANDARD, E, fam('cluster_m2'))).toMatchObject({
      symbol: null,
      name: 'E voicing (1 b2 2)',
      degrees: '1 2 b2'
    });
    expect(nameVoicing(spread, E_STANDARD, E).name).toBe('E voicing (1 b2 2)');
    // D3 C4 C#5 on C: gaps 10 and 13.
    expect(nameVoicing([x, x, 0, x, 1, 9], E_STANDARD, C, fam('cluster_m2')).name).toBe('C voicing (1 b2 2) over D');
  });

  it('never lets a family override a confident symbol', () => {
    expect(nameVoicing([0, 2, 2, x, x, x], E_STANDARD, E, fam('drone_power5')).name).toBe('E5');
    // E E G# B is a plain E major triad even when the caller asked for Phrygian.
    expect(nameVoicing([0, 7, 6, 4, x, x], E_STANDARD, E, fam('phrygian')).symbol).toBe('E');
    expect(nameVoicing([0, 8, 6, 4, x, x], E_STANDARD, E, fam('phrygian')).symbol).toBe('E(addb9)');
  });

  it('stays honest on random shapes', () => {
    const rng = createRng('naming-honesty');
    const majorQuality = new Set(['', '7', 'maj7', '6', 'add9', '(addb9)', '7(b9)', '9', 'maj9']);
    for (let n = 0; n < 2000; n++) {
      const tuning = rng.chance(0.5) ? E_STANDARD : DROP_D;
      const shape: Shape = tuning.openMidi.map(() => (rng.chance(0.4) ? null : rng.int(0, 12)));
      const root = rng.int(0, 11);
      const v = nameVoicing(shape, tuning, root);
      const tokens = v.degrees === '' ? [] : v.degrees.split(' ');
      expect(tokens.length).toBe(shapeToMidi(shape, tuning).length);
      expect(v.degreesByString.filter((d) => d !== null).length).toBe(tokens.length);
      if (v.symbol === null) {
        expect(v.name).toMatch(/^(No notes$|[A-G]#? )/);
        expect(v.name).not.toMatch(/sus|dim|aug|add|\(no/);
        continue;
      }
      const rootName = pitchClassName(root);
      expect(v.name).toBe(v.symbol);
      expect(v.symbol.startsWith(rootName)).toBe(true);
      const bass = bassMidi(shape, tuning) as number;
      expect(v.symbol.includes('/')).toBe(pitchClass(bass) !== root);
      expect(v.symbol.includes('(no root)')).toBe(!tokens.includes('1'));
      if (v.symbol.includes('(no5)')) expect(tokens).not.toContain('5');
      if (v.symbol.includes('(no3)')) {
        expect(tokens).not.toContain('3');
        expect(tokens).not.toContain('b3');
      }
      const quality = v.symbol.slice(rootName.length).split('/')[0].replace(/\((no3|no5|no root)\)/g, '');
      if (/^m(?!aj)/.test(quality)) expect(tokens).toContain('b3');
      if (majorQuality.has(quality) && !v.symbol.includes('(no3)')) expect(tokens).toContain('3');
    }
  });
});
