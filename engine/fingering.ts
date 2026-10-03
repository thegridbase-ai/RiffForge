// Finger assignment for one chord shape. The search is exhaustive and deterministic: every legal
// assignment of fingers to fretted notes is visited, hard limits come from the hand profile, and the
// cheapest assignment by physical cost wins (ties: lexicographically smallest fingers array).
// In barre mode a second pass lets a non-index finger flatten over 2-3 adjacent strings (a mini-barre,
// e.g. the ring finger in the A-shape barre chord), but only when no fingering exists without one.
import type {
  Barre,
  CostBreakdown,
  CostTerm,
  CostTermKey,
  Fingering,
  FingeringMetrics,
  FingeringRejectReason,
  FingeringResult,
  FingerNumber,
  HandProfile,
  PairStretch,
  Shape
} from './types';
import { fingertipMm, fretWireMm } from './geometry';
import { allowedSpanMm, pairLimitFraction } from './handProfile';
import { interiorMutes } from './shape';
import { PHYSICAL_TERMS, PLAYABILITY_WEIGHTS } from './weights';

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

/**
 * Heuristic, not research-backed: a thumb wrapped over the neck frets string 0 at most this many
 * frets behind or ahead of the lowest fretting finger.
 */
export const THUMB_FRET_WINDOW = 1;

/**
 * Heuristic, not research-backed: fretting fingertips sit side by side along the neck in hand order
 * (index nearest the nut), each inside its own fret space, and two consecutive fingers need at least this
 * much neck length between their contact points (adult fingertips are roughly 14-18 mm wide; staggering
 * across strings saves a little). On a 25.5" scale three fingers share one fret only up to fret 7 and
 * four never do: such stacks are barres in disguise and are rejected as NEEDS_BARRE.
 */
export const MIN_FINGER_SPACING_MM = 12.5;

/** A flattened non-index finger (barre mode only) covers at most this many adjacent strings. */
export const MAX_MINI_BARRE_STRINGS = 3;

const EPS = 1e-9;
const FINGERS = 4;

// Leaf outcomes, in rejection-priority order.
const OK = 0;
const THUMB_OUT_OF_WINDOW = 1;
const CROSSING = 2;
const CROWDED = 3;
const TOO_WIDE = 4;
const PAIR_OVER = 5;

// ---------------------------------------------------------------------------
// Physical cost terms
// ---------------------------------------------------------------------------

type TermInputs = Pick<
  FingeringMetrics,
  'reachRatio' | 'maxPairStretch' | 'fingerCount' | 'usesPinky' | 'contortions' | 'interiorMutes' | 'lowestFret' | 'usesThumb'
>;

const rawTerm = (key: CostTermKey, t: TermInputs, barreCount: number): number => {
  switch (key) {
    case 'reach':
      return t.reachRatio;
    case 'pairStretch':
      return t.maxPairStretch;
    case 'fingerCount':
      return t.fingerCount;
    case 'pinky':
      return t.usesPinky ? 1 : 0;
    case 'contortion':
      return t.contortions;
    case 'interiorMutes':
      return t.interiorMutes;
    case 'position':
      return t.lowestFret ?? 0;
    case 'thumb':
      return t.usesThumb ? 1 : 0;
    case 'barre':
      return barreCount;
    default:
      return 0;
  }
};

const clamp01 = (x: number): number => (x > 1 ? 1 : x > 0 ? x : 0);

const normalizeTerm = (key: CostTermKey, raw: number): number => {
  switch (key) {
    case 'reach':
    case 'pairStretch':
      return clamp01(raw * raw);
    case 'fingerCount':
      return clamp01(raw / 4);
    case 'contortion':
    case 'interiorMutes':
      return clamp01(raw / 2);
    case 'position':
      return clamp01(raw / 12);
    default:
      return clamp01(raw);
  }
};

