import { describe, it, expect } from 'vitest';
import {
  TRANSITION_WEIGHTS,
  transitionCost,
  minimaxViterbi,
  optimizeSequence,
  describeTransition
} from './transition';
import { DEFAULT_SCALE_LENGTH_MM, fingertipMm } from './geometry';
import { fromRiffForgeTab } from './shape';
import { createRng } from './random';
import { enumerateFingerings, findBestFingering } from './fingering';
import { DEFAULT_HAND_PROFILE } from './handProfile';
import type {
  Barre,
  CostBreakdown,
  FingeredShape,
  FingerNumber,
  FingeringMetrics,
  SequenceTransition,
  TransitionBreakdown
} from './types';

const L = DEFAULT_SCALE_LENGTH_MM;
const W = TRANSITION_WEIGHTS;
const tip = (fret: number) => fingertipMm(fret, L);

const ZERO_METRICS: FingeringMetrics = {
  frettedCount: 0,
  fingerCount: 0,
  spanMm: 0,
  allowedSpanMm: 0,
  reachRatio: 0,
  pairs: [],
  maxPairRatio: 0,
  maxPairStretch: 0,
  usesPinky: false,
  usesThumb: false,
  contortions: 0,
  interiorMutes: 0,
  lowestFret: null,
  highestFret: null
};

const ZERO_BREAKDOWN: CostBreakdown = { total: 0, physical: 0, rightHand: 0, musical: 0, terms: [] };

/** Hand-built fingered shape, independent of fingering.ts: fingered('x 3 5 5 x x', 'x 1 3 4 x x'). */
const fingered = (tab: string, fingerTab: string, barres: Barre[] = []): FingeredShape => {
  const shape = fromRiffForgeTab(tab);
  if (shape === null) throw new Error(`bad tab ${tab}`);
  const fingers = fingerTab
    .trim()
    .split(/\s+/)
    .map((t) => (t === 'x' ? null : (Number(t) as FingerNumber)));
  if (fingers.length !== shape.length) throw new Error(`finger tab ${fingerTab} does not match ${tab}`);
  return { shape, fingering: { fingers, barres, metrics: { ...ZERO_METRICS }, costBreakdown: ZERO_BREAKDOWN } };
};

const cost = (a: FingeredShape, b: FingeredShape, timeSec = 1) => transitionCost(a, b, { scaleLengthMm: L, timeSec });

const EPS = 1e-9;

type EdgeFn = (layer: number, from: number, to: number) => number;
type NodeFn = (layer: number, index: number) => number;

/** Reference: enumerate every path in lexicographic order, keep the first one that is best by (max, sum). */
const bruteForceMinimax = (sizes: readonly number[], edge: EdgeFn, cyclic: boolean, nodeCost?: NodeFn) => {
  const n = sizes.length;
  let best: { path: number[]; maxCost: number; sumCost: number } | null = null;
  const visit = (path: number[]) => {
    if (path.length < n) {
      for (let k = 0; k < sizes[path.length]; k++) visit([...path, k]);
      return;
    }
    const edges: number[] = [];
    for (let i = 0; i + 1 < n; i++) edges.push(edge(i, path[i], path[i + 1]));
    if (cyclic) edges.push(edge(n - 1, path[n - 1], path[0]));
    const maxCost = edges.length === 0 ? 0 : Math.max(...edges);
    let sumCost = edges.reduce((s, c) => s + c, 0);
    if (nodeCost) path.forEach((k, i) => (sumCost += nodeCost(i, k)));
    if (
      best === null ||
      maxCost < best.maxCost - EPS ||
      (Math.abs(maxCost - best.maxCost) <= EPS && sumCost < best.sumCost - EPS)
    ) {
      best = { path, maxCost, sumCost };
    }
  };
  visit([]);
  return best!;
};

/** Reference: plain min-sum path (what an ordinary Viterbi would pick), lexicographically first on ties. */
const bruteForceMinSum = (sizes: readonly number[], edge: EdgeFn) => {
  let best: { path: number[]; sumCost: number } | null = null;
  const visit = (path: number[]) => {
    if (path.length < sizes.length) {
      for (let k = 0; k < sizes[path.length]; k++) visit([...path, k]);
      return;
    }
    let sumCost = 0;
    for (let i = 0; i + 1 < path.length; i++) sumCost += edge(i, path[i], path[i + 1]);
    if (best === null || sumCost < best.sumCost - EPS) best = { path, sumCost };
  };
  visit([]);
  return best!;
};

/** m[layer][from][to] = edge cost from layer `layer` to the next layer (the last one closes the cycle). */
const fromMatrices =
  (m: number[][][]): EdgeFn =>
  (layer, from, to) =>
    m[layer][from][to];

// ---------------------------------------------------------------------------
// transitionCost
// ---------------------------------------------------------------------------

describe('TRANSITION_WEIGHTS', () => {
  it('keeps every weight non-negative and the anchor discount below 1', () => {
    for (const value of Object.values(W)) expect(value).toBeGreaterThanOrEqual(0);
    expect(W.maxAnchorDiscount).toBeLessThan(1);
    expect(W.slideTravelFactor).toBeLessThanOrEqual(1);
    expect(W.minTimeSec).toBeCloseTo(0.05, 12);
  });
});

