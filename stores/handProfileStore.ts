import { create } from 'zustand';
import type { CalibrationAnswers, HandProfile } from '../engine/types';
import {
  CALIBRATION_HIGH_PINKY_RANGE,
  CALIBRATION_LOW_PINKY_RANGE,
  DEFAULT_CALIBRATION,
  PROFILE_LIMITS,
  calibrationFromProfile,
  createDefaultHandProfile,
  migrateHandProfile,
  profileFromCalibration,
  validateHandProfile
} from '../engine/handProfile';

export const HAND_PROFILE_STORAGE_KEY = 'riffforge:hand-profile:v1';
export const HAND_PROFILE_EXPORT_APP = 'riffforge';

export type ImportProfileResult = { ok: true } | { ok: false; error: string };

interface HandProfileState {
  profile: HandProfile;
  calibration: CalibrationAnswers;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumberIn = (value: unknown, [lo, hi]: readonly [number, number], integer = false): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi && (!integer || Number.isInteger(value));

/** Stored calibration answers, or null when any field is missing or out of range. */
export const parseCalibration = (value: unknown): CalibrationAnswers | null => {
  if (!isRecord(value)) return null;
  const { scaleLengthMm, lowPinkyFret, highPinkyFret, allowStretches, noBarre, allowOpenStrings, maxFret, comfortableSixteenthBpm } = value;
  if (
    !isNumberIn(scaleLengthMm, PROFILE_LIMITS.scaleLengthMm) ||
    !isNumberIn(lowPinkyFret, CALIBRATION_LOW_PINKY_RANGE, true) ||
    !isNumberIn(highPinkyFret, CALIBRATION_HIGH_PINKY_RANGE, true) ||
    typeof allowStretches !== 'boolean' ||
    typeof noBarre !== 'boolean' ||
    typeof allowOpenStrings !== 'boolean' ||
    !isNumberIn(maxFret, PROFILE_LIMITS.maxFret, true) ||
    !isNumberIn(comfortableSixteenthBpm, PROFILE_LIMITS.comfortableSixteenthBpm, true)
  ) {
    return null;
  }
  return { scaleLengthMm, lowPinkyFret, highPinkyFret, allowStretches, noBarre, allowOpenStrings, maxFret, comfortableSixteenthBpm };
};

const defaults = (): HandProfileState => ({ profile: createDefaultHandProfile(), calibration: { ...DEFAULT_CALIBRATION } });

/** Reads `{ version, calibration, profile }` from storage; anything unreadable falls back to the defaults. */
const loadState = (): HandProfileState => {
  try {
    if (typeof localStorage === 'undefined') return defaults();
    const raw = localStorage.getItem(HAND_PROFILE_STORAGE_KEY);
    if (!raw) return defaults();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.profile)) return defaults();
    const profile = migrateHandProfile(parsed.profile);
    return { profile, calibration: parseCalibration(parsed.calibration) ?? calibrationFromProfile(profile) };
  } catch {
    return defaults();
  }
};

const saveState = ({ profile, calibration }: HandProfileState): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(HAND_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, calibration, profile }));
  } catch {
    // Storage unavailable (private mode, quota): the profile stays in memory only
  }
};

/** The core fields a hand profile must carry before the rest is sanitized; rejects unrelated JSON. */
const looksLikeProfile = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  typeof value.scaleLengthMm === 'number' && Number.isFinite(value.scaleLengthMm) &&
  typeof value.reachAtLowMm === 'number' && Number.isFinite(value.reachAtLowMm) &&
  typeof value.reachAtHighMm === 'number' && Number.isFinite(value.reachAtHighMm);

interface HandProfileStore extends HandProfileState {
  setCalibration: (patch: Partial<CalibrationAnswers>) => void;
  resetProfile: () => void;
  exportProfileJson: () => string;
  importProfileJson: (text: string) => ImportProfileResult;
}

const initial = loadState();

export const useHandProfileStore = create<HandProfileStore>((set, get) => ({
  profile: initial.profile,
  calibration: initial.calibration,

  setCalibration: (patch) => {
    const calibration = { ...get().calibration, ...patch };
    const next = { calibration, profile: profileFromCalibration(calibration) };
    saveState(next);
    set(next);
  },

  resetProfile: () => {
    const next = defaults();
    saveState(next);
    set(next);
  },

  exportProfileJson: () => JSON.stringify({ app: HAND_PROFILE_EXPORT_APP, version: 1, profile: get().profile }, null, 2),

  importProfileJson: (text) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'Not valid JSON.' };
    }
    const candidate = isRecord(parsed) && isRecord(parsed.profile) ? parsed.profile : parsed;
    if (!looksLikeProfile(candidate)) {
      return { ok: false, error: 'This JSON is not a hand profile (scale length and reach values are missing).' };
    }
    const profile = validateHandProfile(candidate);
    const next = { profile, calibration: calibrationFromProfile(profile) };
    saveState(next);
    set(next);
    return { ok: true };
  }
}));
