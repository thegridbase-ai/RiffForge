// Pure helpers for the Rhythm Lab: harmony slots (candidates, pedal note, retuning, the RiffBar bridge), the
// fingering optimizer over a rhythm pattern, metronome click times and grid labels. No React, no Tone.js,
// no storage: everything here is deterministic for equal inputs.
import type {
  Fingering,
  GeneratedVoicing,
  HandProfile,
  HarmonySlot,
  HitTarget,
  Meter,
  RhythmEvent,
  RhythmGrid,
  RhythmPattern,
  Shape,
  Tuning,
  VoicingFamily
} from '../engine/types';
import { generateVoicings, resolveFamilyId } from '../engine/generateVoicings';
import { fromLegacyNotes, getFamily } from '../engine/voicingSpec';
import { findBestFingering } from '../engine/fingering';
import { nameVoicing } from '../engine/naming';
import { noveltyScore, scoreVoicing } from '../engine/playability';
import { bassMidi, isValidShape, shapeKey, shapeToMidi } from '../engine/shape';
import { intervalFrom, parseNoteName, parsePitchClass, pitchClass } from '../engine/pitch';
import { getTuning } from '../engine/tuning';
import { PROFILE_LIMITS } from '../engine/handProfile';
import { describeTransition, optimizeSequence, type OptimizedSequence } from '../engine/transition';
import { PPQ, barTicks, barUnits, gridUnitTicks, patternLengthTicks } from '../engine/rhythm/grid';
import { parseRoot } from './chordExplorer';

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export type RhythmSlotSource =
  | { kind: 'family'; familyId: string }
  | { kind: 'notes'; notes: string[]; baseRoot: string };

/** One chord of the Rhythm Lab: a recipe (family or legacy notes) on a root, voiced as one engine shape. */
export interface RhythmSlot {
  id: string;
  label: string;
  /** Pitch-class name the recipe is built on ('E', 'C#'). */
  root: string;
  source: RhythmSlotSource;
  /** Frets low -> high for the tuning named by tuningId. */
  shape: (number | null)[];
  tuningId: string;
  /** Note for pedal hits while this slot is active; null falls back to the shape's lowest note. */
  pedalMidi: number | null;
}

export const MAX_RHYTHM_SLOTS = 4;
export const DEFAULT_SLOT_CANDIDATES = 12;

const hasSound = (shape: Shape): boolean => shape.some((f) => f !== null);

const fitsTuning = (shape: Shape, tuning: Tuning): boolean => isValidShape(shape, tuning.openMidi.length) && hasSound(shape);

let slotCounter = 0;
export const newSlotId = (): string => `slot-${Date.now().toString(36)}-${(slotCounter++).toString(36)}`;

/** The recipe a slot is built from, or null when its family id is unknown or its notes do not parse. */
export const slotFamily = (slot: Pick<RhythmSlot, 'source'>): VoicingFamily | null => {
  if (slot.source.kind === 'family') return resolveFamilyId(slot.source.familyId) ?? null;
  try {
    return fromLegacyNotes(slot.source.notes, slot.source.baseRoot);
  } catch {
    return null;
  }
};

/** Legacy note recipes are relative to their baseRoot; families to the slot root. */
const generationRoot = (slot: Pick<RhythmSlot, 'source' | 'root'>): string =>
  slot.source.kind === 'notes' ? slot.source.baseRoot : slot.root;

/**
 * The lowest open string when it sounds the slot root or fifth (the classic metal pedal), otherwise the
 * shape's bass note. Null only for a shape with no sounding string.
 */
export const defaultPedalMidi = (shape: Shape, tuning: Tuning, root: string): number | null => {
  const rootPc = parsePitchClass(root);
  const low = tuning.openMidi[0];
  if (rootPc !== null && low !== undefined) {
    const interval = intervalFrom(rootPc, pitchClass(low));
    if (interval === 0 || interval === 7) return low;
  }
  return fitsTuning(shape, tuning) ? bassMidi(shape, tuning) : null;
};

