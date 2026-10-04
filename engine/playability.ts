// Playability cost of a fingered voicing: the physical bucket comes from the fingering, this module adds the
// right-hand and musical buckets. Novelty is a separate ranking axis and never part of the difficulty.
import type {
  CostBreakdown,
  CostTerm,
  CostTermKey,
  Fingering,
  HandProfile,
  Shape,
  Tuning,
  VoicingFamily
} from './types';
import { FINGER_NAMES, physicalCostBreakdown } from './fingering';
import { intervalFrom, pitchClass } from './pitch';
import { fromRiffForgeTab, shapeToMidiByString } from './shape';
import { LOW_MUD_THRESHOLD_MIDI, PLAYABILITY_WEIGHTS } from './weights';

export interface ScoreContext {
  tuning: Tuning;
  profile: HandProfile;
  rootPc: number;
  family?: VoicingFamily;
  /** High-gain context: enables the low-register mud term. */
  distortion: boolean;
  /** 'chug' favours fewer, lower strings for palm-muted playing. */
  context: 'strum' | 'chug';
  /** Include the musical bucket. */
  musical: boolean;
}

/** Semitone distances (1..4) that turn to mud when both notes sit below LOW_MUD_THRESHOLD_MIDI. */
const MUD_MAX_SEMITONES = 4;

const TERM_KEYS = Object.keys(PLAYABILITY_WEIGHTS) as CostTermKey[];

const clamp01 = (x: number): number => (x > 1 ? 1 : x > 0 ? x : 0);

/** shape.ts interiorMutes without allocating: muted strings strictly between the lowest and highest sounding ones. */
export const countInteriorMutes = (shape: Shape): number => {
  let lo = -1;
  let hi = -1;
  for (let s = 0; s < shape.length; s++) {
    if (shape[s] === null) continue;
    if (lo < 0) lo = s;
    hi = s;
  }
  let count = 0;
  for (let s = lo + 1; s < hi; s++) if (shape[s] === null) count++;
  return count;
};

const makeTerm = (key: CostTermKey, raw: number, normalized: number): CostTerm => {
  const { bucket, weight } = PLAYABILITY_WEIGHTS[key];
  return { key, bucket, raw, normalized, weight, cost: normalized * weight };
};

/** Note pairs below the mud threshold that are 1..4 semitones apart. */
const lowMudPairs = (notes: readonly number[]): number => {
  let pairs = 0;
  for (let i = 0; i < notes.length; i++) {
    if (notes[i] >= LOW_MUD_THRESHOLD_MIDI) continue;
    for (let j = i + 1; j < notes.length; j++) {
      if (notes[j] >= LOW_MUD_THRESHOLD_MIDI) continue;
      const d = Math.abs(notes[i] - notes[j]);
      if (d >= 1 && d <= MUD_MAX_SEMITONES) pairs++;
    }
  }
  return pairs;
};

/** Extra copies of the most doubled third (minor or major), 0 when no third repeats. */
const extraThirds = (notes: readonly number[], rootPc: number): number => {
  let minor = 0;
  let major = 0;
  for (const midi of notes) {
    const interval = intervalFrom(rootPc, pitchClass(midi));
    if (interval === 3) minor++;
    else if (interval === 4) major++;
  }
  return Math.max(0, Math.max(minor, major) - 1);
};

/** Raw and normalized values of the right-hand and musical terms, in weights.ts key order. */
interface HandAndMusic {
  skips: number;
  skipsN: number;
  chugRaw: number;
  chugN: number;
  mud: number;
  mudN: number;
  thirds: number;
  thirdsN: number;
  wrongBass: number;
  wrongBassN: number;
}