/** Same arithmetic and order as physicalCostBreakdown().total, without allocating terms. */
const physicalTotal = (t: TermInputs, barreCount: number): number => {
  let total = 0;
  for (let i = 0; i < PHYSICAL_TERMS.length; i++) {
    const key = PHYSICAL_TERMS[i];
    total += normalizeTerm(key, rawTerm(key, t, barreCount)) * PLAYABILITY_WEIGHTS[key].weight;
  }
  return total;
};

export const physicalCostBreakdown = (
  _shape: Shape,
  _fingers: (FingerNumber | null)[],
  barres: Barre[],
  metrics: FingeringMetrics
): CostBreakdown => {
  const terms: CostTerm[] = [];
  let total = 0;
  for (const key of PHYSICAL_TERMS) {
    const raw = rawTerm(key, metrics, barres.length);
    const normalized = normalizeTerm(key, raw);
    const { bucket, weight } = PLAYABILITY_WEIGHTS[key];
    const cost = normalized * weight;
    total += cost;
    terms.push({ key, bucket, raw, normalized, weight, cost });
  }
  return { total, physical: total, rightHand: 0, musical: 0, terms };
};

// ---------------------------------------------------------------------------
// Search context
// ---------------------------------------------------------------------------

interface SearchContext {
  shape: Shape;
  profile: HandProfile;
  /** Fretted notes in ascending string order. */
  strings: number[];
  frets: number[];
  tip: Float64Array;
  /** Fret wire positions in mm from the nut. */
  wire: Float64Array;
  /** pairLimitFraction for fingers a < b, at index a * 5 + b. */
  pairFraction: number[];
  lowestFret: number | null;
  highestFret: number | null;
  interiorMutes: number;
  thumbOnString0: boolean;
  /** Lowest fretted fret when an index barre is allowed, otherwise -1. */
  indexBarreFret: number;
  partialBarres: boolean;
  /** Second pass in barre mode: fingers 2..4 may flatten over adjacent strings at their fret. */
  miniBarres: boolean;
  /** Fingers that could fret a note: 4, or 5 with the thumb on string 0. */
  available: number;
}

/** Per finger 0..4; `notes[f] === 0` means unused. */
interface SearchState {
  assign: number[];
  fret: number[];
  notes: number[];
  low: number[];
  high: number[];
}

interface Evaluation extends TermInputs {
  status: number;
  minFret: number;
  maxFret: number;
  spanMm: number;
  allowedSpanMm: number;
  maxPairRatio: number;
  worstFrom: number;
  worstTo: number;
  worstDistance: number;
  worstLimit: number;
  barreCount: number;
  /** CROWDED detail: the tightest run of fingers, its frets and the neck length it needs and has. */
  crowdCount: number;
  crowdFromFret: number;
  crowdToFret: number;
  crowdNeedMm: number;
  crowdHaveMm: number;
}

let tableScale = -1;
let tipCache = new Float64Array(0);
let wireCache = new Float64Array(0);

/** Fingertip and fret wire positions per fret, cached for the last scale length used. */
const neckTables = (scaleLengthMm: number, highestFret: number): { tip: Float64Array; wire: Float64Array } => {
  const size = highestFret + FINGERS + 1;
  if (scaleLengthMm !== tableScale || tipCache.length < size) {
    const n = Math.max(size, 40);
    const tip = new Float64Array(n);
    const wire = new Float64Array(n);
    for (let f = 0; f < n; f++) {
      tip[f] = fingertipMm(f, scaleLengthMm);
      wire[f] = fretWireMm(f, scaleLengthMm);
    }
    tipCache = tip;
    wireCache = wire;
    tableScale = scaleLengthMm;
  }
  return { tip: tipCache, wire: wireCache };
};

const reject = (reason: FingeringRejectReason, detail: string): FingeringResult => ({ ok: false, reason, detail });

type Prepared = { ok: true; ctx: SearchContext } | { ok: false; result: FingeringResult };

