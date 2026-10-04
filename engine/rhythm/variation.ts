// Seeded variations of an existing pattern: small mutations and regeneration around locked bars.
import type { HitTarget, RhythmEvent, RhythmPattern } from '../types';
import { createRng, type Rng } from '../random';
import { barTicks, buildGroups, type RhythmGroup } from './grid';
import { drawPlan, generateRhythm, headAccent, makeContext, renderGroup, seedTag } from './generate';
import {
  copyEvent,
  finalizeEvents,
  finalizeOptions,
  isSlotTarget,
  makeEvent,
  sameEvents,
  slotTarget,
  unaccentedSlotChangeCount,
  withSlotsInRange
} from './events';
import { validateRhythm } from './validate';

type Mutation = 'cell' | 'accent' | 'palmMute' | 'harmony';

const MUTATIONS: readonly Mutation[] = ['cell', 'accent', 'palmMute', 'harmony'];
const ATTEMPTS_PER_MUTATION = 6;

const slotOf = (target: HitTarget): number => (isSlotTarget(target) ? target.slot : 0);

const groupTicks = (group: RhythmGroup, unitTicks: number): [number, number] => [
  group.startUnit * unitTicks,
  (group.startUnit + group.length) * unitTicks
];

/** Re-renders one accent group with a newly drawn cell; an accented chord there keeps its target and accent. */
const mutateCell = (pattern: RhythmPattern, rng: Rng): RhythmEvent[] => {
  const ctx = makeContext(pattern.params);
  const group = rng.pick(buildGroups(pattern.params, pattern.seed));
  const [start, end] = groupTicks(group, ctx.unitTicks);
  const inside = pattern.events.filter((e) => e.tick >= start && e.tick < end);
  const outside = pattern.events.filter((e) => e.tick < start || e.tick >= end);
  const accented = inside.find((e) => !e.tie && e.accent > 0 && isSlotTarget(e.target));
  const before = pattern.events.filter((e) => e.tick < start && isSlotTarget(e.target)).pop();
  const slot = accented ? slotOf(accented.target) : before ? slotOf(before.target) : 0;

  let plan = drawPlan(rng, group, ctx);
  if (accented) plan = { ...plan, kind: plan.kind === 'rest' ? 'stab' : plan.kind, accent: true };
  const { recipe } = ctx;
  const fresh = renderGroup(plan, group, ctx).map((hit) => {
    const accent = hit.role === 'head' ? (accented ? accented.accent : headAccent(plan, group, ctx)) : 0;
    if (accent > 0) {
      const target = accented && !hit.tremolo ? accented.target : slotTarget(hit.tremolo ? 'dyad' : recipe.headTarget, slot);
      return makeEvent(hit.tick, hit.dur, target, false, accent);
    }
    const target: HitTarget = hit.dead
      ? { kind: 'dead' }
      : hit.tremolo
        ? slotTarget('dyad', slot)
        : plan.fillPedal
          ? { kind: 'pedal' }
          : slotTarget(recipe.headTarget, slot);
    return makeEvent(hit.tick, hit.dur, target, !hit.dead && plan.palmMute, 0);
  });
  return [...outside, ...fresh];
};

/** Moves one accented chord hit onto an adjacent pedal or dead hit (target travels with the accent). */
const mutateAccent = (pattern: RhythmPattern, rng: Rng): RhythmEvent[] | null => {
  const ev = pattern.events;
  const isPlainFill = (e: RhythmEvent | undefined) =>
    !!e && !e.tie && e.accent === 0 && (e.target.kind === 'pedal' || e.target.kind === 'dead');
  const options: [number, number][] = [];
  ev.forEach((e, i) => {
    if (e.tie || e.accent === 0 || e.tick === 0) return;
    for (const j of [i - 1, i + 1]) if (isPlainFill(ev[j])) options.push([i, j]);
  });
  if (options.length === 0) return null;
  const [i, j] = rng.pick(options);
  const out = ev.map(copyEvent);
  out[i] = { ...out[i], target: { ...ev[j].target }, palmMute: ev[j].palmMute, accent: 0 };
  out[j] = { ...out[j], target: { ...ev[i].target }, palmMute: false, accent: ev[i].accent };
  // The chord moved away, so ties that sustained it go too.
  let k = i + 1;
  while (k < out.length && out[k].tie) k++;
  return [...out.slice(0, i + 1), ...out.slice(k)];
};

