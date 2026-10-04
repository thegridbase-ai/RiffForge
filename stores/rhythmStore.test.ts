import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RHYTHM_STORAGE_KEY, regenerateKeepingLocks } from './rhythmStore';
import { RIFF_STORAGE_KEY } from './riffStore';
import { generateRhythm } from '../engine/rhythm/generate';
import { defaultRhythmParams } from '../engine/rhythm/styles';
import { validateRhythm } from '../engine/rhythm/validate';
import { barTicks } from '../engine/rhythm/grid';
import { DROP_D, E_STANDARD } from '../engine/tuning';
import { DEFAULT_HAND_PROFILE } from '../engine/handProfile';
import { shapeToMidi } from '../engine/shape';
import type { RhythmPattern } from '../engine/types';
import type { SlotInput } from './rhythmStore';

// Minimal in-memory localStorage for the node test environment
const createStorageMock = () => {
  let data: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = String(value); },
    removeItem: (key: string) => { delete data[key]; },
    clear: () => { data = {}; },
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; }
  } as Storage;
};

const freshStores = async () => {
  vi.resetModules();
  const rhythm = await import('./rhythmStore');
  const riff = await import('./riffStore');
  return { useRhythmStore: rhythm.useRhythmStore, useRiffStore: riff.useRiffStore };
};

const freshStore = async () => (await freshStores()).useRhythmStore;

const slotInput = (root: string, shape: (number | null)[], label = `${root}5`): SlotInput => ({
  label,
  root,
  source: { kind: 'family', familyId: 'power5' },
  shape,
  tuningId: E_STANDARD.id
});

const E5 = slotInput('E', [0, 2, 2, null, null, null]);
const G5 = slotInput('G', [3, 5, 5, null, null, null]);
const A5 = slotInput('A', [5, 7, 7, null, null, null]);
const C5 = slotInput('C', [null, 3, 5, 5, null, null]);
const D5 = slotInput('D', [null, 5, 7, 7, null, null]);

const eventsInBar = (pattern: RhythmPattern, bar: number) => {
  const length = barTicks(pattern.meter);
  return pattern.events.filter((e) => Math.floor(e.tick / length) === bar);
};

const slotsUsed = (pattern: RhythmPattern) =>
  new Set(pattern.events.flatMap((e) => (e.target.kind === 'slot' || e.target.kind === 'dyad' ? [e.target.slot] : [])));

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorageMock());
});

describe('rhythmStore defaults', () => {
  it('starts on the default style, seed and pattern with no slots', async () => {
    const store = await freshStore();
    const s = store.getState();
    expect(s.params).toEqual({ ...defaultRhythmParams('chugEngine'), slotCount: 1 });
    expect(s.seed).toBe('riffforge');
    expect(s.pattern).toEqual(generateRhythm(s.params, 'riffforge'));
    expect(s.slots).toEqual([]);
    expect(s.lockedBars).toEqual([]);
    expect(s.metronomeOn).toBe(false);
    expect(s.isPlaying).toBe(false);
    expect(s.playheadUnit).toBe(-1);
    expect(s.optimization).toBeNull();
    expect(s.bpm).toBe(120);
  });

  it("takes the RiffBar's bpm at first load", async () => {
    localStorage.setItem(RIFF_STORAGE_KEY, JSON.stringify({ steps: [], bpm: 165 }));
    const store = await freshStore();
    expect(store.getState().bpm).toBe(165);
  });

  it('is deterministic for a seed', async () => {
    const a = (await freshStore()).getState().pattern;
    localStorage.clear();
    const b = (await freshStore()).getState().pattern;
    expect(b).toEqual(a);
    const params = { ...defaultRhythmParams('gallop'), slotCount: 2 };
    expect(regenerateKeepingLocks(null, params, 'seed-x', []).pattern).toEqual(generateRhythm(params, 'seed-x'));
  });
});

