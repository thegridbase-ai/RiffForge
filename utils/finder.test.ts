import { describe, it, expect } from 'vitest';
import {
  FINDER_GENERATE_LIMIT,
  createLruCache,
  explainVoicing,
  explorerChordFor,
  explorerTypeForFamily,
  filterVoicings,
  finderCacheKey,
  finderExplorerUrl,
  findVoicings,
  hintText,
  noveltyPercent,
  relaxationHints,
  resultAnnouncement,
  voicingTagLabels,
  type FinderQuery
} from './finder';
import { mapToExplorerType } from './chordExplorer';
import { DEFAULT_CALIBRATION, DEFAULT_HAND_PROFILE, profileFromCalibration } from '../engine/handProfile';
import { DROP_D, E_STANDARD } from '../engine/tuning';
import { ALL_FAMILIES, getFamily } from '../engine/voicingSpec';
import { toRiffForgeTab } from '../engine/shape';
import type { GeneratedVoicing, VoicingTag } from '../engine/types';

const query = (overrides: Partial<FinderQuery> = {}): FinderQuery => ({
  root: 'E',
  familyId: 'power5',
  tuning: DROP_D,
  profile: DEFAULT_HAND_PROFILE,
  distortion: false,
  sort: 'easiest',
  ...overrides
});

const fakeVoicing = (tags: VoicingTag[]): GeneratedVoicing => ({ tags } as unknown as GeneratedVoicing);

describe('createLruCache', () => {
  it('evicts the least recently used entry and refreshes entries on read', () => {
    const cache = createLruCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // a is now the most recent
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('overwrites an existing key without growing', () => {
    const cache = createLruCache<string>(2);
    cache.set('a', 'x');
    cache.set('a', 'y');
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe('y');
  });
});

describe('findVoicings', () => {
  it('memoizes per root, family, tuning, profile hash, distortion and sort', () => {
    const first = findVoicings(query());
    expect(findVoicings(query())).toBe(first);
    // A structurally equal profile object hits the same entry
    expect(findVoicings(query({ profile: { ...DEFAULT_HAND_PROFILE } }))).toBe(first);
    expect(findVoicings(query({ distortion: true }))).not.toBe(first);
    expect(findVoicings(query({ sort: 'unusual' }))).not.toBe(first);
    expect(findVoicings(query({ tuning: E_STANDARD }))).not.toBe(first);
    expect(findVoicings(query({ familyId: 'sus2' }))).not.toBe(first);
  });

  it('keys distinguish every memo input', () => {
    const keys = new Set([
      finderCacheKey(query()),
      finderCacheKey(query({ root: 'F' })),
      finderCacheKey(query({ familyId: 'sus2' })),
      finderCacheKey(query({ tuning: E_STANDARD })),
      finderCacheKey(query({ profile: profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3 }) })),
      finderCacheKey(query({ distortion: true })),
      finderCacheKey(query({ sort: 'unusual' }))
    ]);
    expect(keys.size).toBe(7);
  });

  it('returns at most 48 diversified, no-barre voicings', () => {
    const { voicings } = findVoicings(query({ familyId: 'sus2' }));
    expect(voicings.length).toBeGreaterThan(0);
    expect(voicings.length).toBeLessThanOrEqual(FINDER_GENERATE_LIMIT);
    for (const v of voicings) expect(v.fingering.barres).toEqual([]);
  });

  it('a smaller reach removes wide shapes', () => {
    const narrow = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3 });
    const wide = findVoicings(query()).voicings.map((v) => toRiffForgeTab(v.shape));
    const tight = findVoicings(query({ profile: narrow })).voicings.map((v) => toRiffForgeTab(v.shape));
    expect(tight.length).toBeLessThan(wide.length);
    // Two fingers on fret 2 push the fret 4 note onto ring or pinky, past a fret 1 -> 3 hand
    expect(wide).toContain('2 2 x 4 0 x');
    expect(tight).not.toContain('2 2 x 4 0 x');
    for (const tab of tight) expect(wide).toContain(tab);
  });
});

describe('filterVoicings', () => {
  const voicings = [
    fakeVoicing(['lowStrings', 'pedalCompatible']),
    fakeVoicing(['middleStrings']),
    fakeVoicing(['topStrings', 'pedalCompatible']),
    fakeVoicing(['middleStrings', 'topStrings'])
  ];

  it('keeps everything with no filters', () => {
    expect(filterVoicings(voicings, { stringGroup: 'all', pedalOnly: false })).toHaveLength(4);
  });

  it('filters by string group tag', () => {
    expect(filterVoicings(voicings, { stringGroup: 'low', pedalOnly: false })).toEqual([voicings[0]]);
    expect(filterVoicings(voicings, { stringGroup: 'middle', pedalOnly: false })).toEqual([voicings[1], voicings[3]]);
    expect(filterVoicings(voicings, { stringGroup: 'top', pedalOnly: false })).toEqual([voicings[2], voicings[3]]);
  });

  it('combines the pedal filter with the string group', () => {
    expect(filterVoicings(voicings, { stringGroup: 'all', pedalOnly: true })).toEqual([voicings[0], voicings[2]]);
    expect(filterVoicings(voicings, { stringGroup: 'top', pedalOnly: true })).toEqual([voicings[2]]);
  });
});

