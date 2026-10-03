// Voicing families: interval recipes relative to a chosen root, plus exact validation of concrete shapes.
import type { FamilyGroup, FamilyTag, Shape, Tuning, VoicingFamily } from './types';
import { degreeLabel, intervalFrom, parseNoteName, parsePitchClass, pitchClass } from './pitch';
import { shapeToMidiByString } from './shape';

export type FamilyMismatchReason = 'PITCH_CLASSES' | 'NOTE_COUNT' | 'BASS' | 'NO_DRONE_STRING';

/** Narrow with `m.ok === false`: without strictNullChecks (the apps' setting) `!m.ok` does not narrow. */
export type FamilyMatch = { ok: true } | { ok: false; reason: FamilyMismatchReason; detail: string };

/** Guitar string count cap for note-count limits. */
const MAX_VOICING_NOTES = 6;

const sortedUnique = (values: readonly number[]): number[] =>
  [...new Set(values.map(pitchClass))].sort((a, b) => a - b);

const freezeFamily = (family: VoicingFamily): VoicingFamily =>
  Object.freeze({
    ...family,
    required: Object.freeze([...family.required]),
    optional: Object.freeze([...family.optional]),
    forbidden: Object.freeze([...family.forbidden]),
    bass: family.bass === 'any' ? 'any' : Object.freeze([...family.bass]),
    tags: Object.freeze([...family.tags])
  });

interface FamilyInput {
  id: string;
  label: string;
  description: string;
  group: FamilyGroup;
  required: number[];
  optional?: number[];
  forbidden?: number[];
  bass: number[] | 'any';
  preferredBass?: number;
  minNotes: number;
  maxNotes: number;
  tags?: FamilyTag[];
}

const define = (input: FamilyInput): VoicingFamily => {
  const family: VoicingFamily = {
    id: input.id,
    label: input.label,
    description: input.description,
    group: input.group,
    required: input.required,
    optional: input.optional ?? [],
    forbidden: input.forbidden ?? [],
    bass: input.bass,
    minNotes: input.minNotes,
    maxNotes: input.maxNotes,
    tags: input.tags ?? []
  };
  if (input.preferredBass !== undefined) family.preferredBass = input.preferredBass;
  return freezeFamily(family);
};

const triad = (id: string, label: string, required: number[], description: string): VoicingFamily =>
  define({ id, label, description, group: 'triads', required, bass: 'any', minNotes: 3, maxNotes: 6, tags: ['triad'] });

