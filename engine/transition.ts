// Chord-change cost between fingered shapes, and a minimax Viterbi that picks one voicing per slot so the
// hardest change of the riff is as easy as possible (idea after Hori and Sagayama, ISMIR 2016), with the
// total as tie-break. The change-cost model and its weights are heuristic, not research-backed.
import type {
  Fingering,
  FingeredShape,
  FingerNumber,
  HandProfile,
  SequenceResult,
  SequenceTiming,
  SequenceTransition,
  TransitionBreakdown
} from './types';
import { DEFAULT_SCALE_LENGTH_MM, fingertipMm } from './geometry';
import { enumerateFingerings } from './fingering';
import { lowestFret } from './shape';

export interface TransitionWeights {
  fingerTravelPerMm: number;
  slideTravelFactor: number;
  stringChange: number;
  lifted: number;
  placed: number;
  positionShiftPerMm: number;
  anchorDiscount: number;
  maxAnchorDiscount: number;
  minTimeSec: number;
}

/**
 * raw = (fingerTravelPerMm * (moveTravel + slideTravelFactor * slideTravel)
 *        + stringChange * stringChanges + lifted * lifted + placed * placed
 *        + positionShiftPerMm * positionShiftMm) * (1 - min(maxAnchorDiscount, anchorDiscount * anchors))
 * cost = raw / max(minTimeSec, timeSec)
 * Every term is non-negative and the anchor factor stays positive, so raw >= 0 and identical shapes cost 0.
 */
export const TRANSITION_WEIGHTS: Readonly<TransitionWeights> = {
  // Per mm of along-neck fingertip travel, summed over fingers used in both shapes (200 mm total = 1).
  // Lower than the hand shift because the fingers mostly ride along with the hand.
  fingerTravelPerMm: 0.005,
  // Travel of a finger that stays on its string (a guide-finger slide) counts at this fraction: it keeps
  // contact and leads the hand, so a short slide stays cheaper than a lift plus a place.
  slideTravelFactor: 0.5,
  // Per string a kept finger moves across; it has to come off the string and land again.
  stringChange: 0.25,
  // Per finger released; letting go is quick.
  lifted: 0.15,
  // Per finger newly placed; aiming a fresh finger is the slow part of most chord changes.
  placed: 0.5,
  // Per mm the hand position (lowest fretted fingertip) moves (100 mm = 1). The main cost of position jumps.
  positionShiftPerMm: 0.01,
  // Each anchor (same finger, string and fret held through the change) steadies the hand and cuts the
  // whole change cost by this fraction ...
  anchorDiscount: 0.2,
  // ... up to this total, so a change never becomes free while something still moves.
  maxAnchorDiscount: 0.5,
  // Available time is floored here (about a 16th note at 300 bpm) so near-zero gaps do not explode the cost.
  minTimeSec: 0.05
};

/** The thumb wraps the neck and follows the hand; its movement is covered by positionShiftMm. */
const TRACKED_FINGERS: readonly FingerNumber[] = [1, 2, 3, 4];

interface Placement {
  string: number;
  fret: number;
}

/** Where each finger 1..4 presses; a multi-string finger (barre) is placed at its lowest string. */
const placements = ({ shape, fingering }: FingeredShape): (Placement | null)[] => {
  const out: (Placement | null)[] = [null, null, null, null, null];
  const count = Math.min(shape.length, fingering.fingers.length);
  for (let s = 0; s < count; s++) {
    const finger = fingering.fingers[s];
    const fret = shape[s];
    if (finger === null || finger === 0 || fret === null || fret <= 0) continue;
    if (out[finger] === null) out[finger] = { string: s, fret };
  }
  return out;
};

