import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  VOICING_FAMILIES,
  DRONE_FAMILIES,
  ALL_FAMILIES,
  FAMILY_GROUPS,
  getFamily,
  withDrone,
  allowedIntervals,
  matchFamily,
  fromLegacyNotes,
  relaxFamily
} from './voicingSpec';
import type { Shape, VoicingFamily } from './types';
import { E_STANDARD, DROP_D } from './tuning';
import { parseNoteName, parsePitchClass, pitchClass, intervalFrom } from './pitch';

const x = null;
const E = 4;
const A = 9;
const B = 11;
const C = 0;
const D = 2;
const F = 5;

const fam = (id: string): VoicingFamily => {
  const family = getFamily(id);
  if (!family) throw new Error(`missing family ${id}`);
  return family;
};

describe('family recipes', () => {
  type Recipe = [
    id: string,
    group: string,
    required: number[],
    optional: number[],
    bass: number[] | 'any',
    preferredBass: number | undefined,
    minNotes: number,
    maxNotes: number,
    tags: string[]
  ];
  const recipes: Recipe[] = [
    ['power5', 'power', [0, 7], [], [0], undefined, 2, 4, ['metal-friendly', 'pedal-compatible']],
    ['power5_b2', 'power', [0, 1, 7], [], [0], undefined, 3, 5, ['metal-friendly', 'dissonant']],
    ['dyad_b2', 'power', [0, 1], [], [0], undefined, 2, 4, ['metal-friendly', 'dissonant']],
    ['tritone', 'power', [0, 6], [], [0], undefined, 2, 4, ['metal-friendly', 'dissonant']],
    ['fourth', 'power', [0, 5], [], [0], undefined, 2, 4, ['metal-friendly']],
    ['sus2', 'susAdd', [0, 2, 7], [], 'any', 0, 3, 6, []],
    ['sus4', 'susAdd', [0, 5, 7], [], 'any', 0, 3, 6, []],
    ['add9', 'susAdd', [0, 2, 4], [7], 'any', 0, 3, 6, ['color']],
    ['m_add9', 'susAdd', [0, 2, 3], [7], 'any', 0, 3, 6, ['color', 'metal-friendly']],
    ['7', 'shells', [0, 4, 10], [], [0], undefined, 3, 4, []],
    ['m7', 'shells', [0, 3, 10], [], [0], undefined, 3, 4, []],
    ['maj7', 'shells', [0, 4, 11], [], [0], undefined, 3, 4, ['color']],
    ['quartal', 'quartalCluster', [0, 5, 10], [3], [0], undefined, 3, 4, ['color']],
    ['cluster_m2', 'quartalCluster', [0, 1, 2], [], 'any', 0, 3, 4, ['dissonant', 'color']],
    ['cluster_b3', 'quartalCluster', [0, 2, 3], [], 'any', 0, 3, 4, ['color']],
    ['phrygian', 'darkColors', [0, 1, 4, 7], [10], [0], undefined, 4, 6, ['metal-friendly', 'dissonant']],
    ['major', 'triads', [0, 4, 7], [], 'any', undefined, 3, 6, ['triad']],
    ['minor', 'triads', [0, 3, 7], [], 'any', undefined, 3, 6, ['triad']],
    ['dim', 'triads', [0, 3, 6], [], 'any', undefined, 3, 6, ['triad']],
    ['aug', 'triads', [0, 4, 8], [], 'any', undefined, 3, 6, ['triad']]
  ];

  it('lists exactly the base families in order', () => {
    expect(VOICING_FAMILIES.map((f) => f.id)).toEqual(recipes.map((r) => r[0]));
  });

  it.each(recipes)('%s has the contract recipe', (id, group, required, optional, bass, preferredBass, min, max, tags) => {
    const f = fam(id);
    expect(f.group).toBe(group);
    expect([...f.required]).toEqual(required);
    expect([...f.optional]).toEqual(optional);
    expect(f.bass === 'any' ? 'any' : [...f.bass]).toEqual(bass);
    expect(f.preferredBass).toBe(preferredBass);
    expect(f.minNotes).toBe(min);
    expect(f.maxNotes).toBe(max);
    expect([...f.tags].sort()).toEqual([...tags].sort());
    expect(f.drone).toBeFalsy();
  });

  it('documents the forbidden thirds of power and sus families', () => {
    expect([...fam('power5').forbidden]).toEqual([3, 4]);
    expect([...fam('sus2').forbidden]).toEqual([3, 4]);
    expect([...fam('sus4').forbidden]).toEqual([3, 4]);
  });

  it('keeps every recipe internally consistent', () => {
    const labels = new Set<string>();
    for (const f of ALL_FAMILIES) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(labels.has(f.label)).toBe(false);
      labels.add(f.label);
      expect(f.required[0]).toBe(0);
      const all = [...f.required, ...f.optional, ...f.forbidden];
      for (const i of all) expect(Number.isInteger(i) && i >= 0 && i < 12).toBe(true);
      expect([...f.required]).toEqual([...new Set(f.required)].sort((a, b) => a - b));
      for (const i of f.optional) expect(f.required).not.toContain(i);
      for (const i of f.forbidden) expect(allowedIntervals(f)).not.toContain(i);
      expect(f.minNotes).toBeLessThanOrEqual(f.maxNotes);
      expect(f.minNotes).toBeGreaterThanOrEqual(Math.min(2, f.required.length));
      expect(f.maxNotes).toBeLessThanOrEqual(6);
      if (f.bass !== 'any') for (const i of f.bass) expect(allowedIntervals(f)).toContain(i);
      if (f.preferredBass !== undefined) expect(allowedIntervals(f)).toContain(f.preferredBass);
    }
  });

  it('freezes the shared recipes', () => {
    expect(Object.isFrozen(fam('power5'))).toBe(true);
    expect(Object.isFrozen(fam('power5').required)).toBe(true);
  });
});