const measureHandAndMusic = (shape: Shape, ctx: ScoreContext): HandAndMusic => {
  const byString = shapeToMidiByString(shape, ctx.tuning);
  const notes: number[] = [];
  let stringIndexSum = 0;
  let bass = Infinity;
  for (let s = 0; s < byString.length; s++) {
    const midi = byString[s];
    if (midi === null) continue;
    notes.push(midi);
    stringIndexSum += s;
    if (midi < bass) bass = midi;
  }
  const sounding = notes.length;
  const strings = shape.length;

  const skips = countInteriorMutes(shape);
  const chug =
    ctx.context === 'chug' && sounding > 0
      ? 0.5 * clamp01((sounding - 1) / Math.max(1, strings - 1)) + 0.5 * ((stringIndexSum / sounding) / Math.max(1, strings - 1))
      : 0;

  const mud = lowMudPairs(notes);
  const thirds = extraThirds(notes, ctx.rootPc);
  // Only a family that prefers the root in the bass is charged: a relaxed slash-bass recipe (preferred bass on
  // another degree) has no term of its own, and calling its root-position voicings "root not in the bass" is false.
  const preferred = ctx.family?.preferredBass;
  const wrongBass =
    preferred !== undefined && pitchClass(preferred) === 0 && sounding > 0 && intervalFrom(ctx.rootPc, pitchClass(bass)) !== 0 ? 1 : 0;
  const musical = ctx.musical;

  return {
    skips,
    skipsN: clamp01(skips / 2),
    chugRaw: ctx.context === 'chug' ? sounding : 0,
    chugN: clamp01(chug),
    mud,
    mudN: musical && ctx.distortion ? clamp01(mud / 2) : 0,
    thirds,
    thirdsN: musical ? clamp01(thirds) : 0,
    wrongBass,
    wrongBassN: musical ? wrongBass : 0
  };
};

const rightHandAndMusicalTerms = (shape: Shape, ctx: ScoreContext): CostTerm[] => {
  const m = measureHandAndMusic(shape, ctx);
  return [
    makeTerm('stringSkips', m.skips, m.skipsN),
    makeTerm('chugStrings', m.chugRaw, m.chugN),
    makeTerm('lowMud', m.mud, m.mudN),
    makeTerm('doubledThird', m.thirds, m.thirdsN),
    makeTerm('rootNotInBass', m.wrongBass, m.wrongBassN)
  ];
};

const W = PLAYABILITY_WEIGHTS;

const rightHandCost = (m: HandAndMusic): number => {
  let rightHand = 0;
  rightHand += m.skipsN * W.stringSkips.weight;
  rightHand += m.chugN * W.chugStrings.weight;
  return rightHand;
};

const musicalCost = (m: HandAndMusic): number => {
  let musical = 0;
  musical += m.mudN * W.lowMud.weight;
  musical += m.thirdsN * W.doubledThird.weight;
  musical += m.wrongBassN * W.rootNotInBass.weight;
  return musical;
};

/** The right-hand and musical buckets of scoreVoicing: the part of the cost that needs no fingering. */
export const nonPhysicalCost = (shape: Shape, ctx: ScoreContext): number => {
  const m = measureHandAndMusic(shape, ctx);
  return rightHandCost(m) + musicalCost(m);
};

/**
 * scoreVoicing(...).total without building the breakdown: the same terms summed in the same order, so the result
 * is bit-identical. Used to rank thousands of candidates; only the chosen ones get a full breakdown.
 */
export const scoreTotal = (shape: Shape, fingering: Fingering, ctx: ScoreContext): number => {
  const fromFingering = fingering.costBreakdown.terms;
  const physicalTerms =
    fromFingering.length > 0
      ? fromFingering
      : physicalCostBreakdown(shape, fingering.fingers, fingering.barres, fingering.metrics).terms;
  let physical = 0;
  for (const key of TERM_KEYS) {
    if (W[key].bucket !== 'physical') continue;
    for (const t of physicalTerms) {
      if (t.key === key) {
        physical += t.cost;
        break;
      }
    }
  }
  const m = measureHandAndMusic(shape, ctx);
  return physical + rightHandCost(m) + musicalCost(m);
};

/**
 * Full breakdown: the 9 physical terms copied from the fingering, then right-hand and musical terms, always all
 * 14 in weights.ts key order. Musical terms switched off (musical false, or lowMud without distortion) keep their
 * measured raw value with normalized 0 and cost 0; chugStrings is measured only in the 'chug' context.
 */