export const transitionCost = (
  a: FingeredShape,
  b: FingeredShape,
  opts: { scaleLengthMm: number; timeSec: number }
): TransitionBreakdown => {
  const { scaleLengthMm, timeSec } = opts;
  if (!(scaleLengthMm > 0) || !Number.isFinite(scaleLengthMm)) {
    throw new Error(`transitionCost: scaleLengthMm must be a positive number, got ${scaleLengthMm}`);
  }
  if (Number.isNaN(timeSec)) throw new Error('transitionCost: timeSec must be a number, got NaN');

  const w = TRANSITION_WEIGHTS;
  const tip = (fret: number) => fingertipMm(fret, scaleLengthMm);
  const from = placements(a);
  const to = placements(b);

  let moveTravelMm = 0;
  let slideTravelMm = 0;
  let stringChanges = 0;
  let lifted = 0;
  let placed = 0;
  let anchors = 0;
  let slides = 0;
  for (const finger of TRACKED_FINGERS) {
    const p = from[finger];
    const q = to[finger];
    if (p === null && q === null) continue;
    if (q === null) {
      lifted++;
      continue;
    }
    if (p === null) {
      placed++;
      continue;
    }
    const travel = Math.abs(tip(q.fret) - tip(p.fret));
    stringChanges += Math.abs(q.string - p.string);
    if (p.string !== q.string) {
      moveTravelMm += travel;
    } else if (p.fret === q.fret) {
      anchors++;
    } else {
      slides++;
      slideTravelMm += travel;
    }
  }

  const lowA = lowestFret(a.shape);
  const lowB = lowestFret(b.shape);
  const positionShiftMm = lowA === null || lowB === null ? 0 : Math.abs(tip(lowB) - tip(lowA));

  const base =
    w.fingerTravelPerMm * (moveTravelMm + w.slideTravelFactor * slideTravelMm) +
    w.stringChange * stringChanges +
    w.lifted * lifted +
    w.placed * placed +
    w.positionShiftPerMm * positionShiftMm;
  const raw = base * (1 - Math.min(w.maxAnchorDiscount, w.anchorDiscount * anchors));
  // Reported time is the effective (floored) time, so cost === raw / timeSec always holds.
  const effectiveTimeSec = Math.max(w.minTimeSec, timeSec);

  return {
    fingerTravelMm: moveTravelMm + slideTravelMm,
    stringChanges,
    lifted,
    placed,
    anchors,
    slides,
    positionShiftMm,
    raw,
    timeSec: effectiveTimeSec,
    cost: raw / effectiveTimeSec
  };
};

// ---------------------------------------------------------------------------
// Minimax Viterbi
// ---------------------------------------------------------------------------

const EPS = 1e-9;

/** Index of the first value within EPS of the minimum (ties -> lower index); -1 when all are +Infinity. */
const argminFirst = (values: readonly number[]): number => {
  let min = Infinity;
  for (const v of values) if (v < min) min = v;
  if (min === Infinity) return -1;
  for (let i = 0; i < values.length; i++) if (values[i] <= min + EPS) return i;
  return -1;
};

/**
 * Generic minimax Viterbi: minimize the max edge cost along the path, tie-break by the sum (epsilon 1e-9).
 * sizes[i] = number of candidates in layer i. edgeCost(layer, from, to) is the edge from candidate `from` of
 * layer `layer` to candidate `to` of layer (layer + 1) % n; it is called exactly once per edge, so it may be
 * expensive. nodeCost (optional) only joins the SUM tie-break, and sumCost includes it.
 * cyclic: also include the edge from the last layer back to the first. A single cyclic layer uses its self edge.
 * Deterministic: remaining ties -> the lexicographically smallest path (lower index first).
 * maxCost is 0 for a path without edges. Edge costs may be +Infinity (forbidden unless unavoidable);
 * NaN or -Infinity edges and non-finite node costs throw.
 *
 * Exact in two phases, because (max, sum) is not decomposable per node (a prefix with a smaller max can
 * lose once a later edge dominates both maxima):
 *   1. bottleneck DP: M* = the smallest achievable max edge;
 *   2. min-sum DP restricted to edges <= M* + epsilon; any such complete path has max == M*.
 * Cyclic mode fixes the first-layer candidate s, closes the loop back to s, and keeps the best s.
 */
