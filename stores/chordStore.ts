import { create } from 'zustand';
import { Chord, TuningMode, VibeMode } from '../types';
import { parseUrlState } from '../utils/urlState';

const urlState = parseUrlState();

const FAVORITES_STORAGE_KEY = 'riffforge:favorites:v1';

const loadFavorites = (): string[] => {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
};

const saveFavorites = (favorites: string[]): void => {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Storage unavailable (private mode, quota) — favorites stay in-memory only
  }
};

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

  // Favorites (base chord ids — stable across transposition)
  favorites: string[];
  showFavoritesOnly: boolean;

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
  toggleFavorite: (chordId: string) => void;
  setShowFavoritesOnly: (value: boolean) => void;

  // Compound actions
  resetLockState: () => void;
  incrementChordsToLoad: (amount: number) => void;
}

export const useChordStore = create<ChordStore>((set) => ({
  // Initial state
  isDistorted: false,
  isAudioReady: false,
  activeChordId: null,
  selectedRoot: urlState.root ?? 'E',
  tuningMode: urlState.tuning ?? TuningMode.STANDARD,
  vibeMode: urlState.vibe ?? VibeMode.MELODIC,
  lockedChordId: null,
  relatedChords: [],
  displayedChords: [],
  isLoadingChords: false,
  chordsToLoad: 6,
  totalChordsAvailable: 0,
  favorites: loadFavorites(),
  showFavoritesOnly: false,

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
  toggleFavorite: (chordId) => set((state) => {
    const favorites = state.favorites.includes(chordId)
      ? state.favorites.filter((id) => id !== chordId)
      : [...state.favorites, chordId];
    saveFavorites(favorites);
    return { favorites };
  }),
  setShowFavoritesOnly: (value) => set({ showFavoritesOnly: value }),

  // Compound actions
  resetLockState: () => set({
    lockedChordId: null,
    relatedChords: []
  }),
  incrementChordsToLoad: (amount) => set((state) => ({
    chordsToLoad: state.chordsToLoad + amount
  }))
}));
