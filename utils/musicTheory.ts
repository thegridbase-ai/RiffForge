import { NOTES } from '../constants';
import { Chord, TuningMode } from '../types';

const getSemitoneDistance = (fromNote: string, toNote: string): number => {
  const fromIndex = NOTES.indexOf(fromNote);
  const toIndex = NOTES.indexOf(toNote);
  if (fromIndex === -1 || toIndex === -1) return 0;
  return toIndex - fromIndex;
};

export const transposeNote = (note: string, semitones: number): string => {
  const match = note.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return note;

  const [, name, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);

  let currentIndex = NOTES.indexOf(name);
  if (currentIndex === -1) return note;

  let newIndex = currentIndex + semitones;
  let octaveShift = Math.floor(newIndex / 12);

  newIndex = ((newIndex % 12) + 12) % 12;

  const newName = NOTES[newIndex];
  const newOctave = octave + octaveShift;

  return `${newName}${newOctave}`;
};

export const transposeTabs = (originalTabs: string | undefined, semitones: number, tuningMode: TuningMode): string => {
  if (!originalTabs) return '';
  if (originalTabs === 'TRANSPOSED') return originalTabs;

  const strings = originalTabs.split(' ');

  interface FretInfo {
    fret: number;
    isOpen: boolean;
    isMuted: boolean;
  }

  const transposedStrings: (FretInfo | string)[] = strings.map((val, index) => {
    if (val.toLowerCase() === 'x') return 'x';

    const fret = parseInt(val, 10);
    if (isNaN(fret)) return val;

    let newFret = fret + semitones;

    if (tuningMode === TuningMode.DROP && index === 0) {
      newFret += 2;
    }

    while (newFret < 0) {
      newFret += 12;
    }

    return { fret: newFret, isOpen: fret === 0, isMuted: false };
  });

  const allFrets = transposedStrings
    .filter((s): s is FretInfo => typeof s === 'object' && !s.isMuted)
    .map(s => s.fret);

  if (allFrets.length > 0) {
    transposedStrings.forEach((item) => {
      if (typeof item === 'object' && !item.isMuted && item.fret < 0) {
        item.fret += 12;
      }
    });
  }

  return transposedStrings.map(item => {
    if (typeof item === 'object') {
      return item.fret.toString();
    }
    return item;
  }).join(' ');
};

export const transposeChord = (chord: Chord, targetRoot: string, tuningMode: TuningMode): Chord => {
  const distance = getSemitoneDistance(chord.baseRoot, targetRoot);

  const newNotes = distance === 0
    ? chord.notes
    : chord.notes.map(note => transposeNote(note, distance));

  const isGenericSubtext = !chord.subtext.match(/^[A-G]/);
  const newSubtext = isGenericSubtext
    ? `${targetRoot}${chord.subtext}`
    : chord.subtext.replace(/^[A-G]#?/, targetRoot);

  let newName = chord.name;
  if (distance !== 0) {
    const noteMatch = chord.name.match(/^([A-G]#?)(\s|$|m|M|Major|Minor|Maj|Min|7|9|add|sus|dim|aug|maj|min)/i);
    if (noteMatch) {
      const originalNote = noteMatch[1];
      const originalIndex = NOTES.indexOf(originalNote);
      if (originalIndex !== -1) {
        const newIndex = ((originalIndex + distance % 12) + 12) % 12;
        const newNote = NOTES[newIndex];
        newName = chord.name.replace(/^[A-G]#?/i, newNote);
      }
    }
  }

  const newTabs = transposeTabs(chord.fretboard, distance, tuningMode);

  return {
    ...chord,
    name: newName,
    subtext: newSubtext,
    notes: newNotes,
    fretboard: newTabs
  };
};