describe('drone families and groups', () => {
  it('derives the drone variants with withDrone', () => {
    expect(DRONE_FAMILIES.map((f) => f.id)).toEqual([
      'drone_power5',
      'drone_fourth',
      'drone_sus2',
      'drone_m_add9',
      'drone_quartal',
      'drone_phrygian'
    ]);
    for (const d of DRONE_FAMILIES) {
      const base = fam(d.id.replace(/^drone_/, ''));
      expect(d.group).toBe('drones');
      expect(d.drone).toBe(true);
      expect(d.required).toEqual(base.required);
      expect(d.optional).toEqual(base.optional);
      expect(d.forbidden).toEqual(base.forbidden);
      expect(d.bass).toEqual(base.bass);
      expect(d.minNotes).toBe(base.minNotes);
      expect(d.maxNotes).toBe(base.maxNotes);
      expect(d.label).toBe(`Drone ${base.label}`);
    }
  });

  it('withDrone is idempotent and leaves the input untouched', () => {
    const power = fam('power5');
    const drone = withDrone(power);
    expect(drone.id).toBe('drone_power5');
    expect(withDrone(drone)).toBe(drone);
    expect(power.drone).toBeFalsy();
    expect(power.group).toBe('power');
  });

  it('ALL_FAMILIES is the base list followed by the drones, with unique ids', () => {
    expect(ALL_FAMILIES).toEqual([...VOICING_FAMILIES, ...DRONE_FAMILIES]);
    expect(new Set(ALL_FAMILIES.map((f) => f.id)).size).toBe(ALL_FAMILIES.length);
  });

  it('getFamily finds base and drone families and returns undefined otherwise', () => {
    expect(getFamily('m_add9')?.label).toBe('m(add9)');
    expect(getFamily('drone_quartal')?.drone).toBe(true);
    expect(getFamily('nope')).toBeUndefined();
  });

  it('groups families in UI order and covers each family exactly once', () => {
    expect(FAMILY_GROUPS.map((g) => [g.id, g.label])).toEqual([
      ['power', 'Power and dyads'],
      ['susAdd', 'Sus and add'],
      ['shells', 'Shells'],
      ['quartalCluster', 'Quartal and clusters'],
      ['darkColors', 'Dark colors'],
      ['triads', 'Triads'],
      ['drones', 'Drones']
    ]);
    const listed = FAMILY_GROUPS.flatMap((g) => g.familyIds);
    expect([...listed].sort()).toEqual(ALL_FAMILIES.map((f) => f.id).sort());
    for (const g of FAMILY_GROUPS) for (const id of g.familyIds) expect(fam(id).group).toBe(g.id);
    expect(FAMILY_GROUPS[0].familyIds).toEqual(['power5', 'power5_b2', 'dyad_b2', 'tritone', 'fourth']);
  });
});

