import { describe, it, expect } from 'vitest';
import { libraryLabels } from './musicTheory';

// Shapes, sounding notes and the card title come from the engine (utils/libraryVoicing.ts). The removed
// transposeTabs codified two bugs: Drop mode always added 2 frets to the lowest string (wrong bass: E instead of
// D), and per-string +12 wrapping turned open strings into hidden barres (Em(add9) to G became 3 5 7 3 3 3).

const card = (name: string, subtext: string, baseRoot: string) => ({ name, subtext, baseRoot });

describe('libraryLabels', () => {
  it('strips the "Drop " prefix and moves a nickname root to the selected root', () => {
    expect(libraryLabels(card('Drop Bb Maj7', 'Bb(VI)', 'A#'), 'G').nickname).toBe('G Maj7');
    expect(libraryLabels(card('Drop D Power', '5th', 'D'), 'E').nickname).toBe('E Power');
    expect(libraryLabels(card('Drop Gm Add9', 'Gm(iv)', 'G'), 'C#').nickname).toBe('C#m Add9');
    expect(libraryLabels(card('Em Maj7', 'Em(i)', 'E'), 'G').nickname).toBe('Gm Maj7');
  });

  it('leaves nicknames without a root alone', () => {
    expect(libraryLabels(card('Drop Ghost', 'Dm(add9)', 'D'), 'G').nickname).toBe('Ghost');
    expect(libraryLabels(card('Diminished Phrygian', 'Dim/b2', 'E'), 'C').nickname).toBe('Diminished Phrygian');
    expect(libraryLabels(card('The Omen', 'm2 Clash', 'E'), 'F').nickname).toBe('The Omen');
  });

  it('drops key-bound symbols and Roman numerals from the subtext', () => {
    expect(libraryLabels(card('Drop Bb Maj7', 'Bb(VI)', 'A#'), 'G').detail).toBe('');
    expect(libraryLabels(card('Am Add9', 'Am(iv)', 'A'), 'E').detail).toBe('');
    expect(libraryLabels(card('Drop Ghost', 'Dm(add9)', 'D'), 'E').detail).toBe('');
    expect(libraryLabels(card('C sus2', 'C(VI)sus2', 'C'), 'E').detail).toBe('');
  });

  it('keeps descriptive subtexts without gluing them to a root', () => {
    expect(libraryLabels(card('The Omen', 'm2 Clash', 'E'), 'F').detail).toBe('m2 Clash');
    expect(libraryLabels(card('Phrygian Root', 'b2', 'E'), 'E').detail).toBe('b2');
    expect(libraryLabels(card('Diminished Phrygian', 'Dim/b2', 'E'), 'E').detail).toBe('Dim/b2');
    expect(libraryLabels(card('E Power', '5th', 'E'), 'A').detail).toBe('5th');
  });

  it('drops a subtext the nickname already says', () => {
    expect(libraryLabels(card('E Sus2', 'Sus2', 'E'), 'G')).toEqual({ nickname: 'G Sus2', detail: '' });
  });
});
