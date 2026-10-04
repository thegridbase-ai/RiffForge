// Style presets: user-facing defaults (RhythmParams) plus the internal cell recipe each style generates from.
// All figures are generic metal rhythm vocabulary, written from scratch; nothing is transcribed.
// Every rate below is a hand-tuned heuristic, not a research-backed value.
import type { RhythmParams, RhythmStyleId } from '../types';

export type CellKind =
  | 'chug16'
  | 'chug8'
  | 'gallop'
  | 'reverseGallop'
  | 'stab'
  | 'rest'
  | 'tripletChug'
  | 'tremolo'
  | 'halftime';

export interface StyleRecipe {
  /** Base weights of the cells this style draws from (modulated by density and syncopation). */
  cells: Partial<Record<CellKind, number>>;
  /** Chance a non-cycle-start group head is accented. */
  accentRate: number;
  /** Times params.syncopation: chance a group starts with a rest so its head lands off the beat. */
  offbeatRate: number;
  /** Times params.syncopation: chance an accented head is anticipated and tied over the group start. */
  pushRate: number;
  /** Chance an accented (non-cycle-start) head moves the harmony to the next slot. */
  harmonyMoveRate: number;
  /** Chance the harmony advances at each new accent cycle. */
  cycleMoveRate: number;
  /** Chance a repeated group is redrawn instead of copying the first cycle. */
  variation: number;
  /** Chance the last full group of the last cycle is redrawn (turnaround). */
  turnaround: number;
  /** Chance a non-head hit becomes a dead (muted scratch) note. */
  deadRate: number;
  /** Chance a stab is choked after at most two units instead of ringing through its group. */
  stabChoke: number;
  /** Chance a ringing stab sustains into a silent next group through a tie. */
  tieOverRate: number;
  /** Target kind of accented heads and non-pedal fills. */
  headTarget: 'slot' | 'dyad';
  /** Groups on beats 1 and 3 always get a sustained, accented halftime chord. */
  halftimeStrong: boolean;
  /** The figure every pattern of the style must contain at least once. */
  signature: CellKind | null;
  tags: readonly string[];
}

export interface RhythmStyleInfo {
  label: string;
  description: string;
  params: RhythmParams;
}

export const RHYTHM_STYLE_IDS: readonly RhythmStyleId[] = [
  'chugEngine',
  'gallop',
  'reverseGallop',
  'displacedThrees',
  'halftimeStomp',
  'tremoloWall',
  'syncopatedStabs',
  'sevenEight',
  'fiveOverFour'
];

const params = (style: RhythmStyleId, overrides: Partial<RhythmParams>): RhythmParams => ({
  style,
  meter: { numerator: 4, denominator: 4 },
  bars: 2,
  grid: '16th',
  grouping: 'even',
  density: 0.7,
  syncopation: 0.2,
  pedalRatio: 0.75,
  palmMuteRatio: 0.75,
  slotCount: 2,
  picking: 'alternate',
  anticipation: false,
  ...overrides
});

const freezeInfo = (info: RhythmStyleInfo): RhythmStyleInfo => {
  Object.freeze(info.params.meter);
  if (typeof info.params.grouping !== 'string') Object.freeze(info.params.grouping);
  Object.freeze(info.params);
  return Object.freeze(info);
};

export const RHYTHM_STYLES: Readonly<Record<RhythmStyleId, RhythmStyleInfo>> = Object.freeze({
  chugEngine: freezeInfo({
    label: 'Chug Engine',
    description: 'Dense palm-muted 16th chugs on the pedal; accented open chord stabs move the harmony.',
    params: params('chugEngine', { density: 0.8, syncopation: 0.25, pedalRatio: 0.8, palmMuteRatio: 0.85 })
  }),
  gallop: freezeInfo({
    label: 'Gallop',
    description: 'An 8th and two 16ths on a muted pedal, chords on the accents. Picked down, down-up.',
    params: params('gallop', { density: 0.7, syncopation: 0.15, pedalRatio: 0.8, palmMuteRatio: 0.8 })
  }),
  reverseGallop: freezeInfo({
    label: 'Reverse Gallop',
    description: 'Two 16ths and an 8th: the gallop turned around so each figure lands on the longer note.',
    params: params('reverseGallop', { density: 0.7, syncopation: 0.15, pedalRatio: 0.8, palmMuteRatio: 0.8 })
  }),
  displacedThrees: freezeInfo({
    label: 'Displaced Threes',
    description: 'Accents grouped 3-3-3-3-4 sixteenths: they slide against the beat and realign every bar.',
    params: params('displacedThrees', {
      grouping: '3-3-3-3-4',
      density: 0.75,
      syncopation: 0,
      pedalRatio: 0.85,
      palmMuteRatio: 0.85
    })
  }),
  halftimeStomp: freezeInfo({
    label: 'Halftime Stomp',
    description: 'Half-speed feel: big ringing chords on beats 1 and 3, sparse pedal pickups between. All downstrokes.',
    params: params('halftimeStomp', {
      density: 0.35,
      syncopation: 0.15,
      pedalRatio: 0.75,
      palmMuteRatio: 0.6,
      picking: 'downstrokes'
    })
  }),
  tremoloWall: freezeInfo({
    label: 'Tremolo Wall',
    description: 'Continuous tremolo-picked dyads in 32nds; the harmony shifts on the accents.',
    params: params('tremoloWall', { density: 0.9, syncopation: 0.1, pedalRatio: 0.1, palmMuteRatio: 0.15 })
  }),
  syncopatedStabs: freezeInfo({
    label: 'Syncopated Stabs',
    description: 'Short chord stabs on a 3-3-2 pulse, with rests and pushes tied over the beat.',
    params: params('syncopatedStabs', {
      grouping: '3-3-2',
      density: 0.45,
      syncopation: 0.75,
      pedalRatio: 0.6,
      palmMuteRatio: 0.6
    })
  }),
  sevenEight: freezeInfo({
    label: 'Seven Eight',
    description: '7/8 felt as 2+2+3 eighths: two short beats and a long one, accented every group.',
    params: params('sevenEight', {
      meter: { numerator: 7, denominator: 8 },
      density: 0.7,
      syncopation: 0.2,
      pedalRatio: 0.75,
      palmMuteRatio: 0.8
    })
  }),
  fiveOverFour: freezeInfo({
    label: 'Five Over Four',
    description: 'A 5-sixteenth figure looping over 4/4: its accent drifts across the barline and realigns after 5 bars.',
    params: params('fiveOverFour', {
      grouping: [3, 2],
      cycleSixteenths: 5,
      density: 0.7,
      syncopation: 0.1,
      pedalRatio: 0.85,
      palmMuteRatio: 0.85
    })
  })
});

