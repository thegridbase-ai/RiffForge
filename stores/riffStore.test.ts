import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RIFF_STORAGE_KEY, MAX_RIFF_STEPS, DEFAULT_BPM, clampBpm } from './riffStore';
import type { RiffChordInput } from './riffStore';

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

const ghost: RiffChordInput = {
  id: 'melodic-1',
  name: 'Em',
  subtext: 'Em(add9)',
  notes: ['E2', 'B2', 'F#3', 'G3', 'B3', 'E4']
};

const freshStore = async () => {
  vi.resetModules();
  const mod = await import('./riffStore');
  return mod.useRiffStore;
};

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorageMock());
});

describe('riffStore', () => {
  it('addStep snapshots the chord — later mutations do not affect the riff', async () => {
    const useRiffStore = await freshStore();
    const source = { ...ghost, notes: [...ghost.notes] };

    useRiffStore.getState().addStep(source);

    // Simulate a root change mutating the displayed chord object
    source.name = 'Cm';
    source.subtext = 'Cm(add9)';
    source.notes[0] = 'C2';
    source.notes.push('C5');

    const step = useRiffStore.getState().steps[0];
    expect(step.name).toBe('Em');
    expect(step.subtext).toBe('Em(add9)');
    expect(step.notes).toEqual(['E2', 'B2', 'F#3', 'G3', 'B3', 'E4']);
    expect(step.baseId).toBe('melodic-1');
  });

  it('assigns unique keys when the same chord is added twice', async () => {
    const useRiffStore = await freshStore();
    useRiffStore.getState().addStep(ghost);
    useRiffStore.getState().addStep(ghost);

    const [a, b] = useRiffStore.getState().steps;
    expect(a.key).not.toBe(b.key);
  });

  it('caps the sequence at 16 steps', async () => {
    const useRiffStore = await freshStore();
    for (let i = 0; i < MAX_RIFF_STEPS; i++) {
      expect(useRiffStore.getState().addStep(ghost)).toBe(true);
    }
    expect(useRiffStore.getState().addStep(ghost)).toBe(false);
    expect(useRiffStore.getState().steps).toHaveLength(MAX_RIFF_STEPS);
  });

  it('removeStep removes exactly the targeted step', async () => {
    const useRiffStore = await freshStore();
    useRiffStore.getState().addStep(ghost);
    useRiffStore.getState().addStep({ ...ghost, id: 'melodic-2', name: 'E5' });
    useRiffStore.getState().addStep({ ...ghost, id: 'melodic-3', name: 'E7' });

    const middleKey = useRiffStore.getState().steps[1].key;
    useRiffStore.getState().removeStep(middleKey);

    const names = useRiffStore.getState().steps.map((s) => s.name);
    expect(names).toEqual(['Em', 'E7']);
  });

  it('clearSteps empties the sequence and resets the playhead', async () => {
    const useRiffStore = await freshStore();
    useRiffStore.getState().addStep(ghost);
    useRiffStore.getState().setCurrentStep(0);
    useRiffStore.getState().clearSteps();

    expect(useRiffStore.getState().steps).toEqual([]);
    expect(useRiffStore.getState().currentStep).toBe(-1);
  });

  it('clamps bpm to the 60-240 range', async () => {
    const useRiffStore = await freshStore();
    useRiffStore.getState().setBpm(30);
    expect(useRiffStore.getState().bpm).toBe(60);
    useRiffStore.getState().setBpm(999);
    expect(useRiffStore.getState().bpm).toBe(240);
    useRiffStore.getState().setBpm(172);
    expect(useRiffStore.getState().bpm).toBe(172);
  });

  it('round-trips sequence and bpm through localStorage', async () => {
    const useRiffStore = await freshStore();
    useRiffStore.getState().addStep(ghost);
    useRiffStore.getState().addStep({ ...ghost, id: 'melodic-2', name: 'E5', subtext: 'E5' });
    useRiffStore.getState().setBpm(180);

    // Re-import the module: initial state must hydrate from localStorage
    const rehydrated = await freshStore();
    const state = rehydrated.getState();
    expect(state.steps.map((s) => s.name)).toEqual(['Em', 'E5']);
    expect(state.steps[0].notes).toEqual(ghost.notes);
    expect(state.bpm).toBe(180);
    expect(state.isPlaying).toBe(false);
    expect(state.currentStep).toBe(-1);
  });

  it('falls back to defaults on corrupt localStorage payloads', async () => {
    localStorage.setItem(RIFF_STORAGE_KEY, '{not json');
    let useRiffStore = await freshStore();
    expect(useRiffStore.getState().steps).toEqual([]);
    expect(useRiffStore.getState().bpm).toBe(DEFAULT_BPM);

    localStorage.setItem(RIFF_STORAGE_KEY, JSON.stringify({ steps: [{ bogus: true }], bpm: 'fast' }));
    useRiffStore = await freshStore();
    expect(useRiffStore.getState().steps).toEqual([]);
    expect(useRiffStore.getState().bpm).toBe(DEFAULT_BPM);
  });
});

describe('clampBpm', () => {
  it('rounds and clamps', () => {
    expect(clampBpm(119.6)).toBe(120);
    expect(clampBpm(-5)).toBe(60);
    expect(clampBpm(NaN)).toBe(DEFAULT_BPM);
  });
});
