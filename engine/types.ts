// Shared types for the playability engine. Pure data, no runtime code.
// Canonical string order everywhere in the engine: index 0 = lowest-pitched string.

/** Fret per string, low -> high. `null` = muted, `0` = open. */
export type Shape = readonly (number | null)[];

export interface Tuning {
  readonly id: string;
  readonly name: string;
  /** Open-string MIDI notes, index 0 = lowest-pitched string. */
  readonly openMidi: readonly number[];
}

/** 0 = thumb (only when the profile allows it, lowest string only), 1 = index ... 4 = pinky. */
export type FingerNumber = 0 | 1 | 2 | 3 | 4;

/** One finger pressing two or more strings at the same fret. String range is inclusive, low -> high. */
export interface Barre {
  finger: FingerNumber;
  fret: number;
  fromString: number;
  toString: number;
}

// ---------------------------------------------------------------------------
// Hand profile
// ---------------------------------------------------------------------------

/** Adjacent finger-pair limits as fractions of the allowed total reach. Heuristic, not research-backed. */
export interface PairLimits {
  indexMiddle: number;
  middleRing: number;
  ringPinky: number;
}

export interface HandProfile {
  version: 1;
  scaleLengthMm: number;
  /** Comfortable index -> pinky fingertip distance with the index at `lowRefFret`. */
  reachAtLowMm: number;
  /** Comfortable index -> pinky fingertip distance with the index at `highRefFret`. */
  reachAtHighMm: number;
  lowRefFret: number;
  highRefFret: number;
  pairLimits: PairLimits;
  /** Multiplier on the allowed reach. 1.0 default, 1.1 when "allow stretches" is on. */
  stretchTolerance: number;
  noBarre: boolean;
  allowTwoStringPartialBarre: boolean;
  allowThumb: boolean;
  maxFret: number;
  allowOpenStrings: boolean;
  maxInteriorMutes: number;
  comfortableSixteenthBpm: number;
}

/** Answers from the in-app calibration flow. */
export interface CalibrationAnswers {
  scaleLengthMm: number;
  /** Index on fret 1: highest fret the pinky reaches comfortably on the same string (3..7). */
  lowPinkyFret: number;
  /** Index on fret 7: highest fret the pinky reaches comfortably on the same string (9..13). */
  highPinkyFret: number;
  allowStretches: boolean;
  noBarre: boolean;
  allowOpenStrings: boolean;
  maxFret: number;
  comfortableSixteenthBpm: number;
}

// ---------------------------------------------------------------------------
// Fingering and cost
// ---------------------------------------------------------------------------

export type CostBucket = 'physical' | 'rightHand' | 'musical';

export type CostTermKey =
  // physical
  | 'reach'
  | 'pairStretch'
  | 'fingerCount'
  | 'pinky'
  | 'contortion'
  | 'interiorMutes'
  | 'position'
  | 'thumb'
  | 'barre'
  // right hand
  | 'stringSkips'
  | 'chugStrings'
  // musical
  | 'lowMud'
  | 'doubledThird'
  | 'rootNotInBass';

export interface CostTerm {
  key: CostTermKey;
  bucket: CostBucket;
  /** Measured quantity in natural units (ratio, count, fret, ...). */
  raw: number;
  /** raw mapped to 0..1. */
  normalized: number;
  weight: number;
  /** normalized * weight */
  cost: number;
}

export interface CostBreakdown {
  total: number;
  physical: number;
  rightHand: number;
  musical: number;
  terms: CostTerm[];
}

export interface PairStretch {
  from: FingerNumber;
  to: FingerNumber;
  distanceMm: number;
  limitMm: number;
  /** distanceMm / limitMm; must stay <= 1 (hard constraint). */
  ratio: number;
  /** Relaxed spacing: one fret per finger-number step, measured from `from`'s fret. */
  naturalMm: number;
  /** 0..1 stretch beyond the relaxed spacing toward the limit (cost input). Cramped pairs are 0. */
  stretch: number;
}