describe('rhythmStore persistence', () => {
  it('round-trips params, seed, pattern, slots, bpm, locks and metronome', async () => {
    const store = await freshStore();
    const s = store.getState();
    s.setStyle('gallop');
    s.setParam({ bars: 4, density: 0.55 });
    s.addSlot(E5);
    s.addSlot(G5);
    s.toggleLockBar(1);
    s.setBpm(157);
    s.setMetronome(true);
    s.toggleHitAt(1, { kind: 'dead' });
    s.setIsPlaying(true);
    const before = store.getState();

    const reloaded = (await freshStore()).getState();
    expect(reloaded.params).toEqual(before.params);
    expect(reloaded.seed).toBe(before.seed);
    expect(reloaded.pattern).toEqual(before.pattern);
    expect(reloaded.slots).toEqual(before.slots);
    expect(reloaded.bpm).toBe(157);
    expect(reloaded.lockedBars).toEqual([1]);
    expect(reloaded.metronomeOn).toBe(true);
    expect(reloaded.isPlaying).toBe(false);
    expect(reloaded.optimization).toBeNull();
  });

  it('clamps bpm to 60..240', async () => {
    const store = await freshStore();
    store.getState().setBpm(500);
    expect(store.getState().bpm).toBe(240);
    store.getState().setBpm(10);
    expect(store.getState().bpm).toBe(60);
  });
});

describe('rhythmStore corrupt storage', () => {
  it('falls back to defaults on invalid JSON', async () => {
    localStorage.setItem(RHYTHM_STORAGE_KEY, '{not json');
    const s = (await freshStore()).getState();
    expect(s.params.style).toBe('chugEngine');
    expect(s.pattern).toEqual(generateRhythm(s.params, 'riffforge'));
  });

  it('falls back to defaults on an unknown style', async () => {
    localStorage.setItem(RHYTHM_STORAGE_KEY, JSON.stringify({ params: { style: 'polka' }, seed: 'abc', bpm: 130 }));
    const s = (await freshStore()).getState();
    expect(s.params.style).toBe('chugEngine');
    expect(s.bpm).toBe(130);
    expect(s.pattern).toEqual(generateRhythm(s.params, 'abc'));
  });

  it('regenerates an invalid pattern from params and seed and drops invalid slots', async () => {
    const params = { ...defaultRhythmParams('sevenEight'), slotCount: 1 };
    const broken = generateRhythm(params, 'p');
    broken.events = [...broken.events].reverse();
    localStorage.setItem(
      RHYTHM_STORAGE_KEY,
      JSON.stringify({
        params,
        seed: 'p',
        pattern: broken,
        slots: [{ id: 'bad', label: 'x', root: 'E', source: { kind: 'family', familyId: 'power5' }, shape: [0, 2], tuningId: 'e-standard', pedalMidi: null }, 42],
        bpm: 'fast',
        lockedBars: [0, 7, -1, 'x'],
        metronomeOn: 'yes'
      })
    );
    const s = (await freshStore()).getState();
    expect(s.slots).toEqual([]);
    expect(s.pattern).toEqual(generateRhythm(params, 'p'));
    expect(validateRhythm(s.pattern).ok).toBe(true);
    expect(s.bpm).toBe(120);
    expect(s.metronomeOn).toBe(false);
    expect(s.lockedBars.every((b) => b >= 0 && b < s.pattern.bars)).toBe(true);
  });

  it('keeps a stored pattern that still validates, even after hand edits', async () => {
    const store = await freshStore();
    store.getState().toggleHitAt(2, { kind: 'dead' });
    store.getState().cycleAccentAt(2);
    const edited = store.getState().pattern;
    expect(edited).not.toEqual(generateRhythm(store.getState().params, store.getState().seed));
    expect((await freshStore()).getState().pattern).toEqual(edited);
  });
});

