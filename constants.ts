import { Chord } from './types';

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const CHORDS: Chord[] = [
  {
    id: 'opeth',
    name: 'The "Ghost" Chord',
    subtext: 'm(add9)',
    notes: ['E2', 'B2', 'F#3', 'G3', 'B3', 'E4'],
    description: 'The quintessential melancholy shape.',
    fretboard: '0 2 4 0 0 0',
    baseRoot: 'E'
  },
  {
    id: 'gojira',
    name: 'Whales Maj7',
    subtext: 'Maj7(no5)',
    notes: ['G2', 'F#3', 'D4', 'G4'], 
    description: 'Massive, open, and atmospheric.',
    fretboard: '3 x 4 7 8 x',
    baseRoot: 'G'
  },
  {
    id: 'thall',
    name: 'Void Dissonance',
    subtext: 'Tritone Cluster',
    notes: ['E1', 'A#1', 'E2', 'A#2'],
    description: 'Pure instability. The devil in music.',
    fretboard: '0 6 7 x x x',
    baseRoot: 'E'
  },
  {
    id: 'architects',
    name: 'Modern Metalcore',
    subtext: 'Sus2 Stack',
    notes: ['C#2', 'G#2', 'C#3', 'D#3', 'G#3'],
    description: 'Tight, percussive, and emotionally resonant.',
    fretboard: '0 0 2 3 x x',
    baseRoot: 'C#'
  },
  {
    id: 'meshuggah',
    name: 'Bleed Stack',
    subtext: 'Poly-Rhythm Fuel',
    notes: ['F1', 'F2', 'C2'], 
    description: 'Just the low end. Palm mute required.',
    fretboard: '1 1 3 x x x',
    baseRoot: 'F'
  },
  {
    id: 'shoegaze',
    name: 'Ethereal Wall',
    subtext: 'sus2/Maj7',
    notes: ['E2', 'B2', 'D#3', 'F#3', 'B3', 'E4'],
    description: 'Beautifully muddy with high gain.',
    fretboard: '0 2 1 3 0 0',
    baseRoot: 'E'
  }
];
