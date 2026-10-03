import { describe, it, expect } from 'vitest';
import {
  shapeToMidi,
  shapeToMidiByString,
  bassMidi,
  shapePitchClasses,
  soundingStrings,
  frettedStrings,
  openStrings,
  interiorMutes,
  lowestFret,
  highestFret,
  isValidShape,
  toRiffForgeTab,
  fromRiffForgeTab,
  toChordExplorerFrets,
  fromChordExplorerFrets
} from './shape';
import { E_STANDARD, DROP_D } from './tuning';
import { midiToName } from './pitch';

describe('shapeToMidi', () => {
  it('derives pitches as openMidi + fret', () => {
    expect(shapeToMidi([0, 2, 2, 1, 0, 0], E_STANDARD).map(midiToName)).toEqual(['E2', 'B2', 'E3', 'G#3', 'B3', 'E4']);
  });

  it('sounds D2 A2 D3 for 0 0 0 x x x in Drop D', () => {
    expect(shapeToMidi([0, 0, 0, null, null, null], DROP_D).map(midiToName)).toEqual(['D2', 'A2', 'D3']);
  });

  it('keeps muted strings as null per string', () => {
    expect(shapeToMidiByString([null, 3, 2, 0, 1, 0], E_STANDARD)).toEqual([null, 48, 52, 55, 60, 64]);
  });

  it('throws when the shape does not fit the tuning', () => {
    expect(() => shapeToMidi([0, 2, 2], E_STANDARD)).toThrow();
    expect(() => shapeToMidi([0, -1, 2, 2, 0, 0], E_STANDARD)).toThrow();
  });

  it('finds the bass by pitch, not by string', () => {
    // String 0 at fret 7 (B2) sounds above open string 1 (A2)
    expect(bassMidi([7, 0, null, null, null, null], E_STANDARD)).toBe(45);
    expect(bassMidi([null, null, null, null, null, null], E_STANDARD)).toBeNull();
  });

  it('collects sorted unique pitch classes', () => {
    expect(shapePitchClasses([0, 2, 2, null, null, null], E_STANDARD)).toEqual([4, 11]);
  });
});

describe('shape helpers', () => {
  const shape = [0, null, 2, 4, null, 0];

  it('lists sounding, fretted and open strings', () => {
    expect(soundingStrings(shape)).toEqual([0, 2, 3, 5]);
    expect(frettedStrings(shape)).toEqual([2, 3]);
    expect(openStrings(shape)).toEqual([0, 5]);
  });

  it('counts interior mutes only between sounding strings', () => {
    expect(interiorMutes(shape)).toBe(2);
    expect(interiorMutes([null, null, 2, 2, null, null])).toBe(0);
    expect(interiorMutes([0, null, null, null, null, null])).toBe(0);
  });

  it('finds the fretted range ignoring opens', () => {
    expect(lowestFret(shape)).toBe(2);
    expect(highestFret(shape)).toBe(4);
    expect(lowestFret([0, 0, 0, null, null, null])).toBeNull();
  });

  it('validates shapes', () => {
    expect(isValidShape([0, 2, 2, 1, 0, 0], 6)).toBe(true);
    expect(isValidShape([0, 2, 2, 1, 0], 6)).toBe(false);
    expect(isValidShape([0, 2.5, 2, 1, 0, 0], 6)).toBe(false);
  });
});

describe('adapters', () => {
  it('round-trips RiffForge tabs low -> high', () => {
    expect(toRiffForgeTab([0, 2, 2, null, null, null])).toBe('0 2 2 x x x');
    expect(fromRiffForgeTab('0 2 2 x x x')).toEqual([0, 2, 2, null, null, null]);
    expect(fromRiffForgeTab(' 10 12 X x x x ')).toEqual([10, 12, null, null, null, null]);
    expect(fromRiffForgeTab('0 2 a')).toBeNull();
    expect(fromRiffForgeTab('')).toBeNull();
  });

  it('round-trips Chord Explorer frets high -> low with -1 muted', () => {
    // C major open: x 3 2 0 1 0 low -> high
    const cOpen = [null, 3, 2, 0, 1, 0];
    expect(toChordExplorerFrets(cOpen)).toEqual([0, 1, 0, 2, 3, -1]);
    expect(fromChordExplorerFrets([0, 1, 0, 2, 3, -1])).toEqual(cOpen);
  });
});