const prepare = (shape: Shape, profile: HandProfile): Prepared => {
  if (!Array.isArray(shape as unknown) || shape.length < 1) {
    return { ok: false, result: reject('INVALID_SHAPE', 'shape has no strings') };
  }
  let sounding = 0;
  for (let s = 0; s < shape.length; s++) {
    const fret = shape[s];
    if (fret === null) continue;
    if (typeof fret !== 'number' || !Number.isInteger(fret) || fret < 0) {
      return { ok: false, result: reject('INVALID_SHAPE', `string ${s} has an invalid fret value`) };
    }
    sounding++;
  }
  if (sounding === 0) return { ok: false, result: reject('INVALID_SHAPE', 'no string sounds') };

  const strings: number[] = [];
  const frets: number[] = [];
  let lowest = Infinity;
  let highest = -Infinity;
  for (let s = 0; s < shape.length; s++) {
    const fret = shape[s];
    if (fret === null || fret === 0) continue;
    if (fret > profile.maxFret) {
      return { ok: false, result: reject('FRET_RANGE', `fret ${fret} is above the max fret ${profile.maxFret}`) };
    }
    strings.push(s);
    frets.push(fret);
    if (fret < lowest) lowest = fret;
    if (fret > highest) highest = fret;
  }
  if (!profile.allowOpenStrings && shape.some((fret) => fret === 0)) {
    return { ok: false, result: reject('OPEN_STRINGS_DISALLOWED', 'open strings are turned off in the hand profile') };
  }

  const pairFraction = new Array<number>(25).fill(0);
  for (let a = 1; a < FINGERS; a++) {
    for (let b = a + 1; b <= FINGERS; b++) pairFraction[a * 5 + b] = pairLimitFraction(profile, a as FingerNumber, b as FingerNumber);
  }
  const hasFretted = strings.length > 0;
  const string0 = shape[0];
  const thumbOnString0 = profile.allowThumb && string0 !== null && string0 > 0;
  const { tip, wire } = neckTables(profile.scaleLengthMm, hasFretted ? highest : 0);
  return {
    ok: true,
    ctx: {
      shape,
      profile,
      strings,
      frets,
      tip,
      wire,
      pairFraction,
      lowestFret: hasFretted ? lowest : null,
      highestFret: hasFretted ? highest : null,
      interiorMutes: interiorMutes(shape),
      thumbOnString0,
      indexBarreFret: !profile.noBarre && hasFretted ? lowest : -1,
      partialBarres: profile.allowTwoStringPartialBarre,
      miniBarres: false,
      available: FINGERS + (thumbOnString0 ? 1 : 0)
    }
  };
};

// ---------------------------------------------------------------------------
// Evaluation of one complete assignment
// ---------------------------------------------------------------------------

const safeRatio = (value: number, limit: number): number => (limit > 0 ? value / limit : value > 0 ? Infinity : 0);

const pairDistanceMm = (ctx: SearchContext, fretA: number, fretB: number): number => ctx.tip[fretB] - ctx.tip[fretA];

const pairLimitMm = (ctx: SearchContext, a: number, b: number, allowed: number): number => ctx.pairFraction[a * 5 + b] * allowed;

/** Relaxed spacing: one fret per finger-number step from finger a's fret. */
const naturalSpacingMm = (ctx: SearchContext, a: number, b: number, fretA: number): number =>
  ctx.tip[fretA + (b - a)] - ctx.tip[fretA];

const stretchBeyondNatural = (distance: number, natural: number, limit: number): number => {
  if (distance <= natural) return 0;
  return limit > natural ? Math.min(1, (distance - natural) / (limit - natural)) : 1;
};

const createEvaluation = (ctx: SearchContext): Evaluation => ({
  status: OK,
  minFret: 0,
  maxFret: 0,
  spanMm: 0,
  allowedSpanMm: 0,
  reachRatio: 0,
  maxPairRatio: 0,
  maxPairStretch: 0,
  worstFrom: 0,
  worstTo: 0,
  worstDistance: 0,
  worstLimit: 0,
  fingerCount: 0,
  usesPinky: false,
  usesThumb: false,
  contortions: 0,
  barreCount: 0,
  crowdCount: 0,
  crowdFromFret: 0,
  crowdToFret: 0,
  crowdNeedMm: 0,
  crowdHaveMm: 0,
  interiorMutes: ctx.interiorMutes,
  lowestFret: ctx.lowestFret
});