export interface FingeringMetrics {
  /** Number of fretted (non-open, non-muted) strings. */
  frettedCount: number;
  /** Distinct fingers used, thumb included. */
  fingerCount: number;
  /** Fingertip distance from the lowest-fret to the highest-fret finger (thumb excluded). */
  spanMm: number;
  /** maxReachMm(lowestFret) * stretchTolerance */
  allowedSpanMm: number;
  /** spanMm / allowedSpanMm; 0 when fewer than two distinct fretted frets. */
  reachRatio: number;
  /** Consecutive used fingers (by finger number, thumb excluded) with their distance and limit. */
  pairs: PairStretch[];
  /** Worst pair ratio, 0 when fewer than two fingers. */
  maxPairRatio: number;
  /** Worst pair stretch beyond relaxed spacing, 0..1. */
  maxPairStretch: number;
  usesPinky: boolean;
  usesThumb: boolean;
  /** Same-fret pairs where the lower-numbered finger sits on the higher-pitched string. */
  contortions: number;
  /** Muted strings strictly between the lowest and highest sounding strings. */
  interiorMutes: number;
  lowestFret: number | null;
  highestFret: number | null;
}

export interface Fingering {
  /** Finger per string, low -> high. `null` for open or muted strings. */
  fingers: (FingerNumber | null)[];
  barres: Barre[];
  metrics: FingeringMetrics;
  /** Physical bucket only; playability adds right-hand and musical terms. */
  costBreakdown: CostBreakdown;
}

export type FingeringRejectReason =
  /** More fretted notes than available fingers without a barre, or no legal barre in barre mode. */
  | 'NEEDS_BARRE'
  /** Total span exceeds maxReachMm(lowestFret) * stretchTolerance. */
  | 'REACH'
  /** Every finger assignment breaks an adjacent-pair limit. */
  | 'PAIR_STRETCH'
  /** Every finger assignment needs crossed fingers. */
  | 'FINGER_CROSSING'
  /** A fret is negative, non-integer, or above profile.maxFret. */
  | 'FRET_RANGE'
  /** The shape uses open strings but the profile disallows them. */
  | 'OPEN_STRINGS_DISALLOWED'
  /** Wrong string count or no sounding string. */
  | 'INVALID_SHAPE';

/**
 * Narrow with `result.ok === false` (or `=== true`). The consuming apps compile without `strictNullChecks`, and
 * there `!result.ok` and the else branch of `if (result.ok)` do not narrow, so `result.reason` fails to compile.
 */
export type FingeringResult =
  | { ok: true; fingering: Fingering }
  | { ok: false; reason: FingeringRejectReason; detail: string };

// ---------------------------------------------------------------------------
// Voicing families and generation
// ---------------------------------------------------------------------------

export type FamilyGroup =
  | 'power'
  | 'susAdd'
  | 'shells'
  | 'quartalCluster'
  | 'darkColors'
  | 'triads'
  | 'drones'
  | 'legacy';

export type FamilyTag = 'metal-friendly' | 'color' | 'pedal-compatible' | 'dissonant' | 'triad';

/** Interval recipe relative to the chosen root. Intervals are pitch classes 0..11 above the root. */
export interface VoicingFamily {
  id: string;
  /** Short UI label, e.g. "5", "m(add9)". */
  label: string;
  description: string;
  group: FamilyGroup;
  required: readonly number[];
  optional: readonly number[];
  forbidden: readonly number[];
  /** Allowed intervals of the lowest sounding note (hard constraint), or 'any'. */
  bass: readonly number[] | 'any';
  /** Soft preference for the bass interval (musical cost when violated). */
  preferredBass?: number;
  minNotes: number;
  maxNotes: number;
  tags: readonly FamilyTag[];
  /** Requires at least one open string sounding the root or the fifth. */
  drone?: boolean;
}

export type VoicingTag =
  | 'pedalCompatible'
  | 'drone'
  | 'usesOpenStrings'
  | 'rootInBass'
  | 'lowStrings'
  | 'middleStrings'
  | 'topStrings';

export type StringGroup = 'low3' | 'middle' | 'top3';

