import type { RhythmPattern, RhythmValidation, RhythmWarning } from '../types';
import { DEFAULT_HAND_PROFILE } from '../handProfile';
import { PPQ, barTicks, firstBeatTicks } from './grid';
import { assignPicks } from './picking';
import { isSlotTarget, sameTarget } from './events';

export interface RhythmValidateOptions {
  /** Playback tempo; without it the tooFastForProfile check is skipped. */
  bpm?: number;
  /** Defaults to the default hand profile's value. */
  comfortableSixteenthBpm?: number;
}

const MAX_PICK_ERRORS = 3;

export const validateRhythm = (pattern: RhythmPattern, opts: RhythmValidateOptions = {}): RhythmValidation => {
  const errors: string[] = [];
  const { meter, bars, params, events } = pattern;

  if (!Number.isInteger(meter.numerator) || meter.numerator < 1 || (meter.denominator !== 4 && meter.denominator !== 8)) {
    return { ok: false, errors: [`invalid meter ${meter.numerator}/${meter.denominator}`], warnings: [] };
  }
  if (!Number.isInteger(bars) || bars < 1) return { ok: false, errors: [`invalid bar count ${bars}`], warnings: [] };
  if (pattern.ppq !== PPQ) errors.push(`ppq must be ${PPQ}`);
  if (params.bars !== bars || params.meter.numerator !== meter.numerator || params.meter.denominator !== meter.denominator) {
    errors.push('pattern length differs from params: bars and meter must match params');
  }

  const bar = barTicks(meter);
  const length = bars * bar;
  events.forEach((e, i) => {
    const at = `event ${i} (tick ${e.tick})`;
    if (!Number.isInteger(e.tick) || e.tick < 0) errors.push(`${at}: tick must be a non-negative integer`);
    if (!(e.durationTicks > 0)) errors.push(`${at}: duration must be > 0`);
    if (e.tick + e.durationTicks > length) errors.push(`${at}: ends beyond the pattern length ${length}`);
    if (e.accent !== 0 && e.accent !== 1 && e.accent !== 2) errors.push(`${at}: accent must be 0, 1 or 2`);
    if (isSlotTarget(e.target)) {
      const { slot } = e.target;
      if (!Number.isInteger(slot) || slot < 0 || slot >= params.slotCount) {
        errors.push(`${at}: slot ${slot} outside slotCount ${params.slotCount}`);
      }
    }
    if (i > 0) {
      const prev = events[i - 1];
      if (e.tick <= prev.tick) errors.push(`${at}: ticks not sorted (previous ${prev.tick})`);
      else if (prev.tick + prev.durationTicks > e.tick) errors.push(`${at}: overlaps the previous event`);
    }
    if (e.tie) {
      const prev = events[i - 1];
      if (!prev) errors.push(`${at}: tie as first event`);
      else if (prev.tick + prev.durationTicks !== e.tick) errors.push(`${at}: tie does not continue the previous event`);
      else if (!sameTarget(prev.target, e.target)) errors.push(`${at}: tie target differs from the previous event`);
    }
  });

  const expected = assignPicks(events, params.picking, bar);
  const wrongPicks = events.flatMap((e, i) => (e.pick === expected[i] ? [] : [i]));
  wrongPicks.slice(0, MAX_PICK_ERRORS).forEach((i) => {
    errors.push(`event ${i} (tick ${events[i].tick}): pick ${events[i].pick} inconsistent with ${params.picking} picking (expected ${expected[i]})`);
  });
  if (wrongPicks.length > MAX_PICK_ERRORS) errors.push(`${wrongPicks.length - MAX_PICK_ERRORS} more pick errors`);

  if (!params.anticipation && !events.some((e) => !e.tie && e.tick < firstBeatTicks(meter))) {
    errors.push('no attack in the first beat (set anticipation to allow a pickup feel)');
  }

  return { ok: errors.length === 0, errors, warnings: speedWarnings(pattern, opts) };
};

/**
 * notesPerBeat = 480 / minIoi is compared with the comfortable rate 4 * comfortableSixteenthBpm / bpm.
 * Compared without division to avoid float edges: warn when 480 * bpm > 4 * comfortable * minIoi.
 */
const speedWarnings = (pattern: RhythmPattern, opts: RhythmValidateOptions): RhythmWarning[] => {
  const { bpm } = opts;
  if (bpm === undefined || !(bpm > 0)) return [];
  const comfortable = opts.comfortableSixteenthBpm ?? DEFAULT_HAND_PROFILE.comfortableSixteenthBpm;
  const onsets = pattern.events.filter((e) => !e.tie).map((e) => e.tick);
  if (onsets.length < 2) return [];
  let minIoi = Infinity;
  for (let i = 1; i < onsets.length; i++) minIoi = Math.min(minIoi, onsets[i] - onsets[i - 1]);
  if (!(minIoi > 0) || PPQ * bpm <= 4 * comfortable * minIoi) return [];
  const bpmLimit = Math.floor((4 * comfortable * minIoi) / PPQ);
  const notesPerBeat = PPQ / minIoi;
  return [
    {
      code: 'tooFastForProfile',
      message: `The fastest notes come ${Number(notesPerBeat.toFixed(2))} per beat; above ${bpmLimit} BPM that is faster than your comfortable 16th tempo of ${comfortable} BPM.`,
      minIoiTicks: minIoi,
      bpmLimit
    }
  ];
};
