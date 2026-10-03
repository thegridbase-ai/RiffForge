// Voicing generation: a pruned, exhaustive search over fret windows anchored at the lowest fretted fret, exact
// recipe validation, the fingering search as the hard gate, then cost ranking and diversification across positions
// and string sets. Large searches (wide, barre or thumb profiles) run the fingering search lazily in lower-bound
// order, with the same results. Deterministic for equal inputs, including the order of the results.
import type {
  BindingConstraint,
  Fingering,
  FingeringRejectReason,
  FingeringResult,
  GenerateParams,
  GenerateResult,
  GenerateStats,
  GeneratedVoicing,
  HandProfile,
  Shape,
  Tuning,
  VoicingFamily,
  VoicingTag
} from './types';
import { MAX_MINI_BARRE_STRINGS, THUMB_FRET_WINDOW, findBestFingering } from './fingering';
import { fingertipMm, highestReachableFret } from './geometry';
import { allowedSpanMm } from './handProfile';
import { nameVoicing } from './naming';
import { intervalFrom, pitchClass, pitchClassName, toPitchClass } from './pitch';
import {
  countInteriorMutes,
  nonPhysicalCost,
  noveltyAgainst,
  prepareReferences,
  scoreTotal,
  scoreVoicing,
  shapeConstraintViolation,
  type ScoreContext
} from './playability';
import { mulberry32, seedFromString } from './random';
import { interiorMutes, shapeKey, shapeToMidi } from './shape';
import { allowedIntervals, getFamily, matchFamily, relaxFamily } from './voicingSpec';
import { PLAYABILITY_WEIGHTS } from './weights';

export const DEFAULT_VOICING_LIMIT = 12;
/** Added to a candidate's sort score per already selected voicing at a nearby position on the same strings. */
export const DIVERSITY_PENALTY = 0.6;
/** "Nearby": lowest fretted frets (0 when none) at most this far apart. */
export const DIVERSITY_FRET_DISTANCE = 2;
/** Seeded ordering jitter range: only reorders results whose sort keys are this close. */
export const SEED_JITTER = 0.01;

const FINGERS = 4;
const EPS = 1e-9;

// Empty-result diagnosis searches a wider space than the hand allows, so the constraints that the main search
// enforces by construction (reach windows, max fret, open strings) can be named. Heuristic bounds.
const DIAG_REACH_FACTOR = 1.5;
const DIAG_MIN_WINDOW_FRETS = 4;
const DIAG_EXTRA_FRETS = 12;
const DIAG_FRET_CAP = 24;

/** Tie order when two constraints explain the same number of near misses. */
const BINDING_ORDER: readonly BindingConstraint[] = [
  'NEEDS_BARRE',
  'REACH',
  'PAIR_STRETCH',
  'FINGER_CROSSING',
  'INTERIOR_MUTES',
  'MAX_FRET',
  'OPEN_STRINGS',
  'PITCH_CLASSES',
  'NOTE_COUNT',
  'BASS',
  'NO_DRONE_STRING'
];

const FINGERING_TO_BINDING: Readonly<Record<FingeringRejectReason, BindingConstraint>> = {
  NEEDS_BARRE: 'NEEDS_BARRE',
  REACH: 'REACH',
  PAIR_STRETCH: 'PAIR_STRETCH',
  FINGER_CROSSING: 'FINGER_CROSSING',
  FRET_RANGE: 'MAX_FRET',
  OPEN_STRINGS_DISALLOWED: 'OPEN_STRINGS',
  INVALID_SHAPE: 'NOTE_COUNT'
};

type Counts = Partial<Record<BindingConstraint, number>>;

const bump = (counts: Counts, key: BindingConstraint, by = 1): void => {
  counts[key] = (counts[key] ?? 0) + by;
};

const maskOf = (intervals: readonly number[]): number => {
  let mask = 0;
  for (const i of intervals) mask |= 1 << pitchClass(i);
  return mask;
};

const popcount = (mask: number): number => {
  let count = 0;
  for (let m = mask; m; m &= m - 1) count++;
  return count;
};

/**
 * A registered family id, or a relaxed id `<registered id>~<step>~...` as findClosestVoicing puts in
 * GeneratedVoicing.familyId (rebuilt from relaxFamily, so stored ids regenerate the same recipe).
 */
export const resolveFamilyId = (id: string): VoicingFamily | undefined => {
  const direct = getFamily(id);
  if (direct) return direct;
  const cut = id.indexOf('~');
  if (cut < 0) return undefined;
  const base = getFamily(id.slice(0, cut));
  return base ? relaxFamily(base).find((step) => step.family.id === id)?.family : undefined;
};

const resolveFamily = (family: VoicingFamily | string): VoicingFamily => {
  if (typeof family !== 'string') return family;
  const found = resolveFamilyId(family);
  if (!found) throw new Error(`Unknown voicing family "${family}"`);
  return found;
};