export const VOICING_FAMILIES: readonly VoicingFamily[] = Object.freeze([
  define({
    id: 'power5',
    label: '5',
    description: 'Root and fifth: the tight, gain-proof metal workhorse.',
    group: 'power',
    required: [0, 7],
    forbidden: [3, 4],
    bass: [0],
    minNotes: 2,
    maxNotes: 4,
    tags: ['metal-friendly', 'pedal-compatible']
  }),
  define({
    id: 'power5_b2',
    label: '5 b2',
    description: 'Power chord with a minor-second rub for a darker, menacing edge.',
    group: 'power',
    required: [0, 1, 7],
    bass: [0],
    minNotes: 3,
    maxNotes: 5,
    tags: ['metal-friendly', 'dissonant']
  }),
  define({
    id: 'dyad_b2',
    label: 'b2 dyad',
    description: 'Root against its minor second: a raw, grinding dissonance.',
    group: 'power',
    required: [0, 1],
    bass: [0],
    minNotes: 2,
    maxNotes: 4,
    tags: ['metal-friendly', 'dissonant']
  }),
  define({
    id: 'tritone',
    label: 'Tritone',
    description: 'Root and flat fifth: an unresolved, uneasy dyad.',
    group: 'power',
    required: [0, 6],
    bass: [0],
    minNotes: 2,
    maxNotes: 4,
    tags: ['metal-friendly', 'dissonant']
  }),
  define({
    id: 'fourth',
    label: '4th',
    description: 'Root and fourth: a hollow dyad that stays clear under gain.',
    group: 'power',
    required: [0, 5],
    bass: [0],
    minNotes: 2,
    maxNotes: 4,
    tags: ['metal-friendly']
  }),
  define({
    id: 'sus2',
    label: 'sus2',
    description: 'Root, second and fifth: open and unresolved, no third.',
    group: 'susAdd',
    required: [0, 2, 7],
    forbidden: [3, 4],
    bass: 'any',
    preferredBass: 0,
    minNotes: 3,
    maxNotes: 6
  }),
  define({
    id: 'sus4',
    label: 'sus4',
    description: 'Root, fourth and fifth: suspended tension with no third.',
    group: 'susAdd',
    required: [0, 5, 7],
    forbidden: [3, 4],
    bass: 'any',
    preferredBass: 0,
    minNotes: 3,
    maxNotes: 6
  }),
  define({
    id: 'add9',
    label: 'add9',
    description: 'Major third with an added ninth; the fifth is optional.',
    group: 'susAdd',
    required: [0, 2, 4],
    optional: [7],
    bass: 'any',
    preferredBass: 0,
    minNotes: 3,
    maxNotes: 6,
    tags: ['color']
  }),
  define({
    id: 'm_add9',
    label: 'm(add9)',
    description: 'Minor third with an added ninth: dark and wide; the fifth is optional.',
    group: 'susAdd',
    required: [0, 2, 3],
    optional: [7],
    bass: 'any',
    preferredBass: 0,
    minNotes: 3,
    maxNotes: 6,
    tags: ['color', 'metal-friendly']
  }),
  define({
    id: '7',
    label: '7 shell',
    description: 'Dominant shell: root, major third and flat seventh.',
    group: 'shells',
    required: [0, 4, 10],
    bass: [0],
    minNotes: 3,
    maxNotes: 4
  }),
  define({
    id: 'm7',
    label: 'm7 shell',
    description: 'Minor seventh shell: root, minor third and flat seventh.',
    group: 'shells',
    required: [0, 3, 10],
    bass: [0],
    minNotes: 3,
    maxNotes: 4
  }),
  define({
    id: 'maj7',
    label: 'maj7 shell',
    description: 'Major seventh shell: root, major third and major seventh.',
    group: 'shells',
    required: [0, 4, 11],
    bass: [0],
    minNotes: 3,
    maxNotes: 4,
    tags: ['color']
  }),
  define({
    id: 'quartal',
    label: 'Quartal',
    description: 'The notes of stacked fourths (root, fourth, flat seventh, optional minor third) in any spacing.',
    group: 'quartalCluster',
    required: [0, 5, 10],
    optional: [3],
    bass: [0],
    minNotes: 3,
    maxNotes: 4,
    tags: ['color']
  }),
  define({
    id: 'cluster_m2',
    label: 'm2 cluster',
    description: 'Root, minor second and major second: chromatic neighbours that grind when voiced close.',
    group: 'quartalCluster',
    required: [0, 1, 2],
    bass: 'any',
    preferredBass: 0,
    minNotes: 3,
    maxNotes: 4,
    tags: ['dissonant', 'color']
  }),
  define({
    id: 'cluster_b3',
    label: 'b3 cluster',
    description: 'Root, second and minor third with no fifth: a dark, moody colour.',
    group: 'quartalCluster',
    required: [0, 2, 3],
    bass: 'any',
    preferredBass: 0,
    minNotes: 3,
    maxNotes: 4,
    tags: ['color']
  }),
  define({
    id: 'phrygian',
    label: 'Phrygian',
    description: 'Root, flat second, major third and fifth: Phrygian-dominant menace.',
    group: 'darkColors',
    required: [0, 1, 4, 7],
    optional: [10],
    bass: [0],
    minNotes: 4,
    maxNotes: 6,
    tags: ['metal-friendly', 'dissonant']
  }),
  triad('major', 'Major', [0, 4, 7], 'Major triad in any inversion.'),
  triad('minor', 'Minor', [0, 3, 7], 'Minor triad in any inversion.'),
  triad('dim', 'Dim', [0, 3, 6], 'Diminished triad in any inversion.'),
  triad('aug', 'Aug', [0, 4, 8], 'Augmented triad in any inversion.')
]);

/** Adds the open-string drone rule; pitch-class, bass and note-count rules stay untouched. Idempotent. */
export const withDrone = (family: VoicingFamily): VoicingFamily => {
  if (family.drone) return family;
  return freezeFamily({
    ...family,
    id: `drone_${family.id}`,
    label: `Drone ${family.label}`,
    description: `${family.description} An open string rings the root or fifth.`,
    group: 'drones',
    drone: true
  });
};

const DRONE_BASE_IDS = ['power5', 'fourth', 'sus2', 'm_add9', 'quartal', 'phrygian'] as const;

export const DRONE_FAMILIES: readonly VoicingFamily[] = Object.freeze(
  DRONE_BASE_IDS.map((id) => withDrone(VOICING_FAMILIES.find((f) => f.id === id) as VoicingFamily))
);

export const ALL_FAMILIES: readonly VoicingFamily[] = Object.freeze([...VOICING_FAMILIES, ...DRONE_FAMILIES]);