/** Flips palm mute on the unaccented hits of one group, toward whichever state is rarer there. */
const mutatePalmMute = (pattern: RhythmPattern, rng: Rng): RhythmEvent[] | null => {
  const { unitTicks } = makeContext(pattern.params);
  const ev = pattern.events;
  const eligible = buildGroups(pattern.params, pattern.seed)
    .map((g) => {
      const [start, end] = groupTicks(g, unitTicks);
      return ev.flatMap((e, i) => (e.tick >= start && e.tick < end && !e.tie && e.accent === 0 && e.target.kind !== 'dead' ? [i] : []));
    })
    .filter((list) => list.length > 0);
  if (eligible.length === 0) return null;
  const indices = rng.pick(eligible);
  const muted = indices.filter((i) => ev[i].palmMute).length;
  const value = muted * 2 < indices.length;
  return ev.map((e, i) => (indices.includes(i) ? { ...copyEvent(e), palmMute: value } : copyEvent(e)));
};

/** Re-harmonises one accent (not the first) and the unaccented chord hits that follow it. */
const mutateHarmony = (pattern: RhythmPattern, rng: Rng): RhythmEvent[] | null => {
  const { slotCount } = pattern.params;
  const ev = pattern.events;
  const accents = ev.flatMap((e, i) => (!e.tie && e.accent > 0 && isSlotTarget(e.target) ? [i] : []));
  if (slotCount < 2 || accents.length < 2) return null;
  const start = rng.pick(accents.slice(1));
  const next = (slotOf(ev[start].target) + 1 + rng.int(0, slotCount - 2)) % slotCount;
  const out = ev.map(copyEvent);
  for (let k = start; k < out.length; k++) {
    const e = out[k];
    if (k > start && !e.tie && e.accent > 0 && isSlotTarget(e.target)) break;
    if (isSlotTarget(e.target)) out[k] = { ...e, target: slotTarget(e.target.kind, next) };
  }
  return out;
};

const applyMutation = (kind: Mutation, pattern: RhythmPattern, rng: Rng): RhythmEvent[] | null => {
  switch (kind) {
    case 'cell':
      return mutateCell(pattern, rng);
    case 'accent':
      return mutateAccent(pattern, rng);
    case 'palmMute':
      return mutatePalmMute(pattern, rng);
    default:
      return mutateHarmony(pattern, rng);
  }
};

/**
 * Small seeded change: re-render one group, move one accent, flip palm mute on one group, or re-harmonise one
 * accent. Mutations are tried in a seeded order; the first that changes the events, stays valid and adds no
 * slot change on an unaccented hit wins (re-rendering a group can drop the next group's pushed accent).
 * Slots outside params.slotCount are folded back first.
 */
export const mutateRhythm = (input: RhythmPattern, seed: string): RhythmPattern => {
  const pattern = withSlotsInRange(input);
  const rng = createRng(`mutate:${seed}`);
  const opts = finalizeOptions(pattern);
  const base = { ...pattern, tags: [...pattern.tags], id: `${pattern.id.split('~')[0]}~${seedTag(seed)}` };
  const harmonyBreaks = unaccentedSlotChangeCount(pattern.events);
  for (const kind of rng.shuffle(MUTATIONS)) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MUTATION; attempt++) {
      const events = applyMutation(kind, pattern, rng.fork(`${kind}-${attempt}`));
      if (!events) break;
      const candidate: RhythmPattern = { ...base, events: finalizeEvents(events, opts) };
      if (
        !sameEvents(candidate.events, pattern.events) &&
        validateRhythm(candidate).ok &&
        unaccentedSlotChangeCount(candidate.events) <= harmonyBreaks
      ) {
        return candidate;
      }
    }
  }
  return { ...base, events: pattern.events.map(copyEvent) };
};

/** Slot of the last slot/dyad event before `tick`, or 0 (playback's active slot before any chord). */
const activeSlotBefore = (events: readonly RhythmEvent[], tick: number): number => {
  let slot = 0;
  for (const e of events) {
    if (e.tick >= tick) break;
    if (isSlotTarget(e.target)) slot = e.target.slot;
  }
  return slot;
};

interface MergedEvent {
  e: RhythmEvent;
  kept: boolean;
}

/**
 * Re-harmonises the regenerated stretches between kept ones so that the slot changes only on accented attacks
 * and each kept stretch is entered on the slot it had in the old pattern (its pedal and dead hits take their
 * pitch from that slot). Inside a regenerated stretch, unaccented chord hits follow the current slot; the last
 * accent before a kept stretch that depends on it is moved to the slot it needs, or, without one, the first
 * chord hit of the stretch is accented to make the change (a stretch with no chord hit at all is left as is).
 */
const isChordAttack = (e: RhythmEvent): boolean => isSlotTarget(e.target) && !e.tie;

