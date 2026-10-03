import { NOTES } from '../constants';
import { Chord } from '../types';

const ROOTED_SUBTEXT = /^[A-G][#b]?(?=$|[\s(/\d]|m|maj|min|dim|aug|sus|add|M)/;
const QUALITY_START = /^(m(?!\d)|maj|min|dim|aug|sus|Sus|add|M|\(|7|9|11|13|5(?!th))/;

const getSemitoneDistance = (fromNote: string, toNote: string): number => {
  const fromIndex = NOTES.indexOf(fromNote);
  const toIndex = NOTES.indexOf(toNote);
  if (fromIndex === -1 || toIndex === -1) return 0;
  return toIndex - fromIndex;
};

/**
 * Moves a curated card's name and subtext to the selected root. Shapes and sounding notes are no
 * longer transposed here: they come from the engine (utils/libraryVoicing.ts).
 */
export const transposeChordLabels = (chord: Chord, targetRoot: string): { name: string; subtext: string } => {
  const distance = getSemitoneDistance(chord.baseRoot, targetRoot);

  // A subtext is rooted when a note name is followed by a chord quality ("Em(add9)", "Bb(VI)"), not a
  // word that merely starts with A-G ("Dim/b2").
  const isRooted = ROOTED_SUBTEXT.test(chord.subtext);
  // Glue only real chord qualities to the root; "b2" glued to E would read as E-flat
  const separator = QUALITY_START.test(chord.subtext) ? '' : ' ';
  const subtext = isRooted
    ? chord.subtext.replace(/^[A-G][#b]?/, targetRoot)
    : `${targetRoot}${separator}${chord.subtext}`;

  let name = chord.name;
  if (distance !== 0) {
    const noteMatch = chord.name.match(/^([A-G]#?)(\s|$|m|M|Major|Minor|Maj|Min|7|9|add|sus|dim|aug|maj|min)/i);
    if (noteMatch) {
      const originalIndex = NOTES.indexOf(noteMatch[1]);
      if (originalIndex !== -1) {
        const newIndex = ((originalIndex + (distance % 12)) + 12) % 12;
        name = chord.name.replace(/^[A-G]#?/i, NOTES[newIndex]);
      }
    }
  }

  return { name, subtext };
};
