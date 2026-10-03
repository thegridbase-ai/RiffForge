import { describe, it, expect } from 'vitest';
import * as engine from './index';

describe('engine barrel', () => {
  it('exposes the version and the main entry points', () => {
    expect(engine.ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    for (const name of [
      'shapeToMidi',
      'findBestFingering',
      'generateVoicings',
      'findClosestVoicing',
      'optimizeSequence',
      'fromLegacyNotes',
      'nameVoicing',
      'DEFAULT_HAND_PROFILE'
    ]) {
      expect(engine).toHaveProperty(name);
    }
  });

  it('runs one generation end to end', () => {
    const result = engine.generateVoicings({
      root: 'E',
      family: 'power5',
      tuning: engine.E_STANDARD,
      profile: engine.DEFAULT_HAND_PROFILE
    });
    expect(result.voicings.length).toBeGreaterThan(0);
    const first = result.voicings[0];
    expect(first.midi).toEqual(engine.shapeToMidi(first.shape, engine.E_STANDARD));
  });
});
