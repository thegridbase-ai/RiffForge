import { describe, it, expect } from 'vitest';
import { clearHit, cycleAccent, eventAtUnit, setSlotCount, toggleHit, togglePalmMute } from './edit';
import { generateRhythm } from './generate';
import { RHYTHM_STYLE_IDS, defaultRhythmParams } from './styles';
import { validateRhythm } from './validate';
import { patternUnitCount } from './grid';
import { createRng } from '../random';
import type { HitTarget, RhythmEvent, RhythmParams, RhythmPattern } from '../types';

const SLOT0: HitTarget = { kind: 'slot', slot: 0 };
const SLOT1: HitTarget = { kind: 'slot', slot: 1 };
const PEDAL: HitTarget = { kind: 'pedal' };
const DYAD0: HitTarget = { kind: 'dyad', slot: 0 };

const ev = (tick: number, durationTicks: number, target: HitTarget, extra: Partial<RhythmEvent> = {}): RhythmEvent => ({
  tick,
  durationTicks,
  target,
  palmMute: false,
  accent: 0,
  pick: (tick / 120) % 2 === 0 ? 'down' : 'up',
  ...extra
});

/** One bar of 4/4: accented stab tied over beat 2, a pedal chug, then silence. */
const sparse = (params: Partial<RhythmParams> = {}): RhythmPattern => ({
  id: 'sparse',
  name: 'Sparse',
  seed: 'sparse',
  meter: { numerator: 4, denominator: 4 },
  bars: 1,
  ppq: 480,
  tags: [],
  params: { ...defaultRhythmParams('chugEngine'), bars: 1, ...params },
  events: [
    ev(0, 480, SLOT0, { accent: 2 }),
    ev(480, 240, SLOT0, { tie: true }),
    ev(960, 120, PEDAL, { palmMute: true })
  ]
});

const expectValid = (p: RhythmPattern) => expect(validateRhythm(p).errors).toEqual([]);

/** One beat of 32nd tremolo on dyad 0, then a palm-muted pedal. */
const tremolo = (): RhythmPattern => ({
  ...sparse(),
  id: 'tremolo',
  events: [
    ...[0, 60, 120, 180, 240, 300, 360, 420].map((tick, i) =>
      ev(tick, 60, DYAD0, { accent: i === 0 ? 2 : 0, pick: i % 2 === 0 ? 'down' : 'up' })
    ),
    ev(480, 120, PEDAL, { palmMute: true })
  ]
});

const inCell = (p: RhythmPattern, unit: number) => p.events.filter((e) => e.tick >= unit * 120 && e.tick < (unit + 1) * 120);

describe('eventAtUnit', () => {
  it('finds events by onset unit on the pattern grid', () => {
    const p = sparse();
    expect(eventAtUnit(p, 0)?.target).toEqual(SLOT0);
    expect(eventAtUnit(p, 4)?.tie).toBe(true);
    expect(eventAtUnit(p, 8)?.target).toEqual(PEDAL);
    expect(eventAtUnit(p, 1)).toBeUndefined();
    expect(eventAtUnit(p, 99)).toBeUndefined();
    expect(eventAtUnit(p, -1)).toBeUndefined();
  });
});