// ---------------------------------------------------------------------------
// Finger supply pre-check
// ---------------------------------------------------------------------------

/**
 * Lower bound on the fingers 1..4 that the fretted notes from string `from` up need. Each finger holds one fret and
 * covers at most `cap` adjacent strings there; the index barre at `barreFret` covers that fret's notes inside one run
 * of consecutive fretted strings.
 */
const fingersNeeded = (shape: Shape, from: number, cap: number, barreFret: number): number => {
  const n = shape.length;
  let total = 0;
  let blockSave = 0;
  let bestSave = 0;
  let s = from;
  while (s < n) {
    const f = shape[s];
    if (f === null || f === 0) {
      blockSave = 0;
      s++;
      continue;
    }
    let e = s;
    while (e + 1 < n && shape[e + 1] === f) e++;
    const groups = Math.ceil((e - s + 1) / cap);
    total += groups;
    if (f === barreFret) {
      blockSave += groups;
      if (blockSave > bestSave) bestSave = blockSave;
    }
    s = e + 1;
  }
  return bestSave > 0 ? total - bestSave + 1 : total;
};

/** Most adjacent strings one finger covers at one fret, outside the index barre (mini-barres in barre mode). */
const supplyCap = (profile: HandProfile): number =>
  !profile.noBarre ? MAX_MINI_BARRE_STRINGS : profile.allowTwoStringPartialBarre ? 2 : 1;

/**
 * Cheap necessary condition for a fingering, mirroring fingering.ts's structural rules: one fret per finger, partial
 * barres (2 adjacent strings) and mini-barres (3, barre mode) at one fret, the index barre at the lowest fret, and the
 * thumb on string 0 within THUMB_FRET_WINDOW of the lowest finger. For a shape inside the profile's fret and
 * open-string limits, true means findBestFingering rejects it with NEEDS_BARRE, so the exhaustive search is skipped.
 */
export const structurallyUnfingerable = (shape: Shape, profile: HandProfile): boolean => {
  let lowest = Infinity;
  let lowestAbove0 = Infinity;
  for (let s = 0; s < shape.length; s++) {
    const f = shape[s];
    if (typeof f !== 'number' || !(f > 0)) continue;
    if (f < lowest) lowest = f;
    if (s > 0 && f < lowestAbove0) lowestAbove0 = f;
  }
  if (lowest === Infinity) return false;
  const cap = supplyCap(profile);
  const barreFret = profile.noBarre ? -1 : lowest;
  if (fingersNeeded(shape, 0, cap, barreFret) <= FINGERS) return false;
  const thumbFret = shape[0];
  if (!profile.allowThumb || typeof thumbFret !== 'number' || !(thumbFret > 0)) return true;
  // Thumb on string 0: the fingers hold the other notes (there are some, a lone note needs one finger)
  if (Math.abs(thumbFret - lowestAbove0) > THUMB_FRET_WINDOW) return true;
  return fingersNeeded(shape, 1, cap, barreFret) > FINGERS;
};

// ---------------------------------------------------------------------------
// Shape enumeration
// ---------------------------------------------------------------------------

/** Fretted notes must include `anchor` (the lowest fretted fret) and stay within [anchor, hi]. Anchor 0 = open only. */
interface FretWindow {
  anchor: number;
  hi: number;
}

interface SearchSpace {
  windows: readonly FretWindow[];
  allowOpen: boolean;
  /** Prune branches with more fretted notes than this. */
  maxFretted: number;
  /** Prune branches with more muted strings inside the sounding range than this. */
  maxInteriorMutes: number;
  /** Finger-supply rules for partial-barre, barre or thumb profiles (see structurallyUnfingerable), else null. */
  supply: FingerSupply | null;
}

interface FingerSupply {
  /** supplyCap(profile) */
  cap: number;
  barre: boolean;
  thumb: boolean;
}

const fingerSupply = (profile: HandProfile): FingerSupply | null =>
  profile.noBarre && !profile.allowTwoStringPartialBarre && !profile.allowThumb
    ? null
    : { cap: supplyCap(profile), barre: !profile.noBarre, thumb: profile.allowThumb };

/**
 * structurallyUnfingerable on a partial shape (higher strings still muted), without the thumb-window rule. The
 * finger lower bound never drops as strings are added (the window anchor is the barre fret), so every completion
 * of a flagged prefix is unfingerable too.
 */
const prefixOutOfFingers = (prefix: Shape, supply: FingerSupply, anchor: number): boolean => {
  const barreFret = supply.barre ? anchor : -1;
  if (fingersNeeded(prefix, 0, supply.cap, barreFret) <= FINGERS) return false;
  const thumbFret = prefix[0];
  return !(supply.thumb && thumbFret !== null && thumbFret > 0 && fingersNeeded(prefix, 1, supply.cap, barreFret) <= FINGERS);
};