const GROUP_LABELS: readonly [Exclude<FamilyGroup, 'legacy'>, string][] = [
  ['power', 'Power and dyads'],
  ['susAdd', 'Sus and add'],
  ['shells', 'Shells'],
  ['quartalCluster', 'Quartal and clusters'],
  ['darkColors', 'Dark colors'],
  ['triads', 'Triads'],
  ['drones', 'Drones']
];

export const FAMILY_GROUPS: readonly { id: FamilyGroup; label: string; familyIds: readonly string[] }[] = Object.freeze(
  GROUP_LABELS.map(([id, label]) =>
    Object.freeze({
      id,
      label,
      familyIds: Object.freeze(ALL_FAMILIES.filter((f) => f.group === id).map((f) => f.id))
    })
  )
);

const FAMILY_BY_ID: ReadonlyMap<string, VoicingFamily> = new Map(ALL_FAMILIES.map((f) => [f.id, f]));

export const getFamily = (id: string): VoicingFamily | undefined => FAMILY_BY_ID.get(id);

export const allowedIntervals = (family: VoicingFamily): number[] =>
  sortedUnique([...family.required, ...family.optional]);

// ---------------------------------------------------------------------------
// Matching concrete shapes
// ---------------------------------------------------------------------------

const maskOf = (intervals: readonly number[]): number => {
  let mask = 0;
  for (const i of intervals) mask |= 1 << pitchClass(i);
  return mask;
};

const degreesOfMask = (mask: number): string => {
  const labels: string[] = [];
  for (let i = 0; i < 12; i++) if (mask & (1 << i)) labels.push(degreeLabel(i));
  return labels.join(' ');
};

const noteCountText = (family: VoicingFamily): string =>
  family.minNotes === family.maxNotes ? `${family.minNotes}` : `${family.minNotes}..${family.maxNotes}`;

const DRONE_INTERVALS_MASK = maskOf([0, 7]);

/**
 * Exact validation in a fixed order: note count, pitch classes (required present, nothing outside
 * required + optional, nothing forbidden), bass interval of the lowest-pitched note, then the drone rule.
 */
export const matchFamily = (family: VoicingFamily, rootPc: number, shape: Shape, tuning: Tuning): FamilyMatch => {
  const root = pitchClass(rootPc);
  const byString = shapeToMidiByString(shape, tuning);

  let count = 0;
  let bass = Infinity;
  let present = 0;
  for (const midi of byString) {
    if (midi === null) continue;
    count++;
    if (midi < bass) bass = midi;
    present |= 1 << intervalFrom(root, pitchClass(midi));
  }

  if (count < family.minNotes || count > family.maxNotes) {
    return {
      ok: false,
      reason: 'NOTE_COUNT',
      detail: `${count} ${count === 1 ? 'note' : 'notes'}, ${family.label} needs ${noteCountText(family)}`
    };
  }

  const required = maskOf(family.required);
  const allowed = required | maskOf(family.optional);
  const missing = required & ~present;
  if (missing) {
    return { ok: false, reason: 'PITCH_CLASSES', detail: `missing ${degreesOfMask(missing)}` };
  }
  const forbidden = present & maskOf(family.forbidden);
  if (forbidden) {
    return { ok: false, reason: 'PITCH_CLASSES', detail: `${degreesOfMask(forbidden)} is forbidden in ${family.label}` };
  }
  const outside = present & ~allowed;
  if (outside) {
    return { ok: false, reason: 'PITCH_CLASSES', detail: `${degreesOfMask(outside)} is outside ${family.label}` };
  }

  if (family.bass !== 'any') {
    const bassInterval = intervalFrom(root, pitchClass(bass));
    if (!family.bass.includes(bassInterval)) {
      return {
        ok: false,
        reason: 'BASS',
        detail: `bass is ${degreeLabel(bassInterval)}, ${family.label} needs ${family.bass.map(degreeLabel).join(' or ')}`
      };
    }
  }

  if (family.drone) {
    const hasDrone = byString.some(
      (midi, s) =>
        midi !== null && shape[s] === 0 && (DRONE_INTERVALS_MASK & (1 << intervalFrom(root, pitchClass(midi)))) !== 0
    );
    if (!hasDrone) {
      return { ok: false, reason: 'NO_DRONE_STRING', detail: 'no open string sounds the root or 5th' };
    }
  }

  return { ok: true };
};

// ---------------------------------------------------------------------------
// Legacy RiffForge chord rows
// ---------------------------------------------------------------------------

/**
 * Converts a RiffForge JSON `notes` array into a recipe: pitch classes relative to `baseRoot` are all
 * required, the lowest parsed note fixes the bass. Unparseable tokens are skipped and do not count as notes.
 */