export const scoreVoicing = (shape: Shape, fingering: Fingering, ctx: ScoreContext): CostBreakdown => {
  const fromFingering = fingering.costBreakdown.terms;
  const physicalTerms =
    fromFingering.length > 0
      ? fromFingering
      : physicalCostBreakdown(shape, fingering.fingers, fingering.barres, fingering.metrics).terms;
  const byKey = new Map<CostTermKey, CostTerm>();
  for (const t of physicalTerms) byKey.set(t.key, t);
  for (const t of rightHandAndMusicalTerms(shape, ctx)) byKey.set(t.key, t);

  const terms: CostTerm[] = [];
  let physical = 0;
  let rightHand = 0;
  let musical = 0;
  for (const key of TERM_KEYS) {
    const source = byKey.get(key) ?? makeTerm(key, 0, 0);
    const t: CostTerm = { ...source };
    terms.push(t);
    if (t.bucket === 'physical') physical += t.cost;
    else if (t.bucket === 'rightHand') rightHand += t.cost;
    else musical += t.cost;
  }
  return { total: physical + rightHand + musical, physical, rightHand, musical, terms };
};

// ---------------------------------------------------------------------------
// Novelty
// ---------------------------------------------------------------------------

const COMMON_TABS: readonly string[] = [
  // Open chords, E standard
  '0 2 2 1 0 0', // E
  '0 2 2 0 0 0', // Em
  '0 2 0 1 0 0', // E7
  '0 2 0 0 0 0', // Em7
  '0 2 2 2 0 0', // Esus4
  'x 0 2 2 2 0', // A
  'x 0 2 2 1 0', // Am
  'x 0 2 0 2 0', // A7
  'x 0 2 0 1 0', // Am7
  'x 0 2 1 2 0', // Amaj7
  'x 0 2 2 0 0', // Asus2
  'x 0 2 2 3 0', // Asus4
  'x 3 2 0 1 0', // C
  'x 3 2 0 0 0', // Cmaj7
  'x 3 2 3 1 0', // C7
  'x 3 2 0 3 0', // Cadd9
  'x x 0 2 3 2', // D
  'x x 0 2 3 1', // Dm
  'x x 0 2 1 2', // D7
  'x x 0 2 2 2', // Dmaj7
  'x x 0 2 3 0', // Dsus2
  'x x 0 2 3 3', // Dsus4
  '3 2 0 0 0 3', // G
  '3 2 0 0 3 3', // G (rock)
  '3 2 0 0 0 1', // G7
  'x x 3 2 1 1', // small F
  'x x 3 2 1 0', // Fmaj7
  'x 2 1 2 0 2', // B7
  // Open power chords and drop-tuning one-finger power chord as written
  '0 2 2 x x x', // E5
  'x 0 2 2 x x', // A5
  'x x 0 2 3 x', // D5
  '0 0 0 x x x', // drop-D 5
  // Movable power chords and octaves
  '1 3 3 x x x',
  'x 1 3 3 x x',
  'x x 1 3 3 x',
  '1 3 x x x x',
  'x 1 3 x x x',
  'x x 1 3 x x',
  '1 1 1 x x x', // drop-tuning one-finger power chord
  '1 x 3 x x x',
  'x 1 x 3 x x',
  'x x 1 x 4 x',
  'x x x 1 x 4',
  // CAGED barre forms
  '1 3 3 2 1 1', // E shape
  '1 3 3 1 1 1', // E-shape minor
  '1 3 1 2 1 1', // E-shape 7
  '1 3 1 1 1 1', // E-shape m7
  'x 1 3 3 3 1', // A shape
  'x 1 3 3 2 1', // A-shape minor
  'x 1 3 1 3 1', // A-shape 7
  'x 1 3 1 2 1', // A-shape m7
  'x 4 3 1 2 1', // C shape
  'x x 1 3 4 3', // D shape
  'x x 1 3 4 2', // D-shape minor
  '4 3 1 1 1 4', // G shape
  // Common shells
  '1 x 1 2 x x', // 7 shell, root on string 0
  '1 x 1 1 x x', // m7 shell
  '1 x 2 2 x x', // maj7 shell
  'x 1 x 1 3 x', // 7 shell, root on string 1
  'x 1 x 1 2 x', // m7 shell
  'x 1 x 2 3 x' // maj7 shell
];