/**
 * Depth-first search over strings, low to high. Per string: muted, open, or a fret in the window whose pitch class
 * the recipe allows. Branches that cannot complete the required pitch classes, the note count, the window anchor
 * or the drone string are cut silently; branches cut by a profile limit are reported through `onPrune`.
 */
const enumerateShapes = (
  family: VoicingFamily,
  rootPc: number,
  tuning: Tuning,
  space: SearchSpace,
  onPrune: (constraint: 'NEEDS_BARRE' | 'INTERIOR_MUTES') => void,
  onLeaf: (shape: (number | null)[]) => void
): void => {
  const n = tuning.openMidi.length;
  const allowedMask = maskOf(allowedIntervals(family));
  const requiredMask = maskOf(family.required);
  const droneMask = family.drone ? maskOf([0, 7]) & allowedMask : 0;
  const openInterval = tuning.openMidi.map((midi) => intervalFrom(rootPc, pitchClass(midi)));
  const frets = new Array<number | null>(n).fill(null);

  for (const { anchor, hi } of space.windows) {
    const options: number[][] = [];
    const bits: number[][] = [];
    for (let s = 0; s < n; s++) {
      const o = [-1];
      const b = [0];
      const openBit = 1 << openInterval[s];
      if (space.allowOpen && allowedMask & openBit) {
        o.push(0);
        b.push(openBit);
      }
      if (anchor > 0) {
        for (let f = anchor; f <= hi; f++) {
          const bit = 1 << ((openInterval[s] + f) % 12);
          if (allowedMask & bit) {
            o.push(f);
            b.push(bit);
          }
        }
      }
      options.push(o);
      bits.push(b);
    }
    const suffixMask = new Array<number>(n + 1).fill(0);
    const suffixAnchor = new Array<boolean>(n + 1).fill(false);
    const suffixDrone = new Array<boolean>(n + 1).fill(false);
    for (let s = n - 1; s >= 0; s--) {
      let mask = suffixMask[s + 1];
      let hasAnchor = suffixAnchor[s + 1];
      let hasDrone = suffixDrone[s + 1];
      for (let i = 1; i < options[s].length; i++) {
        mask |= bits[s][i];
        if (options[s][i] === anchor) hasAnchor = true;
        if (options[s][i] === 0 && bits[s][i] & droneMask) hasDrone = true;
      }
      suffixMask[s] = mask;
      suffixAnchor[s] = hasAnchor;
      suffixDrone[s] = hasDrone;
    }

    const visit = (
      s: number,
      present: number,
      sounding: number,
      fretted: number,
      interior: number,
      pending: number,
      hasAnchor: boolean,
      hasDrone: boolean
    ): void => {
      const remaining = n - s;
      if (sounding > family.maxNotes || sounding + remaining < family.minNotes) return;
      const missing = requiredMask & ~present;
      if (missing & ~suffixMask[s] || popcount(missing) > remaining) return;
      if (anchor > 0 && !hasAnchor && !suffixAnchor[s]) return;
      if (droneMask && !hasDrone && !suffixDrone[s]) return;
      if (fretted > space.maxFretted || (fretted > FINGERS && space.supply !== null && prefixOutOfFingers(frets, space.supply, anchor))) {
        onPrune('NEEDS_BARRE');
        return;
      }
      if (interior > space.maxInteriorMutes) {
        onPrune('INTERIOR_MUTES');
        return;
      }
      if (s === n) {
        onLeaf(frets.slice());
        return;
      }
      const o = options[s];
      const b = bits[s];
      for (let i = 0; i < o.length; i++) {
        const f = o[i];
        if (f < 0) {
          frets[s] = null;
          visit(s + 1, present, sounding, fretted, interior, sounding > 0 ? pending + 1 : 0, hasAnchor, hasDrone);
        } else {
          frets[s] = f;
          visit(
            s + 1,
            present | b[i],
            sounding + 1,
            fretted + (f > 0 ? 1 : 0),
            interior + pending,
            0,
            hasAnchor || f === anchor,
            hasDrone || (f === 0 && (b[i] & droneMask) !== 0)
          );
        }
      }
      frets[s] = null;
    };
    visit(0, 0, 0, 0, 0, 0, false, false);
  }
};

const reachHi = (profile: HandProfile, fret: number, factor: number, limit: number): number =>
  highestReachableFret(fret, allowedSpanMm(profile, fret) * factor, profile.scaleLengthMm, limit);

/**
 * One open-only pass, then one window per anchor fret 1..maxFret reaching as far as the hand allows from it.
 * With the thumb allowed, the fingers may start up to THUMB_FRET_WINDOW frets above a thumb on the anchor.
 */