/**
 * Packs the fretting fingers (hand order, thumb excluded, frets non-decreasing) as far toward the nut as
 * MIN_FINGER_SPACING_MM allows. Returns false and fills the CROWDED detail when one lands past its fret wire.
 */
const fitsSideBySide = (ctx: SearchContext, fret: readonly number[], notes: readonly number[], ev: Evaluation): boolean => {
  let pos = -Infinity;
  let runStart = 0;
  let runCount = 0;
  for (let f = 1; f <= FINGERS; f++) {
    if (notes[f] === 0) continue;
    const back = ctx.wire[fret[f] - 1];
    const packed = pos + MIN_FINGER_SPACING_MM;
    if (packed <= back) {
      pos = back;
      runStart = fret[f];
      runCount = 1;
    } else {
      pos = packed;
      runCount++;
    }
    if (pos > ctx.wire[fret[f]] + EPS) {
      ev.crowdCount = runCount;
      ev.crowdFromFret = runStart;
      ev.crowdToFret = fret[f];
      ev.crowdNeedMm = (runCount - 1) * MIN_FINGER_SPACING_MM;
      ev.crowdHaveMm = ctx.wire[fret[f]] - ctx.wire[runStart - 1];
      return false;
    }
  }
  return true;
};

/** Checks the hard rules in rejection-priority order and fills the cost inputs of a legal assignment. */
const evaluate = (ctx: SearchContext, st: SearchState, ev: Evaluation): void => {
  const { fret, notes } = st;
  let minFret = Infinity;
  let maxFret = -Infinity;
  let previous = -Infinity;
  let crossing = false;
  for (let f = 1; f <= FINGERS; f++) {
    if (notes[f] === 0) continue;
    const at = fret[f];
    if (at < previous) crossing = true;
    previous = at;
    if (at < minFret) minFret = at;
    if (at > maxFret) maxFret = at;
  }
  const usesThumb = notes[0] > 0;
  if (usesThumb && minFret !== Infinity && Math.abs(fret[0] - minFret) > THUMB_FRET_WINDOW) {
    ev.status = THUMB_OUT_OF_WINDOW;
    return;
  }
  if (crossing) {
    ev.status = CROSSING;
    return;
  }
  if (!fitsSideBySide(ctx, fret, notes, ev)) {
    ev.status = CROWDED;
    return;
  }

  ev.usesThumb = usesThumb;
  if (minFret === Infinity) {
    ev.minFret = 0;
    ev.maxFret = 0;
    ev.spanMm = 0;
    ev.allowedSpanMm = usesThumb ? allowedSpanMm(ctx.profile, fret[0]) : 0;
    ev.reachRatio = 0;
  } else {
    ev.minFret = minFret;
    ev.maxFret = maxFret;
    ev.spanMm = ctx.tip[maxFret] - ctx.tip[minFret];
    ev.allowedSpanMm = allowedSpanMm(ctx.profile, minFret);
    ev.reachRatio = safeRatio(ev.spanMm, ev.allowedSpanMm);
    if (ev.spanMm > ev.allowedSpanMm + EPS) {
      ev.status = TOO_WIDE;
      return;
    }
  }

  let maxRatio = 0;
  let maxStretch = 0;
  ev.worstFrom = 0;
  ev.worstTo = 0;
  ev.worstDistance = 0;
  ev.worstLimit = 0;
  let a = 0;
  for (let b = 1; b <= FINGERS; b++) {
    if (notes[b] === 0) continue;
    if (a !== 0) {
      const distance = pairDistanceMm(ctx, fret[a], fret[b]);
      const limit = pairLimitMm(ctx, a, b, ev.allowedSpanMm);
      const ratio = safeRatio(distance, limit);
      const stretch = stretchBeyondNatural(distance, naturalSpacingMm(ctx, a, b, fret[a]), limit);
      if (ratio > maxRatio) {
        maxRatio = ratio;
        ev.worstFrom = a;
        ev.worstTo = b;
        ev.worstDistance = distance;
        ev.worstLimit = limit;
      }
      if (stretch > maxStretch) maxStretch = stretch;
    }
    a = b;
  }
  ev.maxPairRatio = maxRatio;
  ev.maxPairStretch = maxStretch;
  if (maxRatio > 1 + EPS) {
    ev.status = PAIR_OVER;
    return;
  }

  let fingerCount = 0;
  let barreCount = 0;
  for (let f = 0; f <= FINGERS; f++) {
    if (notes[f] > 0) fingerCount++;
    if (notes[f] > 1) barreCount++;
  }
  let contortions = 0;
  for (let x = 1; x < FINGERS; x++) {
    if (notes[x] === 0) continue;
    for (let y = x + 1; y <= FINGERS; y++) {
      if (notes[y] > 0 && fret[x] === fret[y] && st.low[x] > st.low[y]) contortions++;
    }
  }
  ev.fingerCount = fingerCount;
  ev.barreCount = barreCount;
  ev.contortions = contortions;
  ev.usesPinky = notes[FINGERS] > 0;
  ev.status = OK;
};

