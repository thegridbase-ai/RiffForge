import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HAND_PROFILE,
  DEFAULT_CALIBRATION,
  createDefaultHandProfile,
  maxReachMm,
  allowedSpanMm,
  pairLimitFraction,
  profileFromCalibration,
  calibrationFromProfile,
  validateHandProfile,
  migrateHandProfile,
  handProfileHash
} from './handProfile';
import { spanMm, DEFAULT_SCALE_LENGTH_MM } from './geometry';

const L = DEFAULT_SCALE_LENGTH_MM;

describe('default profile', () => {
  it('uses the documented defaults', () => {
    const p = DEFAULT_HAND_PROFILE;
    expect(p.scaleLengthMm).toBeCloseTo(647.7, 6);
    expect(p.reachAtLowMm).toBeCloseTo(spanMm(1, 4, L), 6);
    expect(p.reachAtHighMm).toBeCloseTo(spanMm(7, 11, L), 6);
    expect(p.lowRefFret).toBe(1);
    expect(p.highRefFret).toBe(7);
    expect(p.pairLimits).toEqual({ indexMiddle: 0.65, middleRing: 0.35, ringPinky: 0.4 });
    expect(p.stretchTolerance).toBe(1);
    expect(p.noBarre).toBe(true);
    expect(p.allowTwoStringPartialBarre).toBe(false);
    expect(p.allowThumb).toBe(false);
    expect(p.maxFret).toBe(15);
    expect(p.allowOpenStrings).toBe(true);
    expect(p.maxInteriorMutes).toBe(1);
    expect(p.comfortableSixteenthBpm).toBe(110);
  });

  it('matches the default calibration answers', () => {
    expect(profileFromCalibration(DEFAULT_CALIBRATION)).toEqual(DEFAULT_HAND_PROFILE);
  });
});

describe('maxReachMm', () => {
  const p = DEFAULT_HAND_PROFILE;

  it('returns the calibration points exactly', () => {
    expect(maxReachMm(p, 1)).toBeCloseTo(p.reachAtLowMm, 9);
    expect(maxReachMm(p, 7)).toBeCloseTo(p.reachAtHighMm, 9);
  });

  it('interpolates linearly in between', () => {
    expect(maxReachMm(p, 4)).toBeCloseTo((p.reachAtLowMm + p.reachAtHighMm) / 2, 9);
  });

  it('clamps outside the calibration range', () => {
    expect(maxReachMm(p, 0)).toBe(p.reachAtLowMm);
    expect(maxReachMm(p, 15)).toBe(p.reachAtHighMm);
  });

  it('applies the stretch tolerance to the allowed span', () => {
    const stretchy = { ...p, stretchTolerance: 1.1 };
    expect(allowedSpanMm(stretchy, 1)).toBeCloseTo(p.reachAtLowMm * 1.1, 9);
  });
});

describe('pairLimitFraction', () => {
  it('uses adjacent limits and sums across skipped fingers', () => {
    const p = DEFAULT_HAND_PROFILE;
    expect(pairLimitFraction(p, 1, 2)).toBeCloseTo(0.65, 9);
    expect(pairLimitFraction(p, 2, 3)).toBeCloseTo(0.35, 9);
    expect(pairLimitFraction(p, 3, 4)).toBeCloseTo(0.4, 9);
    expect(pairLimitFraction(p, 1, 3)).toBeCloseTo(1.0, 9);
    expect(pairLimitFraction(p, 4, 1)).toBeCloseTo(1.4, 9);
  });
});

describe('calibration', () => {
  it('converts pinky answers to mm reach', () => {
    const p = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 5, highPinkyFret: 12, allowStretches: true });
    expect(p.reachAtLowMm).toBeCloseTo(spanMm(1, 5, L), 9);
    expect(p.reachAtHighMm).toBeCloseTo(spanMm(7, 12, L), 9);
    expect(p.stretchTolerance).toBe(1.1);
  });

  it('clamps answers to their documented ranges', () => {
    const p = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 1, highPinkyFret: 20 });
    expect(p.reachAtLowMm).toBeCloseTo(spanMm(1, 3, L), 9);
    expect(p.reachAtHighMm).toBeCloseTo(spanMm(7, 13, L), 9);
  });

  it('round-trips through calibrationFromProfile', () => {
    const answers = { ...DEFAULT_CALIBRATION, lowPinkyFret: 6, highPinkyFret: 10, maxFret: 12 };
    expect(calibrationFromProfile(profileFromCalibration(answers))).toEqual(answers);
  });

  it('scales reach with scale length', () => {
    const baritone = profileFromCalibration({ ...DEFAULT_CALIBRATION, scaleLengthMm: 27 * 25.4 });
    expect(baritone.reachAtLowMm).toBeGreaterThan(DEFAULT_HAND_PROFILE.reachAtLowMm);
  });
});

describe('validateHandProfile', () => {
  it('falls back to defaults for garbage', () => {
    expect(validateHandProfile(null)).toEqual(DEFAULT_HAND_PROFILE);
    expect(validateHandProfile('nope')).toEqual(DEFAULT_HAND_PROFILE);
    expect(validateHandProfile({ reachAtLowMm: 'far', noBarre: 'yes' })).toEqual(DEFAULT_HAND_PROFILE);
  });

  it('clamps out-of-range numbers and keeps valid fields', () => {
    const p = validateHandProfile({ ...DEFAULT_HAND_PROFILE, maxFret: 99, maxInteriorMutes: -3, noBarre: false });
    expect(p.maxFret).toBe(24);
    expect(p.maxInteriorMutes).toBe(0);
    expect(p.noBarre).toBe(false);
  });

  it('repairs inverted reference frets', () => {
    const p = validateHandProfile({ ...DEFAULT_HAND_PROFILE, lowRefFret: 9, highRefFret: 3 });
    expect(p.lowRefFret).toBe(1);
    expect(p.highRefFret).toBe(7);
  });

  it('migrates version-less stored data', () => {
    const { version: _v, ...legacy } = createDefaultHandProfile();
    expect(migrateHandProfile(legacy)).toEqual(DEFAULT_HAND_PROFILE);
  });
});

describe('handProfileHash', () => {
  it('is stable and changes when a relevant field changes', () => {
    expect(handProfileHash(DEFAULT_HAND_PROFILE)).toBe(handProfileHash(createDefaultHandProfile()));
    expect(handProfileHash({ ...DEFAULT_HAND_PROFILE, maxFret: 12 })).not.toBe(handProfileHash(DEFAULT_HAND_PROFILE));
  });
});