export const minimaxViterbi = (
  sizes: readonly number[],
  edgeCost: (layer: number, from: number, to: number) => number,
  opts: { cyclic?: boolean; nodeCost?: (layer: number, index: number) => number } = {}
): { path: number[]; maxCost: number; sumCost: number } => {
  const n = sizes.length;
  const cyclic = opts.cyclic ?? false;
  if (n === 0) return { path: [], maxCost: 0, sumCost: 0 };
  sizes.forEach((size, i) => {
    if (!Number.isInteger(size) || size < 1) {
      throw new Error(`minimaxViterbi: layer ${i} needs at least one candidate, got size ${size}`);
    }
  });

  // edges[i][from][to]: layer i -> layer (i + 1) % n. The closing edge (i = n - 1) exists only when cyclic.
  const edgeLayers = cyclic ? n : n - 1;
  const edges: number[][][] = [];
  for (let i = 0; i < edgeLayers; i++) {
    const next = (i + 1) % n;
    const matrix: number[][] = [];
    for (let from = 0; from < sizes[i]; from++) {
      const row: number[] = [];
      for (let to = 0; to < sizes[next]; to++) {
        const c = edgeCost(i, from, to);
        if (Number.isNaN(c) || c === -Infinity) {
          throw new Error(`minimaxViterbi: edge cost must be a number or +Infinity, got ${c} (layer ${i}, ${from} -> ${to})`);
        }
        row.push(c);
      }
      matrix.push(row);
    }
    edges.push(matrix);
  }

  const nodes: number[][] = sizes.map((size, i) =>
    Array.from({ length: size }, (_, k) => {
      const c = opts.nodeCost ? opts.nodeCost(i, k) : 0;
      if (!Number.isFinite(c)) throw new Error(`minimaxViterbi: node cost must be finite, got ${c} (layer ${i}, candidate ${k})`);
      return c;
    })
  );

  /**
   * Backward DP over layers n-1 .. 0 (cost-to-go per candidate). `terminal(v)` seeds the last layer,
   * `combine` merges an edge cost with the cost-to-go of its head (Infinity when the edge is not allowed),
   * and `withNode` adds the node term.
   */
  const backward = (
    terminal: (v: number) => number,
    combine: (edge: number, next: number) => number,
    withNode: (layer: number, v: number, value: number) => number
  ): number[][] => {
    const go: number[][] = new Array(n);
    go[n - 1] = Array.from({ length: sizes[n - 1] }, (_, v) => withNode(n - 1, v, terminal(v)));
    for (let i = n - 2; i >= 0; i--) {
      go[i] = Array.from({ length: sizes[i] }, (_, v) => {
        let best = Infinity;
        for (let w = 0; w < sizes[i + 1]; w++) {
          const value = combine(edges[i][v][w], go[i + 1][w]);
          if (value < best) best = value;
        }
        return withNode(i, v, best);
      });
    }
    return go;
  };

  // Phase 1: the optimal bottleneck M*. No edges at all (single acyclic layer) => no restriction.
  const bottleneckFrom = (start: number | null): number[][] =>
    backward(
      (v) => (start === null ? -Infinity : edges[n - 1][v][start]),
      (edge, next) => Math.max(edge, next),
      (_layer, _v, value) => value
    );
  const starts = cyclic ? Array.from({ length: sizes[0] }, (_, s) => s) : [null];
  let threshold = Infinity;
  if (edgeLayers > 0) {
    for (const start of starts) {
      const go = bottleneckFrom(start);
      const value = start === null ? Math.min(...go[0]) : go[0][start];
      if (value < threshold) threshold = value;
    }
    threshold += EPS;
  }

  // Phase 2: min-sum over the edges allowed by the bottleneck.
  const allowed = (edge: number) => edge <= threshold;
  const sumFrom = (start: number | null): number[][] =>
    backward(
      (v) => {
        if (start === null) return 0;
        const closing = edges[n - 1][v][start];
        return allowed(closing) ? closing : Infinity;
      },
      (edge, next) => (allowed(edge) ? edge + next : Infinity),
      (layer, v, value) => value + nodes[layer][v]
    );

  let bestStart = -1;
  let bestGo: number[][] | null = null;
  if (cyclic) {
    const totals: number[] = [];
    const gos: number[][][] = [];
    for (let s = 0; s < sizes[0]; s++) {
      const go = sumFrom(s);
      gos.push(go);
      totals.push(go[0][s]);
    }
    bestStart = argminFirst(totals);
    if (bestStart >= 0) bestGo = gos[bestStart];
  } else {
    bestGo = sumFrom(null);
    bestStart = argminFirst(bestGo[0]);
  }
  if (bestStart < 0) {
    // Every path crosses a +Infinity edge (M* = Infinity), so all tie on max and sum: lexicographically first.
    bestStart = 0;
    bestGo = null;
  }

  const path: number[] = [bestStart];
  for (let i = 0; i + 1 < n; i++) {
    const v = path[i];
    if (bestGo === null) {
      path.push(0);
      continue;
    }
    const go = bestGo;
    const options = Array.from({ length: sizes[i + 1] }, (_, w) =>
      allowed(edges[i][v][w]) ? edges[i][v][w] + go[i + 1][w] : Infinity
    );
    const next = argminFirst(options);
    path.push(next < 0 ? 0 : next);
  }

  let maxCost = -Infinity;
  let sumCost = 0;
  for (let i = 0; i < edgeLayers; i++) {
    const c = edges[i][path[i]][path[(i + 1) % n]];
    if (c > maxCost) maxCost = c;
    sumCost += c;
  }
  for (let i = 0; i < n; i++) sumCost += nodes[i][path[i]];
  return { path, maxCost: edgeLayers === 0 ? 0 : maxCost, sumCost };
};

