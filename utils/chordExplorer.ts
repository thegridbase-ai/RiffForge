/**
 * Maps a displayed chord (name + subtext) to a Chord Explorer deep link:
 * https://chords.thegridbase.com/?root=<ROOT>&type=<TYPE>
 *
 * Chord Explorer type ids: major, minor, dim, aug, 7, m7, maj7, dim7, sus2, sus4
 */

import { parsePitchClass, pitchClass, pitchClassName } from '../engine/pitch';
import { VOICING_FAMILIES } from '../engine/voicingSpec';

export const CHORD_EXPLORER_BASE_URL = 'https://chords.thegridbase.com/';

export type ChordExplorerType =
  | 'major' | 'minor' | 'dim' | 'aug' | '7'
  | 'm7' | 'maj7' | 'dim7' | 'sus2' | 'sus4';

// A root is a note letter with an optional accidental followed by a chord quality or a non-letter
// ("Em", "C#m7", "Bb(VI)", "F#5"); ordinary words that start with A-G ("Drop Ghost", "Diminished") are not roots.
const QUALITY_AHEAD = '(?=$|[^a-z]|m|maj|min|dim|aug|sus|add)';
const ROOT_RE = new RegExp(`^([A-G](?:#|b${QUALITY_AHEAD})?)${QUALITY_AHEAD}`);
const STRIP_ROOT_RE = /^([A-G]#?)/;

const rootOf = (text: string): string | null => {
  const match = text.trim().match(ROOT_RE);
  if (!match) return null;
  const pc = parsePitchClass(match[1]);
  return pc === null ? null : pitchClassName(pc);
};

/** Fallback root from a label ("C#m7" -> "C#", "Bb(VI)" -> "A#"). Falls back to "E". */
export const parseRoot = (name: string, subtext: string): string => rootOf(name) ?? rootOf(subtext) ?? 'E';

/**
 * Best-effort mapping of a chord quality string (root stripped) to a
 * Chord Explorer type id. Checks are ordered most-specific first.
 */
const qualityToType = (quality: string): ChordExplorerType | null => {
  const q = quality.trim();
  if (q === '') return 'major';

  const lower = q.toLowerCase();
  // Collapse spelled-out qualities: "Major 7" -> "maj7", "Minor 7" -> "m7"
  const compact = lower.replace(/\s+/g, '').replace(/^major/, 'maj').replace(/^minor/, 'min');

  if (compact.startsWith('maj7') || lower.startsWith('ma7') || q.startsWith('M7')) return 'maj7';
  if (compact.startsWith('min7')) return 'm7';
  if (lower.startsWith('dim7') || q.startsWith('°7')) return 'dim7';
  if (lower.startsWith('dim') || q.startsWith('°')) return 'dim';
  if (lower.startsWith('aug') || q.startsWith('+')) return 'aug';
  if (lower.startsWith('sus2')) return 'sus2';
  if (lower.startsWith('sus')) return 'sus4';
  if (q.startsWith('m7') || lower.startsWith('min7')) return 'm7';
  if (lower.startsWith('minor') || lower.startsWith('min') || (q.startsWith('m') && !lower.startsWith('maj'))) return 'minor';
  if (q.startsWith('7')) return '7';
  if (lower.startsWith('major') || lower.startsWith('maj')) return 'major';
  if (q.startsWith('5')) return 'major'; // power chord — closest match

  return null;
};

/**
 * Maps a displayed chord to a Chord Explorer type.
 * Subtext (e.g. "Em(add9)") is more descriptive than name, so it wins;
 * unknown qualities fall back to minor if an "m" marker is present, else major.
 */
export const mapToExplorerType = (name: string, subtext: string): ChordExplorerType => {
  const stripRoot = (s: string) => s.trim().replace(STRIP_ROOT_RE, '');

  const fromSubtext = qualityToType(stripRoot(subtext));
  if (fromSubtext) return fromSubtext;

  const fromName = qualityToType(stripRoot(name));
  if (fromName) return fromName;

  // Unknown quality: minor-ish if either string carries an "m" marker right after the root
  const minorish = /^[A-G]#?m(?!aj)/.test(name.trim()) || /^[A-G]#?m(?!aj)/.test(subtext.trim());
  return minorish ? 'minor' : 'major';
};

/** Chord Explorer's URL ids are case-sensitive and capitalize only Major. */
const TYPE_PARAM: Record<ChordExplorerType, string> = {
  major: 'Major', minor: 'minor', dim: 'dim', aug: 'aug', '7': '7',
  m7: 'm7', maj7: 'maj7', dim7: 'dim7', sus2: 'sus2', sus4: 'sus4'
};

/** Shape as Chord Explorer's `gv` param: low -> high frets joined by "-", "x" for muted ("0-2-2-x-x-x"). */
export const shapeToGvParam = (shape: readonly (number | null)[]): string =>
  shape.map((f) => (f === null ? 'x' : String(f))).join('-');

/**
 * Builds the full Chord Explorer URL. Sharps are URL-encoded (C# -> C%23). With a shape, Chord Explorer's
 * "Playable for me" panel opens on that exact voicing.
 */
export const buildChordExplorerUrl = (
  chord: { name: string; subtext: string },
  shape?: readonly (number | null)[]
): string => {
  const root = parseRoot(chord.name, chord.subtext);
  const type = TYPE_PARAM[mapToExplorerType(chord.name, chord.subtext)];
  const gv = shape ? `&gv=${shapeToGvParam(shape)}` : '';
  return `${CHORD_EXPLORER_BASE_URL}?root=${encodeURIComponent(root)}&type=${encodeURIComponent(type)}${gv}`;
};

/** What a link should open in Chord Explorer: the sounded root, and a type only when Chord Explorer has one. */
export interface ExplorerTarget {
  root: string;
  type?: ChordExplorerType;
}

// Engine families Chord Explorer can show. Power chords, dyads, the tritone, fourths, quartal stacks and clusters
// have no Chord Explorer type, so their links carry no type at all rather than a wrong one.
const TYPE_BY_FAMILY: Readonly<Record<string, ChordExplorerType>> = {
  sus2: 'sus2', sus4: 'sus4', add9: 'major', m_add9: 'minor', '7': '7', m7: 'm7', maj7: 'maj7',
  phrygian: 'major', major: 'major', minor: 'minor', dim: 'dim', aug: 'aug'
};

// Full Chord Explorer formulas for sounds no engine family matches (e.g. a complete maj7 or an m11)
const FULL_FORMULAS: readonly [ChordExplorerType, readonly number[]][] = [
  ['dim7', [0, 3, 6, 9]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['7', [0, 4, 7, 10]],
  ['major', [0, 4, 7]], ['minor', [0, 3, 7]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['aug', [0, 4, 8]], ['dim', [0, 3, 6]]
];

export const explorerTypeForFamily = (familyId: string): ChordExplorerType | undefined =>
  TYPE_BY_FAMILY[familyId.replace(/^drone_/, '')];

/**
 * Chord Explorer type for the sounding pitch classes (intervals above the root): the first engine family whose
 * pitch classes match exactly (bass and note count ignored), else the largest full formula that is present without
 * a contradicting third. Undefined when nothing fits honestly.
 */
export const explorerTypeForIntervals = (intervals: readonly number[]): ChordExplorerType | undefined => {
  const sounding = new Set(intervals.map((i) => pitchClass(i)));
  for (const family of VOICING_FAMILIES) {
    const allowed = new Set([...family.required, ...family.optional]);
    if (family.required.every((i) => sounding.has(i)) && [...sounding].every((i) => allowed.has(i))) {
      return explorerTypeForFamily(family.id);
    }
  }
  const hasMinor = sounding.has(3);
  const hasMajor = sounding.has(4);
  for (const [type, formula] of FULL_FORMULAS) {
    if (!formula.every((i) => sounding.has(i))) continue;
    const third = formula.includes(4) ? 'major' : formula.includes(3) ? 'minor' : 'none';
    if (third === 'major' && hasMinor) continue;
    if (third === 'minor' && hasMajor) continue;
    if (third === 'none' && (hasMinor || hasMajor)) continue;
    return type;
  }
  return undefined;
};

/** Chord Explorer URL for a target; the exact shape travels as gv (callers send it only in E Standard). */
export const buildExplorerUrl = (target: ExplorerTarget, shape?: readonly (number | null)[]): string => {
  const params = [`root=${encodeURIComponent(target.root)}`];
  if (target.type) params.push(`type=${encodeURIComponent(TYPE_PARAM[target.type])}`);
  if (shape) params.push(`gv=${shapeToGvParam(shape)}`);
  return `${CHORD_EXPLORER_BASE_URL}?${params.join('&')}`;
};
