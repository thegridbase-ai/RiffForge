/**
 * Maps a displayed chord (name + subtext) to a Chord Explorer deep link:
 * https://chords.thegridbase.com/?root=<ROOT>&type=<TYPE>
 *
 * Chord Explorer type ids: major, minor, dim, aug, 7, m7, maj7, dim7, sus2, sus4
 */

export const CHORD_EXPLORER_BASE_URL = 'https://chords.thegridbase.com/';

export type ChordExplorerType =
  | 'major' | 'minor' | 'dim' | 'aug' | '7'
  | 'm7' | 'maj7' | 'dim7' | 'sus2' | 'sus4';

const ROOT_RE = /^([A-G]#?)/;

/** Extracts the displayed root ("C#m7" -> "C#"). Falls back to "E". */
export const parseRoot = (name: string, subtext: string): string => {
  const fromName = name.trim().match(ROOT_RE);
  if (fromName) return fromName[1];
  const fromSubtext = subtext.trim().match(ROOT_RE);
  if (fromSubtext) return fromSubtext[1];
  return 'E';
};

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
  const stripRoot = (s: string) => s.trim().replace(ROOT_RE, '');

  const fromSubtext = qualityToType(stripRoot(subtext));
  if (fromSubtext) return fromSubtext;

  const fromName = qualityToType(stripRoot(name));
  if (fromName) return fromName;

  // Unknown quality: minor-ish if either string carries an "m" marker right after the root
  const minorish = /^[A-G]#?m(?!aj)/.test(name.trim()) || /^[A-G]#?m(?!aj)/.test(subtext.trim());
  return minorish ? 'minor' : 'major';
};

/** Builds the full Chord Explorer URL. Sharps are URL-encoded (C# -> C%23). */
export const buildChordExplorerUrl = (chord: { name: string; subtext: string }): string => {
  const root = parseRoot(chord.name, chord.subtext);
  const type = mapToExplorerType(chord.name, chord.subtext);
  return `${CHORD_EXPLORER_BASE_URL}?root=${encodeURIComponent(root)}&type=${encodeURIComponent(type)}`;
};
