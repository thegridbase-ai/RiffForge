// Grid-editing helpers for the UI. `unit` = grid unit index from the pattern start in the pattern's grid.
// Every helper returns a new, valid pattern and never mutates its input; an invalid request returns an
// unchanged copy.
import type { HitTarget, RhythmEvent, RhythmPattern } from '../types';
import { PPQ, gridUnitTicks, patternLengthTicks, patternUnitCount } from './grid';
import {
  copyEvent,
  finalizeEvents,
  finalizeOptions,
  hasFirstBeatAttack,
  isSlotTarget,
  makeEvent,
  sameTarget
} from './events';

const unitTick = (pattern: RhythmPattern, unit: number): number | null =>
  Number.isInteger(unit) && unit >= 0 && unit < patternUnitCount(pattern) ? unit * gridUnitTicks(pattern.params.grid) : null;

const isUsableTarget = (pattern: RhythmPattern, target: HitTarget): boolean => {
  if (isSlotTarget(target)) return Number.isInteger(target.slot) && target.slot >= 0 && target.slot < pattern.params.slotCount;
  return target.kind === 'pedal' || target.kind === 'dead';
};

/**
 * Re-derives durations, ties and picks. Emptying the first beat by hand switches params.anticipation on,
 * since the player has deliberately made a pickup.
 */
const rebuild = (pattern: RhythmPattern, events: readonly RhythmEvent[]): RhythmPattern => {
  const finalized = finalizeEvents(events, finalizeOptions(pattern));
  const anticipation = pattern.params.anticipation || !hasFirstBeatAttack(finalized, pattern);
  return {
    ...pattern,
    events: finalized,
    tags: [...pattern.tags],
    params: anticipation === pattern.params.anticipation ? pattern.params : { ...pattern.params, anticipation }
  };
};

/**
 * Events whose onset lies in this grid cell, in pattern order: usually one, two in a 32nd tremolo cell
 * (32nds between units belong to the cell they start in).
 */
export const eventsInUnit = (pattern: RhythmPattern, unit: number): RhythmEvent[] => {
  const tick = unitTick(pattern, unit);
  if (tick === null) return [];
  const end = tick + gridUnitTicks(pattern.params.grid);
  return pattern.events.filter((e) => e.tick >= tick && e.tick < end);
};

/** First event of this grid cell (see eventsInUnit). */
export const eventAtUnit = (pattern: RhythmPattern, unit: number): RhythmEvent | undefined => eventsInUnit(pattern, unit)[0];

/** Pedal hits added by hand follow the style's palm-mute habit. Heuristic. */
const defaultPalmMute = (pattern: RhythmPattern, target: HitTarget): boolean =>
  target.kind === 'pedal' && pattern.params.palmMuteRatio >= 0.5;

/**
 * Edits address whole grid cells. Empty cell: adds an unaccented attack ringing until the next event, at
 * most one quarter note; ties right after it sustained the event it interrupts and are dropped, so the new
 * hit never inherits that sound. Same target as the cell's first event (attack or tie): clears the cell.
 * Different target: retargets every attack in the cell (keeping accent, palm mute and length) and turns a
 * leading tie into a fresh attack. Ties after a changed event follow its new target; ties left without a
 * source are dropped.
 */
export const toggleHit = (pattern: RhythmPattern, unit: number, target: HitTarget): RhythmPattern => {
  const tick = unitTick(pattern, unit);
  if (tick === null || !isUsableTarget(pattern, target)) return rebuild(pattern, pattern.events);
  const cell = new Set(eventsInUnit(pattern, unit));
  const events = pattern.events.map(copyEvent);
  const indices = pattern.events.flatMap((e, i) => (cell.has(e) ? [i] : []));
  if (indices.length === 0) {
    const nextIndex = pattern.events.findIndex((e) => e.tick > tick);
    const length = patternLengthTicks(pattern);
    const end = Math.min(nextIndex >= 0 ? pattern.events[nextIndex].tick : length, tick + PPQ, length);
    let stop = nextIndex;
    while (stop >= 0 && stop < events.length && events[stop].tie) stop++;
    const kept = nextIndex < 0 ? events : [...events.slice(0, nextIndex), ...events.slice(stop)];
    return rebuild(pattern, [...kept, makeEvent(tick, end - tick, target, defaultPalmMute(pattern, target), 0)]);
  }
  if (sameTarget(events[indices[0]].target, target)) {
    return rebuild(pattern, events.filter((_, i) => !indices.includes(i)));
  }
  indices.forEach((i, k) => {
    const e = events[i];
    if (!e.tie) {
      events[i] = makeEvent(e.tick, e.durationTicks, target, target.kind === 'dead' ? false : e.palmMute, e.accent);
    } else if (k === 0) {
      events[i] = makeEvent(e.tick, e.durationTicks, target, defaultPalmMute(pattern, target), 0);
    }
  });
  return rebuild(pattern, events);
};

/** 0 -> 1 -> 2 -> 0 on the cell's first event when it is an attack; ties and empty cells are left alone. */
export const cycleAccent = (pattern: RhythmPattern, unit: number): RhythmPattern => {
  const target = eventAtUnit(pattern, unit);
  if (!target || target.tie) return rebuild(pattern, pattern.events);
  return rebuild(
    pattern,
    pattern.events.map((e) => (e === target ? { ...copyEvent(e), accent: ((e.accent + 1) % 3) as 0 | 1 | 2 } : copyEvent(e)))
  );
};

/**
 * Flips palm mute on the cell's first attack and sets every other attack in the cell to match; a cell that
 * starts with a dead note or a tie, and an empty cell, is left alone (dead notes are never palm-muted).
 */
export const togglePalmMute = (pattern: RhythmPattern, unit: number): RhythmPattern => {
  const first = eventAtUnit(pattern, unit);
  if (!first || first.tie || first.target.kind === 'dead') return rebuild(pattern, pattern.events);
  const cell = new Set(eventsInUnit(pattern, unit));
  const value = !first.palmMute;
  return rebuild(
    pattern,
    pattern.events.map((e) =>
      cell.has(e) && !e.tie && e.target.kind !== 'dead' ? { ...copyEvent(e), palmMute: value } : copyEvent(e)
    )
  );
};

/** Removes every event of this cell, leaving a rest; ties that sustained them are dropped too. */
export const clearHit = (pattern: RhythmPattern, unit: number): RhythmPattern => {
  const cell = new Set(eventsInUnit(pattern, unit));
  return rebuild(pattern, pattern.events.filter((e) => !cell.has(e)));
};

/**
 * Sets params.slotCount (rounded and clamped to 1..4; a non-number keeps the current count) and folds slot
 * targets that no longer exist back into range with slot % slotCount, e.g. when the user drops voicings.
 */
export const setSlotCount = (pattern: RhythmPattern, slotCount: number): RhythmPattern => {
  const count = Number.isFinite(slotCount) ? Math.min(4, Math.max(1, Math.round(slotCount))) : pattern.params.slotCount;
  return rebuild({ ...pattern, params: { ...pattern.params, slotCount: count } }, pattern.events);
};