describe('toggleHit', () => {
  it('adds a hit in an empty unit, ringing until the next onset or one beat', () => {
    expectValid(sparse());
    const p = toggleHit(sparse(), 12, SLOT1);
    expectValid(p);
    expect(eventAtUnit(p, 12)).toMatchObject({ tick: 1440, durationTicks: 480, target: SLOT1, accent: 0 });
    const q = toggleHit(p, 10, PEDAL);
    expect(eventAtUnit(q, 10)).toMatchObject({ durationTicks: 240, palmMute: true, pick: 'down' });
    expectValid(q);
  });

  it('removes the hit when toggled again with the same target', () => {
    const p = toggleHit(toggleHit(sparse(), 12, SLOT1), 12, SLOT1);
    expect(p.events).toEqual(sparse().events);
  });

  it('replaces the target of an existing hit and keeps its tie following it', () => {
    const p = toggleHit(sparse(), 0, SLOT1);
    expectValid(p);
    expect(eventAtUnit(p, 0)).toMatchObject({ target: SLOT1, accent: 2 });
    expect(eventAtUnit(p, 4)).toMatchObject({ target: SLOT1, tie: true });
  });

  it('truncates a ringing event when a hit lands inside it and drops that event\'s ties', () => {
    const p = toggleHit(sparse(), 2, PEDAL);
    expectValid(p);
    expect(eventAtUnit(p, 0)?.durationTicks).toBe(240);
    expect(eventAtUnit(p, 2)).toMatchObject({ tick: 240, durationTicks: 240, palmMute: true });
    expect(eventAtUnit(p, 4)).toBeUndefined();
    expect(p.events.map((e) => e.tick)).toEqual([0, 240, 960]);
  });

  it('never hands a chord\'s sustain to a palm-muted hit inserted inside it', () => {
    const base = generateRhythm(defaultRhythmParams('halftimeStomp'), 'a');
    expect(base.events[1]).toMatchObject({ tick: 480, tie: true });
    const p = toggleHit(base, 2, PEDAL);
    expectValid(p);
    expect(eventAtUnit(p, 2)).toMatchObject({ durationTicks: 240, palmMute: true });
    expect(p.events.some((e) => e.tie && e.palmMute)).toBe(false);
    expect(eventAtUnit(p, 4)).toBeUndefined();
  });

  it('turns a tie into a new attack for a different target and removes it for the same one', () => {
    const attack = toggleHit(sparse(), 4, PEDAL);
    expectValid(attack);
    expect(eventAtUnit(attack, 4)?.tie).toBeUndefined();
    expect(eventAtUnit(attack, 4)?.target).toEqual(PEDAL);
    const removed = toggleHit(sparse(), 4, SLOT0);
    expect(eventAtUnit(removed, 4)).toBeUndefined();
    expectValid(removed);
  });

  it('ignores invalid units and slots outside slotCount', () => {
    const base = sparse();
    expect(toggleHit(base, 16, PEDAL).events).toEqual(base.events);
    expect(toggleHit(base, 1.5, PEDAL).events).toEqual(base.events);
    expect(toggleHit(base, 3, { kind: 'slot', slot: 2 }).events).toEqual(base.events);
  });
});

describe('32nd tremolo cells', () => {
  it('reports, clears and toggles every 32nd in a grid cell', () => {
    const t = tremolo();
    expectValid(t);
    expect(eventAtUnit(t, 1)?.tick).toBe(120);
    const cleared = clearHit(t, 1);
    expectValid(cleared);
    expect(inCell(cleared, 1)).toEqual([]);
    expect(eventAtUnit(cleared, 1)).toBeUndefined();
    const toggled = toggleHit(t, 1, DYAD0);
    expectValid(toggled);
    expect(inCell(toggled, 1)).toEqual([]);
  });

  it('retargets and palm-mutes the whole cell', () => {
    const t = tremolo();
    const retargeted = toggleHit(t, 1, SLOT1);
    expectValid(retargeted);
    expect(inCell(retargeted, 1).map((e) => e.target)).toEqual([SLOT1, SLOT1]);
    const muted = togglePalmMute(t, 2);
    expectValid(muted);
    expect(inCell(muted, 2).map((e) => e.palmMute)).toEqual([true, true]);
  });

  it('finds a 32nd that sits between grid units', () => {
    const t = { ...tremolo(), events: tremolo().events.filter((e) => e.tick !== 120) };
    expectValid(t);
    expect(eventAtUnit(t, 1)?.tick).toBe(180);
    expect(inCell(clearHit(t, 1), 1)).toEqual([]);
    expect(inCell(toggleHit(t, 1, DYAD0), 1)).toEqual([]);
  });

  it('keeps the tremolo pendulum after a cell is cleared', () => {
    const p = clearHit(generateRhythm(defaultRhythmParams('tremoloWall'), 'riff-1'), 1);
    expectValid(p);
    expect(eventAtUnit(p, 1)).toBeUndefined();
    expect(inCell(p, 1)).toEqual([]);
    expect(p.events.filter((e) => e.tick % 120 === 0 && e.tick < 1920).every((e) => e.tick % 480 !== 0 || e.pick === 'down')).toBe(true);
  });
});

