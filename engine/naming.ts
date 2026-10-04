// Honest voicing labels: degrees always come from the sounding notes; a chord symbol is given only for a
// confident template match against the caller's root, otherwise the name only states what sounds.
import type { Shape, Tuning, VoicingFamily } from './types';
import { degreeLabel, intervalFrom, intervalName, pitchClass, pitchClassName } from './pitch';
import { shapeToMidiByString } from './shape';
import { matchFamily } from './voicingSpec';

interface ChordTemplate {
  /** Suffix after the root letter, e.g. 'm7'. */
  symbol: string;
  intervals: readonly number[];
  /** The symbol states no third quality of its own, so '(no3)' stays truthful. */
  allowNo3?: boolean;
}

const CHORD_TEMPLATES: readonly ChordTemplate[] = [
  { symbol: '5', intervals: [0, 7] },
  { symbol: '5(b9)', intervals: [0, 1, 7] },
  { symbol: '', intervals: [0, 4, 7] },
  { symbol: 'm', intervals: [0, 3, 7] },
  { symbol: 'dim', intervals: [0, 3, 6] },
  { symbol: 'aug', intervals: [0, 4, 8] },
  { symbol: 'sus2', intervals: [0, 2, 7] },
  { symbol: 'sus4', intervals: [0, 5, 7] },
  { symbol: '7', intervals: [0, 4, 7, 10], allowNo3: true },
  { symbol: 'm7', intervals: [0, 3, 7, 10] },
  { symbol: 'maj7', intervals: [0, 4, 7, 11], allowNo3: true },
  { symbol: 'mMaj7', intervals: [0, 3, 7, 11] },
  { symbol: 'm7b5', intervals: [0, 3, 6, 10] },
  { symbol: 'dim7', intervals: [0, 3, 6, 9] },
  { symbol: '7sus4', intervals: [0, 5, 7, 10] },
  { symbol: '6', intervals: [0, 4, 7, 9] },
  { symbol: 'm6', intervals: [0, 3, 7, 9] },
  { symbol: 'add9', intervals: [0, 2, 4, 7] },
  { symbol: 'm(add9)', intervals: [0, 2, 3, 7] },
  { symbol: '(addb9)', intervals: [0, 1, 4, 7] },
  { symbol: '7(b9)', intervals: [0, 1, 4, 7, 10] },
  { symbol: '9', intervals: [0, 2, 4, 7, 10] },
  { symbol: 'm9', intervals: [0, 2, 3, 7, 10] },
  { symbol: 'maj9', intervals: [0, 2, 4, 7, 11] },
  { symbol: 'm11', intervals: [0, 2, 3, 5, 7, 10] }
];

const ROOT_BIT = 1 << 0;
const THIRD_BITS = (1 << 3) | (1 << 4);
// Only the perfect fifth may be omitted: dropping a b5 or #5 would erase the chord quality.
const FIFTH_BIT = 1 << 7;

/** A symbol that omits anything must still rest on at least this many sounding pitch classes. */
const MIN_PITCH_CLASSES_WITH_OMISSIONS = 3;

const TEMPLATE_MASKS: readonly { template: ChordTemplate; mask: number }[] = CHORD_TEMPLATES.map((template) => ({
  template,
  mask: template.intervals.reduce((mask, i) => mask | (1 << i), 0)
}));

const popcount = (mask: number): number => {
  let count = 0;
  for (let m = mask; m; m &= m - 1) count++;
  return count;
};

const omissionLabels = (missing: number): string[] => {
  const labels: string[] = [];
  if (missing & THIRD_BITS) labels.push('(no3)');
  if (missing & FIFTH_BIT) labels.push('(no5)');
  if (missing & ROOT_BIT) labels.push('(no root)');
  return labels;
};

export interface ChordSymbolResult {
  symbol: string | null;
  omissions: string[];
}

export interface VoicingName {
  symbol: string | null;
  name: string;
  degrees: string;
  degreesByString: (string | null)[];
}

const noSymbol = (): ChordSymbolResult => ({ symbol: null, omissions: [] });

/**
 * Chord-symbol suffix relative to `rootPc` (e.g. '', 'm7(no5)', '/E'), or null when no template matches
 * confidently. `intervals` may contain duplicates or unreduced values; the bass always counts as sounding.
 * Omissions: perfect fifth, the root (only reported, never replaced by another root), and the third only for
 * templates whose symbol makes no third claim. Ties between different templates at the same omission count
 * give no symbol.
 */
export const chordSymbol = (
  rootPc: number,
  intervals: readonly number[],
  bassInterval: number | null
): ChordSymbolResult => {
  let present = 0;
  for (const i of intervals) present |= 1 << pitchClass(i);
  if (bassInterval !== null) present |= 1 << pitchClass(bassInterval);
  const pitchClasses = popcount(present);
  if (pitchClasses < 2) return noSymbol();

  let best: { template: ChordTemplate; missing: number }[] = [];
  let bestOmitted = Infinity;
  for (const { template, mask } of TEMPLATE_MASKS) {
    if (present & ~mask) continue;
    const missing = mask & ~present;
    const omitted = popcount(missing);
    if (omitted > 0) {
      if (pitchClasses < MIN_PITCH_CLASSES_WITH_OMISSIONS) continue;
      const omissible = ROOT_BIT | (mask & FIFTH_BIT) | (template.allowNo3 ? mask & THIRD_BITS : 0);
      if (missing & ~omissible) continue;
    }
    if (omitted < bestOmitted) {
      best = [{ template, missing }];
      bestOmitted = omitted;
    } else if (omitted === bestOmitted) {
      best.push({ template, missing });
    }
  }
  if (best.length !== 1) return noSymbol();

  const { template, missing } = best[0];
  const omissions = omissionLabels(missing);
  const bass = bassInterval === null ? 0 : pitchClass(bassInterval);
  const slash = bass === 0 ? '' : `/${pitchClassName(rootPc + bass)}`;
  return { symbol: `${template.symbol}${omissions.join('')}${slash}`, omissions };
};