const handWindows = (profile: HandProfile): FretWindow[] => {
  const windows: FretWindow[] = [{ anchor: 0, hi: 0 }];
  for (let w = 1; w <= profile.maxFret; w++) {
    let hi = reachHi(profile, w, 1, profile.maxFret);
    if (profile.allowThumb) {
      for (let k = 1; k <= THUMB_FRET_WINDOW; k++) hi = Math.max(hi, reachHi(profile, Math.min(w + k, profile.maxFret), 1, profile.maxFret));
    }
    windows.push({ anchor: w, hi });
  }
  return windows;
};

const maxFrettedNotes = (profile: HandProfile): number => {
  if (!profile.noBarre) return Infinity;
  const thumb = profile.allowThumb ? 1 : 0;
  return (profile.allowTwoStringPartialBarre ? 2 * FINGERS : FINGERS) + thumb;
};

// ---------------------------------------------------------------------------
// Empty-result diagnosis
// ---------------------------------------------------------------------------

/**
 * Some open string can ring the root or 5th: allowed by the recipe, and when it is not an allowed bass note, a
 * lower string can still sound an allowed bass note below it.
 */
const droneStringExists = (family: VoicingFamily, rootPc: number, tuning: Tuning): boolean => {
  const allowed = maskOf(allowedIntervals(family));
  const bassOk = (interval: number): boolean => family.bass === 'any' || family.bass.includes(interval);
  const { openMidi } = tuning;
  return openMidi.some((midi, s) => {
    const interval = intervalFrom(rootPc, pitchClass(midi));
    if ((interval !== 0 && interval !== 7) || !(allowed & (1 << interval))) return false;
    if (bassOk(interval)) return true;
    for (let t = 0; t < s; t++) {
      for (let f = 0; openMidi[t] + f < midi && f <= DIAG_FRET_CAP; f++) {
        const below = intervalFrom(rootPc, pitchClass(openMidi[t] + f));
        if (allowed & (1 << below) && bassOk(below)) return true;
      }
    }
    return false;
  });
};

const CONSTRAINT_TEXT: Readonly<Record<BindingConstraint, (profile: HandProfile) => string>> = {
  PITCH_CLASSES: () => 'pitch classes (no shape sounds exactly the notes this recipe asks for)',
  NOTE_COUNT: () => 'note count (the recipe cannot fit its note limits on these strings)',
  BASS: () => 'bass note (no shape puts an allowed note in the bass)',
  NO_DRONE_STRING: () => 'no drone string (no open string can ring the root or 5th here)',
  NEEDS_BARRE: () => 'needs a barre (the closest shapes need more fingers than fit without one)',
  REACH: () => 'reach (the closest shapes need a wider stretch than your hand profile allows)',
  PAIR_STRETCH: () => 'finger stretch (the closest shapes pull two neighbouring fingers past their limit)',
  FINGER_CROSSING: () => 'finger crossing (the closest shapes need crossed fingers)',
  INTERIOR_MUTES: (p) => `interior mutes (the closest shapes mute more than ${p.maxInteriorMutes} inner string${p.maxInteriorMutes === 1 ? '' : 's'})`,
  MAX_FRET: (p) => `max fret (the closest shapes sit above fret ${p.maxFret})`,
  OPEN_STRINGS: () => 'open strings are off (the closest shapes need open strings)'
};

const emptyResult = (
  constraint: BindingConstraint,
  family: VoicingFamily,
  rootPc: number,
  tuning: Tuning,
  profile: HandProfile,
  onlyThis = 0
): NonNullable<GenerateResult['empty']> => {
  const tail = onlyThis > 0 ? `; ${onlyThis} close shape${onlyThis === 1 ? ' fails' : 's fail'} only on this` : '';
  return {
    constraint,
    message: `No ${family.label} voicing on ${pitchClassName(rootPc)} in ${tuning.name}: ${CONSTRAINT_TEXT[constraint](profile)}${tail}.`
  };
};