describe('rhythmStore locks', () => {
  it('keeps a locked bar across newIdea', async () => {
    const store = await freshStore();
    store.getState().setStyle('gallop');
    store.getState().addSlot(E5);
    store.getState().addSlot(G5);
    store.getState().toggleLockBar(0);
    for (let i = 0; i < 5; i++) {
      const before = store.getState();
      before.newIdea();
      const after = store.getState();
      expect(after.seed).not.toBe(before.seed);
      expect(after.lockedBars).toEqual([0]);
      expect(eventsInBar(after.pattern, 0)).toEqual(eventsInBar(before.pattern, 0));
      expect(validateRhythm(after.pattern).ok).toBe(true);
    }
  });

  it('keeps locked bars across density changes but drops them on a grid change', async () => {
    const store = await freshStore();
    store.getState().toggleLockBar(1);
    const bar1 = eventsInBar(store.getState().pattern, 1);
    store.getState().setParam({ density: 0.2 });
    expect(eventsInBar(store.getState().pattern, 1)).toEqual(bar1);
    expect(store.getState().lockedBars).toEqual([1]);
    store.getState().setParam({ grid: '16th-triplet' });
    expect(store.getState().lockedBars).toEqual([]);
    expect(store.getState().pattern.params.grid).toBe('16th-triplet');
  });

  it('mutates without touching a locked bar', async () => {
    const store = await freshStore();
    store.getState().addSlot(E5);
    store.getState().addSlot(G5);
    store.getState().toggleLockBar(0);
    const bar0 = eventsInBar(store.getState().pattern, 0);
    let changed = 0;
    for (let i = 0; i < 6; i++) {
      const before = store.getState().pattern;
      if (store.getState().mutate()) {
        changed++;
        expect(store.getState().pattern.events).not.toEqual(before.events);
      }
      expect(eventsInBar(store.getState().pattern, 0)).toEqual(bar0);
      expect(validateRhythm(store.getState().pattern).ok).toBe(true);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('ignores locks outside the pattern', async () => {
    const store = await freshStore();
    store.getState().toggleLockBar(9);
    store.getState().toggleLockBar(-1);
    expect(store.getState().lockedBars).toEqual([]);
  });
});

describe('rhythmStore slots', () => {
  it('keeps params.slotCount in sync on add and remove', async () => {
    const store = await freshStore();
    const s = store.getState();
    expect(s.addSlot(E5)).toBe(true);
    expect(store.getState().params.slotCount).toBe(1);
    expect(s.addSlot(G5)).toBe(true);
    expect(store.getState().params.slotCount).toBe(2);
    expect(store.getState().pattern.params.slotCount).toBe(2);
    expect(slotsUsed(store.getState().pattern)).toEqual(new Set([0, 1]));
    expect(s.addSlot(A5)).toBe(true);
    expect(s.addSlot(C5)).toBe(true);
    expect(s.addSlot(D5)).toBe(false);
    expect(store.getState().slots).toHaveLength(4);
    expect(store.getState().pattern.params.slotCount).toBe(4);

    store.getState().removeSlot(store.getState().slots[1].id);
    expect(store.getState().slots.map((x) => x.label)).toEqual(['E5', 'A5', 'C5']);
    expect(store.getState().params.slotCount).toBe(3);
    expect(Math.max(...slotsUsed(store.getState().pattern))).toBeLessThan(3);
    expect(validateRhythm(store.getState().pattern).ok).toBe(true);

    for (const slot of store.getState().slots) store.getState().removeSlot(slot.id);
    expect(store.getState().slots).toEqual([]);
    expect(store.getState().params.slotCount).toBe(1);
  });

  it('keeps the rhythm figure when the slot count changes (same seed)', async () => {
    const store = await freshStore();
    const ticks = store.getState().pattern.events.map((e) => [e.tick, e.durationTicks, e.accent, e.palmMute]);
    store.getState().addSlot(E5);
    store.getState().addSlot(G5);
    expect(store.getState().pattern.events.map((e) => [e.tick, e.durationTicks, e.accent, e.palmMute])).toEqual(ticks);
  });

  it('keeps a hand edit in an unlocked bar when a slot is added', async () => {
    const store = await freshStore();
    store.getState().addSlot(E5);
    const before = store.getState().pattern.events;
    store.getState().toggleHitAt(3, { kind: 'dead' });
    const edited = store.getState().pattern;
    expect(edited.events).not.toEqual(before);
    expect(edited.events.some((e) => e.target.kind === 'dead')).toBe(true);
    expect(store.getState().lockedBars).toEqual([]);

    expect(store.getState().addSlot(G5)).toBe(true);
    const after = store.getState().pattern;
    expect(store.getState().params.slotCount).toBe(2);
    expect(after.params.slotCount).toBe(2);
    expect(after.events).toEqual(edited.events);
    expect(validateRhythm(after).ok).toBe(true);
  });

  it('keeps a hand edit and folds slots into range when a slot is removed', async () => {
    const store = await freshStore();
    store.getState().addSlot(E5);
    store.getState().addSlot(G5);
    store.getState().addSlot(A5);
    store.getState().toggleHitAt(3, { kind: 'dead' });
    const deadTicks = store.getState().pattern.events.filter((e) => e.target.kind === 'dead').map((e) => e.tick);
    expect(deadTicks.length).toBeGreaterThan(0);

    store.getState().removeSlot(store.getState().slots[2].id);
    const after = store.getState().pattern;
    expect(after.params.slotCount).toBe(2);
    expect(after.events.filter((e) => e.target.kind === 'dead').map((e) => e.tick)).toEqual(deadTicks);
    expect(Math.max(...slotsUsed(after))).toBeLessThan(2);
    expect(validateRhythm(after).ok).toBe(true);
  });

  it('keeps a mutated pattern when the slot count changes', async () => {
    const store = await freshStore();
    store.getState().addSlot(E5);
    store.getState().addSlot(G5);
    expect(store.getState().mutate()).toBe(true);
    const mutated = store.getState().pattern.events;
    store.getState().addSlot(A5);
    expect(store.getState().pattern.events).toEqual(mutated);
  });

  it('rejects slots that do not fit their tuning', async () => {
    const store = await freshStore();
    expect(store.getState().addSlot({ ...E5, shape: [0, 2, 2] })).toBe(false);
    expect(store.getState().addSlot({ ...E5, tuningId: 'seven-string' })).toBe(false);
    expect(store.getState().slots).toEqual([]);
  });

  it('fills the default pedal and updates it with the shape', async () => {
    const store = await freshStore();
    store.getState().addSlot(C5);
    const slot = store.getState().slots[0];
    expect(slot.pedalMidi).toBe(48);
    expect(store.getState().setSlotShape(slot.id, [8, 10, 10, null, null, null])).toBe(true);
    expect(store.getState().slots[0].pedalMidi).toBe(48);
    expect(store.getState().setSlotShape(slot.id, [8, 10])).toBe(false);
  });

  it('bridges distinct RiffBar steps into slots', async () => {
    const { useRhythmStore, useRiffStore } = await freshStores();
    expect(useRhythmStore.getState().useRiffBarChords(E_STANDARD)).toBe(0);
    useRiffStore.setState({
      steps: [
        { key: 'a', baseId: 'x', name: 'E5', subtext: 'E5', notes: ['E2', 'B2', 'E3'] },
        { key: 'b', baseId: 'x', name: 'E5', subtext: 'E5', notes: ['E2', 'B2', 'E3'] },
        { key: 'c', baseId: 'y', name: 'C5', subtext: 'C5', notes: ['C3', 'G3', 'C4'] },
        { key: 'd', baseId: 'x', name: 'E5', subtext: 'E5', notes: ['E2', 'B2', 'E3'] }
      ]
    });
    expect(useRhythmStore.getState().useRiffBarChords(E_STANDARD, DEFAULT_HAND_PROFILE)).toBe(2);
    const { slots, params, pattern } = useRhythmStore.getState();
    expect(slots.map((s) => s.label)).toEqual(['E5', 'C5']);
    expect(slots[0].source).toEqual({ kind: 'notes', notes: ['E2', 'B2', 'E3'], baseRoot: 'E' });
    expect(shapeToMidi(slots[0].shape, E_STANDARD)).toEqual([40, 47, 52]);
    expect([...shapeToMidi(slots[1].shape, E_STANDARD)].sort((a, b) => a - b)).toEqual([48, 55, 60]);
    expect(params.slotCount).toBe(2);
    expect(pattern.params.slotCount).toBe(2);
  });

  it('retunes slots to the app tuning', async () => {
    const store = await freshStore();
    store.getState().addSlot(E5);
    expect(store.getState().retuneSlots(DROP_D, DEFAULT_HAND_PROFILE)).toBe(0);
    const slot = store.getState().slots[0];
    expect(slot.tuningId).toBe(DROP_D.id);
    expect([...shapeToMidi(slot.shape, DROP_D)].sort((a, b) => a - b)).toEqual([40, 47, 52]);
  });

  it('optimizes slot fingerings and reports the hardest change', async () => {
    const store = await freshStore();
    expect(store.getState().optimizeSlots(DEFAULT_HAND_PROFILE, E_STANDARD).ok).toBe(false);
    store.getState().addSlot(E5);
    store.getState().addSlot(A5);
    const out = store.getState().optimizeSlots(DEFAULT_HAND_PROFILE, E_STANDARD);
    expect(out.ok).toBe(true);
    const { optimization, slots } = store.getState();
    expect(optimization).not.toBeNull();
    expect(optimization!.fingers).toHaveLength(2);
    expect(optimization!.text).toMatch(/^Hardest change: slot/);
    expect(slots).toHaveLength(2);
    store.getState().setSlotShape(slots[0].id, [0, 2, 2, null, null, null]);
    expect(store.getState().optimization).toBeNull();
  });
});

describe('rhythmStore style and params', () => {
  it('setStyle uses the preset with the slot count of the lab', async () => {
    const store = await freshStore();
    store.getState().addSlot(E5);
    store.getState().addSlot(G5);
    store.getState().setStyle('fiveOverFour');
    const { params, pattern } = store.getState();
    expect(params).toEqual({ ...defaultRhythmParams('fiveOverFour'), slotCount: 2 });
    expect(pattern.cycleTicks).toBe(5 * 120);
    expect(validateRhythm(pattern).ok).toBe(true);
    store.getState().setStyle('sevenEight');
    expect(store.getState().pattern.meter).toEqual({ numerator: 7, denominator: 8 });
  });

  it('setParam only accepts the exposed knobs and bar options', async () => {
    const store = await freshStore();
    store.getState().setParam({ bars: 4, picking: 'downstrokes', syncopation: 2 });
    expect(store.getState().params).toMatchObject({ bars: 4, picking: 'downstrokes', syncopation: 1 });
    expect(store.getState().pattern.bars).toBe(4);
    expect(store.getState().pattern.events.every((e) => e.pick === 'down')).toBe(true);
    store.getState().setParam({ bars: 3 });
    expect(store.getState().params.bars).toBe(4);
  });
});

describe('scheduleRhythmRestart', () => {
  it('restarts while playing, but never after Stop or cancel', async () => {
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const { scheduleRhythmRestart, useRhythmStore } = await import('./rhythmStore');
      const restart = vi.fn();

      useRhythmStore.getState().setIsPlaying(true);
      scheduleRhythmRestart(restart, 60);
      vi.advanceTimersByTime(60);
      expect(restart).toHaveBeenCalledTimes(1);

      scheduleRhythmRestart(restart, 60);
      vi.advanceTimersByTime(30);
      useRhythmStore.getState().setIsPlaying(false);
      vi.advanceTimersByTime(30);
      expect(restart).toHaveBeenCalledTimes(1);

      useRhythmStore.getState().setIsPlaying(true);
      const cancel = scheduleRhythmRestart(restart, 60);
      cancel();
      vi.advanceTimersByTime(60);
      expect(restart).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
