import { describe, it, expect, afterAll } from 'vitest';
import { generateVoicings } from './generateVoicings';
import { findBestFingering } from './fingering';
import { DEFAULT_HAND_PROFILE } from './handProfile';
import { intervalFrom, pitchClass, pitchClassName } from './pitch';
import { fromRiffForgeTab, shapeToMidi, toRiffForgeTab } from './shape';
import { DROP_D, E_STANDARD } from './tuning';
import { DRONE_FAMILIES, VOICING_FAMILIES, allowedIntervals, matchFamily } from './voicingSpec';
import type { GenerateResult, Tuning, VoicingFamily } from './types';

const P = DEFAULT_HAND_PROFILE;
const TUNINGS: readonly Tuning[] = [E_STANDARD, DROP_D];
const ROOTS = Array.from({ length: 12 }, (_, i) => i);
const LIMIT = 12;
const EPS = 1e-9;
const COVERAGE_TARGET = 0.95;
const FILE_BUDGET_MS = 10_000;
const MEDIAN_BUDGET_MS = 30;

const fileStart = performance.now();
const summary: Record<string, unknown> = {};

const label = (tuning: Tuning, family: VoicingFamily, root: number): string =>
  `${tuning.id} ${family.id} ${pitchClassName(root)}`;

/** (a) exact pitch classes, (b) barre-free fingering with distinct fingers, (c) reach and pair limits, (d) audio == tab. */
const checkVoicings = (result: GenerateResult, family: VoicingFamily, root: number, tuning: Tuning): void => {
  for (const v of result.voicings) {
    const where = `${label(tuning, family, root)} ${toRiffForgeTab(v.shape)}`;
    const match = matchFamily(family, root, v.shape, tuning);
    expect(match, where).toEqual({ ok: true });

    const fingering = findBestFingering(v.shape, P);
    expect(fingering.ok, where).toBe(true);
    if (fingering.ok === false) continue;
    expect(fingering.fingering.barres, where).toEqual([]);
    const used = fingering.fingering.fingers.filter((f) => f !== null);
    expect(new Set(used).size, where).toBe(used.length);
    expect(v.fingering).toEqual(fingering.fingering);

    const { metrics } = fingering.fingering;
    expect(metrics.reachRatio, where).toBeLessThanOrEqual(1 + EPS);
    expect(metrics.spanMm, where).toBeLessThanOrEqual(metrics.allowedSpanMm + EPS);
    for (const pair of metrics.pairs) expect(pair.ratio, where).toBeLessThanOrEqual(1 + EPS);

    const viaTab = fromRiffForgeTab(toRiffForgeTab(v.shape));
    expect(viaTab, where).not.toBeNull();
    if (viaTab) expect(v.midi, where).toEqual(shapeToMidi(viaTab, tuning));
  }
};

/** An open string can carry the drone: root or 5th, allowed by the recipe, and not a forbidden bass on string 0. */
const droneable = (family: VoicingFamily, root: number, tuning: Tuning): boolean => {
  const allowed = new Set(allowedIntervals(family));
  return tuning.openMidi.some((midi, s) => {
    const interval = intervalFrom(root, pitchClass(midi));
    if ((interval !== 0 && interval !== 7) || !allowed.has(interval)) return false;
    return s !== 0 || family.bass === 'any' || family.bass.includes(interval);
  });
};

describe('generateVoicings property: base families x 12 roots x {E standard, Drop D}', () => {
  it('returns only exact, barre-free, reachable voicings whose audio equals the tab, for >= 95 percent of combos', () => {
    const empties: string[] = [];
    let combos = 0;
    let covered = 0;
    let voicings = 0;
    for (const tuning of TUNINGS) {
      for (const family of VOICING_FAMILIES) {
        for (const root of ROOTS) {
          const result = generateVoicings({ root, family, tuning, profile: P, limit: LIMIT });
          combos++;
          expect(result.voicings.length).toBeLessThanOrEqual(LIMIT);
          checkVoicings(result, family, root, tuning);
          voicings += result.voicings.length;
          if (result.voicings.length > 0) {
            covered++;
            expect(result.empty).toBeUndefined();
          } else {
            expect(result.empty?.constraint, label(tuning, family, root)).toBeDefined();
            expect(result.empty?.message.length).toBeGreaterThan(0);
            empties.push(`${label(tuning, family, root)}: ${result.empty?.constraint} (${result.empty?.message})`);
          }
        }
      }
    }
    const coverage = covered / combos;
    summary.base = { combos, covered, coverage: Number(coverage.toFixed(4)), voicings, empties };
    expect(combos).toBe(12 * VOICING_FAMILIES.length * 2);
    expect(coverage).toBeGreaterThanOrEqual(COVERAGE_TARGET);
  }, 20_000);
});

describe('generateVoicings property: drone families', () => {
  it('returns drones exactly where an open string can ring the root or 5th, else names the constraint', () => {
    let combos = 0;
    let covered = 0;
    let expectedCovered = 0;
    const mismatches: string[] = [];
    const constraints: Record<string, number> = {};
    for (const tuning of TUNINGS) {
      for (const family of DRONE_FAMILIES) {
        for (const root of ROOTS) {
          const result = generateVoicings({ root, family, tuning, profile: P, limit: LIMIT });
          combos++;
          checkVoicings(result, family, root, tuning);
          for (const v of result.voicings) {
            expect(v.tags).toContain('drone');
            expect(v.shape).toContain(0);
          }
          const expected = droneable(family, root, tuning);
          if (expected) expectedCovered++;
          if (result.voicings.length > 0) covered++;
          else {
            const constraint = result.empty?.constraint ?? 'MISSING';
            constraints[constraint] = (constraints[constraint] ?? 0) + 1;
            if (!expected) expect(constraint, label(tuning, family, root)).toBe('NO_DRONE_STRING');
          }
          if (expected !== result.voicings.length > 0) mismatches.push(`${label(tuning, family, root)}: ${result.empty?.constraint}`);
        }
      }
    }
    summary.drones = { combos, covered, expectedCovered, coverage: Number((covered / combos).toFixed(4)), emptyConstraints: constraints, mismatches };
    expect(mismatches).toEqual([]);
  }, 20_000);
});

describe('generateVoicings performance', () => {
  it('generates one root x family x tuning in under 30 ms (median)', () => {
    for (let i = 0; i < 40; i++) {
      generateVoicings({ root: i % 12, family: VOICING_FAMILIES[i % VOICING_FAMILIES.length], tuning: E_STANDARD, profile: P });
    }
    const times: number[] = [];
    for (const tuning of TUNINGS) {
      for (const family of VOICING_FAMILIES) {
        for (const root of ROOTS) {
          const t0 = performance.now();
          generateVoicings({ root, family, tuning, profile: P, limit: LIMIT });
          times.push(performance.now() - t0);
        }
      }
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    summary.timingMs = {
      median: Number(median.toFixed(3)),
      p90: Number(times[Math.floor(times.length * 0.9)].toFixed(3)),
      max: Number(times[times.length - 1].toFixed(3))
    };
    expect(median).toBeLessThan(MEDIAN_BUDGET_MS);
  }, 20_000);

  it('finishes the whole property file in under 10 s', () => {
    const elapsed = performance.now() - fileStart;
    summary.fileMs = Math.round(elapsed);
    expect(elapsed).toBeLessThan(FILE_BUDGET_MS);
  });
});

afterAll(() => {
  console.info(`generateVoicings property summary ${JSON.stringify(summary, null, 2)}`);
});