export interface GeneratedVoicing {
  shape: Shape;
  fingering: Fingering;
  /** Sounding MIDI notes, low -> high string order (muted strings skipped). */
  midi: number[];
  /** Degree labels of sounding notes, low -> high pitch, space-separated, e.g. "1 5 b2 1". */
  degrees: string;
  /** Degree label per string, low -> high; null for muted strings. */
  degreesByString: (string | null)[];
  /** Honest chord symbol, or null when the notes do not support a confident symbol. */
  symbol: string | null;
  /** Display name: symbol when confident, otherwise an interval description. */
  name: string;
  familyId: string;
  cost: number;
  breakdown: CostBreakdown;
  /** 0..1 distance from common open/CAGED shapes and reference shapes. Not part of difficulty. */
  novelty: number;
  tags: VoicingTag[];
}

export type BindingConstraint =
  | 'PITCH_CLASSES'
  | 'NOTE_COUNT'
  | 'INTERIOR_MUTES'
  | 'BASS'
  | 'NEEDS_BARRE'
  | 'REACH'
  | 'PAIR_STRETCH'
  | 'FINGER_CROSSING'
  | 'MAX_FRET'
  | 'OPEN_STRINGS'
  | 'NO_DRONE_STRING';

export type VoicingSort = 'easiest' | 'unusual';

export interface GenerateParams {
  /** Pitch class 0..11 or a note name ("E", "C#", "Db"). */
  root: number | string;
  /** Family object or a registered family id. */
  family: VoicingFamily | string;
  tuning: Tuning;
  profile: HandProfile;
  /** High-gain context: enables the low-register mud term. Default true. */
  distortion?: boolean;
  /** 'chug' favours fewer, lower strings for palm-muted use. Default 'strum'. */
  context?: 'strum' | 'chug';
  /** Include the musical cost bucket. Default true. */
  musical?: boolean;
  /** Maximum results. Default 12. */
  limit?: number;
  sort?: VoicingSort;
  /** Optional seed: only perturbs ordering among near-equal results, deterministically. */
  seed?: string;
  /** Extra shapes counted as "known" for novelty (e.g. a curated library). */
  referenceShapes?: readonly Shape[];
  /** Spread results across positions and string sets. Default true. */
  diversify?: boolean;
}

/**
 * Counts from the real search. Above LAZY_SEARCH_MIN_SHAPES fingering-feasible shapes the fingering search is
 * lazy: `playable` and the fingering-stage rejections then cover only searched shapes (voicings are identical).
 */
export interface GenerateStats {
  windows: number;
  combinations: number;
  pitchValid: number;
  playable: number;
  rejections: Partial<Record<BindingConstraint, number>>;
}