describe('setSlotCount', () => {
  const base = generateRhythm({ ...defaultRhythmParams('syncopatedStabs'), slotCount: 4 }, 'k1');
  const slots = (p: RhythmPattern) => p.events.map((e) => (e.target.kind === 'slot' || e.target.kind === 'dyad' ? e.target.slot : -1));
  const rhythm = (p: RhythmPattern) => p.events.map((e) => [e.tick, e.durationTicks, e.accent, e.palmMute, !!e.tie, e.target.kind]);

  it('folds slots that no longer exist back into range, keeping the rhythm', () => {
    expect(slots(base).some((s) => s >= 2)).toBe(true);
    const reduced = setSlotCount(base, 2);
    expectValid(reduced);
    expect(reduced.params.slotCount).toBe(2);
    expect(rhythm(reduced)).toEqual(rhythm(base));
    expect(slots(reduced)).toEqual(slots(base).map((s) => (s < 0 ? s : s % 2)));
    expect(setSlotCount(base, 4).events).toEqual(base.events);
    expect(setSlotCount(base, 9).params.slotCount).toBe(4);
  });

  it('lets every edit helper recover a pattern whose slotCount was lowered by hand', () => {
    const stale: RhythmPattern = { ...base, params: { ...base.params, slotCount: 2 } };
    expect(validateRhythm(stale).ok).toBe(false);
    expectValid(toggleHit(stale, 7, PEDAL));
    expectValid(clearHit(stale, 3));
    expectValid(cycleAccent(stale, 0));
    expectValid(togglePalmMute(stale, 5));
  });
});

describe('cycleAccent, togglePalmMute, clearHit', () => {
  it('cycles accents 2 -> 0 -> 1 -> 2 and leaves ties alone', () => {
    const a = cycleAccent(sparse(), 0);
    expect(eventAtUnit(a, 0)?.accent).toBe(0);
    expect(eventAtUnit(cycleAccent(a, 0), 0)?.accent).toBe(1);
    expect(eventAtUnit(cycleAccent(cycleAccent(a, 0), 0), 0)?.accent).toBe(2);
    expect(cycleAccent(sparse(), 4).events).toEqual(sparse().events);
  });

  it('toggles palm mute and leaves dead notes and ties alone', () => {
    const p = togglePalmMute(sparse(), 8);
    expect(eventAtUnit(p, 8)?.palmMute).toBe(false);
    expect(eventAtUnit(togglePalmMute(p, 8), 8)?.palmMute).toBe(true);
    const dead = toggleHit(sparse(), 8, { kind: 'dead' });
    expect(eventAtUnit(togglePalmMute(dead, 8), 8)?.palmMute).toBe(false);
    expect(togglePalmMute(sparse(), 4).events).toEqual(sparse().events);
  });

  it('clears a hit and drops ties that depended on it', () => {
    const p = clearHit(sparse({ anticipation: true }), 0);
    expect(p.events.map((e) => e.tick)).toEqual([960]);
    expectValid(p);
  });

  it('switches anticipation on when the first beat is emptied', () => {
    const p = clearHit(sparse(), 0);
    expect(p.params.anticipation).toBe(true);
    expectValid(p);
    expect(sparse().params.anticipation).toBe(false);
  });

  it('recomputes picks for the mode', () => {
    const down = sparse({ picking: 'downstrokes' });
    const p = toggleHit({ ...down, events: down.events.map((e) => ({ ...e, pick: 'down' as const })) }, 3, PEDAL);
    expect(p.events.every((e) => e.pick === 'down')).toBe(true);
    const alt = toggleHit(sparse(), 3, PEDAL);
    expect(eventAtUnit(alt, 3)?.pick).toBe('up');
  });
});

describe('edit helpers on generated patterns', () => {
  it('keep every style valid through a random sequence of edits, without mutating inputs', () => {
    const targets: HitTarget[] = [PEDAL, SLOT0, SLOT1, { kind: 'dyad', slot: 0 }, { kind: 'dead' }];
    for (const style of RHYTHM_STYLE_IDS) {
      for (const grid of ['16th', '16th-triplet'] as const) {
        let p = generateRhythm({ ...defaultRhythmParams(style), grid }, `edit-${style}`);
        const rng = createRng(`edits-${style}-${grid}`);
        const units = patternUnitCount(p);
        for (let step = 0; step < 60; step++) {
          const before = JSON.stringify(p);
          const unit = rng.int(0, units - 1);
          const op = rng.int(0, 3);
          const next =
            op === 0
              ? toggleHit(p, unit, rng.pick(targets))
              : op === 1
                ? cycleAccent(p, unit)
                : op === 2
                  ? togglePalmMute(p, unit)
                  : clearHit(p, unit);
          expect(JSON.stringify(p)).toBe(before);
          expect(next).not.toBe(p);
          expectValid(next);
          p = next;
        }
      }
    }
  });
});