const recipe = (overrides: Partial<StyleRecipe> & Pick<StyleRecipe, 'cells' | 'tags'>): StyleRecipe => ({
  accentRate: 0.4,
  offbeatRate: 0.2,
  pushRate: 0.3,
  harmonyMoveRate: 0.5,
  cycleMoveRate: 0.6,
  variation: 0.12,
  turnaround: 0.6,
  deadRate: 0,
  stabChoke: 0.4,
  tieOverRate: 0.3,
  headTarget: 'slot',
  halftimeStrong: false,
  signature: null,
  ...overrides
});

export const STYLE_RECIPES: Readonly<Record<RhythmStyleId, StyleRecipe>> = {
  chugEngine: recipe({
    cells: { chug16: 1, gallop: 0.3, chug8: 0.35, stab: 0.25, rest: 0.1 },
    accentRate: 0.45,
    offbeatRate: 0.3,
    pushRate: 0.35,
    variation: 0.15,
    deadRate: 0.04,
    signature: 'chug16',
    tags: ['chug', 'palm-mute']
  }),
  gallop: recipe({
    cells: { gallop: 1, chug8: 0.25, chug16: 0.2, stab: 0.2, rest: 0.05 },
    stabChoke: 0.3,
    signature: 'gallop',
    tags: ['gallop']
  }),
  reverseGallop: recipe({
    cells: { reverseGallop: 1, chug8: 0.25, chug16: 0.2, stab: 0.2, rest: 0.05 },
    stabChoke: 0.3,
    signature: 'reverseGallop',
    tags: ['gallop', 'reverse-gallop']
  }),
  // No rests, offbeats or pushes: the 3-3-3-3-4 accent grid itself is the point.
  displacedThrees: recipe({
    cells: { chug16: 1, gallop: 0.3, chug8: 0.2, stab: 0.2 },
    accentRate: 1,
    offbeatRate: 0,
    pushRate: 0,
    variation: 0.12,
    turnaround: 0.5,
    stabChoke: 0.5,
    tieOverRate: 0,
    tags: ['displaced', 'syncopated']
  }),
  halftimeStomp: recipe({
    cells: { halftime: 1, chug8: 0.2, rest: 0.15 },
    accentRate: 0.25,
    offbeatRate: 0.3,
    pushRate: 0,
    harmonyMoveRate: 0.4,
    variation: 0.2,
    deadRate: 0.05,
    stabChoke: 0,
    tieOverRate: 0.6,
    halftimeStrong: true,
    tags: ['halftime', 'breakdown']
  }),
  tremoloWall: recipe({
    cells: { tremolo: 1, stab: 0.12, chug16: 0.1 },
    accentRate: 0.3,
    pushRate: 0.25,
    harmonyMoveRate: 0.6,
    cycleMoveRate: 0.7,
    variation: 0.1,
    turnaround: 0.5,
    stabChoke: 0,
    tieOverRate: 0.2,
    headTarget: 'dyad',
    signature: 'tremolo',
    tags: ['tremolo']
  }),
  syncopatedStabs: recipe({
    cells: { stab: 1, chug8: 0.35, chug16: 0.3, gallop: 0.15, rest: 0.45 },
    accentRate: 0.85,
    offbeatRate: 0.5,
    pushRate: 0.45,
    variation: 0.15,
    deadRate: 0.12,
    stabChoke: 0.75,
    signature: 'stab',
    tags: ['syncopated']
  }),
  // Every 2+2+3 group accented and no pushes, so the meter stays audible.
  sevenEight: recipe({
    cells: { chug16: 0.8, gallop: 0.6, reverseGallop: 0.25, chug8: 0.4, stab: 0.25, rest: 0.05 },
    accentRate: 0.9,
    offbeatRate: 0.15,
    pushRate: 0,
    tieOverRate: 0.2,
    tags: ['odd-meter']
  }),
  // The 5-unit figure must repeat almost unchanged for the polymeter to be heard.
  fiveOverFour: recipe({
    cells: { chug16: 0.6, chug8: 0.6, gallop: 0.4, stab: 0.3, rest: 0.25 },
    accentRate: 0.15,
    offbeatRate: 0,
    pushRate: 0,
    harmonyMoveRate: 0.4,
    cycleMoveRate: 0.35,
    variation: 0.05,
    turnaround: 0.2,
    stabChoke: 0.5,
    tieOverRate: 0,
    tags: ['polymeter']
  })
};

export const defaultRhythmParams = (style: RhythmStyleId): RhythmParams => {
  const base = (RHYTHM_STYLES[style] ?? RHYTHM_STYLES.chugEngine).params;
  return {
    ...base,
    meter: { ...base.meter },
    grouping: typeof base.grouping === 'string' ? base.grouping : [...base.grouping]
  };
};
