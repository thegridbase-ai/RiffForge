import { create } from 'zustand';
import { Chord, TuningMode, VibeMode } from '../types';

interface ChordStore {
  // Audio state
  isDistorted: boolean;
  isAudioReady: boolean;
  activeChordId: string | null;

  // Selection state
  selectedRoot: string;
  tuningMode: TuningMode;
  vibeMode: VibeMode;

  // Lock state
  lockedChordId: string | null;
  relatedChords: Chord[];

  // Loading state
  displayedChords: Chord[];
  isLoadingChords: boolean;
  chordsToLoad: number;
  totalChordsAvailable: number;

  // Actions
  setIsDistorted: (value: boolean) => void;
  setIsAudioReady: (value: boolean) => void;
  setActiveChordId: (id: string | null) => void;
  setSelectedRoot: (root: string) => void;
  setTuningMode: (mode: TuningMode) => void;
  setVibeMode: (mode: VibeMode) => void;
  setLockedChordId: (id: string | null) => void;
  setRelatedChords: (chords: Chord[]) => void;
  setDisplayedChords: (chords: Chord[]) => void;
  setIsLoadingChords: (value: boolean) => void;
  setChordsToLoad: (count: number) => void;
  setTotalChordsAvailable: (count: number) => void;

  // Compound actions
  resetLockState: () => void;
  incrementChordsToLoad: (amount: number) => void;
}

export const useChordStore = create<ChordStore>((set) => ({
  // Initial state
  isDistorted: false,
  isAudioReady: false,
  activeChordId: null,
  selectedRoot: 'E',
  tuningMode: TuningMode.STANDARD,
  vibeMode: VibeMode.MELODIC,
  lockedChordId: null,
  relatedChords: [],
  displayedChords: [],
  isLoadingChords: false,
  chordsToLoad: 6,
  totalChordsAvailable: 0,

  // Actions
  setIsDistorted: (value) => set({ isDistorted: value }),
  setIsAudioReady: (value) => set({ isAudioReady: value }),
  setActiveChordId: (id) => set({ activeChordId: id }),
  setSelectedRoot: (root) => set({ selectedRoot: root }),
  setTuningMode: (mode) => set({ tuningMode: mode }),
  setVibeMode: (mode) => set({ vibeMode: mode }),
  setLockedChordId: (id) => set({ lockedChordId: id }),
  setRelatedChords: (chords) => set({ relatedChords: chords }),
  setDisplayedChords: (chords) => set({ displayedChords: chords }),
  setIsLoadingChords: (value) => set({ isLoadingChords: value }),
  setChordsToLoad: (count) => set({ chordsToLoad: count }),
  setTotalChordsAvailable: (count) => set({ totalChordsAvailable: count }),

  // Compound actions
  resetLockState: () => set({
    lockedChordId: null,
    relatedChords: []
  }),
  incrementChordsToLoad: (amount) => set((state) => ({
    chordsToLoad: state.chordsToLoad + amount
  }))
}));
