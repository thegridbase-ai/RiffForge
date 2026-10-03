import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HAND_PROFILE_STORAGE_KEY, parseCalibration } from './handProfileStore';
import type { ImportProfileResult } from './handProfileStore';
import {
  DEFAULT_CALIBRATION,
  DEFAULT_HAND_PROFILE,
  STRETCH_TOLERANCE_ALLOW,
  calibrationFromProfile,
  profileFromCalibration
} from '../engine/handProfile';
import { spanMm } from '../engine/geometry';

// Minimal in-memory localStorage for the node test environment
const createStorageMock = () => {
  let data: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = String(value); },
    removeItem: (key: string) => { delete data[key]; },
    clear: () => { data = {}; },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; }
  } as Storage;
};

const freshStore = async () => {
  vi.resetModules();
  const mod = await import('./handProfileStore');
  return mod.useHandProfileStore;
};

const stored = () => JSON.parse(localStorage.getItem(HAND_PROFILE_STORAGE_KEY) ?? 'null');

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', createStorageMock());
});

describe('handProfileStore', () => {
  it('starts from the defaults when nothing is stored', async () => {
    const store = await freshStore();
    const { profile, calibration } = store.getState();
    expect(profile).toEqual(DEFAULT_HAND_PROFILE);
    expect(calibration).toEqual(DEFAULT_CALIBRATION);
    // The default answers reproduce the default profile exactly
    expect(profileFromCalibration(calibration)).toEqual(DEFAULT_HAND_PROFILE);
  });

  it('falls back to the defaults without localStorage', async () => {
    vi.stubGlobal('localStorage', undefined);
    const store = await freshStore();
    expect(store.getState().profile).toEqual(DEFAULT_HAND_PROFILE);
    // Writes must not throw either
    expect(() => store.getState().setCalibration({ lowPinkyFret: 3 })).not.toThrow();
  });

  it('falls back to the defaults when storage access throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); }
    });
    const store = await freshStore();
    expect(store.getState().profile).toEqual(DEFAULT_HAND_PROFILE);
    expect(() => store.getState().setCalibration({ maxFret: 12 })).not.toThrow();
    expect(store.getState().profile.maxFret).toBe(12);
  });

  it('persists calibration changes and reloads them', async () => {
    const store = await freshStore();
    store.getState().setCalibration({ lowPinkyFret: 5, allowStretches: true, maxFret: 12 });

    const saved = stored();
    expect(saved.version).toBe(1);
    expect(saved.calibration.lowPinkyFret).toBe(5);
    expect(saved.profile.maxFret).toBe(12);

    const reloaded = await freshStore();
    expect(reloaded.getState().calibration).toEqual(store.getState().calibration);
    expect(reloaded.getState().profile).toEqual(store.getState().profile);
  });

  it('setCalibration rebuilds the profile from the merged answers', async () => {
    const store = await freshStore();
    store.getState().setCalibration({ lowPinkyFret: 3 });
    const { profile, calibration } = store.getState();

    expect(calibration).toEqual({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3 });
    expect(profile.reachAtLowMm).toBeCloseTo(spanMm(1, 3, DEFAULT_CALIBRATION.scaleLengthMm), 6);
    expect(profile.reachAtLowMm).toBeLessThan(DEFAULT_HAND_PROFILE.reachAtLowMm);
    // Untouched answers survive the patch
    expect(profile.reachAtHighMm).toBeCloseTo(DEFAULT_HAND_PROFILE.reachAtHighMm, 6);

    store.getState().setCalibration({ allowStretches: true, allowOpenStrings: false, noBarre: false });
    expect(store.getState().profile.stretchTolerance).toBe(STRETCH_TOLERANCE_ALLOW);
    expect(store.getState().profile.allowOpenStrings).toBe(false);
    expect(store.getState().profile.noBarre).toBe(false);
    expect(store.getState().calibration.lowPinkyFret).toBe(3);
  });

  it('resetProfile restores and persists the defaults', async () => {
    const store = await freshStore();
    store.getState().setCalibration({ lowPinkyFret: 7, highPinkyFret: 13, comfortableSixteenthBpm: 200 });
    store.getState().resetProfile();
    expect(store.getState().profile).toEqual(DEFAULT_HAND_PROFILE);
    expect(store.getState().calibration).toEqual(DEFAULT_CALIBRATION);
    expect(stored().calibration).toEqual(DEFAULT_CALIBRATION);
  });

  it.each([
    ['invalid JSON', '{not json'],
    ['a number', '42'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['a wrapper without a profile', JSON.stringify({ version: 1, calibration: DEFAULT_CALIBRATION })],
    ['a string profile', JSON.stringify({ version: 1, profile: 'wide' })]
  ])('falls back to the defaults for corrupt storage: %s', async (_label, raw) => {
    localStorage.setItem(HAND_PROFILE_STORAGE_KEY, raw);
    const store = await freshStore();
    expect(store.getState().profile).toEqual(DEFAULT_HAND_PROFILE);
    expect(store.getState().calibration).toEqual(DEFAULT_CALIBRATION);
  });

  it('sanitizes a stored profile and rebuilds an invalid calibration from it', async () => {
    const wide = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 6, highPinkyFret: 12 });
    localStorage.setItem(
      HAND_PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        calibration: { ...DEFAULT_CALIBRATION, lowPinkyFret: 'six' },
        profile: { ...wide, maxFret: 999, noBarre: 'yes' }
      })
    );
    const store = await freshStore();
    const { profile, calibration } = store.getState();
    expect(profile.maxFret).toBe(24);
    expect(profile.noBarre).toBe(true);
    expect(profile.reachAtLowMm).toBeCloseTo(wide.reachAtLowMm, 6);
    expect(calibration).toEqual(calibrationFromProfile(profile));
    expect(calibration.lowPinkyFret).toBe(6);
    expect(calibration.highPinkyFret).toBe(12);
  });

  it('exports a wrapper and imports it back (round trip)', async () => {
    const store = await freshStore();
    store.getState().setCalibration({ lowPinkyFret: 6, highPinkyFret: 12, scaleLengthMm: 27 * 25.4, allowStretches: true });
    const exportedProfile = store.getState().profile;
    const json = store.getState().exportProfileJson();

    const parsed = JSON.parse(json);
    expect(parsed.app).toBe('riffforge');
    expect(parsed.version).toBe(1);
    expect(parsed.profile).toEqual(exportedProfile);
    expect(json).toContain('\n  '); // pretty printed

    store.getState().resetProfile();
    expect(store.getState().importProfileJson(json)).toEqual({ ok: true });
    expect(store.getState().profile).toEqual(exportedProfile);
    expect(store.getState().calibration).toEqual(calibrationFromProfile(exportedProfile));
    expect(stored().profile).toEqual(exportedProfile);
  });

  it('imports a bare profile object', async () => {
    const store = await freshStore();
    const narrow = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3 });
    expect(store.getState().importProfileJson(JSON.stringify(narrow))).toEqual({ ok: true });
    expect(store.getState().profile).toEqual(narrow);
    expect(store.getState().calibration.lowPinkyFret).toBe(3);
  });

  it.each([
    ['empty text', ''],
    ['invalid JSON', '{"profile": '],
    ['a number', '7'],
    ['null', 'null'],
    ['an array', '[]'],
    ['an unrelated object', JSON.stringify({ hello: 'world' })],
    ['a wrapper with garbage', JSON.stringify({ app: 'riffforge', version: 1, profile: { reachAtLowMm: 'far' } })]
  ])('import rejects %s without throwing or changing the profile', async (_label, text) => {
    const store = await freshStore();
    store.getState().setCalibration({ lowPinkyFret: 5 });
    const before = store.getState().profile;

    const run = (): ImportProfileResult => store.getState().importProfileJson(text);
    expect(run).not.toThrow();
    const result = run();
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error.length).toBeGreaterThan(0);
    expect(store.getState().profile).toBe(before);
  });
});

describe('parseCalibration', () => {
  it('accepts complete answers and rejects missing or out-of-range ones', () => {
    expect(parseCalibration(DEFAULT_CALIBRATION)).toEqual(DEFAULT_CALIBRATION);
    expect(parseCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 9 })).toBeNull();
    expect(parseCalibration({ ...DEFAULT_CALIBRATION, highPinkyFret: 10.5 })).toBeNull();
    expect(parseCalibration({ ...DEFAULT_CALIBRATION, scaleLengthMm: 100 })).toBeNull();
    const { noBarre: _omit, ...missing } = DEFAULT_CALIBRATION;
    expect(parseCalibration(missing)).toBeNull();
    expect(parseCalibration(null)).toBeNull();
  });
});
