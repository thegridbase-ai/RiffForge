import { describe, it, expect } from 'vitest';
import { parseRoot, mapToExplorerType, buildChordExplorerUrl } from './chordExplorer';

describe('parseRoot', () => {
  it('extracts natural and sharp roots from the name', () => {
    expect(parseRoot('Em', 'Em(add9)')).toBe('E');
    expect(parseRoot('C#m7', 'C#m7')).toBe('C#');
  });

  it('falls back to the subtext when the name has no root', () => {
    expect(parseRoot('???', 'F#5')).toBe('F#');
  });

  it('defaults to E when nothing parses', () => {
    expect(parseRoot('???', '???')).toBe('E');
  });
});

describe('mapToExplorerType', () => {
  it('maps minor with extensions: Em(add9) -> minor', () => {
    expect(mapToExplorerType('Em', 'Em(add9)')).toBe('minor');
  });

  it('maps power chords to major: E5 -> major', () => {
    expect(mapToExplorerType('E5', 'E5')).toBe('major');
  });

  it('maps maj7: Emaj7 -> maj7', () => {
    expect(mapToExplorerType('Emaj7', 'Emaj7')).toBe('maj7');
  });

  it('maps spelled-out qualities: "E Major 7" -> maj7, "E Minor 7" -> m7', () => {
    expect(mapToExplorerType('E Major 7', 'E(VI)')).toBe('maj7');
    expect(mapToExplorerType('E Minor 7', 'E(i7)')).toBe('m7');
  });

  it('maps dominant 7: E7 -> 7', () => {
    expect(mapToExplorerType('E7', 'E7')).toBe('7');
  });

  it('maps diminished: Edim -> dim', () => {
    expect(mapToExplorerType('Edim', 'Edim(vii)')).toBe('dim');
  });

  it('maps sus4: Esus4 -> sus4', () => {
    expect(mapToExplorerType('Esus4', 'Esus4')).toBe('sus4');
  });

  it('maps sus2: Dsus2 -> sus2', () => {
    expect(mapToExplorerType('Dsus2', 'Dsus2')).toBe('sus2');
  });

  it('maps minor 7: C#m7 -> m7', () => {
    expect(mapToExplorerType('C#m7', 'C#m7')).toBe('m7');
  });

  it('maps diminished 7 before dim: Bdim7 -> dim7', () => {
    expect(mapToExplorerType('Bdim7', 'Bdim7')).toBe('dim7');
  });

  it('maps augmented: Aaug -> aug', () => {
    expect(mapToExplorerType('Aaug', 'Aaug')).toBe('aug');
    expect(mapToExplorerType('A+', 'A+')).toBe('aug');
  });

  it('maps a bare root to major: G -> major', () => {
    expect(mapToExplorerType('G', 'G')).toBe('major');
  });

  it('falls back to minor when an m marker is present on unknown quality', () => {
    expect(mapToExplorerType('Fm', 'Fm(weird!)')).toBe('minor');
  });

  it('falls back to major for fully unknown qualities', () => {
    expect(mapToExplorerType('E?', 'E?')).toBe('major');
  });
});

describe('buildChordExplorerUrl', () => {
  it('builds the full URL for a natural root', () => {
    expect(buildChordExplorerUrl({ name: 'Em', subtext: 'Em(add9)' }))
      .toBe('https://chords.thegridbase.com/?root=E&type=minor');
  });

  it('URL-encodes sharp roots (C# -> C%23)', () => {
    expect(buildChordExplorerUrl({ name: 'C#m7', subtext: 'C#m7' }))
      .toBe('https://chords.thegridbase.com/?root=C%23&type=m7');
  });

  it('encodes sharps for major chords too (F#5)', () => {
    expect(buildChordExplorerUrl({ name: 'F#5', subtext: 'F#5' }))
      .toBe('https://chords.thegridbase.com/?root=F%23&type=major');
  });
});
