import { create } from 'zustand';
import type { FingerNumber, HandProfile, HitTarget, RhythmParams, RhythmPattern, RhythmStyleId, Tuning } from '../engine/types';
import { generateRhythm, sanitizeRhythmParams } from '../engine/rhythm/generate';
import { RHYTHM_STYLE_IDS, defaultRhythmParams } from '../engine/rhythm/styles';
import { mutateRhythm, regenerateRhythm } from '../engine/rhythm/variation';
import { validateRhythm } from '../engine/rhythm/validate';
import { clearHit, cycleAccent, setSlotCount, togglePalmMute, toggleHit } from '../engine/rhythm/edit';
import { barTicks } from '../engine/rhythm/grid';
import { getTuning } from '../engine/tuning';
import { isValidShape } from '../engine/shape';
import { clampBpm, useRiffStore } from './riffStore';
import { useChordStore } from './chordStore';
import { useHandProfileStore } from './handProfileStore';
import { tuningForMode } from '../utils/libraryVoicing';
import {
  MAX_RHYTHM_SLOTS,
  createRhythmSlot,
  defaultPedalMidi,
  optimizeSlotShapes,
  retuneSlot,
  sanitizeRhythmSlot,
  slotShapesKey,
  slotsFromRiffSteps,
  type RhythmSlot,
  type SlotInput
} from '../utils/rhythmSlots';

export type { RhythmSlot, RhythmSlotSource, SlotInput } from '../utils/rhythmSlots';
export { MAX_RHYTHM_SLOTS, createRhythmSlot } from '../utils/rhythmSlots';
export { MIN_BPM, MAX_BPM } from './riffStore';

export const RHYTHM_STORAGE_KEY = 'riffforge:rhythm:v1';
export const RHYTHM_BAR_OPTIONS: readonly number[] = [1, 2, 4];
export const DEFAULT_RHYTHM_STYLE: RhythmStyleId = 'chugEngine';
export const DEFAULT_RHYTHM_SEED = 'riffforge';

// Single access point for the hand profile used by the Rhythm Lab (the user's calibrated profile).
export const getRhythmHandProfile = (): HandProfile => useHandProfileStore.getState().profile;
export const useRhythmHandProfile = (): HandProfile => useHandProfileStore((s) => s.profile);

/** The app's current tuning (Standard / Drop from the chord store). */
export const getRhythmTuning = (): Tuning => tuningForMode(useChordStore.getState().tuningMode);

/** Knobs the Rhythm Lab exposes besides the style preset. */
export type RhythmParamPatch = Partial<Pick<RhythmParams, 'density' | 'syncopation' | 'grid' | 'bars' | 'picking'>>;

export interface RhythmOptimization {
  text: string;
  maxCost: number;
  /** Finger per string per slot, chosen together with the neighbours. Valid while shapesKey matches. */
  fingers: (FingerNumber | null)[][];
  shapesKey: string;
}

export type OptimizeOutcome = { ok: true; text: string } | { ok: false; message: string };

interface PersistedRhythm {
  params: RhythmParams;
  seed: string;
  pattern: RhythmPattern;
  slots: RhythmSlot[];
  bpm: number;
  lockedBars: number[];
  metronomeOn: boolean;
}

export interface RhythmStore extends PersistedRhythm {
  isPlaying: boolean;
  /** Grid unit under the playhead, -1 when idle. */
  playheadUnit: number;
  optimization: RhythmOptimization | null;

  setStyle: (style: RhythmStyleId) => void;
  setParam: (patch: RhythmParamPatch) => void;
  newIdea: () => void;
  mutate: () => boolean;
  toggleLockBar: (bar: number) => void;
  toggleHitAt: (unit: number, target: HitTarget) => void;
  cycleAccentAt: (unit: number) => void;
  togglePalmMuteAt: (unit: number) => void;
  clearHitAt: (unit: number) => void;
  setBpm: (bpm: number) => void;
  setMetronome: (on: boolean) => void;
  addSlot: (slot: SlotInput) => boolean;
  removeSlot: (id: string) => void;
  setSlotShape: (id: string, shape: readonly (number | null)[]) => boolean;
  /**
   * RiffBar bridge: replaces the slots with the first distinct RiffBar steps (app tuning and hand profile by
   * default); returns how many slots were made (0 leaves the slots alone).
   */
  useRiffBarChords: (tuning?: Tuning, profile?: HandProfile) => number;
  /** Re-voices slots that belong to another tuning; returns how many slots had to be dropped. */
  retuneSlots: (tuning?: Tuning, profile?: HandProfile) => number;
  optimizeSlots: (profile: HandProfile, tuning: Tuning) => OptimizeOutcome;
  setIsPlaying: (value: boolean) => void;
  setPlayheadUnit: (unit: number) => void;
}