/** A GeneratedVoicing for an arbitrary shape, scored like the generator does; null when it cannot be fingered. */
const voicingForShape = (
  shape: Shape,
  tuning: Tuning,
  profile: HandProfile,
  family: VoicingFamily | null,
  root: string
): GeneratedVoicing | null => {
  if (!fitsTuning(shape, tuning)) return null;
  const found = findBestFingering(shape, profile);
  if (found.ok === false) return null;
  const rootPc = parsePitchClass(root) ?? 0;
  const naming = nameVoicing(shape, tuning, rootPc, family ?? undefined);
  const breakdown = scoreVoicing(shape, found.fingering, {
    tuning,
    profile,
    rootPc,
    family: family ?? undefined,
    distortion: true,
    context: 'strum',
    musical: true
  });
  return {
    shape: [...shape],
    fingering: found.fingering,
    midi: shapeToMidi(shape, tuning),
    degrees: naming.degrees,
    degreesByString: naming.degreesByString,
    symbol: naming.symbol,
    name: naming.name,
    familyId: family?.id ?? 'custom',
    cost: breakdown.total,
    breakdown,
    novelty: noveltyScore(shape),
    tags: []
  };
};

const generate = (family: VoicingFamily, root: string, tuning: Tuning, profile: HandProfile, limit: number, diversify: boolean) => {
  try {
    return generateVoicings({ root, family, tuning, profile, limit, diversify }).voicings;
  } catch {
    return [];
  }
};

/** Bass windows (semitones from the slot's reference bass) tried in order; the last one is unlimited. */
export const REGISTER_WINDOWS: readonly number[] = [5, 7, Infinity];

/**
 * The bass the slot is heard at: the current shape's bass in this tuning, else (legacy notes) the lowest
 * written note, else null (no register preference).
 */
const referenceBass = (slot: RhythmSlot, tuning: Tuning): number | null => {
  if (slot.tuningId === tuning.id && fitsTuning(slot.shape, tuning)) return bassMidi(slot.shape, tuning);
  const oldTuning = getTuning(slot.tuningId);
  if (oldTuning && fitsTuning(slot.shape, oldTuning)) return bassMidi(slot.shape, oldTuning);
  if (slot.source.kind === 'notes') {
    const midi = slot.source.notes.map(parseNoteName).filter((m): m is number => m !== null);
    return midi.length > 0 ? Math.min(...midi) : null;
  }
  return null;
};

/** The narrowest register window that leaves at least two voicings (riffs keep their register), first k. */
const nearRegister = (voicings: GeneratedVoicing[], bass: number | null, k: number): GeneratedVoicing[] => {
  if (bass === null) return voicings.slice(0, k);
  for (const window of REGISTER_WINDOWS) {
    const near = voicings.filter((v) => Math.abs(Math.min(...v.midi) - bass) <= window);
    if (near.length >= 2 || window === Infinity) return near.slice(0, k);
  }
  return voicings.slice(0, k);
};

/** Pool searched before the register filter, so k voicings usually survive it. */
const CANDIDATE_POOL_FACTOR = 4;

/**
 * Up to k diversified engine voicings of the slot's recipe for this tuning and hand, kept near the slot's
 * register: the bass stays within a fourth of the slot's current bass (a fifth, then anywhere, when fewer than
 * two voicings qualify), so the optimizer never trades a low chug chord for an easier high dyad. The slot's
 * current shape is put first when it is valid for the tuning and fingerable but not among them.
 */
export const slotCandidates = (
  slot: RhythmSlot,
  tuning: Tuning,
  profile: HandProfile,
  k: number = DEFAULT_SLOT_CANDIDATES
): GeneratedVoicing[] => {
  const family = slotFamily(slot);
  const root = generationRoot(slot);
  const pool = family ? generate(family, root, tuning, profile, k * CANDIDATE_POOL_FACTOR, true) : [];
  const voicings = nearRegister(pool, referenceBass(slot, tuning), k);
  if (slot.tuningId !== tuning.id || !fitsTuning(slot.shape, tuning)) return voicings;
  const key = shapeKey(slot.shape);
  if (voicings.some((v) => shapeKey(v.shape) === key)) return voicings;
  const current = voicingForShape(slot.shape, tuning, profile, family, root);
  return current ? [current, ...voicings] : voicings;
};