/** The profile rules a pitch-valid shape breaks; fingering is checked under a copy without fret/open limits. */
const profileViolations = (shape: Shape, profile: HandProfile, relaxed: HandProfile): BindingConstraint[] => {
  const out: BindingConstraint[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  let open = false;
  for (const f of shape) {
    if (f === null) continue;
    if (f === 0) open = true;
    else {
      if (f < lo) lo = f;
      if (f > hi) hi = f;
    }
  }
  if (hi > profile.maxFret) out.push('MAX_FRET');
  if (open && !profile.allowOpenStrings) out.push('OPEN_STRINGS');
  if (interiorMutes(shape) > profile.maxInteriorMutes) out.push('INTERIOR_MUTES');
  // Span over all fretted notes: the fingering search reports NEEDS_BARRE before reach, so reach is checked here.
  // With the thumb allowed its note leaves the span, so the fingering result decides instead.
  if (!profile.allowThumb && lo !== Infinity) {
    const span = fingertipMm(hi, profile.scaleLengthMm) - fingertipMm(lo, profile.scaleLengthMm);
    if (span > allowedSpanMm(profile, lo) + EPS) out.push('REACH');
  }
  const fingering: FingeringResult = structurallyUnfingerable(shape, relaxed)
    ? { ok: false, reason: 'NEEDS_BARRE', detail: '' }
    : findBestFingering(shape, relaxed);
  if (fingering.ok === false) {
    const constraint = FINGERING_TO_BINDING[fingering.reason];
    if (!out.includes(constraint)) out.push(constraint);
  }
  return out;
};

const mostCounted = (counts: Counts): BindingConstraint | null => {
  let best: BindingConstraint | null = null;
  for (const key of BINDING_ORDER) {
    const n = counts[key] ?? 0;
    if (n > 0 && (best === null || n > (counts[best] ?? 0))) best = key;
  }
  return best;
};

/**
 * Names the constraint behind an empty result. Searches pitch-valid shapes in a wider space (larger windows, frets
 * above maxFret, open strings, no mute or note limits) and picks the constraint that alone rejects the most of them;
 * when every near miss breaks several rules, the one breaking the most; with no pitch-valid shape at all, the
 * recipe's own failure.
 */
const diagnoseEmpty = (
  family: VoicingFamily,
  rootPc: number,
  tuning: Tuning,
  profile: HandProfile
): NonNullable<GenerateResult['empty']> => {
  const strings = tuning.openMidi.length;
  const say = (c: BindingConstraint, onlyThis = 0) => emptyResult(c, family, rootPc, tuning, profile, onlyThis);
  if (family.minNotes > strings || family.minNotes > family.maxNotes || family.required.length > family.maxNotes) {
    return say('NOTE_COUNT');
  }
  if (family.drone && !droneStringExists(family, rootPc, tuning)) return say('NO_DRONE_STRING');

  const diagMax = Math.max(profile.maxFret, Math.min(DIAG_FRET_CAP, profile.maxFret + DIAG_EXTRA_FRETS));
  const windows: FretWindow[] = [{ anchor: 0, hi: 0 }];
  for (let w = 1; w <= diagMax; w++) {
    const hi = Math.max(reachHi(profile, w, DIAG_REACH_FACTOR, diagMax), Math.min(diagMax, w + DIAG_MIN_WINDOW_FRETS));
    windows.push({ anchor: w, hi });
  }
  const relaxed: HandProfile = { ...profile, maxFret: diagMax, allowOpenStrings: true };
  const single: Counts = {};
  const any: Counts = {};
  const pitch: Counts = {};
  enumerateShapes(
    family,
    rootPc,
    tuning,
    { windows, allowOpen: true, maxFretted: Infinity, maxInteriorMutes: Infinity, supply: null },
    () => undefined,
    (shape) => {
      const match = matchFamily(family, rootPc, shape, tuning);
      if (match.ok === false) {
        bump(pitch, match.reason);
        return;
      }
      const violations = profileViolations(shape, profile, relaxed);
      if (violations.length === 1) bump(single, violations[0]);
      for (const v of violations) bump(any, v);
    }
  );
  const alone = mostCounted(single);
  if (alone) return say(alone, single[alone]);
  return say(mostCounted(any) ?? mostCounted(pitch) ?? 'PITCH_CLASSES');
};

// ---------------------------------------------------------------------------
// Ranking and output
// ---------------------------------------------------------------------------

interface Candidate {
  shape: Shape;
  key: string;
  fingering: Fingering;
  /** scoreVoicing(...).total; the breakdown is built only for the chosen voicings. */
  total: number;
  /** NaN until computed (only needed up front for the 'unusual' sort). */
  novelty: number;
  primary: number;
  secondary: number;
  lowest: number;
  stringMask: number;
}

const compareCandidates = (a: Candidate, b: Candidate): number =>
  a.primary - b.primary || a.secondary - b.secondary || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

interface Selection {
  picked: Candidate[];
  /** Highest score any pick won its round with: a candidate scoring above it can never be picked. */
  worst: number;
}

/**
 * Greedy pick in sort order; a candidate's score grows by DIVERSITY_PENALTY for every selected voicing on the same
 * sounding strings within DIVERSITY_FRET_DISTANCE frets. Ties keep the sort order.
 */
const diversified = (sorted: readonly Candidate[], limit: number): Selection => {
  const picked: Candidate[] = [];
  const taken = new Uint8Array(sorted.length);
  let worst = -Infinity;
  while (picked.length < limit) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      if (taken[i]) continue;
      const c = sorted[i];
      if (best !== -1 && c.primary >= bestScore) break;
      let near = 0;
      for (const p of picked) {
        if (p.stringMask === c.stringMask && Math.abs(p.lowest - c.lowest) <= DIVERSITY_FRET_DISTANCE) near++;
      }
      const score = c.primary + DIVERSITY_PENALTY * near;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best === -1) break;
    taken[best] = 1;
    picked.push(sorted[best]);
    if (bestScore > worst) worst = bestScore;
  }
  return { picked, worst };
};