export interface GenerateResult {
  voicings: GeneratedVoicing[];
  stats: GenerateStats;
  /**
   * Present when `voicings` is empty: the rule that blocks the most nearly-valid shapes in a wider diagnostic
   * search (wider windows, frets above maxFret, open strings). It may be absent from `stats.rejections`.
   */
  empty?: { constraint: BindingConstraint; message: string };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface FingeredShape {
  shape: Shape;
  fingering: Fingering;
}

export interface TransitionBreakdown {
  /** Sum of along-the-neck fingertip movement for fingers used in both shapes (mm). */
  fingerTravelMm: number;
  /** Sum of |string change| for fingers used in both shapes. */
  stringChanges: number;
  lifted: number;
  placed: number;
  /** Same finger, same string, same fret in both shapes. */
  anchors: number;
  /** Same finger, same string, different fret (guide-finger slide). */
  slides: number;
  /** Movement of the hand position (lowest fretted fingertip) in mm. */
  positionShiftMm: number;
  /** Unscaled cost. */
  raw: number;
  /** Seconds available for the change. */
  timeSec: number;
  /** raw scaled by available time. */
  cost: number;
}

export interface SequenceTiming {
  bpm: number;
  /** Beats each slot lasts before the next change; length = number of slots. */
  beatsPerSlot: readonly number[];
  /** Also count the last -> first transition (looping riff). Default true. */
  cyclic?: boolean;
}

export interface SequenceTransition {
  from: number;
  to: number;
  cost: number;
  breakdown: TransitionBreakdown;
}

export interface SequenceResult {
  /** Chosen candidate index per slot. */
  path: number[];
  /** Hardest transition cost on the path (minimized first). */
  maxCost: number;
  /** Sum of transition costs on the path (tie-break). */
  sumCost: number;
  transitions: SequenceTransition[];
  /**
   * null when the path has no transition (no slots, or one slot with `cyclic: false`). Check it before use: the
   * consuming apps compile without `strictNullChecks`, so the compiler does not flag a missing null check.
   */
  hardest: SequenceTransition | null;
}

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

export type Meter = { numerator: number; denominator: 4 | 8 };

export type HitTarget =
  /** Pedal note, usually the lowest string open or the root on it. */
  | { kind: 'pedal' }
  /** Index into the harmony slots (voicings chosen by the user or optimizer). */
  | { kind: 'slot'; slot: number }
  /** Top two notes of the slot voicing. */
  | { kind: 'dyad'; slot: number }
  /** Muted percussive scratch. */
  | { kind: 'dead' };

export interface RhythmEvent {
  /** Onset from pattern start. */
  tick: number;
  /** > 0, no overlap with the next event. */
  durationTicks: number;
  target: HitTarget;
  palmMute: boolean;
  /** 0 normal, 1 accent, 2 strong accent */
  accent: 0 | 1 | 2;
  pick: 'down' | 'up';
  /** Sustain from the previous event, no new attack. */
  tie?: boolean;
}

export type RhythmGrid = '16th' | '16th-triplet';

export type GroupingSpec = 'even' | '3-3-2' | '3-3-3-3-4' | 'random-odd' | readonly number[];

export type RhythmStyleId =
  | 'chugEngine'
  | 'gallop'
  | 'reverseGallop'
  | 'displacedThrees'
  | 'halftimeStomp'
  | 'tremoloWall'
  | 'syncopatedStabs'
  | 'sevenEight'
  | 'fiveOverFour';

export type PickingMode = 'alternate' | 'downstrokes';

export interface RhythmParams {
  style: RhythmStyleId;
  meter: Meter;
  bars: number;
  grid: RhythmGrid;
  grouping: GroupingSpec;
  /** Polymeter: accent-cycle length in grid units, looping against the barline. */
  cycleSixteenths?: number;
  /** 0..1 */
  density: number;
  /** 0..1 */
  syncopation: number;
  /** 0..1 share of hits on the pedal. */
  pedalRatio: number;
  /** 0..1 share of palm-muted hits. */
  palmMuteRatio: number;
  /** 1..4 harmony slots. */
  slotCount: number;
  picking: PickingMode;
  /** Allow the first beat to be empty (pickup / anticipation feel). */
  anticipation: boolean;
}

export interface RhythmPattern {
  id: string;
  name: string;
  seed: string;
  meter: Meter;
  bars: number;
  ppq: 480;
  /** Polymeter phrase length that loops against the bar. */
  cycleTicks?: number;
  /** Sorted by tick; rests are gaps. */
  events: RhythmEvent[];
  tags: string[];
  params: RhythmParams;
}

export interface RhythmWarning {
  code: 'tooFastForProfile';
  message: string;
  /** Smallest inter-onset interval in ticks. */
  minIoiTicks: number;
  /** BPM above which the pattern exceeds the profile's comfortable sixteenth tempo. */
  bpmLimit: number;
}

export interface RhythmValidation {
  ok: boolean;
  errors: string[];
  warnings: RhythmWarning[];
}

/** A harmony slot for playback: one voicing plus an optional pedal note. */
export interface HarmonySlot {
  shape: Shape;
  /** MIDI note for pedal hits; null falls back to the slot's lowest sounding note. */
  pedalMidi: number | null;
}

export interface PlaybackEvent {
  tick: number;
  timeSec: number;
  midi: number[];
  /** 0..1 */
  velocity: number;
  durationSec: number;
  kind: HitTarget['kind'];
  palmMute: boolean;
  accent: 0 | 1 | 2;
}

export interface MidiNoteEvent {
  tick: number;
  durationTicks: number;
  pitch: number;
  /** 1..127 */
  velocity: number;
}