describe('display helpers', () => {
  it('labels the tags worth showing in a stable order', () => {
    expect(voicingTagLabels(['rootInBass', 'lowStrings', 'usesOpenStrings', 'pedalCompatible'])).toEqual([
      'pedal',
      'open strings',
      'root in bass'
    ]);
    expect(voicingTagLabels(['middleStrings'])).toEqual([]);
  });

  it('explains cost against the comfortable reach', () => {
    const v = findVoicings(query({ familyId: 'sus2' })).voicings.find((x) => x.fingering.metrics.reachRatio > 0);
    expect(v).toBeDefined();
    const text = explainVoicing(v as GeneratedVoicing, DEFAULT_HAND_PROFILE);
    expect(text).toMatch(/^\d finger/);
    expect(text).toContain('percent of your comfort');
    expect(text).toContain(' · ');
    expect(text.toLowerCase()).not.toContain('safe');
  });

  it('announces counts with the family label', () => {
    expect(resultAnnouncement(7, 'E', getFamily('sus2')!)).toBe('7 voicings for E sus2');
    expect(resultAnnouncement(1, 'C#', getFamily('m_add9')!)).toBe('1 voicing for C# m(add9)');
  });

  it('clamps novelty to a percent', () => {
    expect(noveltyPercent(0.426)).toBe(43);
    expect(noveltyPercent(-1)).toBe(0);
    expect(noveltyPercent(2)).toBe(100);
  });
});

describe('Chord Explorer mapping', () => {
  it('maps every family to a type that survives the URL builder', () => {
    for (const family of ALL_FAMILIES) {
      const chord = explorerChordFor('F#', family.id);
      expect(mapToExplorerType(chord.name, chord.subtext)).toBe(explorerTypeForFamily(family.id));
    }
  });

  it('picks the closest Chord Explorer type', () => {
    expect(explorerTypeForFamily('power5')).toBe('major');
    expect(explorerTypeForFamily('m_add9')).toBe('minor');
    expect(explorerTypeForFamily('sus2')).toBe('sus2');
    expect(explorerTypeForFamily('fourth')).toBe('sus4');
    expect(explorerTypeForFamily('tritone')).toBe('dim');
    expect(explorerTypeForFamily('drone_quartal')).toBe('sus4');
    expect(explorerTypeForFamily('m7')).toBe('m7');
  });

  it('sends the shape only in E Standard', () => {
    const standard = findVoicings(query({ tuning: E_STANDARD, familyId: 'm_add9' })).voicings[0];
    const drop = findVoicings(query({ familyId: 'm_add9' })).voicings[0];
    const standardUrl = finderExplorerUrl('E', 'm_add9', standard, E_STANDARD);
    expect(standardUrl).toContain('root=E&type=minor');
    expect(standardUrl).toContain(`&gv=${standard.shape.map((f) => (f === null ? 'x' : f)).join('-')}`);
    expect(finderExplorerUrl('C#', 'm_add9', drop, DROP_D)).toBe('https://chords.thegridbase.com/?root=C%23&type=minor');
  });
});

describe('relaxationHints', () => {
  const strict = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3, highPinkyFret: 9, allowOpenStrings: false });

  it('offers allow stretches when that unlocks shapes', () => {
    const q = query({ tuning: E_STANDARD, familyId: 'dyad_b2', profile: strict });
    expect(findVoicings(q).voicings).toHaveLength(0);
    const hints = relaxationHints(q);
    const stretch = hints.find((h) => h.kind === 'calibration' && h.patch.allowStretches === true);
    expect(stretch).toBeDefined();
    expect(stretch!.count).toBeGreaterThan(0);
    expect(hintText(stretch!)).toMatch(/^With 'Allow stretches': \d+ shapes?$/);
    expect(hintText({ kind: 'extraMute', label: 'With one more muted inner string', count: FINDER_GENERATE_LIMIT })).toBe(
      'With one more muted inner string: 48+ shapes'
    );
  });

  it('offers one more muted inner string as a finder-only override', () => {
    const tight = profileFromCalibration({ ...DEFAULT_CALIBRATION, lowPinkyFret: 3, highPinkyFret: 9, allowOpenStrings: false, maxFret: 7 });
    const q = query({ tuning: E_STANDARD, root: 'C', familyId: 'power5_b2', profile: tight });
    expect(findVoicings(q).voicings).toHaveLength(0);
    const hints = relaxationHints(q);
    expect(hints.some((h) => h.kind === 'extraMute' && h.count > 0)).toBe(true);
    expect(relaxationHints(q, true).some((h) => h.kind === 'extraMute')).toBe(false);
  });

  it('never suggests barres and stays silent when nothing helps', () => {
    // F has no open string on its root or fifth in Drop D: no relaxation can add a drone string
    const q = query({ root: 'F', familyId: 'drone_power5' });
    expect(findVoicings(q).voicings).toHaveLength(0);
    expect(relaxationHints(q)).toEqual([]);
    for (const family of ['dyad_b2', 'phrygian', 'cluster_m2']) {
      for (const hint of relaxationHints(query({ tuning: E_STANDARD, familyId: family, profile: strict }))) {
        if (hint.kind === 'calibration') expect(hint.patch).not.toHaveProperty('noBarre');
      }
    }
  });

  it('skips options that are already on', () => {
    const relaxed = profileFromCalibration({ ...DEFAULT_CALIBRATION, allowStretches: true, allowOpenStrings: true });
    const hints = relaxationHints(query({ root: 'F', familyId: 'drone_power5', profile: relaxed }));
    expect(hints.filter((h) => h.kind === 'calibration')).toEqual([]);
  });
});