describe('transitionCost', () => {
  it('costs nothing between identical shapes and counts every held finger as an anchor', () => {
    const eMajor = fingered('0 2 2 1 0 0', 'x 2 3 1 x x');
    const t = cost(eMajor, eMajor);
    expect(t).toEqual({
      fingerTravelMm: 0,
      stringChanges: 0,
      lifted: 0,
      placed: 0,
      anchors: 3,
      slides: 0,
      positionShiftMm: 0,
      raw: 0,
      timeSec: 1,
      cost: 0
    });
  });

  it('counts a barre finger once (at its lowest string) when the shape is held', () => {
    const fBarre = fingered('1 3 3 2 1 1', '1 3 4 2 1 1', [{ finger: 1, fret: 1, fromString: 0, toString: 5 }]);
    const t = cost(fBarre, fBarre);
    expect(t.anchors).toBe(4);
    expect(t.raw).toBe(0);
  });

  it('places a barre finger at its lowest string', () => {
    const barre = fingered('x x 3 3 3 x', 'x x 1 1 1 x', [{ finger: 1, fret: 3, fromString: 2, toString: 4 }]);
    const single = fingered('x x 3 x x x', 'x x 1 x x x');
    const highSingle = fingered('x x x x 3 x', 'x x x x 1 x');
    expect(cost(barre, single).anchors).toBe(1);
    const t = cost(barre, highSingle);
    expect(t.anchors).toBe(0);
    expect(t.stringChanges).toBe(2);
    expect(t.fingerTravelMm).toBe(0);
  });

  it('counts lifted and placed fingers', () => {
    const three = fingered('x 3 5 5 x x', 'x 1 3 4 x x');
    const two = fingered('x 3 5 x x x', 'x 1 3 x x x');
    const down = cost(three, two);
    expect(down).toMatchObject({ lifted: 1, placed: 0, anchors: 2, slides: 0, stringChanges: 0 });
    const up = cost(two, three);
    expect(up).toMatchObject({ lifted: 0, placed: 1, anchors: 2 });
    // Placing a finger is slower than lifting one.
    expect(up.raw).toBeGreaterThan(down.raw);
  });

  it('counts string changes for fingers kept across the change', () => {
    // Open E major -> open A minor: the same hand frame moved one string over.
    const eMajor = fingered('0 2 2 1 0 0', 'x 2 3 1 x x');
    const aMinor = fingered('x 0 2 2 1 0', 'x x 2 3 1 x');
    const t = cost(eMajor, aMinor);
    expect(t).toMatchObject({ stringChanges: 3, fingerTravelMm: 0, anchors: 0, slides: 0, lifted: 0, placed: 0, positionShiftMm: 0 });
    expect(t.raw).toBeCloseTo(3 * W.stringChange, 12);
  });

  it('measures slides, finger travel and the hand position shift in mm', () => {
    const at3 = fingered('x 3 5 5 x x', 'x 1 3 4 x x');
    const at5 = fingered('x 5 7 7 x x', 'x 1 3 4 x x');
    const t = cost(at3, at5);
    const travel = tip(5) - tip(3) + 2 * (tip(7) - tip(5));
    const shift = tip(5) - tip(3);
    expect(t.slides).toBe(3);
    expect(t.anchors).toBe(0);
    expect(t.stringChanges).toBe(0);
    expect(t.fingerTravelMm).toBeCloseTo(travel, 9);
    expect(t.positionShiftMm).toBeCloseTo(shift, 9);
    expect(t.raw).toBeCloseTo(W.fingerTravelPerMm * W.slideTravelFactor * travel + W.positionShiftPerMm * shift, 12);
    // Moving down is the same distance.
    expect(cost(at5, at3).raw).toBeCloseTo(t.raw, 12);
  });

  it('makes a slide cheaper than lifting and placing fingers for the same notes', () => {
    const from = fingered('x 3 5 x x x', 'x 1 3 x x x');
    const slide = cost(from, fingered('x 5 7 x x x', 'x 1 3 x x x'));
    const lift = cost(from, fingered('x 5 7 x x x', 'x 2 4 x x x'));
    expect(slide).toMatchObject({ slides: 2, lifted: 0, placed: 0 });
    expect(lift).toMatchObject({ slides: 0, lifted: 2, placed: 2 });
    expect(slide.positionShiftMm).toBeCloseTo(lift.positionShiftMm, 12);
    expect(slide.raw).toBeLessThan(lift.raw);
  });

  it('discounts the cost of a change that keeps an anchor finger down', () => {
    const from = fingered('x 3 5 x x x', 'x 1 3 x x x');
    const to = fingered('x 3 x 6 x x', 'x 1 x 4 x x');
    const t = cost(from, to);
    expect(t).toMatchObject({ anchors: 1, lifted: 1, placed: 1, positionShiftMm: 0 });
    expect(t.raw).toBeCloseTo((W.lifted + W.placed) * (1 - W.anchorDiscount), 12);
    // Same lift and place without the anchor costs the full amount.
    const noAnchor = cost(fingered('x x 5 x x x', 'x x 3 x x x'), fingered('x x x 6 x x', 'x x x 4 x x'));
    expect(noAnchor.raw).toBeGreaterThan(t.raw);
  });

  it('caps the anchor discount', () => {
    const from = fingered('3 5 5 4 3 3', '1 3 4 2 1 1', [{ finger: 1, fret: 3, fromString: 0, toString: 5 }]);
    const to = fingered('3 5 5 4 3 x', '1 3 4 2 1 x', [{ finger: 1, fret: 3, fromString: 0, toString: 4 }]);
    const moved = fingered('3 5 5 x x x', '1 3 4 x x x');
    // Three anchors (fingers 1, 3, 4) and one finger lifted (finger 2); three anchors exceed the cap.
    expect(3 * W.anchorDiscount).toBeGreaterThan(W.maxAnchorDiscount);
    const t = cost(from, moved);
    expect(t).toMatchObject({ anchors: 3, lifted: 1 });
    expect(t.raw).toBeCloseTo(W.lifted * (1 - W.maxAnchorDiscount), 12);
    expect(cost(from, to).raw).toBe(0);
  });

  it('ignores open strings and reports no position shift when a shape has no fretted note', () => {
    const power = fingered('0 2 2 x x x', 'x 1 2 x x x');
    const open = fingered('0 x x x x x', 'x x x x x x');
    const t = cost(power, open);
    expect(t).toMatchObject({ lifted: 2, placed: 0, positionShiftMm: 0, fingerTravelMm: 0 });
    expect(t.raw).toBeCloseTo(2 * W.lifted, 12);
    expect(cost(open, open).raw).toBe(0);
  });

  it('does not track the thumb as a finger', () => {
    const withThumb = fingered('3 x 5 5 4 x', '0 x 3 4 2 x');
    const without = fingered('x x 5 5 4 x', 'x x 3 4 2 x');
    const t = cost(withThumb, without);
    expect(t).toMatchObject({ lifted: 0, placed: 0, anchors: 3 });
  });

  it('keeps raw non-negative', () => {
    const shapes = [
      fingered('0 2 2 1 0 0', 'x 2 3 1 x x'),
      fingered('x 3 5 5 x x', 'x 1 3 4 x x'),
      fingered('x 0 2 2 1 0', 'x x 2 3 1 x'),
      fingered('1 3 3 2 1 1', '1 3 4 2 1 1', [{ finger: 1, fret: 1, fromString: 0, toString: 5 }]),
      fingered('0 0 0 x x x', 'x x x x x x')
    ];
    for (const a of shapes) for (const b of shapes) expect(cost(a, b).raw).toBeGreaterThanOrEqual(0);
  });

  it('scales by the available time: half the time doubles the cost', () => {
    const a = fingered('x 3 5 5 x x', 'x 1 3 4 x x');
    const b = fingered('x 5 7 7 x x', 'x 1 3 4 x x');
    const slow = cost(a, b, 1);
    const fast = cost(a, b, 0.5);
    expect(fast.raw).toBeCloseTo(slow.raw, 12);
    expect(fast.cost).toBeCloseTo(2 * slow.cost, 12);
    expect(slow.cost).toBeCloseTo(slow.raw, 12);
    expect(fast.timeSec).toBe(0.5);
  });

  it('floors the available time at 0.05 s', () => {
    const a = fingered('x 3 5 5 x x', 'x 1 3 4 x x');
    const b = fingered('x 5 7 7 x x', 'x 1 3 4 x x');
    for (const timeSec of [0, 0.01, 0.05]) {
      const t = cost(a, b, timeSec);
      expect(t.timeSec).toBeCloseTo(0.05, 12);
      expect(t.cost).toBeCloseTo(t.raw / 0.05, 9);
    }
  });

  it('uses the scale length for distances', () => {
    const a = fingered('x 3 x x x x', 'x 1 x x x x');
    const b = fingered('x 8 x x x x', 'x 1 x x x x');
    const short = transitionCost(a, b, { scaleLengthMm: 24.75 * 25.4, timeSec: 1 });
    const long = transitionCost(a, b, { scaleLengthMm: 27 * 25.4, timeSec: 1 });
    expect(long.positionShiftMm).toBeGreaterThan(short.positionShiftMm);
  });

  it('rejects invalid timing and scale length', () => {
    const a = fingered('x 3 x x x x', 'x 1 x x x x');
    expect(() => transitionCost(a, a, { scaleLengthMm: L, timeSec: Number.NaN })).toThrow(/timeSec/);
    expect(() => transitionCost(a, a, { scaleLengthMm: 0, timeSec: 1 })).toThrow(/scaleLengthMm/);
  });

  it('is deterministic', () => {
    const a = fingered('0 2 2 1 0 0', 'x 2 3 1 x x');
    const b = fingered('x 5 7 7 x x', 'x 1 3 4 x x');
    expect(cost(a, b, 0.4)).toEqual(cost(a, b, 0.4));
  });
});

