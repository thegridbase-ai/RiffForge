import { Chord } from '../types';
import { parsePitchClass, pitchClass, pitchClassName } from '../engine/pitch';

// A root at the start of a nickname: note letter, optional accidental, then a space, a digit or a chord quality
// ("Em Maj7", "Bb Maj7", "D Power"). Words that merely start with A-G ("Diminished", "Exotic") are not roots.
const NICKNAME_ROOT = /^([A-G](?:#|b(?![a-z]))?)(?=$|[\s(\d]|m|M|maj|min|dim|aug|sus|add)/;

// A subtext is a chord symbol tied to the curated key ("Em(add9)", "Bb(VI)", "F#dim(vii)") when a note name is
// followed by a chord quality, not a word that merely starts with A-G ("Dim/b2").
const ROOTED_SUBTEXT = /^[A-G][#b]?(?=$|[\s(/\d]|m|maj|min|dim|aug|sus|add|M)/;

export interface LibraryLabels {
  /** Curated nickname without the "Drop " prefix, its root (if any) moved to the selected root. */
  nickname: string;
  /** Curated descriptive subtext ("m2 Clash", "5th"); empty when it was a key-bound chord symbol. */
  detail: string;
}

/**
 * Labels for a curated card on the selected root. The title of a resolved card is the engine's name for what
 * sounds; these are the secondary labels. Key-bound symbols such as "Bb(VI)" are dropped because the card's root
 * follows the selected root, so a Roman numeral or a stored symbol would describe a different chord.
 */
export const libraryLabels = (chord: Pick<Chord, 'name' | 'subtext' | 'baseRoot'>, targetRoot: string): LibraryLabels => {
  const base = parsePitchClass(chord.baseRoot);
  const target = parsePitchClass(targetRoot);
  const shift = base === null || target === null ? 0 : target - base;

  let nickname = chord.name.trim().replace(/^drop\s+/i, '');
  const match = nickname.match(NICKNAME_ROOT);
  if (match) {
    const pc = parsePitchClass(match[1]);
    if (pc !== null) nickname = `${pitchClassName(pitchClass(pc + shift))}${nickname.slice(match[1].length)}`;
  }

  const subtext = chord.subtext.trim();
  const keyBound = ROOTED_SUBTEXT.test(subtext);
  const redundant = subtext !== '' && nickname.toLowerCase().includes(subtext.toLowerCase());
  return { nickname, detail: keyBound || redundant ? '' : subtext };
};
