import { create } from 'zustand';

export const RIFF_STORAGE_KEY = 'riffforge:riff:v1';
export const MAX_RIFF_STEPS = 16;
export const MIN_BPM = 60;
export const MAX_BPM = 240;
export const DEFAULT_BPM = 120;

/** A frozen snapshot of a chord as it was displayed when added to the riff. */
export interface RiffStep {
  key: string;
  baseId: string;
  name: string;
  subtext: string;
  notes: string[];
}

interface PersistedRiff {
  steps: RiffStep[];
  bpm: number;
}

export const clampBpm = (bpm: number): number => {
  if (!Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
};

let keyCounter = 0;
const nextKey = (): string =>
  `step-${Date.now().toString(36)}-${(keyCounter++).toString(36)}`;

const isValidStep = (value: unknown): value is Omit<RiffStep, 'key'> & { key?: string } => {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.baseId === 'string' &&
    typeof step.name === 'string' &&
    typeof step.subtext === 'string' &&
    Array.isArray(step.notes) &&
    step.notes.every((n) => typeof n === 'string')
  );
};

const loadRiff = (): PersistedRiff => {
  const fallback: PersistedRiff = { steps: [], bpm: DEFAULT_BPM };
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(RIFF_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;

    const steps: RiffStep[] = Array.isArray(parsed.steps)
      ? parsed.steps
          .filter(isValidStep)
          .slice(0, MAX_RIFF_STEPS)
          .map((step) => ({
            key: typeof step.key === 'string' ? step.key : nextKey(),
            baseId: step.baseId,
            name: step.name,
            subtext: step.subtext,
            notes: [...step.notes]
          }))
      : [];

    const bpm = typeof parsed.bpm === 'number' ? clampBpm(parsed.bpm) : DEFAULT_BPM;

    return { steps, bpm };
  } catch {
    return fallback;
  }
};

const saveRiff = (steps: RiffStep[], bpm: number): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(RIFF_STORAGE_KEY, JSON.stringify({ steps, bpm }));
  } catch {
    // Storage unavailable (private mode, quota) — riff stays in-memory only
  }
};

export interface RiffChordInput {
  id: string;
  name: string;
  subtext: string;
  notes: string[];
}

interface RiffStore {
  steps: RiffStep[];
  bpm: number;
  isPlaying: boolean;
  currentStep: number; // -1 when idle
  metronomeOn: boolean;

  addStep: (chord: RiffChordInput) => boolean;
  removeStep: (key: string) => void;
  clearSteps: () => void;
  setBpm: (bpm: number) => void;
  setIsPlaying: (value: boolean) => void;
  setCurrentStep: (index: number) => void;
  setMetronomeOn: (value: boolean) => void;
}

const initial = loadRiff();

export const useRiffStore = create<RiffStore>((set) => ({
  steps: initial.steps,
  bpm: initial.bpm,
  isPlaying: false,
  currentStep: -1,
  metronomeOn: false,

  addStep: (chord) => {
    let added = false;
    set((state) => {
      if (state.steps.length >= MAX_RIFF_STEPS) return state;
      added = true;
      // Snapshot the chord as currently displayed — later transpositions must not mutate the riff
      const step: RiffStep = {
        key: nextKey(),
        baseId: chord.id,
        name: chord.name,
        subtext: chord.subtext,
        notes: [...chord.notes]
      };
      const steps = [...state.steps, step];
      saveRiff(steps, state.bpm);
      return { steps };
    });
    return added;
  },

  removeStep: (key) => set((state) => {
    const steps = state.steps.filter((step) => step.key !== key);
    saveRiff(steps, state.bpm);
    return { steps };
  }),

  clearSteps: () => set((state) => {
    saveRiff([], state.bpm);
    return { steps: [], currentStep: -1 };
  }),

  setBpm: (bpm) => set((state) => {
    const clamped = clampBpm(bpm);
    saveRiff(state.steps, clamped);
    return { bpm: clamped };
  }),

  setIsPlaying: (value) => set({ isPlaying: value }),
  setCurrentStep: (index) => set({ currentStep: index }),
  setMetronomeOn: (value) => set({ metronomeOn: value })
}));