describe('allowedIntervals', () => {
  it('returns sorted unique required and optional intervals', () => {
    expect(allowedIntervals(fam('phrygian'))).toEqual([0, 1, 4, 7, 10]);
    expect(allowedIntervals(fam('quartal'))).toEqual([0, 3, 5, 10]);
    expect(allowedIntervals(fam('power5'))).toEqual([0, 7]);
  });
});

describe('matchFamily', () => {
  const ok = { ok: true };
  // Narrows with `=== true`: the repo tsconfig is non-strict, where `!r.ok` does not narrow the union.
  const mismatch = (family: string, root: number, shape: Shape, tuning = E_STANDARD) => {
    const r = matchFamily(fam(family), root, shape, tuning);
    return r.ok === true ? null : r;
  };
  const reason = (family: string, root: number, shape: Shape, tuning = E_STANDARD): string | null =>
    mismatch(family, root, shape, tuning)?.reason ?? null;

  it('accepts hand-checked power chords and octave doublings', () => {
    expect(matchFamily(fam('power5'), E, [0, 2, 2, x, x, x], E_STANDARD)).toEqual(ok);
    expect(matchFamily(fam('power5'), E, [0, 2, x, x, x, x], E_STANDARD)).toEqual(ok);
    expect(matchFamily(fam('power5'), A, [5, 7, 7, x, x, x], E_STANDARD)).toEqual(ok);
    expect(matchFamily(fam('power5'), A, [x, 0, 2, 2, x, x], E_STANDARD)).toEqual(ok);
  });

  it('accepts Drop D one-finger power chords', () => {
    expect(matchFamily(fam('power5'), D, [0, 0, 0, x, x, x], DROP_D)).toEqual(ok);
    expect(matchFamily(fam('power5'), F, [3, 3, 3, x, x, x], DROP_D)).toEqual(ok);
    // The same grip in E standard is E A D: not a power chord.
    expect(reason('power5', E, [0, 0, 0, x, x, x])).toBe('PITCH_CLASSES');
  });

  it('rejects wrong note counts', () => {
    expect(mismatch('power5', E, [0, x, x, x, x, x])).toMatchObject({
      reason: 'NOTE_COUNT',
      detail: expect.stringContaining('1 note,')
    });
    expect(reason('power5', E, [0, 2, 2, 4, 5, 0])).toBe('NOTE_COUNT');
    expect(reason('power5', E, [x, x, x, x, x, x])).toBe('NOTE_COUNT');
    // Shells cap at four notes; the six-string Em(add9) fits m_add9's six-note cap.
    expect(reason('7', E, [0, 2, 0, 1, 0, 0])).toBe('NOTE_COUNT');
    expect(matchFamily(fam('m_add9'), E, [0, 2, 4, 0, 0, 0], E_STANDARD)).toEqual(ok);
    expect(matchFamily(fam('m_add9'), E, [0, 2, 4, 0, x, x], E_STANDARD)).toEqual(ok);
  });

  it('rejects missing, outside and forbidden pitch classes', () => {
    expect(mismatch('power5_b2', E, [0, 2, 2, x, x, x])).toEqual({
      ok: false,
      reason: 'PITCH_CLASSES',
      detail: 'missing b2'
    });
    // Open E major has the major third: forbidden for power5.
    expect(mismatch('power5', E, [0, 2, 2, 1, x, x])).toEqual({
      ok: false,
      reason: 'PITCH_CLASSES',
      detail: '3 is forbidden in 5'
    });
    expect(mismatch('power5_b2', E, [0, 2, 2, 1, x, x])?.detail).toBe('missing b2');
    // E A E G#: the major third is simply outside the 4th dyad.
    expect(mismatch('fourth', E, [0, 0, 2, 1, x, x])?.detail).toBe('3 is outside 4th');
    // sus2 E B F# B is fine, adding G (b3) breaks it.
    expect(matchFamily(fam('sus2'), E, [0, 2, 4, 4, x, x], E_STANDARD)).toEqual(ok);
    expect(reason('sus2', E, [0, 2, 4, 0, x, x])).toBe('PITCH_CLASSES');
  });

  it('accepts optional intervals and both shapes with and without them', () => {
    expect(matchFamily(fam('add9'), C, [x, 3, 2, 0, 3, x], E_STANDARD)).toEqual(ok); // C E G D
    expect(matchFamily(fam('add9'), C, [x, 3, 2, x, 3, x], E_STANDARD)).toEqual(ok); // C E D
    expect(matchFamily(fam('phrygian'), E, [0, 8, 6, 4, x, x], E_STANDARD)).toEqual(ok); // E F G# B
    expect(reason('phrygian', E, [0, 7, 6, x, x, x])).toBe('NOTE_COUNT');
  });

  it('accepts any inversion for triads', () => {
    expect(matchFamily(fam('major'), C, [x, 3, 2, 0, 1, 0], E_STANDARD)).toEqual(ok);
    expect(matchFamily(fam('major'), C, [0, 3, 2, 0, 1, x], E_STANDARD)).toEqual(ok); // E bass
    expect(matchFamily(fam('major'), C, [3, 3, 2, 0, 1, x], E_STANDARD)).toEqual(ok); // G bass
    expect(reason('minor', C, [x, 3, 2, 0, 1, 0])).toBe('PITCH_CLASSES');
  });

  it('enforces the hard bass rule', () => {
    expect(mismatch('power5', E, [x, 2, 2, x, x, x])).toEqual({
      ok: false,
      reason: 'BASS',
      detail: 'bass is 5, 5 needs 1'
    }); // B2 E3
    expect(reason('7', C, [x, x, 2, 3, 1, x])).toBe('BASS'); // E A# C: shell with the third in the bass
  });

  it('finds the bass by pitch, not by string', () => {
    // String 0 fret 12 is E3, but the open A string (A2) is lower: bass is the 4th of E.
    expect(reason('fourth', E, [12, 0, x, x, x, x])).toBe('BASS');
    // String 0 fret 10 is D3 above the open A2: the A root is the real bass.
    expect(matchFamily(fam('fourth'), A, [10, 0, x, x, x, x], E_STANDARD)).toEqual(ok);
  });

  it('applies the drone rule to open strings only', () => {
    expect(matchFamily(fam('drone_power5'), D, [0, 0, 0, x, x, x], DROP_D)).toEqual(ok);
    expect(matchFamily(fam('drone_power5'), D, [x, x, 0, 2, 3, x], E_STANDARD)).toEqual(ok);
    // The open high E is the fifth of A.
    expect(matchFamily(fam('drone_power5'), A, [x, 12, 14, x, x, 0], E_STANDARD)).toEqual(ok);
    expect(mismatch('drone_power5', F, [1, 3, 3, x, x, x])).toEqual({
      ok: false,
      reason: 'NO_DRONE_STRING',
      detail: 'no open string sounds the root or 5th'
    });
    // Open D is the b3 of B: allowed by quartal, but not a drone on the root or fifth.
    const bQuartal: Shape = [7, 7, 0, 2, x, x];
    expect(matchFamily(fam('quartal'), B, bQuartal, E_STANDARD)).toEqual(ok);
    expect(reason('drone_quartal', B, bQuartal)).toBe('NO_DRONE_STRING');
  });

  it('keeps pitch-class rules ahead of the drone rule', () => {
    // An open fifth is not allowed in a 4th dyad, so drone_fourth needs an open root.
    expect(reason('drone_fourth', A, [x, 0, 0, x, x, 0])).toBe('PITCH_CLASSES');
    expect(matchFamily(fam('drone_fourth'), E, [0, 0, x, x, x, x], E_STANDARD)).toEqual(ok);
  });

  it('normalizes the root pitch class', () => {
    expect(matchFamily(fam('power5'), E + 12, [0, 2, 2, x, x, x], E_STANDARD)).toEqual(ok);
  });
});

