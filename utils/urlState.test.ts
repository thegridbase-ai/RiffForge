import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseUrlState, syncUrlState } from './urlState';
import { TuningMode, VibeMode } from '../types';

// Minimal window.location + history for the node test environment
const stubWindow = (search: string) => {
  const location = { pathname: '/', search };
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    location.search = url.slice(url.indexOf('?'));
  });
  vi.stubGlobal('window', { location, history: { replaceState } });
  return { location, replaceState };
};

const queryOf = (search: string) => Object.fromEntries(new URLSearchParams(search));

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseUrlState', () => {
  it('returns nothing without a window', () => {
    expect(parseUrlState()).toEqual({});
  });

  it('parses root, tuning, vibe and the finder view', () => {
    stubWindow('?root=e&tuning=drop&vibe=dark&view=finder');
    expect(parseUrlState()).toEqual({ root: 'E', tuning: TuningMode.DROP, vibe: VibeMode.DARK, view: 'finder' });
  });

  it('accepts the rhythm view and ignores case', () => {
    stubWindow('?view=Rhythm');
    expect(parseUrlState()).toEqual({ view: 'rhythm' });
  });

  it('drops invalid values, including unknown views and an explicit library view', () => {
    stubWindow('?root=H&tuning=open&vibe=happy&view=settings');
    expect(parseUrlState()).toEqual({});
    stubWindow('?view=library');
    expect(parseUrlState()).toEqual({});
  });

  it('keeps the old behaviour without a view param', () => {
    stubWindow('?root=C%23&tuning=standard&vibe=melodic');
    expect(parseUrlState()).toEqual({ root: 'C#', tuning: TuningMode.STANDARD, vibe: VibeMode.MELODIC });
  });
});

describe('syncUrlState', () => {
  it('writes root, tuning and vibe exactly as before and omits the library view', () => {
    const { location, replaceState } = stubWindow('');
    syncUrlState('F#', TuningMode.DROP, VibeMode.ENERGETIC);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(queryOf(location.search)).toEqual({ root: 'F#', tuning: 'drop', vibe: 'energetic' });
  });

  it('writes view=finder for the finder', () => {
    const { location } = stubWindow('?root=E&tuning=drop');
    syncUrlState('E', TuningMode.DROP, VibeMode.MELODIC, 'finder');
    expect(queryOf(location.search)).toEqual({ root: 'E', tuning: 'drop', vibe: 'melodic', view: 'finder' });
  });

  it('removes the view param when switching back to the library', () => {
    const { location } = stubWindow('?root=E&tuning=drop&view=finder');
    syncUrlState('E', TuningMode.DROP, VibeMode.MELODIC, 'library');
    expect(queryOf(location.search)).toEqual({ root: 'E', tuning: 'drop', vibe: 'melodic' });
  });

  it('keeps unrelated params and round-trips through parseUrlState', () => {
    const { location } = stubWindow('?utm_source=forum');
    syncUrlState('A#', TuningMode.STANDARD, VibeMode.DARK, 'finder');
    expect(queryOf(location.search).utm_source).toBe('forum');
    expect(parseUrlState()).toEqual({ root: 'A#', tuning: TuningMode.STANDARD, vibe: VibeMode.DARK, view: 'finder' });
  });
});
