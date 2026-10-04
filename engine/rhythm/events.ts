// Event-list normalisation shared by the generator, the edit helpers and the variation tools.
import type { HitTarget, PickingMode, RhythmEvent, RhythmPattern } from '../types';
import { assignPicks } from './picking';
import { barTicks, firstBeatTicks, patternLengthTicks } from './grid';

export const isSlotTarget = (target: HitTarget): target is Extract<HitTarget, { slot: number }> =>
  target.kind === 'slot' || target.kind === 'dyad';

export const slotTarget = (kind: 'slot' | 'dyad', slot: number): HitTarget =>
  kind === 'slot' ? { kind: 'slot', slot } : { kind: 'dyad', slot };

export const copyTarget = (target: HitTarget): HitTarget => ({ ...target });

export const sameTarget = (a: HitTarget, b: HitTarget): boolean =>
  a.kind === b.kind && (!isSlotTarget(a) || (isSlotTarget(b) && a.slot === b.slot));

/** Canonical event object: `tie` is present only on ties. */
export const makeEvent = (
  tick: number,
  durationTicks: number,
  target: HitTarget,
  palmMute: boolean,
  accent: 0 | 1 | 2,
  pick: 'down' | 'up' = 'down',
  tie = false
): RhythmEvent =>
  tie
    ? { tick, durationTicks, target: copyTarget(target), palmMute, accent, pick, tie: true }
    : { tick, durationTicks, target: copyTarget(target), palmMute, accent, pick };

export const copyEvent = (e: RhythmEvent): RhythmEvent =>
  makeEvent(e.tick, e.durationTicks, e.target, e.palmMute, e.accent, e.pick, e.tie === true);

export const sameEvents = (a: readonly RhythmEvent[], b: readonly RhythmEvent[]): boolean =>
  a.length === b.length &&
  a.every((e, i) => {
    const o = b[i];
    return (
      e.tick === o.tick &&
      e.durationTicks === o.durationTicks &&
      sameTarget(e.target, o.target) &&
      e.palmMute === o.palmMute &&
      e.accent === o.accent &&
      e.pick === o.pick &&
      !!e.tie === !!o.tie
    );
  });

export interface FinalizeOptions {
  lengthTicks: number;
  barTicks: number;
  picking: PickingMode;
  /** When set, slot targets outside 0..slotCount-1 are folded back with slot % slotCount. */
  slotCount?: number;
}

const slotInRange = (slot: number, slotCount: number): boolean => Number.isInteger(slot) && slot >= 0 && slot < slotCount;

/** slot % slotCount keeps a lowered slot count's chord changes audible and consistent within each accent. */
const foldSlot = (target: HitTarget, slotCount: number | undefined): HitTarget => {
  if (slotCount === undefined || !isSlotTarget(target) || slotInRange(target.slot, slotCount)) return target;
  const slot = Number.isInteger(target.slot) && target.slot >= 0 ? target.slot % Math.max(1, Math.floor(slotCount)) : 0;
  return slotTarget(target.kind, slot);
};

/**
 * Sorts, drops events outside the pattern, keeps the first event per tick, caps durations at the next onset
 * and the pattern end (never extends them, so a removed hit leaves a rest), drops ties that no longer continue
 * the previous event, makes surviving ties copy their source's target and palm mute, folds out-of-range slots
 * (opts.slotCount), then assigns picks.
 */
export const finalizeEvents = (input: readonly RhythmEvent[], opts: FinalizeOptions): RhythmEvent[] => {
  const sorted = input
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => Number.isInteger(e.tick) && e.tick >= 0 && e.tick < opts.lengthTicks && e.durationTicks > 0)
    .sort((a, b) => a.e.tick - b.e.tick || a.i - b.i)
    .map(({ e }) => e)
    .filter((e, i, list) => i === 0 || e.tick !== list[i - 1].tick);

  const out: RhythmEvent[] = [];
  sorted.forEach((e, i) => {
    const limit = (i + 1 < sorted.length ? sorted[i + 1].tick : opts.lengthTicks) - e.tick;
    const duration = Math.min(Math.round(e.durationTicks), limit);
    if (e.tie) {
      const prev = out[out.length - 1];
      if (!prev || prev.tick + prev.durationTicks !== e.tick) return;
      out.push(makeEvent(e.tick, duration, prev.target, prev.palmMute, 0, 'down', true));
    } else {
      out.push(makeEvent(e.tick, duration, foldSlot(e.target, opts.slotCount), e.palmMute, e.accent, 'down'));
    }
  });

  const picks = assignPicks(out, opts.picking, opts.barTicks);
  return out.map((e, i) => ({ ...e, pick: picks[i] }));
};

export const finalizeOptions = (pattern: Pick<RhythmPattern, 'bars' | 'meter' | 'params'>): FinalizeOptions => ({
  lengthTicks: patternLengthTicks(pattern),
  barTicks: barTicks(pattern.meter),
  picking: pattern.params.picking,
  slotCount: pattern.params.slotCount
});

/** The pattern itself when every slot target exists, else a copy with out-of-range slots folded back. */
export const withSlotsInRange = (pattern: RhythmPattern): RhythmPattern =>
  pattern.events.every((e) => !isSlotTarget(e.target) || slotInRange(e.target.slot, pattern.params.slotCount))
    ? pattern
    : { ...pattern, events: finalizeEvents(pattern.events, finalizeOptions(pattern)) };

/** Slot/dyad events whose slot differs from the previous chord event without being an accented attack. */
export const unaccentedSlotChangeCount = (events: readonly RhythmEvent[]): number => {
  let current: number | null = null;
  let count = 0;
  for (const e of events) {
    if (!isSlotTarget(e.target)) continue;
    if (current !== null && e.target.slot !== current && (e.tie || e.accent === 0)) count++;
    current = e.target.slot;
  }
  return count;
};

export const hasFirstBeatAttack = (events: readonly RhythmEvent[], pattern: Pick<RhythmPattern, 'meter'>): boolean =>
  events.some((e) => !e.tie && e.tick < firstBeatTicks(pattern.meter));