const withSlot = (e: RhythmEvent, slot: number): RhythmEvent =>
  isSlotTarget(e.target) ? { ...e, target: slotTarget(e.target.kind, slot) } : e;

const reharmonise = (items: MergedEvent[], old: readonly RhythmEvent[]): void => {
  let current: number | null = null;
  let i = 0;
  while (i < items.length) {
    if (items[i].kept) {
      const { target } = items[i].e;
      if (isSlotTarget(target)) current = target.slot;
      i++;
      continue;
    }
    const start = i;
    while (i < items.length && !items[i].kept) i++;
    const run = items.slice(start, i);
    for (const item of run) {
      const { e } = item;
      if (!isChordAttack(e) || !isSlotTarget(e.target)) continue;
      if (e.accent > 0 || current === null) current = e.target.slot;
      else if (e.target.slot !== current) item.e = withSlot(e, current);
    }
    if (i >= items.length) break;

    // The kept stretch depends on the entry slot unless it opens with an accented chord attack.
    const opener = items[i].e;
    if (isSlotTarget(opener.target) && !opener.tie && opener.accent > 0) continue;
    const need = activeSlotBefore(old, opener.tick);
    if ((current ?? 0) === need) continue;
    let from = run.map(({ e }) => isChordAttack(e) && e.accent > 0).lastIndexOf(true);
    if (from < 0) from = run.findIndex(({ e }) => isChordAttack(e));
    if (from < 0) continue;
    if (run[from].e.accent === 0) run[from].e = { ...run[from].e, accent: 1, palmMute: false };
    for (const item of run.slice(from)) if (isChordAttack(item.e)) item.e = withSlot(item.e, need);
    current = need;
  }
};

/**
 * Generates with a new seed but keeps every event whose onset lies in a locked bar, unchanged. A locked tie
 * also keeps the chain back to the attack it sustains, and a kept attack keeps the ties that sustain it past
 * the bar (a push into the next bar stays tied over its downbeat); new events that would start inside a kept
 * event's sound are dropped. A new tie whose attack was dropped becomes an attack with that attack's sound,
 * so a pushed accent that fell into a locked bar still lands on its downbeat. Harmony is then re-planned
 * around the kept bars (see reharmonise). Picks reset at each barline, so locked bars keep their picks too.
 * Slots outside params.slotCount are folded back first.
 */
export const regenerateRhythm = (input: RhythmPattern, seed: string, lockedBars: readonly number[]): RhythmPattern => {
  const pattern = withSlotsInRange(input);
  const fresh = generateRhythm(pattern.params, seed);
  const locked = [...new Set(lockedBars.filter((b) => Number.isInteger(b) && b >= 0 && b < pattern.bars))].sort((a, b) => a - b);
  if (locked.length === 0) return fresh;

  const bar = barTicks(pattern.meter);
  const inLocked = (tick: number) => locked.includes(Math.floor(tick / bar));
  const old = pattern.events;
  const keep = new Set(old.flatMap((e, i) => (inLocked(e.tick) ? [i] : [])));
  for (const i of [...keep]) {
    if (!old[i].tie) continue;
    for (let j = i - 1; j >= 0 && !keep.has(j); j--) {
      keep.add(j);
      if (!old[j].tie) break;
    }
  }
  for (const i of [...keep].sort((a, b) => a - b)) {
    for (let j = i + 1; j < old.length && old[j].tie && !keep.has(j); j++) keep.add(j);
  }
  const kept = old.filter((_, i) => keep.has(i)).map(copyEvent);
  const covered = (tick: number) => kept.some((k) => tick >= k.tick && tick < k.tick + k.durationTicks);

  const added: RhythmEvent[] = [];
  let source: RhythmEvent | null = null;
  let previousAdded = false;
  for (const e of fresh.events) {
    if (!e.tie) source = e;
    const dropped = inLocked(e.tick) || covered(e.tick);
    if (!dropped) {
      added.push(
        !e.tie || previousAdded || !source
          ? copyEvent(e)
          : makeEvent(e.tick, e.durationTicks, source.target, source.palmMute, source.accent)
      );
    }
    previousAdded = !dropped;
  }

  const items: MergedEvent[] = [
    ...kept.map((e) => ({ e, kept: true })),
    ...added.map((e) => ({ e, kept: false }))
  ].sort((a, b) => a.e.tick - b.e.tick);
  reharmonise(items, old);

  return {
    ...fresh,
    id: `${fresh.id}-keep-${locked.join('.')}`,
    events: finalizeEvents(
      items.map((item) => item.e),
      finalizeOptions(fresh)
    ),
    tags: [...new Set([...fresh.tags, ...pattern.tags])]
  };
};