// ---------------------------------------------------------------------------
// Pure state helpers (exported for tests)
// ---------------------------------------------------------------------------

export const slotCountFor = (slots: readonly unknown[]): number => Math.min(MAX_RHYTHM_SLOTS, Math.max(1, slots.length));

/** App code may use crypto for seeds; the engine itself stays seeded and deterministic. */
export const randomSeed = (): string => {
  try {
    const bytes = new Uint32Array(1);
    globalThis.crypto.getRandomValues(bytes);
    return bytes[0].toString(36).padStart(7, '0');
  } catch {
    return Math.floor(Math.random() * 0xffffffff).toString(36).padStart(7, '0');
  }
};

const sanitizeLocks = (bars: readonly unknown[], barCount: number): number[] =>
  [...new Set(bars.filter((b): b is number => Number.isInteger(b) && (b as number) >= 0 && (b as number) < barCount))].sort(
    (a, b) => a - b
  );

const sameMeter = (a: RhythmPattern['meter'], b: RhythmPattern['meter']): boolean =>
  a.numerator === b.numerator && a.denominator === b.denominator;

/**
 * A fresh pattern for params + seed that keeps the old pattern's locked bars (engine regenerateRhythm). Locks
 * only survive while meter and grid stay the same; otherwise the old bars would not line up with the new grid.
 * When the merge does not validate, the fresh pattern wins and the locks are dropped.
 */
export const regenerateKeepingLocks = (
  old: RhythmPattern | null,
  params: RhythmParams,
  seed: string,
  lockedBars: readonly number[]
): { pattern: RhythmPattern; lockedBars: number[] } => {
  const fresh = generateRhythm(params, seed);
  const locks = sanitizeLocks(lockedBars, fresh.bars);
  if (!old || locks.length === 0) return { pattern: fresh, lockedBars: locks };
  if (!sameMeter(old.meter, fresh.meter) || old.params.grid !== fresh.params.grid) return { pattern: fresh, lockedBars: [] };
  try {
    const input: RhythmPattern = { ...old, bars: fresh.bars, meter: { ...fresh.meter }, params: fresh.params };
    const merged = regenerateRhythm(input, seed, locks);
    if (validateRhythm(merged).ok === true) return { pattern: merged, lockedBars: locks };
  } catch {
    // Fall through to the fresh pattern
  }
  return { pattern: fresh, lockedBars: [] };
};

const eventsInBars = (pattern: RhythmPattern, bars: readonly number[]): string => {
  const bar = barTicks(pattern.meter);
  return JSON.stringify(pattern.events.filter((e) => bars.includes(Math.floor(e.tick / bar))));
};

/**
 * True when an unlocked bar no longer matches what params + seed generate, i.e. the player edited or mutated it.
 * Locked bars are the player's by definition and are kept by regenerateKeepingLocks anyway.
 */
export const hasUnlockedChanges = (
  pattern: RhythmPattern,
  params: RhythmParams,
  seed: string,
  lockedBars: readonly number[]
): boolean => {
  const fresh = generateRhythm(params, seed);
  if (fresh.bars !== pattern.bars || !sameMeter(fresh.meter, pattern.meter) || fresh.params.grid !== pattern.params.grid) return true;
  const unlocked = Array.from({ length: pattern.bars }, (_, bar) => bar).filter((bar) => !lockedBars.includes(bar));
  return eventsInBars(pattern, unlocked) !== eventsInBars(fresh, unlocked);
};

const MUTATE_ATTEMPTS = 8;