const buildFingering = (ctx: SearchContext, st: SearchState, ev: Evaluation): Fingering => {
  const { shape } = ctx;
  const fingers = new Array<FingerNumber | null>(shape.length).fill(null);
  for (let i = 0; i < ctx.strings.length; i++) fingers[ctx.strings[i]] = st.assign[i] as FingerNumber;

  const barres: Barre[] = [];
  for (let f = 0; f <= FINGERS; f++) {
    if (st.notes[f] > 1) barres.push({ finger: f as FingerNumber, fret: st.fret[f], fromString: st.low[f], toString: st.high[f] });
  }

  const pairs: PairStretch[] = [];
  let a = 0;
  for (let b = 1; b <= FINGERS; b++) {
    if (st.notes[b] === 0) continue;
    if (a !== 0) {
      const distanceMm = pairDistanceMm(ctx, st.fret[a], st.fret[b]);
      const limitMm = pairLimitMm(ctx, a, b, ev.allowedSpanMm);
      const naturalMm = naturalSpacingMm(ctx, a, b, st.fret[a]);
      pairs.push({
        from: a as FingerNumber,
        to: b as FingerNumber,
        distanceMm,
        limitMm,
        ratio: safeRatio(distanceMm, limitMm),
        naturalMm,
        stretch: stretchBeyondNatural(distanceMm, naturalMm, limitMm)
      });
    }
    a = b;
  }

  const metrics: FingeringMetrics = {
    frettedCount: ctx.strings.length,
    fingerCount: ev.fingerCount,
    spanMm: ev.spanMm,
    allowedSpanMm: ev.allowedSpanMm,
    reachRatio: ev.reachRatio,
    pairs,
    maxPairRatio: ev.maxPairRatio,
    maxPairStretch: ev.maxPairStretch,
    usesPinky: ev.usesPinky,
    usesThumb: ev.usesThumb,
    contortions: ev.contortions,
    interiorMutes: ctx.interiorMutes,
    lowestFret: ctx.lowestFret,
    highestFret: ctx.highestFret
  };
  return { fingers, barres, metrics, costBreakdown: physicalCostBreakdown(shape, fingers, barres, metrics) };
};

// ---------------------------------------------------------------------------
// Exhaustive search
// ---------------------------------------------------------------------------