// ---------------------------------------------------------------------------
// minimaxViterbi
// ---------------------------------------------------------------------------

describe('minimaxViterbi', () => {
  it('minimizes the hardest edge where the sum-optimal path differs (counterexample)', () => {
    // Layer 1 has two candidates: an easy-then-brutal route (1, 10) and an even route (6, 6).
    const sizes = [1, 2, 1];
    const edge = fromMatrices([[[1, 6]], [[10], [6]]]);
    const sumOptimal = bruteForceMinSum(sizes, edge);
    expect(sumOptimal).toEqual({ path: [0, 0, 0], sumCost: 11 });
    const result = minimaxViterbi(sizes, edge);
    expect(result).toEqual({ path: [0, 1, 0], maxCost: 6, sumCost: 12 });
  });

  it('stays exact where keeping one (max, sum) prefix per node would fail', () => {
    // At the third layer the prefix via [0, 0] has max 4 (sum 8), the one via [1, 1] max 5 (sum 6).
    // The last edge (6) dominates both maxima, so the lower sum must win: [1, 1, 0, 0].
    const sizes = [2, 2, 1, 1];
    const edge = fromMatrices([
      [
        [4, 100],
        [100, 1]
      ],
      [[4], [5]],
      [[6]]
    ]);
    const result = minimaxViterbi(sizes, edge);
    expect(result).toEqual({ path: [1, 1, 0, 0], maxCost: 6, sumCost: 12 });
  });

  it('breaks equal maxima by the sum, even toward a higher index', () => {
    const sizes = [1, 3, 1];
    const edge = fromMatrices([[[5, 2, 5]], [[4], [5], [1]]]);
    expect(minimaxViterbi(sizes, edge)).toEqual({ path: [0, 2, 0], maxCost: 5, sumCost: 6 });
  });

  it('breaks equal maxima and sums by the lower index, with a 1e-9 tolerance', () => {
    const sizes = [1, 3, 1];
    expect(minimaxViterbi(sizes, fromMatrices([[[2, 2, 2]], [[2], [2], [2]]])).path).toEqual([0, 0, 0]);
    const nearTie = fromMatrices([[[2, 2, 2]], [[2 + 5e-10], [2], [2]]]);
    expect(minimaxViterbi(sizes, nearTie).path).toEqual([0, 0, 0]);
    const realGap = fromMatrices([[[2, 2, 2]], [[2 + 1e-6], [2], [2]]]);
    expect(minimaxViterbi(sizes, realGap).path).toEqual([0, 1, 0]);
  });

  it('lets node costs join only the sum tie-break', () => {
    const sizes = [1, 2, 1];
    const nodeCost: NodeFn = (layer, index) => (layer === 1 && index === 0 ? 100 : 0);
    const maxWins = minimaxViterbi(sizes, fromMatrices([[[3, 4]], [[3], [1]]]), { nodeCost });
    expect(maxWins).toEqual({ path: [0, 0, 0], maxCost: 3, sumCost: 106 });
    const tie = minimaxViterbi(sizes, fromMatrices([[[3, 3]], [[3], [3]]]), {
      nodeCost: (layer, index) => (layer === 1 && index === 0 ? 1 : 0)
    });
    expect(tie).toEqual({ path: [0, 1, 0], maxCost: 3, sumCost: 6 });
  });

  it('includes the closing edge in cyclic mode, which can change the path', () => {
    const sizes = [2, 1];
    // a0 -> b costs 1, a1 -> b costs 2; closing b -> a0 costs 10, b -> a1 costs 2.
    const edge = fromMatrices([[[1], [2]], [[10, 2]]]);
    expect(minimaxViterbi(sizes, edge)).toEqual({ path: [0, 0], maxCost: 1, sumCost: 1 });
    expect(minimaxViterbi(sizes, edge, { cyclic: false })).toEqual({ path: [0, 0], maxCost: 1, sumCost: 1 });
    expect(minimaxViterbi(sizes, edge, { cyclic: true })).toEqual({ path: [1, 0], maxCost: 2, sumCost: 4 });
  });

  it('uses the self edge for a single cyclic layer', () => {
    const edge = fromMatrices([
      [
        [3, 0, 0],
        [0, 1, 0],
        [0, 0, 2]
      ]
    ]);
    expect(minimaxViterbi([3], edge, { cyclic: true })).toEqual({ path: [1], maxCost: 1, sumCost: 1 });
  });

  it('handles a single acyclic layer and an empty graph', () => {
    const never: EdgeFn = () => {
      throw new Error('no edges expected');
    };
    expect(minimaxViterbi([3], never)).toEqual({ path: [0], maxCost: 0, sumCost: 0 });
    expect(minimaxViterbi([3], never, { nodeCost: (_, i) => [2, 0, 1][i] })).toEqual({ path: [1], maxCost: 0, sumCost: 0 });
    expect(minimaxViterbi([], never)).toEqual({ path: [], maxCost: 0, sumCost: 0 });
    expect(minimaxViterbi([], never, { cyclic: true })).toEqual({ path: [], maxCost: 0, sumCost: 0 });
  });

  it('evaluates every edge exactly once', () => {
    const sizes = [3, 2, 4];
    for (const cyclic of [false, true]) {
      const seen = new Map<string, number>();
      const edge: EdgeFn = (layer, from, to) => {
        const key = `${layer}:${from}:${to}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        return (layer * 7 + from * 3 + to * 5) % 4;
      };
      minimaxViterbi(sizes, edge, { cyclic });
      const expected = 3 * 2 + 2 * 4 + (cyclic ? 4 * 3 : 0);
      expect(seen.size).toBe(expected);
      expect([...seen.values()].every((count) => count === 1)).toBe(true);
    }
  });

  it('rejects empty layers and invalid costs', () => {
    expect(() => minimaxViterbi([2, 0, 1], () => 0)).toThrow(/layer 1/);
    expect(() => minimaxViterbi([2, 2], () => Number.NaN)).toThrow(/NaN/);
    expect(() => minimaxViterbi([2, 2], () => -Infinity)).toThrow(/-Infinity/);
    expect(() => minimaxViterbi([2], () => 0, { nodeCost: () => Number.NaN })).toThrow(/finite/);
    expect(() => minimaxViterbi([2], () => 0, { nodeCost: () => Infinity })).toThrow(/finite/);
  });

  it('treats +Infinity edges as forbidden unless every path needs one', () => {
    const avoidable = fromMatrices([[[Infinity, 3]], [[0], [3]]]);
    expect(minimaxViterbi([1, 2, 1], avoidable)).toEqual({ path: [0, 1, 0], maxCost: 3, sumCost: 6 });
    const unavoidable = fromMatrices([[[Infinity, Infinity]], [[1], [0]]]);
    expect(minimaxViterbi([1, 2, 1], unavoidable)).toEqual({ path: [0, 0, 0], maxCost: Infinity, sumCost: Infinity });
    expect(minimaxViterbi([2], () => Infinity, { cyclic: true })).toEqual({ path: [0], maxCost: Infinity, sumCost: Infinity });
  });

  it('matches brute force on seeded random graphs (acyclic and cyclic, with and without node costs)', () => {
    for (let trial = 0; trial < 400; trial++) {
      const rng = createRng(`minimax-${trial}`);
      const n = rng.int(1, 5);
      const sizes = Array.from({ length: n }, () => rng.int(1, 3));
      const cyclic = trial % 2 === 0;
      // Small integer costs force many exact ties, which exercises the tie-break rules.
      const matrices = sizes.map((size, i) =>
        Array.from({ length: size }, () => Array.from({ length: sizes[(i + 1) % n] }, () => rng.int(0, 4)))
      );
      const nodes = sizes.map((size) => Array.from({ length: size }, () => rng.int(0, 2)));
      const nodeCost: NodeFn | undefined = trial % 4 < 2 ? (layer, index) => nodes[layer][index] : undefined;
      const edge = fromMatrices(matrices);
      const expected = bruteForceMinimax(sizes, edge, cyclic, nodeCost);
      const actual = minimaxViterbi(sizes, edge, { cyclic, nodeCost });
      expect(actual, `trial ${trial}`).toEqual(expected);
    }
  });

  it('matches brute force on seeded random real-valued graphs', () => {
    for (let trial = 0; trial < 200; trial++) {
      const rng = createRng(`minimax-real-${trial}`);
      const n = rng.int(2, 5);
      const sizes = Array.from({ length: n }, () => rng.int(1, 4));
      const cyclic = trial % 2 === 1;
      const matrices = sizes.map((size, i) =>
        Array.from({ length: size }, () => Array.from({ length: sizes[(i + 1) % n] }, () => rng.next() * 10))
      );
      const edge = fromMatrices(matrices);
      const expected = bruteForceMinimax(sizes, edge, cyclic);
      const actual = minimaxViterbi(sizes, edge, { cyclic });
      expect(actual.path, `trial ${trial}`).toEqual(expected.path);
      expect(actual.maxCost).toBeCloseTo(expected.maxCost, 9);
      expect(actual.sumCost).toBeCloseTo(expected.sumCost, 9);
    }
  });

  it('is deterministic', () => {
    const edge = fromMatrices([
      [
        [1, 2],
        [2, 1]
      ],
      [
        [2, 1],
        [1, 2]
      ]
    ]);
    const first = minimaxViterbi([2, 2], edge, { cyclic: true });
    expect(minimaxViterbi([2, 2], edge, { cyclic: true })).toEqual(first);
    expect(first.path).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// optimizeSequence
// ---------------------------------------------------------------------------

const POWER = (fret: number) => fingered(`x ${fret} ${fret + 2} ${fret + 2} x x`, 'x 1 3 4 x x');

describe('optimizeSequence', () => {
  const pool = {
    eMajor: fingered('0 2 2 1 0 0', 'x 2 3 1 x x'),
    aMinor: fingered('x 0 2 2 1 0', 'x x 2 3 1 x'),
    power3: POWER(3),
    power5: POWER(5),
    power8: POWER(8),
    dyad7: fingered('x x 7 9 x x', 'x x 1 3 x x'),
    cluster: fingered('x 2 4 5 x x', 'x 1 3 4 x x'),
    em9: fingered('0 2 4 0 0 0', 'x 1 3 x x x')
  };

  it('matches a brute-force minimax over transitionCost (cyclic by default)', () => {
    const slots = [
      [pool.eMajor, pool.power5, pool.cluster],
      [pool.aMinor, pool.power8, pool.dyad7],
      [pool.em9, pool.power3, pool.power5]
    ];
    const timing = { bpm: 120, beatsPerSlot: [2, 1, 1] };
    for (const cyclic of [true, false]) {
      const edge: EdgeFn = (layer, from, to) =>
        transitionCost(slots[layer][from], slots[(layer + 1) % slots.length][to], {
          scaleLengthMm: L,
          timeSec: (timing.beatsPerSlot[layer] * 60) / timing.bpm
        }).cost;
      const expected = bruteForceMinimax(
        slots.map((s) => s.length),
        edge,
        cyclic
      );
      const result = cyclic ? optimizeSequence(slots, timing) : optimizeSequence(slots, { ...timing, cyclic: false });
      expect(result.path).toEqual(expected.path);
      expect(result.maxCost).toBeCloseTo(expected.maxCost, 12);
      expect(result.sumCost).toBeCloseTo(expected.sumCost, 12);
    }
  });

  it('picks different paths with and without the loop-back change', () => {
    // Acyclic: 5 -> 7 is the shorter first move. Looping, 12 -> 5 is the worst jump, so start at 10.
    const slots = [[POWER(5), POWER(10)], [POWER(7)], [POWER(12)]];
    const timing = { bpm: 100, beatsPerSlot: [4, 4, 4] };
    const open = optimizeSequence(slots, { ...timing, cyclic: false });
    const loop = optimizeSequence(slots, timing);
    expect(open.path).toEqual([0, 0, 0]);
    expect(loop.path).toEqual([1, 0, 0]);
    expect(open.transitions).toHaveLength(2);
    expect(loop.transitions).toHaveLength(3);
    expect(loop.transitions[2]).toMatchObject({ from: 2, to: 0 });
  });

  it('returns transitions in path order, timed by the slot being left, plus the hardest one', () => {
    const slots = [[pool.power3], [pool.power8], [pool.eMajor]];
    const result = optimizeSequence(slots, { bpm: 120, beatsPerSlot: [2, 1, 4] });
    expect(result.path).toEqual([0, 0, 0]);
    expect(result.transitions.map((t) => [t.from, t.to])).toEqual([
      [0, 1],
      [1, 2],
      [2, 0]
    ]);
    expect(result.transitions.map((t) => t.breakdown.timeSec)).toEqual([1, 0.5, 2]);
    for (const t of result.transitions) expect(t.cost).toBe(t.breakdown.cost);
    const costs = result.transitions.map((t) => t.cost);
    expect(result.maxCost).toBe(Math.max(...costs));
    expect(result.sumCost).toBeCloseTo(costs.reduce((s, c) => s + c, 0), 12);
    expect(result.hardest).toBe(result.transitions[costs.indexOf(Math.max(...costs))]);
    expect(result.hardest).toMatchObject({ from: 1, to: 2 });
  });

  it('with one cyclic slot picks the cheapest self-transition (the first candidate)', () => {
    const result = optimizeSequence([[pool.power5, pool.eMajor]], { bpm: 120, beatsPerSlot: [4] });
    expect(result.path).toEqual([0]);
    expect(result.maxCost).toBe(0);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({ from: 0, to: 0, cost: 0 });
  });

  it('with one acyclic slot returns the first candidate and no transitions', () => {
    const result = optimizeSequence([[pool.power5, pool.eMajor]], { bpm: 120, beatsPerSlot: [4], cyclic: false });
    expect(result).toEqual({
      path: [0],
      maxCost: 0,
      sumCost: 0,
      transitions: [],
      hardest: null,
      fingerings: [pool.power5.fingering]
    });
  });

  it('returns an empty result for no slots', () => {
    expect(optimizeSequence([], { bpm: 120, beatsPerSlot: [] })).toEqual({
      path: [],
      maxCost: 0,
      sumCost: 0,
      transitions: [],
      hardest: null,
      fingerings: []
    });
  });

  it('throws a clear error for a slot without candidates and for bad timing', () => {
    expect(() => optimizeSequence([[pool.power3], []], { bpm: 120, beatsPerSlot: [1, 1] })).toThrow(/slot 2/);
    expect(() => optimizeSequence([[pool.power3]], { bpm: 0, beatsPerSlot: [1] })).toThrow(/bpm/);
    expect(() => optimizeSequence([[pool.power3], [pool.power5]], { bpm: 120, beatsPerSlot: [1] })).toThrow(/beatsPerSlot/);
    expect(() => optimizeSequence([[pool.power3]], { bpm: 120, beatsPerSlot: [-1] })).toThrow(/beatsPerSlot/);
  });

  it('honours the scale length option', () => {
    const slots = [[pool.power3], [pool.power8]];
    const timing = { bpm: 120, beatsPerSlot: [1, 1], cyclic: false };
    const short = optimizeSequence(slots, timing, { scaleLengthMm: 24.75 * 25.4 });
    const long = optimizeSequence(slots, timing, { scaleLengthMm: 27 * 25.4 });
    expect(long.maxCost).toBeGreaterThan(short.maxCost);
  });

  it('is deterministic', () => {
    const slots = [
      [pool.eMajor, pool.power5, pool.cluster, pool.power3],
      [pool.aMinor, pool.power8, pool.dyad7],
      [pool.em9, pool.power3]
    ];
    const timing = { bpm: 140, beatsPerSlot: [1, 2, 1] };
    expect(optimizeSequence(slots, timing)).toEqual(optimizeSequence(slots, timing));
  });

  it('without a profile keeps every candidate fingering as given and reports it per slot', () => {
    const slots = [[pool.eMajor, pool.power5], [pool.aMinor, pool.dyad7]];
    const result = optimizeSequence(slots, { bpm: 120, beatsPerSlot: [1, 1] });
    result.path.forEach((k, i) => expect(result.fingerings[i]).toBe(slots[i][k].fingering));
  });
});

describe('optimizeSequence with a hand profile (fingerings chosen with the neighbours)', () => {
  const P = DEFAULT_HAND_PROFILE;
  /** What the generator attaches: the statically best fingering for the default profile. */
  const best = (tab: string): FingeredShape => {
    const shape = fromRiffForgeTab(tab);
    if (shape === null) throw new Error(`bad tab ${tab}`);
    const result = findBestFingering(shape, P);
    if (!result.ok) throw new Error(`no fingering for ${tab}`);
    return { shape, fingering: result.fingering };
  };
  const power = best('x 5 7 7 x x');
  const dyad = best('x x 7 7 x x');
  const dyadUp = best('x x 12 12 x x');

  it('starts from the fingerings the generator attaches (index+middle dyad, index/ring/pinky power chord)', () => {
    expect(power.fingering.fingers).toEqual([null, 1, 3, 4, null, null]);
    expect(dyad.fingering.fingers).toEqual([null, null, 1, 2, null, null]);
  });

  it('makes adding the root under a held dyad cheaper than sliding the dyad 5 frets', () => {
    const timing = { bpm: 60, beatsPerSlot: [1, 1], cyclic: false };
    const addRoot = optimizeSequence([[dyad], [power]], timing, { profile: P });
    const liftRoot = optimizeSequence([[power], [dyad]], timing, { profile: P });
    const jump = optimizeSequence([[dyad], [dyadUp]], timing, { profile: P });
    expect(addRoot.maxCost).toBeLessThan(jump.maxCost);
    expect(liftRoot.maxCost).toBeLessThan(jump.maxCost);
    // Two fingers stay down; only the index comes and goes (index-middle may span two frets by default).
    expect(addRoot.fingerings[0].fingers).toEqual([null, null, 2, 3, null, null]);
    expect(addRoot.fingerings[1].fingers).toEqual([null, 1, 2, 3, null, null]);
    expect(addRoot.transitions[0].breakdown).toMatchObject({ anchors: 2, placed: 1, lifted: 0, stringChanges: 0 });
    expect(liftRoot.fingerings[1].fingers).toEqual([null, null, 2, 3, null, null]);
    expect(liftRoot.transitions[0].breakdown).toMatchObject({ anchors: 2, placed: 0, lifted: 1, stringChanges: 0 });
    // The jump keeps the index+middle grip and slides it.
    expect(jump.fingerings.map((f) => f.fingers)).toEqual([dyad.fingering.fingers, dyadUp.fingering.fingers]);
  });

  it('reports the real move as the hardest change of a looping riff', () => {
    const result = optimizeSequence([[power], [dyad, best('x 12 12 x x x')]], { bpm: 120, beatsPerSlot: [1, 1] }, { profile: P });
    expect(result.path).toEqual([0, 0]);
    expect(result.fingerings.map((f) => f.fingers)).toEqual([
      [null, 1, 2, 3, null, null],
      [null, null, 2, 3, null, null]
    ]);
    const shift = tip(7) - tip(5);
    const addIndex = ((W.placed + W.positionShiftPerMm * shift) * (1 - 2 * W.anchorDiscount)) / 0.5;
    expect(result.maxCost).toBeCloseTo(addIndex, 9);
    expect(describeTransition(result.hardest!)).toBe(
      'Hardest change: slot 2 -> 1, hand shifts 54 mm, 1 finger placed in 0.5 s, 2 fingers stay down'
    );
  });

  it('keeps the attached fingering (same object) when no alternative makes the changes easier', () => {
    // Dyad slides: index+pinky (or middle+pinky) on both dyads moves exactly like index+ring, so nothing is gained.
    const slots = [[best('x x 7 9 x x')], [best('x x 9 11 x x')], [best('x x 5 7 x x')]];
    const timing = { bpm: 120, beatsPerSlot: [1, 1, 2] };
    const plain = optimizeSequence(slots, timing);
    const result = optimizeSequence(slots, timing, { profile: P });
    result.fingerings.forEach((f, i) => expect(f).toBe(slots[i][0].fingering));
    expect(result).toEqual(plain);
  });

  it('never does worse than the attached fingerings and stays consistent with what it reports', () => {
    const slots = [
      [best('0 2 2 1 0 0'), best('x 5 7 7 x x'), best('x x 7 7 x x')],
      [best('x 0 2 2 1 0'), best('x x 7 9 x x'), best('x 3 5 x x x')],
      [best('x x 5 x x x'), best('x 2 4 5 x x'), best('x x 12 12 x x')]
    ];
    for (const cyclic of [true, false]) {
      const timing = { bpm: 150, beatsPerSlot: [1, 2, 1], cyclic };
      const plain = optimizeSequence(slots, timing);
      const result = optimizeSequence(slots, timing, { profile: P });
      expect(result.maxCost).toBeLessThanOrEqual(plain.maxCost + EPS);
      result.path.forEach((k, i) => {
        const chosen = result.fingerings[i];
        const own = slots[i][k];
        const valid = enumerateFingerings(own.shape, P).some((f) => JSON.stringify(f.fingers) === JSON.stringify(chosen.fingers));
        expect(chosen === own.fingering || valid).toBe(true);
      });
      for (const t of result.transitions) {
        const a = { shape: slots[t.from][result.path[t.from]].shape, fingering: result.fingerings[t.from] };
        const b = { shape: slots[t.to][result.path[t.to]].shape, fingering: result.fingerings[t.to] };
        expect(t.breakdown).toEqual(transitionCost(a, b, { scaleLengthMm: P.scaleLengthMm, timeSec: (timing.beatsPerSlot[t.from] * 60) / 150 }));
      }
      const costs = result.transitions.map((t) => t.cost);
      expect(result.maxCost).toBe(Math.max(...costs));
      expect(result.sumCost).toBeCloseTo(costs.reduce((s, c) => s + c, 0), 12);
      expect(optimizeSequence(slots, timing, { profile: P })).toEqual(result);
    }
  });

  it('takes the scale length from the profile unless one is given', () => {
    const slots = [[dyad], [dyadUp]];
    const timing = { bpm: 120, beatsPerSlot: [1, 1], cyclic: false };
    const longNeck = { ...P, scaleLengthMm: 27 * 25.4 };
    const fromProfile = optimizeSequence(slots, timing, { profile: longNeck });
    expect(fromProfile.maxCost).toBeCloseTo(optimizeSequence(slots, timing, { scaleLengthMm: 27 * 25.4 }).maxCost, 12);
    expect(optimizeSequence(slots, timing, { profile: longNeck, scaleLengthMm: L }).maxCost).toBeCloseTo(
      optimizeSequence(slots, timing).maxCost,
      12
    );
  });
});

// ---------------------------------------------------------------------------
// describeTransition
// ---------------------------------------------------------------------------

const breakdown = (overrides: Partial<TransitionBreakdown>): TransitionBreakdown => ({
  fingerTravelMm: 0,
  stringChanges: 0,
  lifted: 0,
  placed: 0,
  anchors: 0,
  slides: 0,
  positionShiftMm: 0,
  raw: 0,
  timeSec: 0.5,
  cost: 0,
  ...overrides
});

const transition = (from: number, to: number, overrides: Partial<TransitionBreakdown>): SequenceTransition => ({
  from,
  to,
  cost: 0,
  breakdown: breakdown(overrides)
});

describe('describeTransition', () => {
  it('names the slots 1-based with the hand shift and the time', () => {
    expect(describeTransition(transition(1, 2, { positionShiftMm: 41.3 }))).toBe(
      'Hardest change: slot 2 -> 3, hand shifts 41 mm in 0.5 s'
    );
  });

  it('lists placed and lifted fingers, string changes, slides and held fingers', () => {
    const t = transition(0, 1, {
      positionShiftMm: 12.6,
      placed: 2,
      lifted: 1,
      stringChanges: 1,
      slides: 1,
      anchors: 2,
      timeSec: 0.428571
    });
    expect(describeTransition(t)).toBe(
      'Hardest change: slot 1 -> 2, hand shifts 13 mm, 2 fingers placed, 1 finger lifted, 1 string change, 1 slide in 0.43 s, 2 fingers stay down'
    );
  });

  it('says when nothing moves', () => {
    expect(describeTransition(transition(0, 0, { anchors: 1, timeSec: 2 }))).toBe(
      'Hardest change: slot 1 -> 1, no movement in 2 s, 1 finger stays down'
    );
    expect(describeTransition(transition(2, 0, { positionShiftMm: 0.2, timeSec: 1 }))).toBe(
      'Hardest change: slot 3 -> 1, no movement in 1 s'
    );
  });

  it('accepts a custom label', () => {
    expect(describeTransition(transition(0, 1, { placed: 1, timeSec: 1 }), 'Change')).toBe(
      'Change: slot 1 -> 2, 1 finger placed in 1 s'
    );
  });

  it('describes a real optimized sequence', () => {
    const result = optimizeSequence([[POWER(3)], [POWER(8)]], { bpm: 120, beatsPerSlot: [1, 1], cyclic: false });
    const shift = Math.round(tip(8) - tip(3));
    expect(describeTransition(result.hardest!)).toBe(`Hardest change: slot 1 -> 2, hand shifts ${shift} mm, 3 slides in 0.5 s`);
  });
});

describe('describeTransition without a change', () => {
  it('handles a single-chord sequence that has no hardest change', () => {
    expect(describeTransition(null)).toBe('Hardest change: none (one chord)');
  });
});
