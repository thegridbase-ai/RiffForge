import type { Tuning } from './types';

export const E_STANDARD: Tuning = { id: 'e-standard', name: 'E Standard', openMidi: [40, 45, 50, 55, 59, 64] };
export const DROP_D: Tuning = { id: 'drop-d', name: 'Drop D', openMidi: [38, 45, 50, 55, 59, 64] };
export const D_STANDARD: Tuning = { id: 'd-standard', name: 'D Standard', openMidi: [38, 43, 48, 53, 57, 62] };
export const DROP_C: Tuning = { id: 'drop-c', name: 'Drop C', openMidi: [36, 43, 48, 53, 57, 62] };
export const C_STANDARD: Tuning = { id: 'c-standard', name: 'C Standard', openMidi: [36, 41, 46, 51, 55, 60] };

export const TUNING_PRESETS: readonly Tuning[] = [E_STANDARD, DROP_D, D_STANDARD, DROP_C, C_STANDARD];

export const MIN_STRINGS = 4;
export const MAX_STRINGS = 8;

export const getTuning = (id: string): Tuning | undefined => TUNING_PRESETS.find((t) => t.id === id);

/** Narrow with `v.ok === false`: without `strictNullChecks` (the apps' setting) `!v.ok` does not narrow. */
export type TuningValidation = { ok: true } | { ok: false; reason: string };

/** Strings must be integer MIDI notes in 0..127, strictly ascending from string 0 (lowest). */
export const validateTuning = (tuning: Tuning): TuningValidation => {
  const { openMidi } = tuning;
  if (!Array.isArray(openMidi)) return { ok: false, reason: 'openMidi must be an array' };
  if (openMidi.length < MIN_STRINGS || openMidi.length > MAX_STRINGS) {
    return { ok: false, reason: `expected ${MIN_STRINGS}..${MAX_STRINGS} strings, got ${openMidi.length}` };
  }
  for (let s = 0; s < openMidi.length; s++) {
    const m = openMidi[s];
    if (!Number.isInteger(m) || m < 0 || m > 127) return { ok: false, reason: `string ${s} is not a MIDI note` };
    if (s > 0 && m <= openMidi[s - 1]) {
      return { ok: false, reason: `string ${s} must be higher than string ${s - 1}` };
    }
  }
  return { ok: true };
};

export const stringCount = (tuning: Tuning): number => tuning.openMidi.length;
