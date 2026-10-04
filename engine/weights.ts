// Default cost weights. Every term is normalized to 0..1 before weighting, so a weight reads as
// "the most this term can add". Values are heuristic starting points; the ISMIR 2023 fitted
// weights (Velez Vasquez et al.) guide the relative order, they are not reproduced exactly.
import type { CostBucket, CostTermKey } from './types';

export interface CostWeight {
  bucket: CostBucket;
  weight: number;
}

export const PLAYABILITY_WEIGHTS: Readonly<Record<CostTermKey, CostWeight>> = {
  // normalized = reachRatio^2. ISMIR 2023 gives finger positioning (cramped/wide) its top weight (3);
  // squaring keeps comfortable spans cheap and makes the last few millimetres expensive.
  reach: { bucket: 'physical', weight: 3.0 },
  // normalized = maxPairStretch^2: how far the worst consecutive finger pair is pulled beyond its relaxed
  // one-fret-per-finger spacing toward its hard limit. Plain ratio-to-limit would punish the ordinary
  // one-finger-per-fret hand frame (middle-ring sits near its limit there) and pick odd fingerings.
  pairStretch: { bucket: 'physical', weight: 1.5 },
  // normalized = fingerCount / 4. ISMIR fingering difficulty (2) also covers barre, which is a hard
  // constraint here, so the remaining finger-count share is lower.
  fingerCount: { bucket: 'physical', weight: 1.0 },
  // normalized = 1 when the pinky frets a note. Hori and Sagayama rank the pinky least preferred.
  pinky: { bucket: 'physical', weight: 0.5 },
  // normalized = min(1, contortions / 2): lower-numbered finger on a higher string at the same fret.
  contortion: { bucket: 'physical', weight: 1.0 },
  // normalized = min(1, interiorMutes / 2): each muted string inside the voicing needs a finger to
  // damp it, which gets noisy under gain.
  interiorMutes: { bucket: 'physical', weight: 1.5 },
  // normalized = min(1, lowestFret / 12). Mild preference for lower positions only.
  position: { bucket: 'physical', weight: 0.3 },
  // normalized = 1 when the thumb frets the lowest string (only possible when the profile allows it).
  thumb: { bucket: 'physical', weight: 1.0 },
  // normalized = min(1, barres). Only reachable in barre mode; the generator default forbids barres.
  barre: { bucket: 'physical', weight: 2.0 },

  // normalized = min(1, skippedStrings / 2). ISMIR right-hand complexity (skipped strings) weight 2.
  stringSkips: { bucket: 'rightHand', weight: 2.0 },
  // Chug context only: 0.5 * min(1, (soundingStrings - 1) / 5) + 0.5 * meanStringIndex / (strings - 1).
  // Fewer, lower strings stay tight under palm muting. Always 0 in the 'strum' context.
  chugStrings: { bucket: 'rightHand', weight: 0.5 },

  // Distortion only: normalized = min(1, pairs / 2) over note pairs both below MIDI 52 (E3) that are
  // 1..4 semitones apart. Narrow low intervals turn to mud under high gain.
  lowMud: { bucket: 'musical', weight: 2.0 },
  // normalized = min(1, thirdsSounding - 1): a doubled third is thick and hard to keep in tune.
  doubledThird: { bucket: 'musical', weight: 0.5 },
  // normalized = 1 when the family prefers the root in the bass (preferredBass 0) and the bass is another
  // degree. A preferred bass on another degree (a relaxed slash-bass recipe) is not charged here.
  rootNotInBass: { bucket: 'musical', weight: 0.5 }
};

export const PHYSICAL_TERMS: readonly CostTermKey[] = [
  'reach',
  'pairStretch',
  'fingerCount',
  'pinky',
  'contortion',
  'interiorMutes',
  'position',
  'thumb',
  'barre'
];

export const RIGHT_HAND_TERMS: readonly CostTermKey[] = ['stringSkips', 'chugStrings'];

export const MUSICAL_TERMS: readonly CostTermKey[] = ['lowMud', 'doubledThird', 'rootNotInBass'];

/** MIDI note below which narrow intervals count as low-register mud (E3). */
export const LOW_MUD_THRESHOLD_MIDI = 52;