describe('fromLegacyNotes', () => {
  it('converts "The Omen" (standard-dark, dark-1)', () => {
    const f = fromLegacyNotes(['E2', 'F2', 'B2', 'E3'], 'E');
    expect([...f.required]).toEqual([0, 1, 7]);
    expect([...f.optional]).toEqual([]);
    expect([...f.forbidden]).toEqual([]);
    expect(f.bass).toEqual([0]);
    expect(f.minNotes).toBe(3);
    expect(f.maxNotes).toBe(4);
    expect(f.group).toBe('legacy');
    expect(f.id).toBe('legacy:0.1.7/0');
    expect(f.label).toBe('1 b2 5');
    expect([...f.tags]).toEqual([]);
    expect(f.preferredBass).toBeUndefined();
  });

  it('reads flat spellings against a sharp baseRoot (drop-melodic "Drop Bb Maj7")', () => {
    const f = fromLegacyNotes(['Bb2', 'D3', 'F3', 'A3'], 'A#');
    expect([...f.required]).toEqual([0, 4, 7, 11]);
    expect(f.bass).toEqual([0]);
    expect(f.label).toBe('1 3 5 7');
    const sus = fromLegacyNotes(['Bb2', 'C3', 'F3', 'Bb3'], 'A#'); // "Drop Bb sus2"
    expect([...sus.required]).toEqual([0, 2, 7]);
  });

  it('keeps pitch classes of notes below the guitar range ("E Low Stack")', () => {
    const f = fromLegacyNotes(['E1', 'E2', 'B2'], 'E');
    expect([...f.required]).toEqual([0, 7]);
    expect(f.bass).toEqual([0]);
    expect(f.minNotes).toBe(2);
    expect(f.maxNotes).toBe(3);
    expect(f.id).toBe('legacy:0.7/0');
  });

  it('converts other real rows', () => {
    expect([...fromLegacyNotes(['E2', 'G2', 'B2', 'D3', 'F#3', 'A3'], 'E').required]).toEqual([0, 2, 3, 5, 7, 10]);
    expect(fromLegacyNotes(['E2', 'G2', 'B2', 'D3', 'F#3', 'A3'], 'E').maxNotes).toBe(6);
    expect([...fromLegacyNotes(['F#2', 'A2', 'C3', 'F#3'], 'F#').required]).toEqual([0, 3, 6]);
    expect([...fromLegacyNotes(['D2', 'D#2', 'A2', 'D3'], 'D').required]).toEqual([0, 1, 7]);
  });

  it('takes the bass interval from the lowest parsed note, wherever it is listed', () => {
    const f = fromLegacyNotes(['C3', 'E3', 'G2'], 'C');
    expect(f.bass).toEqual([7]);
    expect(f.id).toBe('legacy:0.4.7/7');
  });

  it('clamps maxNotes to the guitar and skips unparseable tokens', () => {
    expect(fromLegacyNotes(['E2', 'B2', 'E3', 'B3', 'E4', 'B4', 'E5'], 'E').maxNotes).toBe(6);
    const f = fromLegacyNotes(['E2', 'foo', 'B2', ''], 'E');
    expect([...f.required]).toEqual([0, 7]);
    expect(f.maxNotes).toBe(2);
  });

  it('throws when nothing parses or the root is invalid', () => {
    expect(() => fromLegacyNotes(['nope'], 'E')).toThrow();
    expect(() => fromLegacyNotes([], 'E')).toThrow();
    expect(() => fromLegacyNotes(['E2'], 'H')).toThrow();
  });

  it('produces a family that matches its own notes', () => {
    const f = fromLegacyNotes(['E2', 'F2', 'B2', 'E3'], 'E');
    expect(matchFamily(f, E, [0, x, 3, 4, 5, x], E_STANDARD)).toEqual({ ok: true }); // E2 F3 B3 E4
    expect(matchFamily(f, E, [0, 2, 3, x, x, x], E_STANDARD)).toEqual({ ok: true }); // E2 B2 F3
  });

  const chordsDir = fileURLToPath(new URL('../public/chords/', import.meta.url));
  describe.skipIf(!existsSync(chordsDir))('every row in public/chords', () => {
    interface Row {
      id: string;
      notes: string[];
      baseRoot: string;
      relatedChords?: Row[];
    }
    const rows: Row[] = readdirSync(chordsDir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .flatMap((file) => JSON.parse(readFileSync(chordsDir + file, 'utf8')) as Row[])
      .flatMap((row) => [row, ...(row.relatedChords ?? [])]);

    it('loads the real library', () => {
      expect(rows.length).toBeGreaterThan(40);
    });

    it('turns each row into the pitch classes of its notes with the lowest note as bass', () => {
      for (const row of rows) {
        const f = fromLegacyNotes(row.notes, row.baseRoot);
        const root = parsePitchClass(row.baseRoot) as number;
        const midi = row.notes.map((n) => parseNoteName(n) as number);
        const expected = [...new Set(midi.map((m) => intervalFrom(root, pitchClass(m))))].sort((a, b) => a - b);
        expect([...f.required], row.id).toEqual(expected);
        expect(f.bass, row.id).toEqual([intervalFrom(root, pitchClass(Math.min(...midi)))]);
        expect(f.minNotes, row.id).toBe(expected.length);
        expect(f.maxNotes, row.id).toBe(Math.min(6, Math.max(expected.length, row.notes.length)));
        expect(f.id, row.id).toBe(`legacy:${expected.join('.')}/${f.bass}`);
      }
    });
  });
});

describe('relaxFamily', () => {
  const steps = (id: string): string[][] => relaxFamily(fam(id)).map((s) => s.relaxed);
  /** True when no rung of the ladder accepts the shape. */
  const neverAccepted = (family: VoicingFamily, root: number, shape: Shape, tuning = E_STANDARD): boolean =>
    relaxFamily(family).every((s) => matchFamily(s.family, root, shape, tuning).ok !== true);

  it('relaxes 7 shells: bass first, then note count', () => {
    const ladder = relaxFamily(fam('7'));
    expect(ladder.map((s) => s.relaxed)).toEqual([['any bass note'], ['any bass note', 'any note count']]);
    const [first, second] = ladder;
    expect(first.family.bass).toBe('any');
    expect(first.family.preferredBass).toBe(0);
    expect(first.family.maxNotes).toBe(4);
    expect(second.family.bass).toBe('any');
    expect(second.family.minNotes).toBe(3);
    expect(second.family.maxNotes).toBe(6);
  });

  it('never frees the bass of a dyad: inverting it would change its only interval', () => {
    for (const id of ['power5', 'dyad_b2', 'fourth']) {
      expect(steps(id), id).toEqual([['any note count']]);
      for (const step of relaxFamily(fam(id))) expect(step.family.bass, id).toEqual([0]);
    }
    expect(relaxFamily(fam('power5'))[0].family.maxNotes).toBe(6);
    // C#3 C4 is a major 7th, not a b2 dyad on C; B2 E3 is a 4th, not E5; A2 E3 is a 5th, not an E 4th dyad.
    expect(neverAccepted(fam('dyad_b2'), C, [9, x, 10, x, x, x])).toBe(true);
    expect(neverAccepted(fam('power5'), E, [x, 2, 2, x, x, x])).toBe(true);
    expect(neverAccepted(fam('fourth'), E, [x, 0, 2, x, x, x])).toBe(true);
  });

  it('keeps the bass relaxation for the tritone, its own inversion', () => {
    expect(steps('tritone')).toEqual([['any bass note'], ['any bass note', 'any note count']]);
    expect(matchFamily(relaxFamily(fam('tritone'))[0].family, E, [x, 1, 2, x, x, x], E_STANDARD).ok).toBe(true); // A# E
  });

  it('never decays a family into a dyad free to invert (sus2, sus4, triads)', () => {
    for (const id of ['sus2', 'sus4', 'major', 'minor']) expect(steps(id), id).toEqual([]);
    // B3 F#4 is a B5 power chord, not F#sus4 without its fifth.
    expect(neverAccepted(fam('sus4'), 6, [x, x, x, x, 0, 2])).toBe(true);
  });

  it('never drops the interval a family is named for', () => {
    for (const [id, named] of [
      ['add9', 2],
      ['m_add9', 2],
      ['cluster_b3', 2],
      ['quartal', 5]
    ] as const) {
      for (const step of relaxFamily(fam(id))) expect(step.family.required, `${id} ${step.relaxed}`).toContain(named);
    }
    // G2 B2 E3 is Em/G, not E m(add9); F#2 D#3 is a 6th dyad, not a b3 cluster on D#.
    expect(neverAccepted(fam('m_add9'), E, [3, 2, 2, x, x, x])).toBe(true);
    expect(neverAccepted(fam('add9'), C, [x, 3, 2, 0, 1, x])).toBe(true);
    expect(neverAccepted(fam('cluster_b3'), 3, [2, 6, x, x, x, x])).toBe(true);
    expect(steps('cluster_b3')).toEqual([['any note count']]);
    expect(relaxFamily(fam('cluster_b3'))[0].family.minNotes).toBe(3);
    expect(steps('quartal')).toEqual([['any bass note'], ['any bass note', 'any note count']]);
  });

  it('moves extensions to optional when a third or seventh is required (library m9 row)', () => {
    const m9 = fromLegacyNotes(['E2', 'G2', 'B2', 'D3', 'F#3'], 'E');
    const ladder = relaxFamily(m9);
    expect(ladder.map((s) => s.relaxed.at(-1))).toEqual(['any bass note', 'no 5th', 'no extensions', 'any note count']);
    expect([...ladder[2].family.required]).toEqual([0, 3, 10]);
    expect([...ladder[2].family.optional]).toEqual([2, 7]);
    expect(ladder[3].family.minNotes).toBe(3);
  });

  it('leaves sus4 extensions alone (no third, no seventh)', () => {
    const custom: VoicingFamily = { ...fam('sus4'), id: 'custom_sus4', bass: [0], preferredBass: undefined };
    expect(relaxFamily(custom).map((s) => s.relaxed.at(-1))).toEqual(['any bass note']);
    expect([...relaxFamily(custom)[0].family.required]).toEqual([0, 5, 7]);
  });

  it('walks the full ladder for phrygian and stays cumulative', () => {
    const ladder = relaxFamily(fam('phrygian'));
    expect(ladder.map((s) => s.relaxed)).toEqual([
      ['any bass note'],
      ['any bass note', 'no 5th'],
      ['any bass note', 'no 5th', 'any note count']
    ]);
    const last = ladder[2].family;
    expect(last.bass).toBe('any');
    expect([...last.required]).toEqual([0, 1, 4]);
    expect([...last.optional]).toEqual([7, 10]);
    expect(last.minNotes).toBe(3);
    expect(last.maxNotes).toBe(6);
  });

  it('keeps the drone rule, group and forbidden list, and gives each step a distinct id', () => {
    for (const id of ['drone_power5', 'drone_phrygian']) {
      const base = fam(id);
      const ladder = relaxFamily(base);
      expect(ladder.length, id).toBeGreaterThan(0);
      for (const step of ladder) {
        expect(step.family.drone).toBe(true);
        expect(step.family.group).toBe('drones');
        expect(step.family.forbidden).toEqual(base.forbidden);
        expect(step.family.id.startsWith(id)).toBe(true);
      }
      const ids = ladder.map((s) => s.family.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(id);
    }
  });

  it('returns nothing for a family that is already fully relaxed', () => {
    for (const id of ['power5', 'phrygian']) {
      const loose = relaxFamily(fam(id)).at(-1)!.family;
      expect(relaxFamily(loose), id).toEqual([]);
    }
  });

  it('relaxed families accept shapes the exact recipe rejects', () => {
    const inverted: Shape = [x, x, 2, 3, 1, x]; // E A# C: C7 shell with the third in the bass
    expect(matchFamily(fam('7'), C, inverted, E_STANDARD).ok).toBe(false);
    expect(matchFamily(relaxFamily(fam('7'))[0].family, C, inverted, E_STANDARD).ok).toBe(true);
    const noFifth: Shape = [0, 8, 6, x, x, x]; // E F G#
    expect(matchFamily(fam('phrygian'), E, noFifth, E_STANDARD).ok).toBe(false);
    expect(matchFamily(relaxFamily(fam('phrygian'))[2].family, E, noFifth, E_STANDARD).ok).toBe(true);
  });

  it('does not mutate the input family', () => {
    const before = JSON.stringify(fam('phrygian'));
    relaxFamily(fam('phrygian'));
    expect(JSON.stringify(fam('phrygian'))).toBe(before);
  });
});
