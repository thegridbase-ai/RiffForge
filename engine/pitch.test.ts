import { describe, it, expect } from 'vitest';
import {
  pitchClass,
  midiToName,
  nameToMidi,
  parseNoteName,
  parsePitchClass,
  pitchClassName,
  intervalFrom,
  degreeLabel,
  intervalName,
  DEGREE_LABELS
} from './pitch';

describe('pitchClass', () => {
  it('wraps into 0..11 including negatives', () => {
    expect(pitchClass(40)).toBe(4);
    expect(pitchClass(60)).toBe(0);
    expect(pitchClass(-1)).toBe(11);
    expect(pitchClass(-12)).toBe(0);
  });
});

describe('midiToName / nameToMidi', () => {
  it('uses C4 = 60 and sharp spelling', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(40)).toBe('E2');
    expect(midiToName(38)).toBe('D2');
    expect(midiToName(46)).toBe('A#2');
    expect(midiToName(23)).toBe('B0');
  });

  it('parses sharps and flats', () => {
    expect(nameToMidi('E2')).toBe(40);
    expect(nameToMidi('Bb2')).toBe(46);
    expect(nameToMidi('A#2')).toBe(46);
    expect(nameToMidi('Db3')).toBe(49);
    expect(nameToMidi('Cb4')).toBe(59);
    expect(nameToMidi('B#3')).toBe(60);
    expect(nameToMidi('E1')).toBe(28);
  });

  it('round-trips every MIDI note', () => {
    for (let m = 0; m <= 127; m++) {
      expect(nameToMidi(midiToName(m))).toBe(m);
    }
  });

  it('returns null from parseNoteName and throws from nameToMidi on bad input', () => {
    expect(parseNoteName('x')).toBeNull();
    expect(parseNoteName('H2')).toBeNull();
    expect(parseNoteName('E')).toBeNull();
    expect(() => nameToMidi('nope')).toThrow();
  });
});

describe('pitch class names', () => {
  it('parses names with flats and normalizes case of the letter', () => {
    expect(parsePitchClass('C')).toBe(0);
    expect(parsePitchClass('Db')).toBe(1);
    expect(parsePitchClass('C#')).toBe(1);
    expect(parsePitchClass('e')).toBe(4);
    expect(parsePitchClass('Bb')).toBe(10);
    expect(parsePitchClass('X')).toBeNull();
  });

  it('spells pitch classes with sharps', () => {
    expect(pitchClassName(1)).toBe('C#');
    expect(pitchClassName(10)).toBe('A#');
    expect(pitchClassName(13)).toBe('C#');
  });
});

describe('intervals and degrees', () => {
  it('measures the interval above a root as a pitch class', () => {
    expect(intervalFrom(4, 5)).toBe(1);
    expect(intervalFrom(4, 4 + 7)).toBe(7);
    expect(intervalFrom(9, 4)).toBe(7);
  });

  it('labels degrees with the documented table', () => {
    expect(DEGREE_LABELS).toEqual(['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', '#5', '6', 'b7', '7']);
    expect(degreeLabel(0)).toBe('1');
    expect(degreeLabel(1)).toBe('b2');
    expect(degreeLabel(8)).toBe('#5');
    expect(degreeLabel(10)).toBe('b7');
    expect(degreeLabel(19)).toBe('5');
  });

  it('names intervals', () => {
    expect(intervalName(0)).toBe('unison');
    expect(intervalName(1)).toBe('minor 2nd');
    expect(intervalName(6)).toBe('tritone');
    expect(intervalName(7)).toBe('perfect 5th');
  });
});