const parseCommon = (text: string): Shape => {
  const shape = fromRiffForgeTab(text);
  if (!shape) throw new Error(`Invalid common shape ${text}`);
  return Object.freeze(shape);
};

/**
 * E-standard open chords and common movable shapes (power chords, octaves, CAGED forms, shells). Shapes without
 * open strings match at any position; shapes with open strings match only as written.
 */
export const COMMON_SHAPES: readonly Shape[] = Object.freeze(COMMON_TABS.map(parseCommon));

const MUTED = -2;
const OPEN = -1;

/** Per string: -2 muted, -1 open, otherwise the fret minus the lowest fretted fret, or the fret itself when absolute. */
const signatureOf = (shape: Shape, absolute: boolean): Int16Array => {
  let min = Infinity;
  for (const f of shape) if (f !== null && f > 0 && f < min) min = f;
  const offset = absolute || min === Infinity ? 0 : min;
  const values = new Int16Array(shape.length);
  for (let s = 0; s < shape.length; s++) {
    const f = shape[s];
    values[s] = f === null ? MUTED : f === 0 ? OPEN : f - offset;
  }
  return values;
};

/** A reference shape reduced to its signature. References with open strings compare frets as written. */
export interface PreparedReference {
  absolute: boolean;
  signature: Int16Array;
}

const isUsableShape = (shape: unknown): shape is Shape =>
  Array.isArray(shape) &&
  shape.some((f) => f !== null) &&
  shape.every((f) => f === null || (Number.isInteger(f) && (f as number) >= 0));

/** Reduces reference shapes once so novelty can be computed for many candidates; malformed or silent shapes are skipped. */
export const prepareReferences = (shapes: readonly Shape[]): PreparedReference[] =>
  shapes.filter(isUsableShape).map((shape) => {
    const absolute = shape.some((f) => f === 0);
    return { absolute, signature: signatureOf(shape, absolute) };
  });

const COMMON_REFERENCES: readonly PreparedReference[] = prepareReferences(COMMON_SHAPES);

/**
 * Signatures of different lengths are aligned at their highest string and the shorter one is padded with muted low
 * strings: the top six strings of a 7- or 8-string guitar are the strings the 6-string references were written for.
 */
const signatureDistance = (a: Int16Array, b: Int16Array): number => {
  const n = a.length > b.length ? a.length : b.length;
  const padA = n - a.length;
  const padB = n - b.length;
  let sum = 0;
  for (let s = 0; s < n; s++) {
    const x = s < padA ? MUTED : a[s - padA];
    const y = s < padB ? MUTED : b[s - padB];
    if (x === y) continue;
    if (x >= 0 && y >= 0) {
      const d = Math.abs(x - y) / 2;
      sum += d > 1 ? 1 : d;
    } else {
      sum += 1;
    }
  }
  return n === 0 ? 1 : sum / n;
};

