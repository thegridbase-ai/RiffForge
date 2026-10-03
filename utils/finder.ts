// Pure helpers for the Voicing Finder: memoized generation, result filters, display labels, Chord Explorer
// mapping and the empty-state relaxation hints. No React, no audio.
import type {
  CalibrationAnswers,
  GenerateResult,
  GeneratedVoicing,
  HandProfile,
  Tuning,
  VoicingFamily,
  VoicingSort,
  VoicingTag
} from '../engine/types';
import { generateVoicings } from '../engine/generateVoicings';
import { STRETCH_TOLERANCE_ALLOW, handProfileHash } from '../engine/handProfile';
import { explainCost } from '../engine/playability';
import { buildChordExplorerUrl, type ChordExplorerType } from './chordExplorer';

export const FINDER_DEFAULT_FAMILY = 'power5';
export const FINDER_GENERATE_LIMIT = 48;
export const FINDER_SHOW_LIMIT = 12;
export const FINDER_CACHE_SIZE = 32;

// ---------------------------------------------------------------------------
// Small LRU cache
// ---------------------------------------------------------------------------

export interface LruCache<V> {
  get: (key: string) => V | undefined;
  set: (key: string, value: V) => void;
  readonly size: number;
}

/** Map-backed LRU: reads refresh an entry, writes past `capacity` evict the least recently used one. */
export const createLruCache = <V>(capacity: number): LruCache<V> => {
  const map = new Map<string, V>();
  return {
    get: (key) => {
      if (!map.has(key)) return undefined;
      const value = map.get(key) as V;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set: (key, value) => {
      map.delete(key);
      map.set(key, value);
      while (map.size > capacity) map.delete(map.keys().next().value as string);
    },
    get size() {
      return map.size;
    }
  };
};

// ---------------------------------------------------------------------------
// Memoized generation
// ---------------------------------------------------------------------------

export interface FinderQuery {
  root: string;
  familyId: string;
  tuning: Tuning;
  profile: HandProfile;
  distortion: boolean;
  sort: VoicingSort;
}

export const finderCacheKey = ({ root, familyId, tuning, profile, distortion, sort }: FinderQuery): string =>
  [root, familyId, tuning.id, handProfileHash(profile), distortion ? 1 : 0, sort].join('|');

const resultCache = createLruCache<GenerateResult>(FINDER_CACHE_SIZE);

/** generateVoicings for the finder (diversified, 48 candidates), memoized per query in a module-level LRU. */
export const findVoicings = (query: FinderQuery): GenerateResult => {
  const key = finderCacheKey(query);
  const cached = resultCache.get(key);
  if (cached) return cached;
  const result = generateVoicings({
    root: query.root,
    family: query.familyId,
    tuning: query.tuning,
    profile: query.profile,
    distortion: query.distortion,
    sort: query.sort,
    limit: FINDER_GENERATE_LIMIT,
    diversify: true
  });
  resultCache.set(key, result);
  return result;
};

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type StringGroupFilter = 'all' | 'low' | 'middle' | 'top';

export const STRING_GROUP_FILTERS: readonly { id: StringGroupFilter; label: string; tag: VoicingTag | null }[] = [
  { id: 'all', label: 'All', tag: null },
  { id: 'low', label: 'Low 3', tag: 'lowStrings' },
  { id: 'middle', label: 'Middle', tag: 'middleStrings' },
  { id: 'top', label: 'Top 3', tag: 'topStrings' }
];

export interface FinderFilters {
  stringGroup: StringGroupFilter;
  pedalOnly: boolean;
}

export const filterVoicings = (voicings: readonly GeneratedVoicing[], { stringGroup, pedalOnly }: FinderFilters): GeneratedVoicing[] => {
  const groupTag = STRING_GROUP_FILTERS.find((g) => g.id === stringGroup)?.tag ?? null;
  return voicings.filter(
    (v) => (groupTag === null || v.tags.includes(groupTag)) && (!pedalOnly || v.tags.includes('pedalCompatible'))
  );
};

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const TAG_LABELS: Partial<Record<VoicingTag, string>> = {
  pedalCompatible: 'pedal',
  drone: 'drone',
  usesOpenStrings: 'open strings',
  rootInBass: 'root in bass'
};

/** Short chip labels for the tags worth showing on a card, in a stable order. */
export const voicingTagLabels = (tags: readonly VoicingTag[]): string[] =>
  (Object.keys(TAG_LABELS) as VoicingTag[]).filter((tag) => tags.includes(tag)).map((tag) => TAG_LABELS[tag] as string);

/** One-line comfort explanation: "3 fingers · reach 82 percent of your comfort · 1 interior mute". */
export const explainVoicing = (voicing: GeneratedVoicing, profile: HandProfile): string =>
  explainCost(voicing.breakdown, voicing.fingering, profile).join(' · ');

/** "E sus2", as used in headings and the live announcement. */
export const familyTitle = (root: string, family: VoicingFamily): string => `${root} ${family.label}`;

export const resultAnnouncement = (count: number, root: string, family: VoicingFamily): string =>
  `${count} ${count === 1 ? 'voicing' : 'voicings'} for ${familyTitle(root, family)}`;

/** Novelty 0..1 as a whole percent, for the "unusual" meter. */
export const noveltyPercent = (novelty: number): number => Math.round(Math.min(1, Math.max(0, novelty)) * 100);

// ---------------------------------------------------------------------------
// Chord Explorer
// ---------------------------------------------------------------------------

/**
 * Closest Chord Explorer type per base family (CE only knows triads, 7ths and sus chords). Dyads and power chords
 * land on the triad that contains their notes; the fourth and quartal stacks on sus4; the b3 cluster on minor.
 */
const EXPLORER_TYPE_BY_FAMILY: Readonly<Record<string, ChordExplorerType>> = {
  power5: 'major',
  power5_b2: 'major',
  dyad_b2: 'major',
  tritone: 'dim',
  fourth: 'sus4',
  sus2: 'sus2',
  sus4: 'sus4',
  add9: 'major',
  m_add9: 'minor',
  '7': '7',
  m7: 'm7',
  maj7: 'maj7',
  quartal: 'sus4',
  cluster_m2: 'major',
  cluster_b3: 'minor',
  phrygian: 'major',
  major: 'major',
  minor: 'minor',
  dim: 'dim',
  aug: 'aug'
};

/** Chord-name suffixes that utils/chordExplorer maps back to each type. */
const EXPLORER_SUFFIX: Readonly<Record<ChordExplorerType, string>> = {
  major: '',
  minor: 'm',
  dim: 'dim',
  aug: 'aug',
  '7': '7',
  m7: 'm7',
  maj7: 'maj7',
  dim7: 'dim7',
  sus2: 'sus2',
  sus4: 'sus4'
};

export const explorerTypeForFamily = (familyId: string): ChordExplorerType =>
  EXPLORER_TYPE_BY_FAMILY[familyId.replace(/^drone_/, '')] ?? 'major';

/** A name/subtext pair that buildChordExplorerUrl maps to the family's closest Chord Explorer type. */
export const explorerChordFor = (root: string, familyId: string): { name: string; subtext: string } => {
  const name = `${root}${EXPLORER_SUFFIX[explorerTypeForFamily(familyId)]}`;
  return { name, subtext: name };
};

/** Chord Explorer deep link; the exact shape only travels in E Standard, the only tuning Chord Explorer knows. */
export const finderExplorerUrl = (root: string, familyId: string, voicing: GeneratedVoicing, tuning: Tuning): string =>
  buildChordExplorerUrl(explorerChordFor(root, familyId), tuning.id === 'e-standard' ? voicing.shape : undefined);

// ---------------------------------------------------------------------------
// Empty-state relaxation hints
// ---------------------------------------------------------------------------

export type RelaxationHint =
  | { kind: 'calibration'; label: string; count: number; patch: Partial<CalibrationAnswers> }
  /** Interior mutes are not a calibration answer, so this one is a finder-only override. */
  | { kind: 'extraMute'; label: string; count: number };

const countFor = (query: FinderQuery, profile: HandProfile): number => findVoicings({ ...query, profile }).voicings.length;

/**
 * One-click ways out of an empty result, each tried alone against the same recipe: allow stretches, allow open
 * strings, and one more muted inner string. Only options that produce shapes are returned. Barres are never
 * suggested; the hand profile's no-barre rule stays as the player set it.
 */
export const relaxationHints = (query: FinderQuery, extraMuteActive = false): RelaxationHint[] => {
  const { profile } = query;
  const hints: RelaxationHint[] = [];
  if (profile.stretchTolerance < STRETCH_TOLERANCE_ALLOW) {
    const count = countFor(query, { ...profile, stretchTolerance: STRETCH_TOLERANCE_ALLOW });
    if (count > 0) hints.push({ kind: 'calibration', label: "With 'Allow stretches'", count, patch: { allowStretches: true } });
  }
  if (!profile.allowOpenStrings) {
    const count = countFor(query, { ...profile, allowOpenStrings: true });
    if (count > 0) hints.push({ kind: 'calibration', label: "With 'Allow open strings'", count, patch: { allowOpenStrings: true } });
  }
  if (!extraMuteActive) {
    const count = countFor(query, { ...profile, maxInteriorMutes: profile.maxInteriorMutes + 1 });
    if (count > 0) hints.push({ kind: 'extraMute', label: 'With one more muted inner string', count });
  }
  return hints;
};

/** "With 'Allow stretches': 4 shapes"; a count at the generation limit is a lower bound ("48+ shapes"). */
export const hintText = (hint: RelaxationHint): string =>
  `${hint.label}: ${hint.count}${hint.count >= FINDER_GENERATE_LIMIT ? '+' : ''} ${hint.count === 1 ? 'shape' : 'shapes'}`;
