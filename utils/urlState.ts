import { NOTES } from '../constants';
import { TuningMode, VibeMode } from '../types';

const TUNING_PARAMS: Record<string, TuningMode> = {
  standard: TuningMode.STANDARD,
  drop: TuningMode.DROP
};

const VIBE_PARAMS: Record<string, VibeMode> = {
  dark: VibeMode.DARK,
  melodic: VibeMode.MELODIC,
  energetic: VibeMode.ENERGETIC
};

export interface UrlState {
  root?: string;
  tuning?: TuningMode;
  vibe?: VibeMode;
}

/** Parses ?root=C&tuning=drop&vibe=dark from the current URL. Invalid values are dropped. */
export const parseUrlState = (): UrlState => {
  if (typeof window === 'undefined') return {};

  const params = new URLSearchParams(window.location.search);
  const state: UrlState = {};

  const root = params.get('root')?.toUpperCase();
  if (root && NOTES.includes(root)) {
    state.root = root;
  }

  const tuning = params.get('tuning')?.toLowerCase();
  if (tuning && tuning in TUNING_PARAMS) {
    state.tuning = TUNING_PARAMS[tuning];
  }

  const vibe = params.get('vibe')?.toLowerCase();
  if (vibe && vibe in VIBE_PARAMS) {
    state.vibe = VIBE_PARAMS[vibe];
  }

  return state;
};

/** Writes the current selection to the query string without a navigation. */
export const syncUrlState = (root: string, tuning: TuningMode, vibe: VibeMode): void => {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  params.set('root', root);
  params.set('tuning', tuning === TuningMode.DROP ? 'drop' : 'standard');
  params.set('vibe', vibe.toLowerCase());

  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
};