interface Diagnostics {
  /** Some assignment put the thumb outside its fret window. */
  thumbOutOfWindow: boolean;
  structural: boolean;
  crossingFree: boolean;
  /** Some crossing-free assignment fits its fingers side by side. */
  fits: boolean;
  /** Mildest overcrowding over all crossing-free assignments (NEEDS_BARRE detail). */
  crowdExcessMm: number;
  crowdCount: number;
  crowdFromFret: number;
  crowdToFret: number;
  crowdNeedMm: number;
  crowdHaveMm: number;
  reachOk: boolean;
  /** Narrowest failing span (REACH detail). */
  reachRatio: number;
  reachSpan: number;
  reachAllowed: number;
  reachMinFret: number;
  reachMaxFret: number;
  /** Mildest failing pair over all reach-legal assignments (PAIR_STRETCH detail). */
  pairRatio: number;
  pairFrom: number;
  pairTo: number;
  pairDistance: number;
  pairLimit: number;
}

const createState = (k: number): SearchState => ({
  assign: new Array<number>(k).fill(0),
  fret: [0, 0, 0, 0, 0],
  notes: [0, 0, 0, 0, 0],
  low: [0, 0, 0, 0, 0],
  high: [0, 0, 0, 0, 0]
});

/**
 * May finger `f` (already placed) also press string `s` at `fret`? Strings are visited in ascending
 * order, so st.high[f] is the highest string the finger covers so far.
 */
const canExtend = (ctx: SearchContext, st: SearchState, f: number, s: number, fret: number): boolean => {
  if (f === 0 || st.fret[f] !== fret) return false;
  if (ctx.partialBarres && st.notes[f] === 1 && st.high[f] === s - 1) return true;
  if (ctx.miniBarres && f > 1 && st.notes[f] < MAX_MINI_BARRE_STRINGS && st.high[f] === s - 1) return true;
  if (f !== 1 || fret !== ctx.indexBarreFret) return false;
  // Index barre: every string it spans must be fretted, and strings at the barre fret are the barre's.
  for (let t = st.high[1] + 1; t < s; t++) {
    const between = ctx.shape[t];
    if (between === null || between === 0 || between === fret) return false;
  }
  return true;
};

const explore = (ctx: SearchContext, onValid: (st: SearchState, ev: Evaluation) => void): Diagnostics => {
  const k = ctx.strings.length;
  const st = createState(k);
  const ev = createEvaluation(ctx);
  const diag: Diagnostics = {
    thumbOutOfWindow: false,
    structural: false,
    crossingFree: false,
    fits: false,
    crowdExcessMm: Infinity,
    crowdCount: 0,
    crowdFromFret: 0,
    crowdToFret: 0,
    crowdNeedMm: 0,
    crowdHaveMm: 0,
    reachOk: false,
    reachRatio: Infinity,
    reachSpan: 0,
    reachAllowed: 0,
    reachMinFret: 0,
    reachMaxFret: 0,
    pairRatio: Infinity,
    pairFrom: 0,
    pairTo: 0,
    pairDistance: 0,
    pairLimit: 0
  };

  const visit = (): void => {
    evaluate(ctx, st, ev);
    if (ev.status === THUMB_OUT_OF_WINDOW) {
      diag.thumbOutOfWindow = true;
      return;
    }
    diag.structural = true;
    if (ev.status === CROSSING) return;
    diag.crossingFree = true;
    if (ev.status === CROWDED) {
      const excess = ev.crowdNeedMm - ev.crowdHaveMm;
      if (excess < diag.crowdExcessMm) {
        diag.crowdExcessMm = excess;
        diag.crowdCount = ev.crowdCount;
        diag.crowdFromFret = ev.crowdFromFret;
        diag.crowdToFret = ev.crowdToFret;
        diag.crowdNeedMm = ev.crowdNeedMm;
        diag.crowdHaveMm = ev.crowdHaveMm;
      }
      return;
    }
    diag.fits = true;
    if (ev.status === TOO_WIDE) {
      if (ev.reachRatio < diag.reachRatio) {
        diag.reachRatio = ev.reachRatio;
        diag.reachSpan = ev.spanMm;
        diag.reachAllowed = ev.allowedSpanMm;
        diag.reachMinFret = ev.minFret;
        diag.reachMaxFret = ev.maxFret;
      }
      return;
    }
    diag.reachOk = true;
    if (ev.status === PAIR_OVER) {
      if (ev.maxPairRatio < diag.pairRatio) {
        diag.pairRatio = ev.maxPairRatio;
        diag.pairFrom = ev.worstFrom;
        diag.pairTo = ev.worstTo;
        diag.pairDistance = ev.worstDistance;
        diag.pairLimit = ev.worstLimit;
      }
      return;
    }
    onValid(st, ev);
  };

  const step = (i: number): void => {
    if (i === k) {
      visit();
      return;
    }
    const s = ctx.strings[i];
    const fret = ctx.frets[i];
    for (let f = s === 0 && ctx.thumbOnString0 ? 0 : 1; f <= FINGERS; f++) {
      if (st.notes[f] === 0) {
        st.fret[f] = fret;
        st.notes[f] = 1;
        st.low[f] = s;
        st.high[f] = s;
        st.assign[i] = f;
        step(i + 1);
        st.notes[f] = 0;
      } else if (canExtend(ctx, st, f, s, fret)) {
        const previousHigh = st.high[f];
        st.notes[f]++;
        st.high[f] = s;
        st.assign[i] = f;
        step(i + 1);
        st.notes[f]--;
        st.high[f] = previousHigh;
      }
    }
  };

  step(0);
  return diag;
};