// ---------------------------------------------------------------------------
// Sequence optimization
// ---------------------------------------------------------------------------

export interface OptimizedSequence extends SequenceResult {
  /** Fingering used in each slot (the transitions are costed with it): the candidate's own unless a profile
   *  was given and another valid fingering of the same shape makes the changes easier. */
  fingerings: Fingering[];
}

/** Which fingers a fingering uses, e.g. "3,4" for ring + pinky. */
const fingerSetKey = (f: Fingering): string =>
  [...new Set(f.fingers.filter((x): x is FingerNumber => x !== null))].sort((a, b) => a - b).join(',');

/**
 * Fingerings the optimizer may use for one candidate: its own first, then the cheapest valid fingering (under
 * the profile) for every other set of fingers. Which fingers are busy decides what can stay down through a
 * change (a dyad held with ring + pinky leaves the index free for the root below), while re-ordering the same
 * fingers only adds static cost. So at most 1 + C(5, k) options, e.g. 7 for a dyad.
 */
const fingeringOptions = (candidate: FingeredShape, profile: HandProfile | undefined): Fingering[] => {
  const own = candidate.fingering;
  if (profile === undefined) return [own];
  const options = [own];
  const seen = new Set([fingerSetKey(own)]);
  for (const alt of enumerateFingerings(candidate.shape, profile)) {
    const key = fingerSetKey(alt);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(alt);
  }
  return options;
};

interface SequenceState {
  candidate: number;
  shape: FingeredShape;
  /** Static physical cost above the candidate's own fingering; only joins the sum tie-break. */
  extra: number;
}

/**
 * Picks one candidate per slot minimizing the hardest change, then the total. The change leaving slot i
 * gets timing.beatsPerSlot[i] * 60 / bpm seconds. Cyclic by default (riffs loop): the last slot changes
 * back to the first. With one cyclic slot the self-transition is used (identical shapes cost 0).
 *
 * Without `opts.profile` each candidate keeps the fingering it carries. With a profile the fingering is
 * chosen together with the neighbours: every candidate may also use the cheapest valid fingering for each
 * other set of fingers (see fingeringOptions), so a dyad next to its power chord is held with ring + pinky
 * instead of re-gripped. The hardest change still decides first; between equal changes the statically easier
 * fingering wins (the candidate's own on a tie). `fingerings` reports the choice; `sumCost` is the sum of the
 * transition costs only. scaleLengthMm defaults to the profile's, then to DEFAULT_SCALE_LENGTH_MM.
 */