/** Widest profile the engine accepts: used only to show finger numbers for a shape outside the user's hand. */
const permissiveProfile = (profile: HandProfile): HandProfile => ({
  ...profile,
  stretchTolerance: PROFILE_LIMITS.stretchTolerance[1],
  noBarre: false,
  allowTwoStringPartialBarre: true,
  maxFret: PROFILE_LIMITS.maxFret[1],
  allowOpenStrings: true,
  maxInteriorMutes: PROFILE_LIMITS.maxInteriorMutes[1]
});

/** Best fingering for display: the user's profile first, then a permissive one; null when none exists. */
export const displayFingering = (shape: Shape, tuning: Tuning, profile: HandProfile): Fingering | null => {
  if (!fitsTuning(shape, tuning)) return null;
  const own = findBestFingering(shape, profile);
  if (own.ok === true) return own.fingering;
  const loose = findBestFingering(shape, permissiveProfile(profile));
  return loose.ok === true ? loose.fingering : null;
};

export interface SlotInput {
  id?: string;
  label: string;
  root: string;
  source: RhythmSlotSource;
  shape: readonly (number | null)[];
  tuningId: string;
  pedalMidi?: number | null;
}

const isMidi = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 127;

const validSource = (source: unknown): RhythmSlotSource | null => {
  if (typeof source !== 'object' || source === null) return null;
  const s = source as Record<string, unknown>;
  if (s.kind === 'family') {
    return typeof s.familyId === 'string' && s.familyId.length > 0 ? { kind: 'family', familyId: s.familyId } : null;
  }
  if (s.kind === 'notes') {
    if (!Array.isArray(s.notes) || typeof s.baseRoot !== 'string' || parsePitchClass(s.baseRoot) === null) return null;
    const notes = s.notes.filter((n): n is string => typeof n === 'string' && parseNoteName(n) !== null);
    return notes.length > 0 ? { kind: 'notes', notes, baseRoot: s.baseRoot } : null;
  }
  return null;
};

/**
 * A complete, validated slot (fresh id unless given; default pedal unless a MIDI note is given), or null when
 * the tuning is unknown, the shape does not fit it, the root does not parse or the source is malformed.
 */
export const createRhythmSlot = (input: SlotInput): RhythmSlot | null => {
  const tuning = getTuning(input.tuningId);
  const source = validSource(input.source);
  if (!tuning || !source || parsePitchClass(input.root) === null) return null;
  const shape = Array.isArray(input.shape) ? [...input.shape] : [];
  if (!fitsTuning(shape, tuning)) return null;
  return {
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : newSlotId(),
    label: typeof input.label === 'string' && input.label.trim().length > 0 ? input.label.trim() : input.root,
    root: input.root,
    source,
    shape,
    tuningId: tuning.id,
    pedalMidi: isMidi(input.pedalMidi) ? input.pedalMidi : defaultPedalMidi(shape, tuning, input.root)
  };
};

/** Validates a persisted slot; null drops it. A stored null pedal stays null (playback uses the bass). */
export const sanitizeRhythmSlot = (raw: unknown): RhythmSlot | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.label !== 'string' || typeof r.root !== 'string' || typeof r.tuningId !== 'string') {
    return null;
  }
  if (!Array.isArray(r.shape) || !r.shape.every((f) => f === null || (Number.isInteger(f) && (f as number) >= 0))) return null;
  const slot = createRhythmSlot({
    id: r.id,
    label: r.label,
    root: r.root,
    source: r.source as RhythmSlotSource,
    shape: r.shape as (number | null)[],
    tuningId: r.tuningId,
    pedalMidi: isMidi(r.pedalMidi) ? r.pedalMidi : undefined
  });
  if (!slot) return null;
  return r.pedalMidi === null ? { ...slot, pedalMidi: null } : slot;
};

