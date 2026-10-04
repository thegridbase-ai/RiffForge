import { describe, it, expect } from 'vitest';
import {
  CURVE_LENGTH,
  GUITAR_SAMPLE_NOTES,
  guitarSampleUrl,
  nearestSampleDistance,
  onsetSeconds,
  MAX_DRIVE_TRIM_DB,
  chordDriveTrimDb,
  detunedFrequency,
  humanize,
  parseAmpModel,
  saturationCurve,
  strumOrder,
  strumVelocity
} from './ampTone';

const at = (curve: Float32Array, x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

describe('saturationCurve', () => {
  it('is silent at zero, monotonic and peaks at 1 on its louder side', () => {
    const curve = saturationCurve(5);
    expect(curve).toHaveLength(CURVE_LENGTH);
    expect(Math.abs(at(curve, 0))).toBeLessThan(1e-3);
    expect(at(curve, 1)).toBeCloseTo(1, 6);
    expect(at(curve, -1)).toBeCloseTo(-1, 6);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });

  it('is asymmetric with a bias (even harmonics) and still silent at zero', () => {
    const curve = saturationCurve(8, 0.3);
    expect(Math.abs(at(curve, 0))).toBeLessThan(2e-3);
    expect(at(curve, -1)).toBeCloseTo(-1, 6);
    expect(at(curve, 1)).toBeGreaterThan(0.5);
    expect(at(curve, 1)).toBeLessThan(0.6);
  });

  it('compresses more with more drive', () => {
    expect(at(saturationCurve(8), 0.1)).toBeGreaterThan(at(saturationCurve(1.5), 0.1));
  });
});

describe('chordDriveTrimDb', () => {
  it('keeps full drive for single notes and power chords', () => {
    expect(chordDriveTrimDb([40])).toBe(0);
    expect(chordDriveTrimDb([40, 47, 52])).toBe(0);
    expect(chordDriveTrimDb([])).toBe(0);
  });

  it('backs off for low thirds, seconds and dense chords, never more than 6 dB', () => {
    // E2 G#2 B2: a low major third
    expect(chordDriveTrimDb([40, 44, 47])).toBe(-3);
    // E2 F2 B2: a minor second cluster
    expect(chordDriveTrimDb([40, 41, 47])).toBe(-1.5);
    // Open Em(add9) 0 2 2 0 0 2: six notes and a low third
    expect(chordDriveTrimDb([40, 47, 52, 55, 59, 66])).toBe(MAX_DRIVE_TRIM_DB);
    // A third high up is fine
    expect(chordDriveTrimDb([64, 67])).toBe(0);
  });
});

describe('humanize', () => {
  it('stays within +-3 cents and +-2 ms and repeats for the same hit and string', () => {
    for (let hit = 0; hit < 200; hit++) {
      for (let string = 0; string < 6; string++) {
        const h = humanize(hit, string);
        expect(Math.abs(h.cents)).toBeLessThanOrEqual(3);
        expect(Math.abs(h.seconds)).toBeLessThanOrEqual(0.002);
      }
    }
    expect(humanize(17, 3)).toEqual(humanize(17, 3));
    expect(humanize(17, 3)).not.toEqual(humanize(18, 3));
  });

  it('gives repeatable strum velocities in 0.82..0.98', () => {
    const values = Array.from({ length: 50 }, (_, n) => strumVelocity(n));
    expect(values.every((v) => v >= 0.82 && v <= 0.98)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(40);
    expect(strumVelocity(5)).toBe(strumVelocity(5));
  });
});

describe('strum helpers', () => {
  it('strums low to high on a downstroke and high to low on an upstroke', () => {
    expect(strumOrder([40, 47, 52], 'down')).toEqual([40, 47, 52]);
    expect(strumOrder([40, 47, 52], 'up')).toEqual([52, 47, 40]);
  });

  it('detunes by cents', () => {
    expect(detunedFrequency(69, 0)).toBeCloseTo(440, 9);
    expect(detunedFrequency(69, 100)).toBeCloseTo(440 * 2 ** (1 / 12), 9);
  });

  it('parses the stored amp model, defaulting to the new one', () => {
    expect(parseAmpModel('classic')).toBe('classic');
    expect(parseAmpModel('modern')).toBe('modern');
    expect(parseAmpModel('vox')).toBe('modern');
    expect(parseAmpModel(null)).toBe('modern');
  });
});

describe('guitar samples', () => {
  it('repitches at most 1.5 semitones up to D6, and 2 up to E6 (24th fret)', () => {
    for (let midi = 37; midi <= 88; midi++) expect(nearestSampleDistance(midi)).toBeLessThanOrEqual(2);
    for (let midi = 37; midi <= 86; midi++) expect(nearestSampleDistance(midi)).toBeLessThanOrEqual(1.5);
    expect(guitarSampleUrl(GUITAR_SAMPLE_NOTES[40])).toBe('/samples/emilyguitar/E2.mp3');
  });

  it('finds the attack after encoder silence and keeps a 1 ms pre-roll', () => {
    const data = new Float32Array(4410);
    for (let i = 1323; i < data.length; i++) data[i] = Math.sin(i / 3) * Math.exp(-(i - 1323) / 800);
    // Attack at 30 ms
    expect(onsetSeconds(data, 44100)).toBeCloseTo(0.029, 3);
    expect(onsetSeconds(new Float32Array(100), 44100)).toBe(0);
    expect(onsetSeconds([0.5, 0.2], 44100)).toBe(0);
  });
});