export const fromLegacyNotes = (notes: readonly string[], baseRoot: string): VoicingFamily => {
  const root = parsePitchClass(baseRoot);
  if (root === null) throw new Error(`Invalid baseRoot: ${baseRoot}`);
  const midi = notes.map(parseNoteName).filter((m): m is number => m !== null);
  if (midi.length === 0) throw new Error(`No parseable notes in [${notes.join(', ')}]`);

  const required = sortedUnique(midi.map((m) => intervalFrom(root, pitchClass(m))));
  const bass = intervalFrom(root, pitchClass(Math.min(...midi)));
  const label = required.map(degreeLabel).join(' ');
  return define({
    id: `legacy:${required.join('.')}/${bass}`,
    label,
    description: `Library chord recipe ${label} with ${degreeLabel(bass)} in the bass.`,
    group: 'legacy',
    required,
    bass: [bass],
    minNotes: required.length,
    maxNotes: Math.min(MAX_VOICING_NOTES, Math.max(required.length, midi.length))
  });
};

// ---------------------------------------------------------------------------
// Relaxation ladder
// ---------------------------------------------------------------------------

interface RelaxStep {
  key: string;
  label: string;
  apply: (family: VoicingFamily) => VoicingFamily;
}

const moveToOptional = (family: VoicingFamily, intervals: readonly number[]): VoicingFamily => ({
  ...family,
  required: family.required.filter((i) => !intervals.includes(i)),
  optional: sortedUnique([...family.optional, ...family.required.filter((i) => intervals.includes(i))])
});

const EXTENSIONS = [2, 5, 9];
const THIRDS_AND_SEVENTHS = [3, 4, 10, 11];

const RELAX_STEPS: readonly RelaxStep[] = [
  {
    key: 'anyBass',
    label: 'any bass note',
    // Keeps the old bass as a soft preference so root-position results still rank first.
    apply: (f) => {
      if (f.bass === 'any') return f;
      const preferredBass = f.preferredBass ?? f.bass[0];
      return preferredBass === undefined ? { ...f, bass: 'any' } : { ...f, bass: 'any', preferredBass };
    }
  },
  {
    key: 'no5',
    label: 'no 5th',
    apply: (f) => (f.required.includes(7) && f.required.length >= 3 ? moveToOptional(f, [7]) : f)
  },
  {
    key: 'noExt',
    label: 'no extensions',
    apply: (f) => (f.required.some((i) => THIRDS_AND_SEVENTHS.includes(i)) ? moveToOptional(f, EXTENSIONS) : f)
  },
  {
    key: 'anyCount',
    label: 'any note count',
    apply: (f) => ({ ...f, minNotes: Math.max(2, f.required.length), maxNotes: MAX_VOICING_NOTES })
  }
];

/**
 * Two required pitch classes over a free bass: the dyad may sound inverted, which swaps its only interval for the
 * complement (b2 -> 7, 4 -> 5). The tritone is its own inversion.
 */
const invertibleDyad = (f: VoicingFamily): boolean => {
  const required = sortedUnique(f.required);
  return f.bass === 'any' && required.length === 2 && required[1] - required[0] !== 6;
};

const sameRecipe = (a: VoicingFamily, b: VoicingFamily): boolean =>
  a.minNotes === b.minNotes &&
  a.maxNotes === b.maxNotes &&
  a.preferredBass === b.preferredBass &&
  a.required.join() === b.required.join() &&
  a.optional.join() === b.optional.join() &&
  (a.bass === 'any' ? b.bass === 'any' : b.bass !== 'any' && a.bass.join() === b.bass.join());

/**
 * Ordered, cumulative relaxations for the "closest relaxed suggestion". Steps that change nothing are
 * skipped, and so are steps that would leave an invertible dyad: freeing the bass of a b2 dyad, or dropping the
 * 5th of sus4 or the 9th of add9, would return a different interval instead of a looser version of the family.
 * Each relaxed family gets a derived id (`<id>~<step>~...`) so it never collides with the exact one.
 */
export const relaxFamily = (family: VoicingFamily): { family: VoicingFamily; relaxed: string[] }[] => {
  const ladder: { family: VoicingFamily; relaxed: string[] }[] = [];
  let current = family;
  const keys: string[] = [];
  const labels: string[] = [];
  for (const step of RELAX_STEPS) {
    const next = step.apply(current);
    if (sameRecipe(next, current)) continue;
    if (invertibleDyad(next) && !invertibleDyad(current)) continue;
    keys.push(step.key);
    labels.push(step.label);
    current = next;
    ladder.push({
      family: freezeFamily({
        ...current,
        id: `${family.id}~${keys.join('~')}`,
        description: `${family.description} Relaxed: ${labels.join(', ')}.`
      }),
      relaxed: [...labels]
    });
  }
  return ladder;
};
