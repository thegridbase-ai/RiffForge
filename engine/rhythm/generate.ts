// Seeded rhythm generator: accent groups -> cells -> syncopation (offbeats, pushes, tie-overs) -> harmony.
// The first accent cycle is drawn as a motif and repeated with light variation, so riffs repeat like riffs
// and a polymeter figure stays audible against the bar.
import type { GroupingSpec, HitTarget, Meter, RhythmEvent, RhythmGrid, RhythmParams, RhythmPattern } from '../types';
import { createRng, seedFromString, type Rng } from '../random';
import {
  PPQ,
  THIRTY_SECOND_TICKS,
  barTicks,
  buildGroups,
  gridUnitTicks,
  isOddMeter,
  isPolymeter,
  type RhythmGroup
} from './grid';
import { RHYTHM_STYLES, RHYTHM_STYLE_IDS, STYLE_RECIPES, type CellKind, type StyleRecipe } from './styles';
import { finalizeEvents, makeEvent, slotTarget } from './events';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

const NAMED_GROUPINGS: readonly string[] = ['even', '3-3-2', '3-3-3-3-4', 'random-odd'];
const MAX_BARS = 64;
const MAX_CYCLE_UNITS = 1024;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const clampInt = (x: number | undefined, lo: number, hi: number, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : fallback;

const sanitizeGrouping = (grouping: GroupingSpec): GroupingSpec => {
  if (typeof grouping === 'string') return NAMED_GROUPINGS.includes(grouping) ? grouping : 'even';
  const groups = Array.isArray(grouping) ? grouping.filter((g) => Number.isInteger(g) && g > 0) : [];
  return groups.length > 0 ? groups : 'even';
};

/** Clamps every param into its documented range; generateRhythm stores the result on the pattern. */
export const sanitizeRhythmParams = (params: RhythmParams): RhythmParams => {
  const meter: Meter = {
    numerator: clampInt(params.meter?.numerator, 1, 32, 4),
    denominator: params.meter?.denominator === 8 ? 8 : 4
  };
  const grid: RhythmGrid = params.grid === '16th-triplet' ? '16th-triplet' : '16th';
  const out: RhythmParams = {
    style: RHYTHM_STYLE_IDS.includes(params.style) ? params.style : 'chugEngine',
    meter,
    bars: clampInt(params.bars, 1, MAX_BARS, 2),
    grid,
    grouping: sanitizeGrouping(params.grouping),
    density: clamp01(params.density),
    syncopation: clamp01(params.syncopation),
    pedalRatio: clamp01(params.pedalRatio),
    palmMuteRatio: clamp01(params.palmMuteRatio),
    slotCount: clampInt(params.slotCount, 1, 4, 2),
    picking: params.picking === 'downstrokes' ? 'downstrokes' : 'alternate',
    anticipation: params.anticipation === true
  };
  const cycle = params.cycleSixteenths;
  if (typeof cycle === 'number' && Number.isFinite(cycle) && cycle >= 2) {
    out.cycleSixteenths = Math.min(MAX_CYCLE_UNITS, Math.round(cycle));
  }
  return out;
};

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface GenContext {
  params: RhythmParams;
  recipe: StyleRecipe;
  unitTicks: number;
  barTicks: number;
  lengthTicks: number;
  triplet: boolean;
}

export const makeContext = (params: RhythmParams): GenContext => {
  const bar = barTicks(params.meter);
  return {
    params,
    recipe: STYLE_RECIPES[params.style],
    unitTicks: gridUnitTicks(params.grid),
    barTicks: bar,
    lengthTicks: params.bars * bar,
    triplet: params.grid === '16th-triplet'
  };
};

/** Decisions for one accent group. Plans of the first cycle are copied to later cycles. */
export interface GroupPlan {
  kind: CellKind;
  /** Halftime weak-beat figure, 0..3. */
  variant: number;
  /** Rest on the group start; the head moves to the next hit (syncopation). */
  offbeat: boolean;
  /** Accent the head (cycle starts, stabs and strong halftime beats are accented regardless). */
  accent: boolean;
  /** An accented head advances the harmony to the next slot. */
  move: boolean;
  fillPedal: boolean;
  palmMute: boolean;
  /** Tremolo in 32nds instead of 16ths (16th grid only). */
  fine: boolean;
  /** Stab choked after at most two units instead of ringing through the group. */
  choke: boolean;
  /** Anticipate the head by this many units; a tie keeps it sounding through the group start. */
  push: number;
  /** Let a ringing head sustain into a silent next group through a tie. */
  tieOver: boolean;
  deadSeed: number;
  /** The style's characteristic figure; neighbours never push into it. */
  signature: boolean;
}

const CELL_ORDER: readonly CellKind[] = [
  'chug16',
  'tripletChug',
  'tremolo',
  'gallop',
  'reverseGallop',
  'chug8',
  'halftime',
  'stab',
  'rest'
];

/** Approximate hits per grid unit; cells close to params.density are favoured. */
const CELL_DENSITY: Readonly<Record<CellKind, number>> = {
  chug16: 1,
  tripletChug: 1,
  tremolo: 1,
  gallop: 0.75,
  reverseGallop: 0.75,
  chug8: 0.5,
  halftime: 0.3,
  stab: 0.25,
  rest: 0
};

const DENSITY_SIGMA_SQ2 = 2 * 0.3 * 0.3;

const densityFit = (kind: CellKind, density: number): number =>
  Math.max(0.05, Math.exp(-((CELL_DENSITY[kind] - density) ** 2) / DENSITY_SIGMA_SQ2));

const cellWeight = (kind: CellKind, group: RhythmGroup, ctx: GenContext): number => {
  const { params, recipe } = ctx;
  let weight = (recipe.cells[kind] ?? 0) * densityFit(kind, params.density);
  if (kind === 'rest') weight *= group.indexInCycle === 0 ? 0 : 0.5 + params.syncopation;
  if ((kind === 'gallop' || kind === 'reverseGallop') && group.length < 3) weight = 0;
  return weight;
};

export const isHalftimeStrong = (group: RhythmGroup, ctx: GenContext): boolean => {
  const offset = (group.startUnit * ctx.unitTicks) % ctx.barTicks;
  return offset === 0 || offset * 2 === ctx.barTicks;
};

/** Draws one plan. Every random value is drawn unconditionally so a param tweak only changes what it touches. */
export const drawPlan = (rng: Rng, group: RhythmGroup, ctx: GenContext): GroupPlan => {
  const { params, recipe } = ctx;
  const cycleStart = group.indexInCycle === 0;
  const kinds = CELL_ORDER.filter((k) => (recipe.cells[k] ?? 0) > 0);
  const weights = kinds.map((k) => cellWeight(k, group, ctx));
  let kind = rng.weighted(kinds, weights);
  if (kind === 'rest' && cycleStart) kind = kinds.find((k) => k !== 'rest') ?? 'chug8';
  if (kind === 'chug16' && ctx.triplet) kind = 'tripletChug';

  const offbeatRoll = rng.next();
  const accentRoll = rng.next();
  const moveRoll = rng.next();
  const pedalRoll = rng.next();
  const muteRoll = rng.next();
  const fineRoll = rng.next();
  const chokeRoll = rng.next();
  const variant = rng.weighted([0, 1, 2, 3], [1.2 - params.density, 0.4 + params.density, 0.5, 0.4 + 0.5 * params.density]);
  const pushRoll = rng.next();
  const pushSizeRoll = rng.next();
  const tieRoll = rng.next();
  const deadSeed = rng.int(0, 0x7fffffff);

  const offbeat = !cycleStart && kind !== 'rest' && group.length >= 2 && offbeatRoll < params.syncopation * recipe.offbeatRate;
  const accentRate = offbeat ? Math.min(1, recipe.accentRate + 0.3) : recipe.accentRate;
  const choke = kind === 'stab' && chokeRoll < recipe.stabChoke;
  const canPush = !offbeat && kind !== 'rest' && kind !== 'tremolo';
  return {
    kind,
    variant,
    offbeat,
    accent: cycleStart || accentRoll < accentRate,
    move: moveRoll < recipe.harmonyMoveRate,
    fillPedal: pedalRoll < params.pedalRatio,
    palmMute: muteRoll < params.palmMuteRatio,
    fine: fineRoll < 0.3 + 0.6 * params.density,
    choke,
    push: canPush && pushRoll < params.syncopation * recipe.pushRate ? (pushSizeRoll < 0.5 ? 1 : 2) : 0,
    tieOver: ((kind === 'stab' && !choke) || kind === 'halftime') && tieRoll < recipe.tieOverRate,
    deadSeed,
    signature: false
  };
};

const signatureKind = (ctx: GenContext): CellKind | null => {
  const kind = ctx.recipe.signature;
  return kind === 'chug16' && ctx.triplet ? 'tripletChug' : kind;
};

const isChug = (kind: CellKind) => kind === 'chug16' || kind === 'tripletChug';

const matchesSignature = (plan: GroupPlan, group: RhythmGroup, kind: CellKind, ctx: GenContext): boolean => {
  if (plan.kind !== kind || plan.offbeat || plan.push > 0) return false;
  if (kind === 'stab') return plan.choke && group.length >= 2;
  if (group.length < 4) return false;
  if (isChug(kind)) return plan.fillPedal && plan.palmMute;
  if (kind === 'tremolo') return plan.fine || ctx.triplet;
  return true;
};

/** Guarantees the style's characteristic figure appears in the motif (signature groups also skip dead notes). */
const enforceSignature = (motif: GroupPlan[], cycleGroups: RhythmGroup[], ctx: GenContext): GroupPlan[] => {
  const kind = signatureKind(ctx);
  if (!kind) return motif;
  const found = motif.findIndex((plan, i) => matchesSignature(plan, cycleGroups[i], kind, ctx));
  if (found >= 0) return motif.map((plan, i) => (i === found ? { ...plan, signature: true } : plan));
  const need = kind === 'stab' ? 2 : 4;
  const long = cycleGroups.filter((g) => g.length >= need);
  const pool = long.length > 0 ? long : cycleGroups.filter((g) => g.length >= 2);
  if (pool.length === 0) return motif;
  const target = pool.find((g) => g.indexInCycle > 0) ?? pool[0];
  return motif.map((plan, i) =>
    i !== target.indexInCycle
      ? plan
      : {
          ...plan,
          kind,
          offbeat: false,
          push: 0,
          signature: true,
          choke: kind === 'stab' ? true : plan.choke,
          tieOver: kind === 'stab' ? false : plan.tieOver,
          fillPedal: isChug(kind) ? true : plan.fillPedal,
          palmMute: isChug(kind) ? true : plan.palmMute,
          fine: kind === 'tremolo' ? true : plan.fine
        }
  );
};

const planGroups = (groups: RhythmGroup[], ctx: GenContext, rng: Rng): GroupPlan[] => {
  const cycle0 = groups.filter((g) => g.cycle === 0);
  const motif = enforceSignature(
    cycle0.map((g) => drawPlan(rng.fork(`motif-${g.indexInCycle}`), g, ctx)),
    cycle0,
    ctx
  );
  const lastCycle = groups[groups.length - 1].cycle;
  const turnIndex =
    lastCycle > 0 ? groups.reduce((idx, g) => (g.cycle === lastCycle && !g.truncated ? g.index : idx), -1) : -1;

  let plans = groups.map((g) => {
    if (g.cycle === 0) return motif[g.indexInCycle];
    const vary = rng.fork(`vary-${g.index}`);
    const redraw = vary.chance(ctx.recipe.variation);
    const turn = g.index === turnIndex && vary.chance(ctx.recipe.turnaround);
    return redraw || turn ? drawPlan(vary, g, ctx) : { ...motif[g.indexInCycle] };
  });

  if (ctx.recipe.halftimeStrong) {
    plans = plans.map((plan, i) =>
      isHalftimeStrong(groups[i], ctx) ? { ...plan, kind: 'halftime', offbeat: false, push: 0, accent: true } : plan
    );
  }

  // Anticipation: sometimes leave the very first downbeat empty (pickup feel).
  const first = plans[0];
  if (
    ctx.params.anticipation &&
    rng.fork('anticipation').chance(0.5) &&
    first.kind !== 'rest' &&
    !first.signature &&
    groups[0].length >= 2
  ) {
    plans[0] = { ...first, offbeat: true, push: 0 };
  }
  return plans;
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RawHit {
  tick: number;
  dur: number;
  role: 'head' | 'fill' | 'tie';
  group: number;
  dead: boolean;
  tremolo: boolean;
}

/** [offset, length] in grid units within a group. */
type Segment = readonly [number, number];

const repeatFigure = (figure: readonly number[], n: number): Segment[] => {
  const segments: Segment[] = [];
  for (let pos = 0, i = 0; pos < n; i++) {
    const length = Math.min(figure[i % figure.length], n - pos);
    segments.push([pos, length]);
    pos += length;
  }
  return segments;
};

const chokeUnits = (n: number): number => Math.max(1, Math.min(2, n - 1));

/** Weak beats of a halftime bar: 0 rest, 1 two 16ths into the next beat, 2 one 8th, 3 an 8th pickup. */
const halftimeWeak = (variant: number, n: number): Segment[] => {
  switch (variant) {
    case 1:
      return n >= 3 ? [[n - 2, 1], [n - 1, 1]] : [[n - 1, 1]];
    case 2:
      return [[0, Math.min(2, n)]];
    case 3:
      return n >= 3 ? [[n - 2, 2]] : [[0, n]];
    default:
      return [];
  }
};

/**
 * Cell figures, adapted to the group length n:
 * - chug16 / tripletChug: every unit. chug8: every 2 units (on the triplet grid: 8th-note triplets).
 * - gallop: 8th + 16th + 16th repeated (n = 3: 8th + 16th; triplet grid: long-short); n <= 2: plain 16ths.
 * - reverseGallop: 16th + 16th + 8th repeated (n = 3: 16th + 8th; triplet grid: short-long); n <= 2: 16ths.
 * - stab: one hit ringing through the group, or choked after min(2, n - 1) units.
 * - halftime: a ringing chord on beats 1 and 3, a sparse weak-beat figure elsewhere.
 */
const cellSegments = (plan: GroupPlan, group: RhythmGroup, ctx: GenContext): Segment[] => {
  const n = group.length;
  switch (plan.kind) {
    case 'rest':
      return [];
    case 'stab':
      return [[0, plan.choke ? chokeUnits(n) : n]];
    case 'halftime':
      return isHalftimeStrong(group, ctx) ? [[0, n]] : halftimeWeak(plan.variant, n);
    case 'chug8':
      return repeatFigure([2], n);
    case 'gallop':
      return n <= 2 ? repeatFigure([1], n) : repeatFigure(ctx.triplet ? [2, 1] : [2, 1, 1], n);
    case 'reverseGallop':
      if (n <= 2) return repeatFigure([1], n);
      if (n === 3 && !ctx.triplet) return [[0, 1], [1, 2]];
      return repeatFigure(ctx.triplet ? [1, 2] : [1, 1, 2], n);
    default:
      return repeatFigure([1], n);
  }
};

/** Drop the downbeat hit; a single held hit is delayed to the next 8th (or 16th in short groups) instead. */
const shiftOffbeat = (segments: Segment[], n: number): Segment[] => {
  if (segments.length >= 2) return segments.slice(1);
  if (segments.length === 1 && n >= 2) {
    const delay = n >= 4 ? 2 : 1;
    return [[delay, Math.max(1, Math.min(segments[0][1], n - delay))]];
  }
  return segments;
};

export const renderGroup = (plan: GroupPlan, group: RhythmGroup, ctx: GenContext): RawHit[] => {
  const start = group.startUnit * ctx.unitTicks;
  if (plan.kind === 'tremolo') {
    const step = plan.fine && !ctx.triplet ? THIRTY_SECOND_TICKS : ctx.unitTicks;
    const count = (group.length * ctx.unitTicks) / step;
    const first = plan.offbeat && group.length >= 2 ? ctx.unitTicks / step : 0;
    const hits: RawHit[] = [];
    for (let i = first; i < count; i++) {
      hits.push({ tick: start + i * step, dur: step, role: i === first ? 'head' : 'fill', group: group.index, dead: false, tremolo: true });
    }
    return hits;
  }
  const segments = plan.offbeat ? shiftOffbeat(cellSegments(plan, group, ctx), group.length) : cellSegments(plan, group, ctx);
  const dead = createRng(plan.deadSeed);
  return segments.map(([offset, length], i) => ({
    tick: start + offset * ctx.unitTicks,
    dur: length * ctx.unitTicks,
    role: i === 0 ? 'head' : 'fill',
    group: group.index,
    dead: i > 0 && !plan.signature && dead.chance(ctx.recipe.deadRate),
    tremolo: false
  }));
};

export const headAccent = (plan: GroupPlan, group: RhythmGroup, ctx: GenContext): 0 | 1 | 2 => {
  if (group.indexInCycle === 0) return 2;
  if (plan.kind === 'stab' || (plan.kind === 'halftime' && isHalftimeStrong(group, ctx))) return 1;
  return plan.accent ? 1 : 0;
};

/** Anticipation across the group boundary: the accented head moves earlier and a tie holds it through the beat. */
const applyPushes = (groups: RhythmGroup[], plans: GroupPlan[], hits: RawHit[][], ctx: GenContext): void => {
  for (let i = 1; i < groups.length; i++) {
    const plan = plans[i];
    if (plan.push <= 0 || plans[i - 1].signature) continue;
    const group = groups[i];
    const start = group.startUnit * ctx.unitTicks;
    const head = hits[i][0];
    if (!head || head.role !== 'head' || head.tick !== start || headAccent(plan, group, ctx) === 0) continue;
    const pushTicks = plan.push * ctx.unitTicks;
    const newTick = start - pushTicks;
    const prevHits = hits[i - 1];
    if (newTick <= groups[i - 1].startUnit * ctx.unitTicks || prevHits.length === 0 || prevHits[0].tick >= newTick) continue;
    hits[i - 1] = prevHits.filter((h) => h.tick < newTick);
    hits[i] = [{ ...head, tick: newTick, dur: pushTicks }, { ...head, role: 'tie', tick: start }, ...hits[i].slice(1)];
  }
};

/** A ringing head followed by a group that starts silent keeps sounding into it. */
const applyTieOvers = (groups: RhythmGroup[], plans: GroupPlan[], hits: RawHit[][], ctx: GenContext): void => {
  for (let i = 0; i + 1 < groups.length; i++) {
    if (!plans[i].tieOver) continue;
    const end = (groups[i].startUnit + groups[i].length) * ctx.unitTicks;
    const next = groups[i + 1];
    const last = hits[i][hits[i].length - 1];
    if (!last || last.role !== 'head' || last.tick + last.dur !== end || next.startUnit * ctx.unitTicks !== end) continue;
    const firstNext = hits[i + 1].length > 0 ? hits[i + 1][0].tick : (next.startUnit + next.length) * ctx.unitTicks;
    if (firstNext <= end) continue;
    hits[i].push({ ...last, role: 'tie', tick: end, dur: firstNext - end });
  }
};

// ---------------------------------------------------------------------------
// Harmony and assembly
// ---------------------------------------------------------------------------

/**
 * Picks extra harmony moves so that every slot sounds when there are enough accents: moves step the slot by
 * one, so slotCount - 1 moves reach them all. Cycle-start accents are preferred, and each forced move goes to
 * the candidate farthest (in accents) from any existing change, so the slots get similar shares. Heuristic.
 */
const ensureSlotCoverage = (moves: readonly boolean[], strong: readonly boolean[], slotCount: number): boolean[] => {
  const out = [...moves];
  const needed = Math.min(slotCount - 1, out.length - 1);
  let count = out.filter(Boolean).length;
  while (count < needed) {
    const open = out.flatMap((move, i) => (i > 0 && !move ? [i] : []));
    const preferred = open.some((i) => strong[i]) ? open.filter((i) => strong[i]) : open;
    const changes = [0, out.length, ...out.flatMap((move, i) => (move ? [i] : []))];
    const spacing = (i: number) => Math.min(...changes.map((c) => Math.abs(c - i)));
    const best = preferred.reduce((a, b) => (spacing(b) > spacing(a) ? b : a));
    out[best] = true;
    count++;
  }
  return out;
};

/**
 * Slot changes happen only on accented heads. The first accent uses slot 0; afterwards a cycle-start accent
 * advances to the next slot with recipe.cycleMoveRate and other accents when their plan says `move`, plus
 * the moves ensureSlotCoverage adds. Non-accented hits go to the pedal (plan.fillPedal) or stay on the
 * current slot/dyad.
 */
const assignTargets = (groups: RhythmGroup[], plans: GroupPlan[], hits: RawHit[][], ctx: GenContext, rng: Rng): RhythmEvent[] => {
  const { recipe, params } = ctx;
  const lastCycle = groups[groups.length - 1].cycle;
  const advance = Array.from({ length: lastCycle + 1 }, (_, k) => k > 0 && rng.fork(`cycle-${k}`).chance(recipe.cycleMoveRate));
  const ordered = hits.flat().sort((a, b) => a.tick - b.tick);
  const accentOf = (hit: RawHit): 0 | 1 | 2 => (hit.role === 'head' ? headAccent(plans[hit.group], groups[hit.group], ctx) : 0);
  const accented = ordered.filter((hit) => accentOf(hit) > 0);
  const strong = accented.map((hit) => accentOf(hit) === 2);
  const moves = ensureSlotCoverage(
    accented.map((hit, i) => i > 0 && (strong[i] ? advance[groups[hit.group].cycle] : plans[hit.group].move)),
    strong,
    params.slotCount
  );

  const events: RhythmEvent[] = [];
  let cursor = 0;
  let accentIndex = 0;
  for (const hit of ordered) {
    const plan = plans[hit.group];
    const prev = events[events.length - 1];
    if (hit.role === 'tie') {
      if (prev) events.push(makeEvent(hit.tick, hit.dur, prev.target, prev.palmMute, 0, 'down', true));
      continue;
    }
    const accent = accentOf(hit);
    let target: HitTarget;
    let palmMute = plan.palmMute;
    if (accent > 0) {
      if (moves[accentIndex++]) cursor = (cursor + 1) % params.slotCount;
      target = slotTarget(hit.tremolo ? 'dyad' : recipe.headTarget, cursor);
      palmMute = false;
    } else if (hit.dead) {
      target = { kind: 'dead' };
      palmMute = false;
    } else if (hit.tremolo) {
      target = slotTarget('dyad', cursor);
    } else if (plan.fillPedal) {
      target = { kind: 'pedal' };
    } else {
      target = slotTarget(recipe.headTarget, cursor);
    }
    events.push(makeEvent(hit.tick, hit.dur, target, palmMute, accent));
  }
  return events;
};

export const seedTag = (seed: string): string => seedFromString(seed).toString(36).toUpperCase().padStart(4, '0').slice(-4);

const patternTags = (params: RhythmParams, ctx: GenContext, plans: GroupPlan[], hits: RawHit[][]): string[] => {
  const tags = [...ctx.recipe.tags];
  if (plans.some((p) => p.kind === 'gallop' || p.kind === 'reverseGallop')) tags.push('gallop');
  if (plans.some((p) => p.kind === 'halftime')) tags.push('halftime');
  if (hits.some((list) => list.some((h) => h.tremolo))) tags.push('tremolo');
  if (params.grid === '16th-triplet') tags.push('triplet');
  if (isOddMeter(params.meter)) tags.push('odd-meter');
  if (isPolymeter(params)) tags.push('polymeter');
  if (params.syncopation >= 0.5) tags.push('syncopated');
  return [...new Set(tags)];
};

export const generateRhythm = (input: RhythmParams, seed: string): RhythmPattern => {
  const params = sanitizeRhythmParams(input);
  const ctx = makeContext(params);
  const rng = createRng(seed);
  const groups = buildGroups(params, seed);
  const plans = planGroups(groups, ctx, rng.fork('plan'));
  const hits = groups.map((g) => renderGroup(plans[g.index], g, ctx));
  applyPushes(groups, plans, hits, ctx);
  applyTieOvers(groups, plans, hits, ctx);
  const events = finalizeEvents(assignTargets(groups, plans, hits, ctx, rng.fork('harmony')), {
    lengthTicks: ctx.lengthTicks,
    barTicks: ctx.barTicks,
    picking: params.picking,
    slotCount: params.slotCount
  });
  const pattern: RhythmPattern = {
    id: `${params.style}-${seed}`,
    name: `${RHYTHM_STYLES[params.style].label} ${seedTag(seed)}`,
    seed,
    meter: { ...params.meter },
    bars: params.bars,
    ppq: PPQ,
    events,
    tags: patternTags(params, ctx, plans, hits),
    params
  };
  if (params.cycleSixteenths !== undefined) pattern.cycleTicks = params.cycleSixteenths * ctx.unitTicks;
  return pattern;
};
