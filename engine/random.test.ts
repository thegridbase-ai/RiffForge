import { describe, it, expect } from 'vitest';
import { createRng, mulberry32, seedFromString } from './random';

describe('seedFromString', () => {
  it('is stable and distinguishes inputs', () => {
    expect(seedFromString('riff')).toBe(seedFromString('riff'));
    expect(seedFromString('riff')).not.toBe(seedFromString('riffs'));
    expect(seedFromString('')).toBe(0x811c9dc5);
  });
});

describe('mulberry32', () => {
  it('produces the same stream for the same seed, in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('createRng', () => {
  it('is deterministic per seed string', () => {
    const seq = (seed: string) => {
      const rng = createRng(seed);
      return Array.from({ length: 20 }, () => rng.int(0, 9));
    };
    expect(seq('gallop')).toEqual(seq('gallop'));
    expect(seq('gallop')).not.toEqual(seq('chug'));
  });

  it('keeps int within inclusive bounds and covers them', () => {
    const rng = createRng('bounds');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = rng.int(1, 4);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(4);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('never picks zero-weight items unless all weights are zero', () => {
    const rng = createRng('weights');
    for (let i = 0; i < 200; i++) {
      expect(rng.weighted(['a', 'b', 'c'], [0, 1, 0])).toBe('b');
    }
    expect(['a', 'b']).toContain(rng.weighted(['a', 'b'], [0, 0]));
  });

  it('shuffles without losing items and forks stable child streams', () => {
    const rng = createRng('shuffle');
    expect(rng.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    const childA = createRng('parent').fork('bar-1');
    const childB = createRng('parent').fork('bar-1');
    expect(childA.next()).toBe(childB.next());
    expect(createRng('parent').fork('bar-1').next()).not.toBe(createRng('parent').fork('bar-2').next());
  });

  it('throws when picking from an empty list', () => {
    expect(() => createRng('x').pick([])).toThrow();
  });
});