/** Without any multi-string finger, more notes than fingers can be rejected before searching. */
const tooManyNotes = (ctx: SearchContext): FingeringResult | null => {
  const k = ctx.strings.length;
  if (ctx.profile.noBarre && !ctx.partialBarres && k > ctx.available) {
    return reject('NEEDS_BARRE', `${k} fretted notes but only ${ctx.available} fingers without a barre`);
  }
  return null;
};

/** Formats two millimetre values with just enough decimals to tell them apart. */
const formatMmPair = (value: number, limit: number): [string, string] => {
  for (let digits = 0; digits < 2; digits++) {
    const a = value.toFixed(digits);
    const b = limit.toFixed(digits);
    if (a !== b) return [a, b];
  }
  return [value.toFixed(2), limit.toFixed(2)];
};

const rejection = (ctx: SearchContext, diag: Diagnostics): FingeringResult => {
  const k = ctx.strings.length;
  if (!diag.structural) {
    if (diag.thumbOutOfWindow) {
      return reject(
        'NEEDS_BARRE',
        `${k} fretted notes need the thumb, but its fret ${ctx.shape[0]} is more than ${THUMB_FRET_WINDOW} fret from the lowest finger`
      );
    }
    return reject('NEEDS_BARRE', `${k} fretted notes do not fit ${ctx.available} fingers with the allowed barres`);
  }
  if (!diag.crossingFree) return reject('FINGER_CROSSING', 'every finger order needs crossed fingers');
  if (!diag.fits) {
    const [need, have] = formatMmPair(diag.crowdNeedMm, diag.crowdHaveMm);
    const frets = diag.crowdFromFret === diag.crowdToFret ? `fret ${diag.crowdToFret}` : `frets ${diag.crowdFromFret}-${diag.crowdToFret}`;
    return reject(
      'NEEDS_BARRE',
      `${diag.crowdCount} fingers do not fit side by side in ${frets}: need ${need} mm, have ${have} mm`
    );
  }
  if (!diag.reachOk) {
    const [span, allowed] = formatMmPair(diag.reachSpan, diag.reachAllowed);
    return reject('REACH', `span ${span} mm > allowed ${allowed} mm (frets ${diag.reachMinFret}-${diag.reachMaxFret})`);
  }
  const [distance, limit] = formatMmPair(diag.pairDistance, diag.pairLimit);
  const pair = `${FINGER_NAMES[diag.pairFrom]}-${FINGER_NAMES[diag.pairTo]}`;
  return reject('PAIR_STRETCH', `${pair} needs ${distance} mm > limit ${limit} mm`);
};

const lexLess = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

const compareFingers = (a: readonly (FingerNumber | null)[], b: readonly (FingerNumber | null)[]): number => {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return a.length - b.length;
};