/** Novelty against prepared references; COMMON_SHAPES are always included. */
export const noveltyAgainst = (shape: Shape, extra: readonly PreparedReference[] = []): number => {
  const relative = signatureOf(shape, false);
  const absolute = signatureOf(shape, true);
  let best = 1;
  for (const list of [COMMON_REFERENCES, extra]) {
    for (const ref of list) {
      const d = signatureDistance(ref.absolute ? absolute : relative, ref.signature);
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
};

/**
 * 0..1 distance from the nearest common shape or reference: per string, equal => 0, both fretted => min(1, |d| / 2)
 * on frets relative to each shape's lowest fret (as written for references with open strings), otherwise 1;
 * averaged over strings. Shapes and references of different string counts are aligned at the highest string.
 */
export const noveltyScore = (shape: Shape, references: readonly Shape[] = []): number =>
  noveltyAgainst(shape, prepareReferences(references));

// ---------------------------------------------------------------------------
// Explanations and profile constraints
// ---------------------------------------------------------------------------

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Position is only worth mentioning from this fret up. */
const POSITION_NOTE_FRET = 5;

/**
 * The span as a share of the comfortable reach (the calibrated index -> pinky reach). The fingering measures it
 * against the allowed span, which includes the stretch allowance, so without the profile only that can be named.
 */
const reachPhrase = (metrics: Fingering['metrics'], profile?: HandProfile): string => {
  if (!profile || !(profile.stretchTolerance > 0)) {
    return `reach ${Math.round(metrics.reachRatio * 100)} percent of your allowed reach`;
  }
  const comfortMm = metrics.allowedSpanMm / profile.stretchTolerance;
  const pct = Math.round((metrics.spanMm / comfortMm) * 100);
  return `reach ${pct} percent of your comfort${pct > 100 ? ' (a stretch)' : ''}`;
};

/**
 * Short human phrases for the UI. Comfort guidance only: phrases describe effort, never safety. Pass the hand
 * profile the fingering was found with so reach is reported against the comfortable reach.
 */
export const explainCost = (breakdown: CostBreakdown, fingering: Fingering, profile?: HandProfile): string[] => {
  const { metrics } = fingering;
  const cost = (key: CostTermKey): number => breakdown.terms.find((t) => t.key === key)?.cost ?? 0;
  const raw = (key: CostTermKey): number => breakdown.terms.find((t) => t.key === key)?.raw ?? 0;
  const lines: string[] = [];

  lines.push(metrics.fingerCount === 0 ? 'open strings only' : plural(metrics.fingerCount, 'finger'));
  if (metrics.reachRatio > 0) lines.push(reachPhrase(metrics, profile));
  if (metrics.maxPairStretch > 0) {
    const worst = metrics.pairs.reduce((a, b) => (b.stretch > a.stretch ? b : a));
    lines.push(`${FINGER_NAMES[worst.from]}-${FINGER_NAMES[worst.to]} stretch ${Math.round(worst.stretch * 100)} percent toward your limit`);
  }
  if (metrics.usesPinky) lines.push('uses pinky');
  if (metrics.usesThumb) lines.push('thumb frets the low string');
  if (fingering.barres.length > 0) lines.push(plural(fingering.barres.length, 'barre'));
  if (metrics.contortions > 0) lines.push(plural(metrics.contortions, 'same-fret finger crossing'));
  if (metrics.interiorMutes > 0) lines.push(plural(metrics.interiorMutes, 'interior mute'));
  if (metrics.lowestFret !== null && metrics.lowestFret >= POSITION_NOTE_FRET) lines.push(`position at fret ${metrics.lowestFret}`);
  if (cost('stringSkips') > 0) lines.push(`${plural(raw('stringSkips'), 'skipped string')} for the picking hand`);
  if (cost('chugStrings') > 0) lines.push(`${plural(raw('chugStrings'), 'string')} to palm-mute`);
  if (cost('lowMud') > 0) lines.push(`${plural(raw('lowMud'), 'muddy low interval')} under gain`);
  if (cost('doubledThird') > 0) lines.push('doubled third');
  if (cost('rootNotInBass') > 0) lines.push('root not in the bass');
  return lines;
};

/** Profile rules that are not about fingers, checked in this order. */
export const shapeConstraintViolation = (
  shape: Shape,
  profile: HandProfile
): 'MAX_FRET' | 'OPEN_STRINGS' | 'INTERIOR_MUTES' | null => {
  if (shape.some((f) => f !== null && f > profile.maxFret)) return 'MAX_FRET';
  if (!profile.allowOpenStrings && shape.some((f) => f === 0)) return 'OPEN_STRINGS';
  if (countInteriorMutes(shape) > profile.maxInteriorMutes) return 'INTERIOR_MUTES';
  return null;
};