export const degreesByString = (shape: Shape, tuning: Tuning, rootPc: number): (string | null)[] =>
  shapeToMidiByString(shape, tuning).map((midi) =>
    midi === null ? null : degreeLabel(intervalFrom(rootPc, pitchClass(midi)))
  );

/** Sounding notes as [midi, string] sorted by pitch ascending, ties by string. */
const soundingNotes = (shape: Shape, tuning: Tuning): [number, number][] =>
  shapeToMidiByString(shape, tuning)
    .flatMap((midi, s): [number, number][] => (midi === null ? [] : [[midi, s]]))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

const degreesOf = (notes: readonly [number, number][], rootPc: number): string =>
  notes.map(([midi]) => degreeLabel(intervalFrom(rootPc, pitchClass(midi)))).join(' ');

/** Degree labels of the sounding notes sorted by pitch ascending (ties by string), space-separated. */
export const degreeString = (shape: Shape, tuning: Tuning, rootPc: number): string =>
  degreesOf(soundingNotes(shape, tuning), rootPc);

const hasChromaticRun = (intervals: readonly number[]): boolean =>
  intervals.some((i) => intervals.includes((i + 1) % 12) && intervals.includes((i + 2) % 12));

/** Some neighbouring sounding notes (ascending, distinct) are a minor or major 2nd apart. */
const soundsPacked = (pitches: readonly number[]): boolean =>
  pitches.some((p, i) => i > 0 && p - pitches[i - 1] <= 2);

/** Every neighbouring pair of sounding notes (ascending, distinct) is a perfect 4th, possibly an octave wider. */
const soundsStackedFourths = (pitches: readonly number[]): boolean =>
  pitches.length >= 3 && pitches.every((p, i) => i === 0 || (p - pitches[i - 1]) % 12 === 5);

/** Words in a family label that claim a voicing structure, not just pitch content, and the check backing each. */
const STRUCTURAL_WORDS: readonly [RegExp, (pitches: readonly number[]) => boolean][] = [
  [/cluster/i, soundsPacked],
  [/quartal/i, soundsStackedFourths]
];

const labelSounds = (label: string, pitches: readonly number[]): boolean =>
  STRUCTURAL_WORDS.every(([word, holds]) => !word.test(label) || holds(pitches));

/**
 * States only what sounds: root, the other notes or degrees, and a non-root bass. An inverted dyad names the
 * interval up from its bass, which is the one that sounds.
 */
const describeNotes = (
  root: number,
  intervals: readonly number[],
  bassInterval: number,
  pitches: readonly number[],
  familyLabel: string | null
): string => {
  const rootName = pitchClassName(root);
  const noteName = (interval: number): string => pitchClassName(root + interval);
  const degrees = intervals.map(degreeLabel).join(' ');
  const over = bassInterval === 0 ? '' : ` over ${noteName(bassInterval)}`;

  if (!intervals.includes(0)) return `${intervals.map(noteName).join(' + ')} (${degrees} of ${rootName}, no root)`;
  if (intervals.length === 1) return pitches.length > 1 ? `${rootName} octaves` : `${rootName} single note`;

  if (intervals.length === 2) {
    const other = intervals[1];
    if (other === 6) return `${rootName} tritone dyad${over}`;
    if (bassInterval === 0) return `${rootName} + ${noteName(other)} (${intervalName(other)})`;
    return `${rootName}${over} (${intervalName(-other)})`;
  }
  const generic = hasChromaticRun(intervals) && soundsPacked(pitches) ? 'cluster' : 'voicing';
  const kind = familyLabel !== null && labelSounds(familyLabel, pitches) ? familyLabel : generic;
  return `${rootName} ${kind} (${degrees})${over}`;
};

/**
 * `symbol` is the full chord symbol including the root (e.g. 'C/E', 'E5(b9)'), or null. `name` equals the
 * symbol when there is one, otherwise a descriptive name. A family label is used in descriptive names only
 * when the shape really matches that (non-legacy) family and, for labels that name a structure ('cluster',
 * 'Quartal'), when the sounding notes show it.
 */
export const nameVoicing = (
  shape: Shape,
  tuning: Tuning,
  rootPc: number,
  family?: VoicingFamily
): VoicingName => {
  const root = pitchClass(rootPc);
  const notes = soundingNotes(shape, tuning);
  const byString = degreesByString(shape, tuning, root);
  const degrees = degreesOf(notes, root);
  if (notes.length === 0) return { symbol: null, name: 'No notes', degrees, degreesByString: byString };

  const intervals = [...new Set(notes.map(([midi]) => intervalFrom(root, pitchClass(midi))))].sort((a, b) => a - b);
  const bassInterval = intervalFrom(root, pitchClass(notes[0][0]));
  const { symbol: suffix } = chordSymbol(root, intervals, bassInterval);
  if (suffix !== null) {
    const symbol = `${pitchClassName(root)}${suffix}`;
    return { symbol, name: symbol, degrees, degreesByString: byString };
  }

  const familyLabel =
    family && family.group !== 'legacy' && matchFamily(family, root, shape, tuning).ok ? family.label : null;
  const pitches = [...new Set(notes.map(([midi]) => midi))];
  return {
    symbol: null,
    name: describeNotes(root, intervals, bassInterval, pitches, familyLabel),
    degrees,
    degreesByString: byString
  };
};
