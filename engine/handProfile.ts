// Personal hand profile: comfort guidance for one player's hand, not a medical or safety assessment.
import type { CalibrationAnswers, FingerNumber, HandProfile, PairLimits } from './types';
import { DEFAULT_SCALE_LENGTH_MM, spanMm } from './geometry';

/** Heuristic defaults (not research-backed): middle-ring is the most constrained pair. */
export const DEFAULT_PAIR_LIMITS: PairLimits = { indexMiddle: 0.65, middleRing: 0.35, ringPinky: 0.4 };

export const STRETCH_TOLERANCE_ALLOW = 1.1;

export const CALIBRATION_LOW_INDEX_FRET = 1;
export const CALIBRATION_HIGH_INDEX_FRET = 7;
export const CALIBRATION_LOW_PINKY_RANGE = [3, 7] as const;
export const CALIBRATION_HIGH_PINKY_RANGE = [9, 13] as const;

export const PROFILE_LIMITS = {
  scaleLengthMm: [550, 800],
  reachMm: [30, 220],
  refFret: [1, 15],
  pairLimit: [0.1, 1],
  stretchTolerance: [0.8, 1.5],
  maxFret: [3, 24],
  maxInteriorMutes: [0, 4],
  comfortableSixteenthBpm: [40, 300]
} as const;

export const createDefaultHandProfile = (scaleLengthMm: number = DEFAULT_SCALE_LENGTH_MM): HandProfile => ({
  version: 1,
  scaleLengthMm,
  reachAtLowMm: spanMm(CALIBRATION_LOW_INDEX_FRET, 4, scaleLengthMm),
  reachAtHighMm: spanMm(CALIBRATION_HIGH_INDEX_FRET, 11, scaleLengthMm),
  lowRefFret: CALIBRATION_LOW_INDEX_FRET,
  highRefFret: CALIBRATION_HIGH_INDEX_FRET,
  pairLimits: { ...DEFAULT_PAIR_LIMITS },
  stretchTolerance: 1,
  noBarre: true,
  allowTwoStringPartialBarre: false,
  allowThumb: false,
  maxFret: 15,
  allowOpenStrings: true,
  maxInteriorMutes: 1,
  comfortableSixteenthBpm: 110
});

export const DEFAULT_HAND_PROFILE: HandProfile = createDefaultHandProfile();

export const DEFAULT_CALIBRATION: CalibrationAnswers = {
  scaleLengthMm: DEFAULT_SCALE_LENGTH_MM,
  lowPinkyFret: 4,
  highPinkyFret: 11,
  allowStretches: false,
  noBarre: true,
  allowOpenStrings: true,
  maxFret: 15,
  comfortableSixteenthBpm: 110
};

/**
 * Comfortable index -> pinky fingertip reach with the index at `atFret`.
 * Linear between the two calibration points, constant outside them.
 */
export const maxReachMm = (profile: HandProfile, atFret: number): number => {
  const { lowRefFret, highRefFret, reachAtLowMm, reachAtHighMm } = profile;
  if (highRefFret <= lowRefFret) return reachAtLowMm;
  if (atFret <= lowRefFret) return reachAtLowMm;
  if (atFret >= highRefFret) return reachAtHighMm;
  const t = (atFret - lowRefFret) / (highRefFret - lowRefFret);
  return reachAtLowMm + t * (reachAtHighMm - reachAtLowMm);
};

/** Allowed total span for a shape whose lowest fretted note is at `lowestFret`. */
export const allowedSpanMm = (profile: HandProfile, lowestFret: number): number =>
  maxReachMm(profile, lowestFret) * profile.stretchTolerance;

/**
 * Pair limit as a fraction of the allowed span for fingers `a` < `b` (1..4).
 * Non-adjacent fingers get the sum of the adjacent limits between them.
 */
export const pairLimitFraction = (profile: HandProfile, a: FingerNumber, b: FingerNumber): number => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const steps: number[] = [profile.pairLimits.indexMiddle, profile.pairLimits.middleRing, profile.pairLimits.ringPinky];
  let sum = 0;
  for (let f = Math.max(1, lo); f < hi; f++) sum += steps[f - 1];
  return sum;
};

const clamp = (value: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, value));

export const profileFromCalibration = (answers: CalibrationAnswers): HandProfile => {
  const L = clamp(answers.scaleLengthMm, PROFILE_LIMITS.scaleLengthMm);
  const lowPinky = Math.round(clamp(answers.lowPinkyFret, CALIBRATION_LOW_PINKY_RANGE));
  const highPinky = Math.round(clamp(answers.highPinkyFret, CALIBRATION_HIGH_PINKY_RANGE));
  return {
    ...createDefaultHandProfile(L),
    reachAtLowMm: spanMm(CALIBRATION_LOW_INDEX_FRET, lowPinky, L),
    reachAtHighMm: spanMm(CALIBRATION_HIGH_INDEX_FRET, highPinky, L),
    stretchTolerance: answers.allowStretches ? STRETCH_TOLERANCE_ALLOW : 1,
    noBarre: answers.noBarre,
    allowOpenStrings: answers.allowOpenStrings,
    maxFret: Math.round(clamp(answers.maxFret, PROFILE_LIMITS.maxFret)),
    comfortableSixteenthBpm: Math.round(clamp(answers.comfortableSixteenthBpm, PROFILE_LIMITS.comfortableSixteenthBpm))
  };
};