const select = (sorted: readonly Candidate[], limit: number, diversify: boolean): Selection => {
  if (diversify) return diversified(sorted, limit);
  const picked = sorted.slice(0, limit);
  return { picked, worst: picked.length > 0 ? picked[picked.length - 1].primary : -Infinity };
};

// ---------------------------------------------------------------------------
// Lazy fingering search
// ---------------------------------------------------------------------------

/**
 * Above this many fingering-feasible shapes (wide, barre or thumb profiles) the fingering search runs lazily: shapes
 * are searched in order of a lower bound on their sort key, and the search stops once no unsearched shape can enter
 * the results. The voicings are identical to an exhaustive search; stats.playable and the fingering rejections then
 * count only the searched shapes. Smaller searches stay exhaustive.
 */
export const LAZY_SEARCH_MIN_SHAPES = 2048;

/** Shapes searched before the first re-selection in the lazy search; doubles each round. */
const LAZY_FIRST_BATCH = 64;

/** Margin on lower-bound comparisons; costs are short sums of terms of order 1. */
const BOUND_EPS = 1e-9;

/** A shape that passed every check except the fingering search. */
interface Leaf {
  shape: Shape;
  /** shapeKey, computed when needed (seeded jitter or ranking). */
  key: string | null;
  jitter: number;
  /** Lower bound on the candidate's primary sort key (exact for 'unusual'); lazy search only. */
  bound: number;
  /** Precomputed for the lazy 'unusual' search, NaN otherwise. */
  novelty: number;
}

interface NeckTable {
  tip: Float64Array;
  allowed: Float64Array;
}

const neckTable = (profile: HandProfile): NeckTable => {
  const size = profile.maxFret + 2;
  const tip = new Float64Array(size);
  const allowed = new Float64Array(size);
  for (let f = 0; f < size; f++) {
    tip[f] = fingertipMm(f, profile.scaleLengthMm);
    allowed[f] = allowedSpanMm(profile, f);
  }
  return { tip, allowed };
};

const clamp01 = (x: number): number => (x > 1 ? 1 : x > 0 ? x : 0);

/**
 * Lower bound on the reach, finger-count, pinky, thumb and barre terms when fingers 1..4 press exactly the fretted
 * notes from string `from` up (string 0 goes to the thumb when `from` is 1). Mirrors fingering.ts's term
 * normalization; reach is exact because the fingers sit on exactly those frets.
 */
const fingerTermsBound = (shape: Shape, from: number, cap: number, barreFret: number, neck: NeckTable): number => {
  const thumb = from === 1;
  let lo = Infinity;
  let hi = -Infinity;
  let notes = 0;
  for (let s = from; s < shape.length; s++) {
    const f = shape[s];
    if (f === null || f === 0) continue;
    notes++;
    if (f < lo) lo = f;
    if (f > hi) hi = f;
  }
  const fingers = notes === 0 ? 0 : fingersNeeded(shape, from, cap, barreFret);
  let cost = 0;
  if (notes > 0) {
    const ratio = (neck.tip[hi] - neck.tip[lo]) / neck.allowed[lo];
    cost += clamp01(ratio * ratio) * PLAYABILITY_WEIGHTS.reach.weight;
  }
  cost += clamp01((fingers + (thumb ? 1 : 0)) / FINGERS) * PLAYABILITY_WEIGHTS.fingerCount.weight;
  if (fingers >= FINGERS) cost += PLAYABILITY_WEIGHTS.pinky.weight;
  if (thumb) cost += PLAYABILITY_WEIGHTS.thumb.weight;
  // More notes than fingers: some finger covers two or more strings, which the fingering reports as a barre
  if (notes > FINGERS) cost += PLAYABILITY_WEIGHTS.barre.weight;
  return cost;
};

