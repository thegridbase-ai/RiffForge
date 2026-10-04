// Pitch classes, MIDI <-> note names, interval and degree labels.
// Spelling is always sharps on output; flats are accepted on input.

export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const DEGREE_LABELS = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', '#5', '6', 'b7', '7'] as const;

export const INTERVAL_NAMES = [
  'unison',
  'minor 2nd',
  'major 2nd',
  'minor 3rd',
  'major 3rd',
  'perfect 4th',
  'tritone',
  'perfect 5th',
  'minor 6th',
  'major 6th',
  'minor 7th',
  'major 7th'
] as const;

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;

export const pitchClassName = (pc: number): string => PITCH_CLASS_NAMES[pitchClass(pc)];

/** Semitone offset of an accidental string: '#', '##', 'b', 'bb', ''. */
const accidentalOffset = (acc: string): number => {
  let offset = 0;
  for (const ch of acc) offset += ch === '#' ? 1 : -1;
  return offset;
};

/** "C#", "Db", "e" -> pitch class; null when unparseable. */
export const parsePitchClass = (name: string): number | null => {
  const match = name.trim().match(/^([A-Ga-g])(#{1,2}|b{1,2})?$/);
  if (!match) return null;
  return pitchClass(LETTER_PC[match[1].toUpperCase()] + accidentalOffset(match[2] ?? ''));
};

/** "E2", "Bb2", "C#4" -> MIDI (C4 = 60); null when unparseable. Octave follows the letter (Cb4 = B3). */
export const parseNoteName = (name: string): number | null => {
  const match = name.trim().match(/^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d+)$/);
  if (!match) return null;
  const octave = parseInt(match[3], 10);
  return (octave + 1) * 12 + LETTER_PC[match[1].toUpperCase()] + accidentalOffset(match[2] ?? '');
};

export const nameToMidi = (name: string): number => {
  const midi = parseNoteName(name);
  if (midi === null) throw new Error(`Invalid note name: ${name}`);
  return midi;
};

export const midiToName = (midi: number): string =>
  `${PITCH_CLASS_NAMES[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`;

/** Interval of `pc` above `rootPc`, as a pitch class 0..11. */
export const intervalFrom = (rootPc: number, pc: number): number => pitchClass(pc - rootPc);

export const degreeLabel = (interval: number): string => DEGREE_LABELS[pitchClass(interval)];

export const intervalName = (interval: number): string => INTERVAL_NAMES[pitchClass(interval)];

/** Accepts a pitch class number or a note name; throws on invalid names. */
export const toPitchClass = (root: number | string): number => {
  if (typeof root === 'number') return pitchClass(root);
  const pc = parsePitchClass(root);
  if (pc === null) throw new Error(`Invalid root: ${root}`);
  return pc;
};