export const toHarmonySlots = (slots: readonly RhythmSlot[]): HarmonySlot[] =>
  slots.map((slot) => ({ shape: [...slot.shape], pedalMidi: slot.pedalMidi }));

const sortedMidi = (notes: readonly number[]): string => [...notes].sort((a, b) => a - b).join(',');

const cheapest = (voicings: readonly GeneratedVoicing[]): GeneratedVoicing | null =>
  voicings.reduce<GeneratedVoicing | null>((best, v) => (best === null || v.cost < best.cost ? v : best), null);

/** Search size used to find an exact sounding match before falling back to the cheapest voicing. */
const EXACT_MATCH_SEARCH = 300;

/** The cheapest voicing whose sounding notes equal `midi` (as a multiset), searching beyond the top k. */
const exactMatch = (family: VoicingFamily, root: string, tuning: Tuning, profile: HandProfile, midi: readonly number[]) => {
  const target = sortedMidi(midi);
  return cheapest(generate(family, root, tuning, profile, EXACT_MATCH_SEARCH, false).filter((v) => sortedMidi(v.midi) === target));
};

/**
 * Re-voices a slot for another tuning: the voicing that sounds the same notes when one exists, otherwise the
 * cheapest one of its recipe. Unchanged when it already belongs to `tuning`; null when nothing is playable.
 */
export const retuneSlot = (slot: RhythmSlot, tuning: Tuning, profile: HandProfile): RhythmSlot | null => {
  if (slot.tuningId === tuning.id && fitsTuning(slot.shape, tuning)) return slot;
  const family = slotFamily(slot);
  if (!family) return null;
  const root = generationRoot(slot);
  const oldTuning = getTuning(slot.tuningId);
  const oldMidi = oldTuning && fitsTuning(slot.shape, oldTuning) ? shapeToMidi(slot.shape, oldTuning) : null;
  const pick =
    (oldMidi ? exactMatch(family, root, tuning, profile, oldMidi) : null) ??
    cheapest(generate(family, root, tuning, profile, DEFAULT_SLOT_CANDIDATES, true));
  if (!pick) return null;
  const shape = [...pick.shape];
  return { ...slot, shape, tuningId: tuning.id, pedalMidi: defaultPedalMidi(shape, tuning, slot.root) };
};

/** The implicit slot used while the lab has none: the cheapest power chord on `root`. */
export const implicitPowerSlot = (root: string, tuning: Tuning, profile: HandProfile): RhythmSlot | null => {
  const family = getFamily('power5');
  if (!family || parsePitchClass(root) === null) return null;
  const pick = cheapest(generate(family, root, tuning, profile, DEFAULT_SLOT_CANDIDATES, true));
  if (!pick) return null;
  return {
    id: 'implicit-power5',
    label: `${root}5`,
    root,
    source: { kind: 'family', familyId: 'power5' },
    shape: [...pick.shape],
    tuningId: tuning.id,
    pedalMidi: defaultPedalMidi(pick.shape, tuning, root)
  };
};

export interface RiffStepLike {
  name: string;
  subtext: string;
  notes: readonly string[];
}

/**
 * RiffBar bridge: the first `max` distinct steps (same name and notes count once) become slots with a
 * legacy-notes recipe on the step's root. Each starts on the voicing that sounds exactly the step's notes
 * when one exists, else on the cheapest voicing; steps with no playable voicing are skipped.
 */