/** Lower bound on scoreVoicing(...).total over every fingering of a shape that passed structurallyUnfingerable. */
const costLowerBound = (shape: Shape, profile: HandProfile, ctx: ScoreContext, neck: NeckTable): number => {
  let lowest = Infinity;
  for (const f of shape) if (f !== null && f > 0 && f < lowest) lowest = f;
  let physical = clamp01(countInteriorMutes(shape) / 2) * PLAYABILITY_WEIGHTS.interiorMutes.weight;
  if (lowest !== Infinity) {
    const cap = supplyCap(profile);
    const barreFret = profile.noBarre ? -1 : lowest;
    let best = fingersNeeded(shape, 0, cap, barreFret) <= FINGERS ? fingerTermsBound(shape, 0, cap, barreFret, neck) : Infinity;
    const thumbFret = shape[0];
    if (profile.allowThumb && thumbFret !== null && thumbFret > 0) {
      best = Math.min(best, fingerTermsBound(shape, 1, cap, barreFret, neck));
    }
    if (best !== Infinity) physical += best;
    physical += clamp01(lowest / 12) * PLAYABILITY_WEIGHTS.position.weight;
  }
  return physical + nonPhysicalCost(shape, ctx);
};

const voicingTags = (shape: Shape, tuning: Tuning, rootPc: number, family: VoicingFamily): VoicingTag[] => {
  const n = shape.length;
  const tags: VoicingTag[] = [];
  const intervalOn = (s: number): number => intervalFrom(rootPc, pitchClass(tuning.openMidi[s] + (shape[s] ?? 0)));
  const low = shape[0];
  if (low === null || (low === 0 && (intervalOn(0) === 0 || intervalOn(0) === 7))) tags.push('pedalCompatible');
  if (family.drone) tags.push('drone');
  if (shape.some((f) => f === 0)) tags.push('usesOpenStrings');
  let lo = -1;
  let hi = -1;
  let bass = Infinity;
  let bassString = -1;
  for (let s = 0; s < n; s++) {
    const f = shape[s];
    if (f === null) continue;
    if (lo < 0) lo = s;
    hi = s;
    const midi = tuning.openMidi[s] + f;
    if (midi < bass) {
      bass = midi;
      bassString = s;
    }
  }
  if (bassString >= 0 && intervalOn(bassString) === 0) tags.push('rootInBass');
  if (lo >= 0) {
    if (hi <= 2) tags.push('lowStrings');
    if (lo >= 1 && hi <= n - 2) tags.push('middleStrings');
    if (lo >= n - 3) tags.push('topStrings');
  }
  return tags;
};

