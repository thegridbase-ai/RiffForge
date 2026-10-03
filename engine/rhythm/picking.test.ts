import { describe, it, expect } from 'vitest';
import { assignPicks } from './picking';
import { generateRhythm } from './generate';
import { clearHit } from './edit';
import { RHYTHM_STYLE_IDS, defaultRhythmParams } from './styles';
import { barTicks, patternUnitCount } from './grid';
import type { RhythmPattern } from '../types';

const at = (...ticks: number[]) => ticks.map((tick) => ({ tick }));
const BAR = 1920;

describe('assignPicks: alternate', () => {
  it('keys picks to the sixteenth grid: even sixteenths down, odd up', () => {
    expect(assignPicks(at(0, 120, 240, 360, 480), 'alternate', BAR)).toEqual(['down', 'up', 'down', 'up', 'down']);
  });

  it('picks a gallop down, down, up and keeps the pendulum through rests', () => {
    expect(assignPicks(at(0, 240, 360), 'alternate', BAR)).toEqual(['down', 'down', 'up']);
    expect(assignPicks(at(0, 360, 600), 'alternate', BAR)).toEqual(['down', 'up', 'up']);
  });

  it('alternates 32nds strictly, including the on-grid ones between them', () => {
    expect(assignPicks(at(0, 60, 120, 180, 240, 300), 'alternate', BAR)).toEqual([
      'down',
      'up',
      'down',
      'up',
      'down',
      'up'
    ]);
  });

  it('alternates sixteenth triplets by event order', () => {
    expect(assignPicks(at(0, 80, 160, 240, 320, 400, 480), 'alternate', BAR)).toEqual([
      'down',
      'up',
      'down',
      'up',
      'down',
      'up',
      'down'
    ]);
  });

  it('restarts eighth-note triplets on each beat (on-grid pick wins after a 16th or longer gap)', () => {
    expect(assignPicks(at(0, 160, 320, 480), 'alternate', BAR)).toEqual(['down', 'up', 'down', 'down']);
  });

  it('places a leading off-grid event by its own subdivision', () => {
    expect(assignPicks(at(60), 'alternate', BAR)).toEqual(['up']);
    expect(assignPicks(at(80), 'alternate', BAR)).toEqual(['up']);
    expect(assignPicks(at(160), 'alternate', BAR)).toEqual(['down']);
    expect(assignPicks(at(1860), 'alternate', BAR)).toEqual(['up']);
  });

  it('starts each bar fresh so a bar never depends on the previous one', () => {
    // 7/8 on the triplet grid: last triplet of bar 1 is a downstroke, the next downbeat is too.
    expect(assignPicks(at(1600, 1680), 'alternate', 1680)).toEqual(['down', 'down']);
  });
});

describe('assignPicks: runs faster than sixteenths', () => {
  it('keys a sixteenth-triplet run with a gap to its own pendulum, so the next beat is still down', () => {
    expect(assignPicks(at(0, 160, 240, 320, 400, 480), 'alternate', BAR)).toEqual(['down', 'down', 'up', 'down', 'up', 'down']);
  });

  it('keys an offbeat 32nd run to the 32nd pendulum, so the beat it reaches is down', () => {
    expect(assignPicks(at(480, 600, 660, 720, 780, 840, 900, 960), 'alternate', BAR)).toEqual([
      'down',
      'down',
      'up',
      'down',
      'up',
      'down',
      'up',
      'down'
    ]);
  });

  it('keeps the 32nd pendulum through a missing 32nd', () => {
    expect(assignPicks(at(0, 60, 180, 240), 'alternate', BAR)).toEqual(['down', 'up', 'up', 'down']);
  });
});

/** Every event on a quarter-note boundary of its bar is a downstroke; notes closer than a 16th alternate. */
const expectBeatStartsDown = (p: RhythmPattern) => {
  const bar = barTicks(p.meter);
  p.events.forEach((e, i) => {
    if ((e.tick % bar) % 480 === 0) expect(e.pick, `${p.id} tick ${e.tick}`).toBe('down');
    const prev = p.events[i - 1];
    if (prev && !e.tie && !prev.tie && e.tick - prev.tick < 120 && Math.floor(prev.tick / bar) === Math.floor(e.tick / bar)) {
      expect(e.pick, `${p.id} run at ${e.tick}`).not.toBe(prev.pick);
    }
  });
};

describe('assignPicks on generated and edited patterns', () => {
  it('puts every beat start on a downstroke, also after a note is removed from a fast run', () => {
    for (const style of RHYTHM_STYLE_IDS) {
      for (const grid of ['16th', '16th-triplet'] as const) {
        for (const seed of ['b0', 'b54', 'xyz', 'riff-1']) {
          const p = generateRhythm({ ...defaultRhythmParams(style), grid, picking: 'alternate', bars: 1 }, seed);
          expectBeatStartsDown(p);
          for (let unit = 0; unit < patternUnitCount(p); unit++) expectBeatStartsDown(clearHit(p, unit));
        }
      }
    }
  });
});

describe('assignPicks: downstrokes', () => {
  it('picks everything down', () => {
    expect(assignPicks(at(0, 120, 240, 300, 360), 'downstrokes', BAR)).toEqual(['down', 'down', 'down', 'down', 'down']);
  });
});