/** Nearest calibration answers that reproduce a profile (for pre-filling the calibration form). */
export const calibrationFromProfile = (profile: HandProfile): CalibrationAnswers => {
  const nearestPinky = (indexFret: number, reach: number, [lo, hi]: readonly [number, number]): number => {
    let best = lo;
    for (let f = lo; f <= hi; f++) {
      if (Math.abs(spanMm(indexFret, f, profile.scaleLengthMm) - reach) < Math.abs(spanMm(indexFret, best, profile.scaleLengthMm) - reach)) {
        best = f;
      }
    }
    return best;
  };
  return {
    scaleLengthMm: profile.scaleLengthMm,
    lowPinkyFret: nearestPinky(CALIBRATION_LOW_INDEX_FRET, profile.reachAtLowMm, CALIBRATION_LOW_PINKY_RANGE),
    highPinkyFret: nearestPinky(CALIBRATION_HIGH_INDEX_FRET, profile.reachAtHighMm, CALIBRATION_HIGH_PINKY_RANGE),
    allowStretches: profile.stretchTolerance > 1,
    noBarre: profile.noBarre,
    allowOpenStrings: profile.allowOpenStrings,
    maxFret: profile.maxFret,
    comfortableSixteenthBpm: profile.comfortableSixteenthBpm
  };
};

const num = (value: unknown, fallback: number, range: readonly [number, number], integer = false): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = clamp(value, range);
  return integer ? Math.round(clamped) : clamped;
};

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/**
 * Sanitizes untrusted input (localStorage, imported JSON) into a valid profile.
 * Missing or invalid fields fall back to defaults; numbers are clamped to sane ranges.
 */
export const validateHandProfile = (input: unknown): HandProfile => {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const scaleLengthMm = num(raw.scaleLengthMm, DEFAULT_SCALE_LENGTH_MM, PROFILE_LIMITS.scaleLengthMm);
  const base = createDefaultHandProfile(scaleLengthMm);
  const pairsRaw = (typeof raw.pairLimits === 'object' && raw.pairLimits !== null ? raw.pairLimits : {}) as Record<string, unknown>;

  let lowRefFret = num(raw.lowRefFret, base.lowRefFret, PROFILE_LIMITS.refFret, true);
  let highRefFret = num(raw.highRefFret, base.highRefFret, PROFILE_LIMITS.refFret, true);
  if (highRefFret <= lowRefFret) {
    lowRefFret = base.lowRefFret;
    highRefFret = base.highRefFret;
  }

  return {
    version: 1,
    scaleLengthMm,
    reachAtLowMm: num(raw.reachAtLowMm, base.reachAtLowMm, PROFILE_LIMITS.reachMm),
    reachAtHighMm: num(raw.reachAtHighMm, base.reachAtHighMm, PROFILE_LIMITS.reachMm),
    lowRefFret,
    highRefFret,
    pairLimits: {
      indexMiddle: num(pairsRaw.indexMiddle, base.pairLimits.indexMiddle, PROFILE_LIMITS.pairLimit),
      middleRing: num(pairsRaw.middleRing, base.pairLimits.middleRing, PROFILE_LIMITS.pairLimit),
      ringPinky: num(pairsRaw.ringPinky, base.pairLimits.ringPinky, PROFILE_LIMITS.pairLimit)
    },
    stretchTolerance: num(raw.stretchTolerance, base.stretchTolerance, PROFILE_LIMITS.stretchTolerance),
    noBarre: bool(raw.noBarre, base.noBarre),
    allowTwoStringPartialBarre: bool(raw.allowTwoStringPartialBarre, base.allowTwoStringPartialBarre),
    allowThumb: bool(raw.allowThumb, base.allowThumb),
    maxFret: num(raw.maxFret, base.maxFret, PROFILE_LIMITS.maxFret, true),
    allowOpenStrings: bool(raw.allowOpenStrings, base.allowOpenStrings),
    maxInteriorMutes: num(raw.maxInteriorMutes, base.maxInteriorMutes, PROFILE_LIMITS.maxInteriorMutes, true),
    comfortableSixteenthBpm: num(raw.comfortableSixteenthBpm, base.comfortableSixteenthBpm, PROFILE_LIMITS.comfortableSixteenthBpm, true)
  };
};

/**
 * Upgrades any stored shape to the current version. Version 1 is the first version, so today this
 * only sanitizes; unknown future versions are treated as untrusted input.
 */
export const migrateHandProfile = (raw: unknown): HandProfile => validateHandProfile(raw);

/** Stable key for memoizing generation per profile. */
export const handProfileHash = (profile: HandProfile): string => {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return [
    profile.version,
    r(profile.scaleLengthMm),
    r(profile.reachAtLowMm),
    r(profile.reachAtHighMm),
    profile.lowRefFret,
    profile.highRefFret,
    r(profile.pairLimits.indexMiddle),
    r(profile.pairLimits.middleRing),
    r(profile.pairLimits.ringPinky),
    r(profile.stretchTolerance),
    profile.noBarre ? 1 : 0,
    profile.allowTwoStringPartialBarre ? 1 : 0,
    profile.allowThumb ? 1 : 0,
    profile.maxFret,
    profile.allowOpenStrings ? 1 : 0,
    profile.maxInteriorMutes,
    profile.comfortableSixteenthBpm
  ].join('|');
};