export const slotsFromRiffSteps = (
  steps: readonly RiffStepLike[],
  tuning: Tuning,
  profile: HandProfile,
  max: number = MAX_RHYTHM_SLOTS
): RhythmSlot[] => {
  const seen = new Set<string>();
  const slots: RhythmSlot[] = [];
  for (const step of steps) {
    if (slots.length >= max) break;
    const key = `${step.name}|${step.notes.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const notes = step.notes.filter((n) => parseNoteName(n) !== null);
    if (notes.length === 0) continue;
    const baseRoot = parseRoot(step.name, step.subtext);
    const source: RhythmSlotSource = { kind: 'notes', notes: [...notes], baseRoot };
    const family = slotFamily({ source });
    if (!family) continue;
    const midi = notes.map((n) => parseNoteName(n) as number);
    const pick =
      exactMatch(family, baseRoot, tuning, profile, midi) ??
      cheapest(generate(family, baseRoot, tuning, profile, DEFAULT_SLOT_CANDIDATES, true));
    if (!pick) continue;
    const slot = createRhythmSlot({ label: step.name, root: baseRoot, source, shape: pick.shape, tuningId: tuning.id });
    if (slot) slots.push(slot);
  }
  return slots;
};

export const slotShapesKey = (slots: readonly Pick<RhythmSlot, 'shape' | 'tuningId'>[]): string =>
  slots.map((s) => `${s.tuningId}:${shapeKey(s.shape)}`).join('|');

// ---------------------------------------------------------------------------
// Change timing and the fingering optimizer
// ---------------------------------------------------------------------------

const isChordAttack = (e: RhythmEvent): e is RhythmEvent & { target: Extract<HitTarget, { slot: number }> } =>
  !e.tie && (e.target.kind === 'slot' || e.target.kind === 'dyad');

/**
 * Time available for each slot's chord change, in quarter-note beats (the unit optimizeSequence scales by
 * 60 / bpm). Walking the slot and dyad attacks of the looping pattern, every point where the next chord
 * attack is on a different slot is a change: its time runs from the last attack on the old slot to the first
 * attack on the new one, so pedal hits, dead notes, rests and ties in between all count as time to move.
 * Each slot gets its shortest change (the hardest moment to leave it). Slots that are never left, including
 * slots the pattern never plays, get the whole pattern length. The optimizer chains slots in index order
 * (1 -> 2 -> ... -> 1), so this is the worst case of leaving slot i for whichever slot actually follows.
 */
export const changeBeats = (pattern: RhythmPattern, slotCount: number): number[] => {
  const count = Math.max(0, Math.floor(slotCount));
  const length = patternLengthTicks(pattern);
  const best: number[] = Array.from({ length: count }, () => Infinity);
  const attacks = pattern.events.filter(isChordAttack);
  if (attacks.length > 1) {
    for (let i = 0; i < attacks.length; i++) {
      const from = attacks[i];
      const next = attacks[(i + 1) % attacks.length];
      if (from.target.slot === next.target.slot) continue;
      const gap = i + 1 < attacks.length ? next.tick - from.tick : length - from.tick + next.tick;
      const slot = from.target.slot;
      if (slot >= 0 && slot < count && gap < best[slot]) best[slot] = gap;
    }
  }
  return best.map((ticks) => (Number.isFinite(ticks) ? ticks : length) / PPQ);
};

export interface SlotShapeOptimization {
  /** Chosen shape per slot. */
  shapes: (number | null)[][];
  /** Fingering per slot chosen together with its neighbours (show these, not the candidates' own). */
  fingerings: Fingering[];
  result: OptimizedSequence;
  /** describeTransition of the hardest change plus its cost rounded to 0.1. */
  text: string;
}

/**
 * Picks one voicing per slot so the hardest chord change of the looping pattern is as easy as possible at
 * this tempo (minimax Viterbi over slotCandidates, timed by changeBeats), with the user's hand profile so the
 * fingerings are chosen with their neighbours. Throws when a slot has no playable voicing at all.
 */
export const optimizeSlotShapes = (
  slots: readonly RhythmSlot[],
  pattern: RhythmPattern,
  tuning: Tuning,
  profile: HandProfile,
  bpm: number
): SlotShapeOptimization => {
  const candidates = slots.map((slot, i) => {
    const list = slotCandidates(slot, tuning, profile);
    if (list.length === 0) throw new Error(`Slot ${i + 1} (${slot.label}) has no playable voicing for your hand profile.`);
    return list;
  });
  const result = optimizeSequence(
    candidates,
    { bpm, beatsPerSlot: changeBeats(pattern, slots.length), cyclic: true },
    { profile }
  );
  const shapes = result.path.map((index, slot) => [...candidates[slot][index].shape]);
  const text =
    slots.length < 2
      ? describeTransition(null)
      : `${describeTransition(result.hardest)} (cost ${(Math.round(result.maxCost * 10) / 10).toFixed(1)})`;
  return { shapes, fingerings: result.fingerings, result, text };
};

// ---------------------------------------------------------------------------
// Transport timing
// ---------------------------------------------------------------------------

export const secondsPerTick = (bpm: number): number => 60 / (PPQ * bpm);

/** Loop length of the whole pattern in seconds at this (quarter-note) BPM. */
export const loopSeconds = (pattern: Pick<RhythmPattern, 'bars' | 'meter'>, bpm: number): number =>
  bpm > 0 ? patternLengthTicks(pattern) * secondsPerTick(bpm) : 0;

/** Metronome pulse in ticks: quarters in x/4, eighths in x/8. */
export const clickStepTicks = (meter: Meter): number => (meter.denominator === 8 ? PPQ / 2 : PPQ);

/** Click times over the pattern: one per pulse (see clickStepTicks), strong on every bar start. */
export const clickTimes = (pattern: Pick<RhythmPattern, 'bars' | 'meter'>, bpm: number): { timeSec: number; strong: boolean }[] => {
  if (!(bpm > 0)) return [];
  const step = clickStepTicks(pattern.meter);
  const bar = barTicks(pattern.meter);
  const length = patternLengthTicks(pattern);
  const out: { timeSec: number; strong: boolean }[] = [];
  for (let tick = 0; tick < length; tick += step) out.push({ timeSec: tick * secondsPerTick(bpm), strong: tick % bar === 0 });
  return out;
};

// ---------------------------------------------------------------------------
// Grid model and labels
// ---------------------------------------------------------------------------

const SUBDIVISION_NAMES: Readonly<Record<number, readonly string[]>> = {
  2: ['', '&'],
  3: ['', 'trip', 'let'],
  4: ['', 'e', '&', 'a'],
  6: ['', 'trip', 'let', '&', 'trip', 'let']
};

export interface UnitPosition {
  /** 1-based bar number. */
  bar: number;
  /** 1-based count within the bar: quarters in x/4, eighths in x/8. */
  beat: number;
  /** '' on the beat, else 'e', '&', 'a' (16ths) or 'trip', 'let' (16th triplets). */
  sub: string;
  /** Header text: the beat number on the beat, else the syllable. */
  label: string;
  isBarStart: boolean;
  isBeatStart: boolean;
}

export const unitPosition = (unit: number, meter: Meter, grid: RhythmGrid): UnitPosition => {
  const perBar = barUnits(meter, grid);
  const perBeat = clickStepTicks(meter) / gridUnitTicks(grid);
  const inBar = ((unit % perBar) + perBar) % perBar;
  const beat = Math.floor(inBar / perBeat) + 1;
  const index = inBar % perBeat;
  const sub = SUBDIVISION_NAMES[perBeat]?.[index] ?? (index === 0 ? '' : '.');
  return {
    bar: Math.floor(unit / perBar) + 1,
    beat,
    sub,
    label: sub === '' ? String(beat) : sub,
    isBarStart: inBar === 0,
    isBeatStart: index === 0
  };
};

export type LaneId = string;

export interface RhythmLane {
  id: LaneId;
  label: string;
  /** Spoken name ("pedal", "slot 2", "dead note"). */
  spoken: string;
  /** Target a fresh hit in this lane gets. */
  target: HitTarget;
}

export const laneIdOf = (target: HitTarget): LaneId =>
  target.kind === 'slot' || target.kind === 'dyad' ? `slot-${target.slot}` : target.kind;

/** Pedal, Slot 1..N, Dead (top to bottom). */
export const rhythmLanes = (slotCount: number, slotLabels: readonly string[] = []): RhythmLane[] => [
  { id: 'pedal', label: 'Pedal', spoken: 'pedal', target: { kind: 'pedal' } },
  ...Array.from({ length: Math.max(1, slotCount) }, (_, i): RhythmLane => ({
    id: `slot-${i}`,
    label: slotLabels[i] ? `${i + 1} ${slotLabels[i]}` : `Slot ${i + 1}`,
    spoken: slotLabels[i] ? `slot ${i + 1}, ${slotLabels[i]}` : `slot ${i + 1}`,
    target: { kind: 'slot', slot: i }
  })),
  { id: 'dead', label: 'Dead', spoken: 'dead note', target: { kind: 'dead' } }
];

export interface GridColumn {
  unit: number;
  /** Events whose onset lies in this cell (two in a 32nd tremolo cell). */
  events: RhythmEvent[];
  /** Lane of the cell's first event, null when nothing starts here. */
  lane: LaneId | null;
  /** Lane of an earlier event still sounding through this cell (grid duration), when nothing starts here. */
  heldLane: LaneId | null;
}

/** One column per grid unit, in order. */
export const gridColumns = (pattern: RhythmPattern): GridColumn[] => {
  const unitTicks = gridUnitTicks(pattern.params.grid);
  const units = patternLengthTicks(pattern) / unitTicks;
  const columns: GridColumn[] = [];
  let e = 0;
  let last: RhythmEvent | null = null;
  for (let unit = 0; unit < units; unit++) {
    const start = unit * unitTicks;
    const end = start + unitTicks;
    const events: RhythmEvent[] = [];
    while (e < pattern.events.length && pattern.events[e].tick < end) {
      if (pattern.events[e].tick >= start) events.push(pattern.events[e]);
      last = pattern.events[e];
      e++;
    }
    const heldLane =
      events.length === 0 && last && last.tick < start && last.tick + last.durationTicks > start ? laneIdOf(last.target) : null;
    columns.push({ unit, events, lane: events.length > 0 ? laneIdOf(events[0].target) : null, heldLane });
  }
  return columns;
};

/** Target for a toggle in `lane`: the cell's own event target when it is in this lane (so it clears). */
export const toggleTargetFor = (lane: RhythmLane, column: GridColumn): HitTarget =>
  column.lane === lane.id && column.events[0] ? { ...column.events[0].target } : { ...lane.target };

const ACCENT_WORDS = ['', 'accent', 'strong accent'] as const;

/**
 * Screen-reader label for one cell, e.g. "Bar 1, beat 2, e, pedal, palm muted, accent, down",
 * "Bar 1, beat 1, slot 1, dyad, strong accent, down" or "Bar 1, beat 2, e, pedal, rest".
 */
export const describeCell = (position: UnitPosition, lane: RhythmLane, column: GridColumn): string => {
  const parts = [`Bar ${position.bar}`, `beat ${position.beat}`];
  if (position.sub) parts.push(position.sub);
  parts.push(lane.spoken);
  const first = column.events[0];
  if (!first || column.lane !== lane.id) {
    if (column.heldLane === lane.id) parts.push('held');
    else parts.push(column.lane === null && column.heldLane === null ? 'rest' : 'empty');
    return parts.join(', ');
  }
  if (first.target.kind === 'dyad') parts.push('dyad');
  if (first.tie) {
    parts.push('tied');
  } else {
    if (first.palmMute) parts.push('palm muted');
    if (first.accent > 0) parts.push(ACCENT_WORDS[first.accent]);
    parts.push(first.pick);
  }
  if (column.events.length > 1) parts.push(`${column.events.length} notes`);
  return parts.join(', ');
};
