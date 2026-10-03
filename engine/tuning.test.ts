import { describe, it, expect } from 'vitest';
import { E_STANDARD, DROP_D, D_STANDARD, DROP_C, C_STANDARD, TUNING_PRESETS, getTuning, validateTuning } from './tuning';
import { midiToName } from './pitch';

describe('tuning presets', () => {
  it('defines the documented open strings low -> high', () => {
    expect(E_STANDARD.openMidi).toEqual([40, 45, 50, 55, 59, 64]);
    expect(DROP_D.openMidi).toEqual([38, 45, 50, 55, 59, 64]);
    expect(D_STANDARD.openMidi.map(midiToName)).toEqual(['D2', 'G2', 'C3', 'F3', 'A3', 'D4']);
    expect(DROP_C.openMidi.map(midiToName)).toEqual(['C2', 'G2', 'C3', 'F3', 'A3', 'D4']);
    expect(C_STANDARD.openMidi.map(midiToName)).toEqual(['C2', 'F2', 'A#2', 'D#3', 'G3', 'C4']);
  });

  it('validates every preset and resolves ids', () => {
    for (const t of TUNING_PRESETS) {
      expect(validateTuning(t)).toEqual({ ok: true });
      expect(getTuning(t.id)).toBe(t);
    }
    expect(getTuning('nope')).toBeUndefined();
  });
});

describe('validateTuning', () => {
  it('rejects non-ascending, out-of-range and wrong-length tunings', () => {
    expect(validateTuning({ id: 'a', name: 'a', openMidi: [40, 40, 50, 55, 59, 64] }).ok).toBe(false);
    expect(validateTuning({ id: 'b', name: 'b', openMidi: [40, 45, 50, 55, 59, 128] }).ok).toBe(false);
    expect(validateTuning({ id: 'c', name: 'c', openMidi: [40, 45, 50] }).ok).toBe(false);
    expect(validateTuning({ id: 'd', name: 'd', openMidi: [40.5, 45, 50, 55, 59, 64] }).ok).toBe(false);
  });

  it('names the problem in the rejection, readable through the ok === false narrowing', () => {
    const short = validateTuning({ id: 'c', name: 'c', openMidi: [40, 45, 50] });
    const flat = validateTuning({ id: 'a', name: 'a', openMidi: [40, 40, 50, 55, 59, 64] });
    expect(short.ok === false && short.reason).toBe('expected 4..8 strings, got 3');
    expect(flat.ok === false && flat.reason).toBe('string 1 must be higher than string 0');
  });

  it('accepts other string counts within 4..8', () => {
    expect(validateTuning({ id: 'bass', name: 'Bass', openMidi: [28, 33, 38, 43] }).ok).toBe(true);
    expect(validateTuning({ id: '7', name: '7-string', openMidi: [35, 40, 45, 50, 55, 59, 64] }).ok).toBe(true);
  });
});