export const optimizeSequence = (
  candidatesPerSlot: readonly (readonly FingeredShape[])[],
  timing: SequenceTiming,
  opts: { scaleLengthMm?: number; profile?: HandProfile } = {}
): OptimizedSequence => {
  const n = candidatesPerSlot.length;
  candidatesPerSlot.forEach((candidates, i) => {
    if (candidates.length === 0) throw new Error(`optimizeSequence: slot ${i + 1} has no candidate voicings`);
  });
  if (n === 0) return { path: [], maxCost: 0, sumCost: 0, transitions: [], hardest: null, fingerings: [] };

  const { bpm, beatsPerSlot } = timing;
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error(`optimizeSequence: bpm must be a positive number, got ${bpm}`);
  if (beatsPerSlot.length !== n) {
    throw new Error(`optimizeSequence: beatsPerSlot has ${beatsPerSlot.length} entries for ${n} slots`);
  }
  beatsPerSlot.forEach((beats, i) => {
    if (!Number.isFinite(beats) || beats < 0) {
      throw new Error(`optimizeSequence: beatsPerSlot[${i}] must be a non-negative number, got ${beats}`);
    }
  });

  const cyclic = timing.cyclic ?? true;
  const { profile } = opts;
  const scaleLengthMm = opts.scaleLengthMm ?? profile?.scaleLengthMm ?? DEFAULT_SCALE_LENGTH_MM;

  // One state per (candidate, fingering option), candidates in order and each candidate's own fingering
  // first, so lexicographic ties still prefer the lower candidate index and the attached fingering.
  const states: SequenceState[][] = candidatesPerSlot.map((candidates) =>
    candidates.flatMap((candidate, c) => {
      const options = fingeringOptions(candidate, profile);
      const ownCost = candidate.fingering.costBreakdown.physical;
      return options.map((fingering, k) => {
        const extra = fingering.costBreakdown.physical - ownCost;
        return {
          candidate: c,
          shape: k === 0 ? candidate : { shape: candidate.shape, fingering },
          extra: k > 0 && Number.isFinite(extra) ? Math.max(0, extra) : 0
        };
      });
    })
  );

  const change = (slot: number, from: SequenceState, to: SequenceState): TransitionBreakdown =>
    transitionCost(from.shape, to.shape, { scaleLengthMm, timeSec: (beatsPerSlot[slot] * 60) / bpm });

  const { path: statePath } = minimaxViterbi(
    states.map((layer) => layer.length),
    (slot, from, to) => change(slot, states[slot][from], states[(slot + 1) % n][to]).cost,
    { cyclic, nodeCost: (slot, index) => states[slot][index].extra }
  );
  const chosen = statePath.map((index, slot) => states[slot][index]);

  const transitions: SequenceTransition[] = [];
  const count = cyclic ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const breakdown = change(i, chosen[i], chosen[j]);
    transitions.push({ from: i, to: j, cost: breakdown.cost, breakdown });
  }
  let hardest: SequenceTransition | null = null;
  let sumCost = 0;
  for (const t of transitions) {
    if (hardest === null || t.cost > hardest.cost) hardest = t;
    sumCost += t.cost;
  }

  return {
    path: chosen.map((state) => state.candidate),
    maxCost: hardest === null ? 0 : hardest.cost,
    sumCost,
    transitions,
    hardest,
    fingerings: chosen.map((state) => state.shape.fingering)
  };
};

// ---------------------------------------------------------------------------
// UI text
// ---------------------------------------------------------------------------

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

const formatSeconds = (sec: number): string => String(Number(sec.toFixed(2)));

/**
 * One-line UI text, e.g. "Hardest change: slot 2 -> 3, hand shifts 41 mm in 0.5 s". Slots 1-based in text.
 * `label` defaults to "Hardest change" (the usual caller passes SequenceResult.hardest); pass another label
 * when describing an arbitrary transition.
 */
export const describeTransition = (t: SequenceTransition | null, label = 'Hardest change'): string => {
  if (t === null) return `${label}: none (one chord)`;
  const b = t.breakdown;
  const moves: string[] = [];
  const shift = Math.round(b.positionShiftMm);
  if (shift > 0) moves.push(`hand shifts ${shift} mm`);
  if (b.placed > 0) moves.push(`${count(b.placed, 'finger')} placed`);
  if (b.lifted > 0) moves.push(`${count(b.lifted, 'finger')} lifted`);
  if (b.stringChanges > 0) moves.push(count(b.stringChanges, 'string change'));
  if (b.slides > 0) moves.push(count(b.slides, 'slide'));
  const what = moves.length > 0 ? moves.join(', ') : 'no movement';
  const held = b.anchors > 0 ? `, ${count(b.anchors, 'finger')} stay${b.anchors === 1 ? 's' : ''} down` : '';
  return `${label}: slot ${t.from + 1} -> ${t.to + 1}, ${what} in ${formatSeconds(b.timeSec)} s${held}`;
};
