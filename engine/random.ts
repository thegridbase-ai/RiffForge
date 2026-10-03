// Seeded randomness. The engine never calls Math.random.

/** FNV-1a 32-bit hash of a string, used to derive numeric seeds. */
export const seedFromString = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** mulberry32: small, fast, good enough for musical choices. Returns floats in [0, 1). */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface Rng {
  /** Float in [0, 1). */
  next: () => number;
  /** Integer in [min, max] inclusive. */
  int: (min: number, max: number) => number;
  /** True with probability p. */
  chance: (p: number) => boolean;
  pick: <T>(items: readonly T[]) => T;
  /** Pick by non-negative weights; falls back to uniform when all weights are 0. */
  weighted: <T>(items: readonly T[], weights: readonly number[]) => T;
  shuffle: <T>(items: readonly T[]) => T[];
  /** Derive an independent child stream, stable for a given label. */
  fork: (label: string) => Rng;
}

export const createRng = (seed: string | number): Rng => {
  const numeric = typeof seed === 'number' ? seed >>> 0 : seedFromString(seed);
  const next = mulberry32(numeric);

  const rng: Rng = {
    next,
    int: (min, max) => {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[Math.floor(next() * items.length)];
    },
    weighted: (items, weights) => {
      if (items.length === 0) throw new Error('weighted pick from empty list');
      const total = weights.reduce((sum, w) => sum + Math.max(0, w || 0), 0);
      if (total <= 0) return items[Math.floor(next() * items.length)];
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i] || 0);
        if (r < 0) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    fork: (label) => createRng(seedFromString(`${numeric}:${label}`))
  };
  return rng;
};