/** mutateRhythm with seeds derived from the pattern seed; a result that touches a locked bar is retried. */
export const mutateKeepingLocks = (pattern: RhythmPattern, seed: string, lockedBars: readonly number[], round: number): RhythmPattern | null => {
  const locked = eventsInBars(pattern, lockedBars);
  const before = JSON.stringify(pattern.events);
  for (let attempt = 0; attempt < MUTATE_ATTEMPTS; attempt++) {
    const next = mutateRhythm(pattern, `${seed}/m${round}.${attempt}`);
    if (JSON.stringify(next.events) === before) continue;
    if (lockedBars.length > 0 && eventsInBars(next, lockedBars) !== locked) continue;
    return next;
  }
  return null;
};

const isPatternLike = (value: unknown): value is RhythmPattern => {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.seed === 'string' &&
    Array.isArray(p.events) &&
    typeof p.params === 'object' &&
    p.params !== null &&
    typeof p.meter === 'object' &&
    p.meter !== null &&
    Array.isArray(p.tags)
  );
};

const paramsFor = (style: RhythmStyleId, slots: readonly unknown[]): RhythmParams => ({
  ...defaultRhythmParams(style),
  slotCount: slotCountFor(slots)
});

const defaultBpm = (): number => {
  try {
    return clampBpm(useRiffStore.getState().bpm);
  } catch {
    return clampBpm(NaN);
  }
};

export const createDefaultRhythmState = (): PersistedRhythm => {
  const params = paramsFor(DEFAULT_RHYTHM_STYLE, []);
  return {
    params,
    seed: DEFAULT_RHYTHM_SEED,
    pattern: generateRhythm(params, DEFAULT_RHYTHM_SEED),
    slots: [],
    bpm: defaultBpm(),
    lockedBars: [],
    metronomeOn: false
  };
};

/** An old pattern is only reused for its locked bars when it validates on its own. */
const safePattern = (pattern: RhythmPattern): RhythmPattern | null => {
  try {
    return validateRhythm(pattern).ok === true ? pattern : null;
  } catch {
    return null;
  }
};

/**
 * Parses persisted state defensively: unknown styles or malformed params fall back to the defaults, invalid
 * slots are dropped (shapes must fit their tuning), and a pattern that does not validate against its params is
 * regenerated from params + seed (keeping valid locks). Never throws.
 */
export const parseRhythmState = (raw: string | null): PersistedRhythm => {
  const fallback = createDefaultRhythmState();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return fallback;

    const slots = (Array.isArray(parsed.slots) ? parsed.slots : [])
      .map(sanitizeRhythmSlot)
      .filter((s): s is RhythmSlot => s !== null)
      .slice(0, MAX_RHYTHM_SLOTS);
    const rawParams = parsed.params as RhythmParams | undefined;
    const knownStyle = !!rawParams && typeof rawParams === 'object' && RHYTHM_STYLE_IDS.includes(rawParams.style);
    const params: RhythmParams = knownStyle
      ? { ...sanitizeRhythmParams(rawParams as RhythmParams), slotCount: slotCountFor(slots) }
      : paramsFor(DEFAULT_RHYTHM_STYLE, slots);
    const seed = typeof parsed.seed === 'string' && parsed.seed.length > 0 ? parsed.seed : DEFAULT_RHYTHM_SEED;
    const bars = params.bars;
    const lockedBars = sanitizeLocks(Array.isArray(parsed.lockedBars) ? parsed.lockedBars : [], bars);

    let pattern: RhythmPattern | null = null;
    if (knownStyle && isPatternLike(parsed.pattern)) {
      const candidate = parsed.pattern;
      const matches =
        candidate.params.style === params.style &&
        candidate.bars === params.bars &&
        candidate.params.grid === params.grid &&
        candidate.params.slotCount === params.slotCount &&
        sameMeter(candidate.meter, params.meter);
      if (matches && validateRhythm(candidate).ok === true) pattern = candidate;
    }
    let locks = lockedBars;
    if (pattern === null) {
      const rebuilt = regenerateKeepingLocks(isPatternLike(parsed.pattern) ? safePattern(parsed.pattern) : null, params, seed, lockedBars);
      pattern = rebuilt.pattern;
      locks = rebuilt.lockedBars;
    }

    return {
      params,
      seed,
      pattern,
      slots,
      bpm: typeof parsed.bpm === 'number' ? clampBpm(parsed.bpm) : fallback.bpm,
      lockedBars: locks,
      metronomeOn: parsed.metronomeOn === true
    };
  } catch {
    return fallback;
  }
};