/** Rebuilds the search state for a recorded assignment (notes in ascending string order). */
const replay = (ctx: SearchContext, assign: readonly number[]): SearchState => {
  const st = createState(assign.length);
  for (let i = 0; i < assign.length; i++) {
    const f = assign[i];
    const s = ctx.strings[i];
    if (st.notes[f] === 0) {
      st.fret[f] = ctx.frets[i];
      st.low[f] = s;
    }
    st.high[f] = s;
    st.notes[f]++;
    st.assign[i] = f;
  }
  return st;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the search; in barre mode, when nothing is valid, runs it again with mini-barres allowed (a superset
 * of the first pass, so its diagnostics cover every assignment).
 */
const exploreWithFallback = (ctx: SearchContext, onValid: (st: SearchState, ev: Evaluation) => void): { diag: Diagnostics; found: boolean } => {
  let found = false;
  const record = (st: SearchState, ev: Evaluation): void => {
    found = true;
    onValid(st, ev);
  };
  let diag = explore(ctx, record);
  if (!found && !ctx.profile.noBarre && ctx.strings.length > 1) {
    ctx.miniBarres = true;
    diag = explore(ctx, record);
  }
  return { diag, found };
};

export const findBestFingering = (shape: Shape, profile: HandProfile): FingeringResult => {
  const prepared = prepare(shape, profile);
  if (prepared.ok === false) return prepared.result;
  const { ctx } = prepared;
  const early = tooManyNotes(ctx);
  if (early) return early;

  let found = false;
  let bestCost = Infinity;
  const bestAssign = new Array<number>(ctx.strings.length).fill(0);
  const { diag } = exploreWithFallback(ctx, (st, ev) => {
    const cost = physicalTotal(ev, ev.barreCount);
    if (!found || cost < bestCost || (cost === bestCost && lexLess(st.assign, bestAssign))) {
      found = true;
      bestCost = cost;
      for (let i = 0; i < bestAssign.length; i++) bestAssign[i] = st.assign[i];
    }
  });
  if (!found) return rejection(ctx, diag);

  const st = replay(ctx, bestAssign);
  const ev = createEvaluation(ctx);
  evaluate(ctx, st, ev);
  return { ok: true, fingering: buildFingering(ctx, st, ev) };
};

/**
 * All valid assignments, best first (physical cost asc, then lexicographic fingers array). Mini-barre
 * assignments appear only when no assignment without one is valid.
 */
export const enumerateFingerings = (shape: Shape, profile: HandProfile): Fingering[] => {
  const prepared = prepare(shape, profile);
  if (prepared.ok === false) return [];
  const { ctx } = prepared;
  if (tooManyNotes(ctx)) return [];
  const out: Fingering[] = [];
  exploreWithFallback(ctx, (st, ev) => {
    out.push(buildFingering(ctx, st, ev));
  });
  return out.sort((x, y) => x.costBreakdown.total - y.costBreakdown.total || compareFingers(x.fingers, y.fingers));
};

/**
 * Classification for legacy/curated shapes. `noBarre` uses a copy of the profile with noBarre on,
 * `withBarre` a copy with noBarre off (both keep the profile's partial-barre, thumb and reach settings).
 * needsBarre is true only when a barre is what is missing: too many notes for one finger per string,
 * more fingers in a fret than fit side by side, or no barre-free fingering while a barre fingering
 * exists (mini-barres included). Shapes that fail for other reasons
 * (out of reach in both modes, fret range, open strings) are not blamed on the barre.
 */
export const classifyShape = (
  shape: Shape,
  profile: HandProfile
): { needsBarre: boolean; noBarre: FingeringResult; withBarre: FingeringResult } => {
  const noBarre = findBestFingering(shape, { ...profile, noBarre: true });
  const withBarre = findBestFingering(shape, { ...profile, noBarre: false });
  const needsBarre = noBarre.ok === false && (noBarre.reason === 'NEEDS_BARRE' || withBarre.ok);
  return { needsBarre, noBarre, withBarre };
};