const run = (params: GenerateParams, diagnose: boolean): GenerateResult => {
  const family = resolveFamily(params.family);
  const rootPc = toPitchClass(params.root);
  const { tuning, profile } = params;
  const sort = params.sort ?? 'easiest';
  const limitRaw = params.limit ?? DEFAULT_VOICING_LIMIT;
  // Infinity asks for every playable voicing; only NaN falls back to the default
  const limit = Number.isNaN(limitRaw) ? DEFAULT_VOICING_LIMIT : Math.max(0, Math.floor(limitRaw));
  const ctx: ScoreContext = {
    tuning,
    profile,
    rootPc,
    family,
    distortion: params.distortion ?? true,
    context: params.context ?? 'strum',
    musical: params.musical ?? true
  };
  const references = prepareReferences(params.referenceShapes ?? []);
  const { seed } = params;

  const windows = handWindows(profile);
  const rejections: Counts = {};
  const stats: GenerateStats = { windows: windows.length, combinations: 0, pitchValid: 0, playable: 0, rejections };
  // Each shape is enumerated once: windows are keyed by the lowest fretted fret, so no deduplication is needed.
  const leaves: Leaf[] = [];

  enumerateShapes(
    family,
    rootPc,
    tuning,
    {
      windows,
      allowOpen: profile.allowOpenStrings,
      maxFretted: maxFrettedNotes(profile),
      maxInteriorMutes: profile.maxInteriorMutes,
      supply: fingerSupply(profile)
    },
    (constraint) => bump(rejections, constraint),
    (shape) => {
      stats.combinations++;
      const match = matchFamily(family, rootPc, shape, tuning);
      if (match.ok === false) {
        bump(rejections, match.reason);
        return;
      }
      stats.pitchValid++;
      const violation = shapeConstraintViolation(shape, profile);
      if (violation !== null) {
        bump(rejections, violation);
        return;
      }
      if (structurallyUnfingerable(shape, profile)) {
        bump(rejections, 'NEEDS_BARRE');
        return;
      }
      if (seed === undefined) {
        leaves.push({ shape, key: null, jitter: 0, bound: 0, novelty: NaN });
      } else {
        const key = shapeKey(shape);
        leaves.push({ shape, key, jitter: mulberry32(seedFromString(seed + key))() * SEED_JITTER, bound: 0, novelty: NaN });
      }
    }
  );

  const candidates: Candidate[] = [];
  const evaluate = (leaf: Leaf): void => {
    const { shape } = leaf;
    const result = findBestFingering(shape, profile);
    if (result.ok === false) {
      bump(rejections, FINGERING_TO_BINDING[result.reason]);
      return;
    }
    stats.playable++;
    const total = scoreTotal(shape, result.fingering, ctx);
    const novelty = sort !== 'unusual' ? NaN : Number.isNaN(leaf.novelty) ? noveltyAgainst(shape, references) : leaf.novelty;
    let stringMask = 0;
    for (let s = 0; s < shape.length; s++) if (shape[s] !== null) stringMask |= 1 << s;
    candidates.push({
      shape,
      key: leaf.key ?? shapeKey(shape),
      fingering: result.fingering,
      total,
      novelty,
      primary: (sort === 'unusual' ? -novelty : total) + leaf.jitter,
      secondary: sort === 'unusual' ? total : 0,
      lowest: result.fingering.metrics.lowestFret ?? 0,
      stringMask
    });
  };

  const diversify = params.diversify !== false;
  let chosen: Candidate[] = [];
  if (leaves.length <= LAZY_SEARCH_MIN_SHAPES || limit >= leaves.length) {
    for (const leaf of leaves) evaluate(leaf);
    candidates.sort(compareCandidates);
    chosen = select(candidates, limit, diversify).picked;
  } else {
    // Exact: once every unsearched shape's bound exceeds the worst winning score, none of them can be picked
    // (a pick needs a score <= that, and a score is at least the primary key).
    const neck = sort === 'unusual' ? null : neckTable(profile);
    for (const leaf of leaves) {
      if (neck === null) {
        leaf.novelty = noveltyAgainst(leaf.shape, references);
        leaf.bound = -leaf.novelty + leaf.jitter;
      } else {
        leaf.bound = costLowerBound(leaf.shape, profile, ctx, neck) + leaf.jitter;
      }
    }
    // Stable sort: equal bounds keep enumeration order, so the searched set (and the stats) stay deterministic
    leaves.sort((a, b) => a.bound - b.bound);
    let next = 0;
    while (candidates.length < Math.max(1, limit) && next < leaves.length) evaluate(leaves[next++]);
    // Growing batches: the first picks often cost far more than their bounds, so re-selecting early tightens the
    // stopping score before most shapes are searched. Every stop follows a selection on the current pool.
    let batch = LAZY_FIRST_BATCH;
    while (limit > 0) {
      candidates.sort(compareCandidates);
      const { picked, worst } = select(candidates, limit, diversify);
      chosen = picked;
      const stop = worst + BOUND_EPS;
      if (next >= leaves.length || leaves[next].bound > stop) break;
      for (let n = 0; n < batch && next < leaves.length && leaves[next].bound <= stop; n++) evaluate(leaves[next++]);
      batch *= 2;
    }
  }

  const voicings: GeneratedVoicing[] = chosen.map((c) => {
    const naming = nameVoicing(c.shape, tuning, rootPc, family);
    const breakdown = scoreVoicing(c.shape, c.fingering, ctx);
    return {
      shape: c.shape,
      fingering: c.fingering,
      midi: shapeToMidi(c.shape, tuning),
      degrees: naming.degrees,
      degreesByString: naming.degreesByString,
      symbol: naming.symbol,
      name: naming.name,
      familyId: family.id,
      cost: breakdown.total,
      breakdown,
      novelty: Number.isNaN(c.novelty) ? noveltyAgainst(c.shape, references) : c.novelty,
      tags: voicingTags(c.shape, tuning, rootPc, family)
    };
  });

  const result: GenerateResult = { voicings, stats };
  if (candidates.length === 0 && diagnose) result.empty = diagnoseEmpty(family, rootPc, tuning, profile);
  return result;
};

/**
 * All playable voicings of `family` on `root` for the hand profile, best first. Hard rules: exact pitch classes,
 * the profile's fret/open/mute limits and a valid fingering. An empty result names its binding constraint.
 */
export const generateVoicings = (params: GenerateParams): GenerateResult => run(params, true);

export interface ClosestVoicingResult {
  result: GenerateResult;
  /** Relaxation labels used, null when the exact recipe worked or nothing did. */
  relaxed: string[] | null;
  /** Why the exact recipe was empty (present whenever it was), so callers need not search it again. */
  exactEmpty?: NonNullable<GenerateResult['empty']>;
}

/**
 * The exact recipe first, then each step of relaxFamily's ladder; returns the first result with voicings and the
 * relaxation labels used (null when the exact recipe worked). When nothing works, the exact (empty) result.
 */
export const findClosestVoicing = (params: GenerateParams): ClosestVoicingResult => {
  const exact = run(params, true);
  if (exact.empty === undefined) return { result: exact, relaxed: null };
  const exactEmpty = exact.empty;
  for (const step of relaxFamily(resolveFamily(params.family))) {
    const result = run({ ...params, family: step.family }, false);
    if (result.voicings.length > 0) return { result, relaxed: step.relaxed, exactEmpty };
  }
  return { result: exact, relaxed: null, exactEmpty };
};