const loadRhythm = (): PersistedRhythm => {
  try {
    if (typeof localStorage === 'undefined') return createDefaultRhythmState();
    return parseRhythmState(localStorage.getItem(RHYTHM_STORAGE_KEY));
  } catch {
    return createDefaultRhythmState();
  }
};

const saveRhythm = (state: PersistedRhythm): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    const { params, seed, pattern, slots, bpm, lockedBars, metronomeOn } = state;
    localStorage.setItem(RHYTHM_STORAGE_KEY, JSON.stringify({ params, seed, pattern, slots, bpm, lockedBars, metronomeOn }));
  } catch {
    // Storage unavailable (private mode, quota): the lab keeps working in memory
  }
};

const PERSISTED_KEYS: readonly (keyof PersistedRhythm)[] = ['params', 'seed', 'pattern', 'slots', 'bpm', 'lockedBars', 'metronomeOn'];

const clamp01 = (x: unknown, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initial = loadRhythm();
let mutationRound = 0;

export const useRhythmStore = create<RhythmStore>((set, get) => {
  /**
   * New slots: keeps params.slotCount in sync when the count changes. An untouched pattern is regenerated (same
   * seed, locks kept) so every slot gets its chord changes; edited or mutated events are kept, with slot targets
   * folded into range.
   */
  const withSlots = (slots: RhythmSlot[]): Partial<RhythmStore> => {
    const state = get();
    const count = slotCountFor(slots);
    if (count === state.params.slotCount) return { slots, optimization: null };
    const params = { ...state.params, slotCount: count };
    if (hasUnlockedChanges(state.pattern, state.params, state.seed, state.lockedBars)) {
      return { slots, params, pattern: setSlotCount(state.pattern, count), optimization: null };
    }
    const { pattern, lockedBars } = regenerateKeepingLocks(state.pattern, params, state.seed, state.lockedBars);
    return { slots, params, pattern, lockedBars, optimization: null };
  };

  const regenerate = (params: RhythmParams, seed: string): Partial<RhythmStore> => {
    const state = get();
    const { pattern, lockedBars } = regenerateKeepingLocks(state.pattern, params, seed, state.lockedBars);
    return { params, seed, pattern, lockedBars };
  };

  return {
    ...initial,
    isPlaying: false,
    playheadUnit: -1,
    optimization: null,

    setStyle: (style) => {
      if (!RHYTHM_STYLE_IDS.includes(style)) return;
      set(regenerate(paramsFor(style, get().slots), get().seed));
    },

    setParam: (patch) => {
      const current = get().params;
      const next: RhythmParams = { ...current };
      if (patch.density !== undefined) next.density = clamp01(patch.density, current.density);
      if (patch.syncopation !== undefined) next.syncopation = clamp01(patch.syncopation, current.syncopation);
      if (patch.grid === '16th' || patch.grid === '16th-triplet') next.grid = patch.grid;
      if (patch.picking === 'alternate' || patch.picking === 'downstrokes') next.picking = patch.picking;
      if (patch.bars !== undefined && RHYTHM_BAR_OPTIONS.includes(patch.bars)) next.bars = patch.bars;
      set(regenerate(next, get().seed));
    },

    newIdea: () => {
      mutationRound = 0;
      set(regenerate(get().params, randomSeed()));
    },

    mutate: () => {
      const { pattern, seed, lockedBars } = get();
      const next = mutateKeepingLocks(pattern, seed, lockedBars, mutationRound++);
      if (!next) return false;
      set({ pattern: next });
      return true;
    },

    toggleLockBar: (bar) => {
      const { lockedBars, pattern } = get();
      if (!Number.isInteger(bar) || bar < 0 || bar >= pattern.bars) return;
      set({ lockedBars: lockedBars.includes(bar) ? lockedBars.filter((b) => b !== bar) : [...lockedBars, bar].sort((a, b) => a - b) });
    },

    toggleHitAt: (unit, target) => set({ pattern: toggleHit(get().pattern, unit, target) }),
    cycleAccentAt: (unit) => set({ pattern: cycleAccent(get().pattern, unit) }),
    togglePalmMuteAt: (unit) => set({ pattern: togglePalmMute(get().pattern, unit) }),
    clearHitAt: (unit) => set({ pattern: clearHit(get().pattern, unit) }),

    setBpm: (bpm) => set({ bpm: clampBpm(bpm) }),
    setMetronome: (on) => set({ metronomeOn: on === true }),

    addSlot: (input) => {
      const { slots } = get();
      if (slots.length >= MAX_RHYTHM_SLOTS) return false;
      const slot = createRhythmSlot(input);
      if (!slot || slots.some((s) => s.id === slot.id)) return false;
      set(withSlots([...slots, slot]));
      return true;
    },

    removeSlot: (id) => {
      const { slots } = get();
      if (!slots.some((s) => s.id === id)) return;
      set(withSlots(slots.filter((s) => s.id !== id)));
    },

    setSlotShape: (id, shape) => {
      const { slots } = get();
      const slot = slots.find((s) => s.id === id);
      const tuning = slot ? getTuning(slot.tuningId) : undefined;
      if (!slot || !tuning || !isValidShape(shape, tuning.openMidi.length) || !shape.some((f) => f !== null)) return false;
      const next = [...shape];
      set({
        slots: slots.map((s) => (s.id === id ? { ...s, shape: next, pedalMidi: defaultPedalMidi(next, tuning, s.root) } : s)),
        optimization: null
      });
      return true;
    },

    useRiffBarChords: (tuning = getRhythmTuning(), profile = getRhythmHandProfile()) => {
      const slots = slotsFromRiffSteps(useRiffStore.getState().steps, tuning, profile);
      if (slots.length === 0) return 0;
      set(withSlots(slots));
      return slots.length;
    },

    retuneSlots: (tuning = getRhythmTuning(), profile = getRhythmHandProfile()) => {
      const { slots } = get();
      if (slots.every((s) => s.tuningId === tuning.id)) return 0;
      const retuned = slots.map((s) => retuneSlot(s, tuning, profile)).filter((s): s is RhythmSlot => s !== null);
      set(withSlots(retuned));
      return slots.length - retuned.length;
    },

    optimizeSlots: (profile, tuning) => {
      const { slots, pattern, bpm } = get();
      if (slots.length === 0) return { ok: false, message: 'Add chord slots first.' };
      try {
        const out = optimizeSlotShapes(slots, pattern, tuning, profile, bpm);
        const next = slots.map((s, i) => {
          const shape = out.shapes[i];
          const same = s.tuningId === tuning.id && slotShapesKey([s]) === slotShapesKey([{ shape, tuningId: tuning.id }]);
          return same ? s : { ...s, shape, tuningId: tuning.id, pedalMidi: defaultPedalMidi(shape, tuning, s.root) };
        });
        set({
          slots: next,
          optimization: {
            text: out.text,
            maxCost: out.result.maxCost,
            fingers: out.fingerings.map((f) => [...f.fingers]),
            shapesKey: slotShapesKey(next)
          }
        });
        return { ok: true, text: out.text };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Could not optimize these slots.' };
      }
    },

    setIsPlaying: (value) => set(value ? { isPlaying: true } : { isPlaying: false, playheadUnit: -1 }),
    setPlayheadUnit: (unit) => set({ playheadUnit: unit })
  };
});

useRhythmStore.subscribe((state, prev) => {
  if (PERSISTED_KEYS.some((key) => state[key] !== prev[key])) saveRhythm(state);
});

/**
 * Restarts playback after `delayMs` (pattern, slot, tuning or tempo changes mid-playback), but only while the lab
 * is still playing when the timer fires, so a Stop pressed in between is never undone. Returns a cancel function.
 */
export const scheduleRhythmRestart = (restart: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(() => {
    if (useRhythmStore.getState().isPlaying) restart();
  }, delayMs);
  return () => clearTimeout(timer);
};
