// Picking guidance. Validation recomputes picks with this same function, so it must stay pure and positional.
import type { PickingMode } from '../types';
import { SIXTEENTH_TICKS, THIRTY_SECOND_TICKS, TRIPLET_UNIT_TICKS } from './grid';

type Pick = 'down' | 'up';

const flip = (pick: Pick): Pick => (pick === 'down' ? 'up' : 'down');
const byParity = (index: number): Pick => (index % 2 === 0 ? 'down' : 'up');

/**
 * 'downstrokes': every pick down.
 * 'alternate' (pendulum keyed to the grid; state resets at every barline, so a bar's picks never depend on
 * its neighbours and bar-relative positions are used throughout):
 * - a note less than a sixteenth from a neighbour in its bar belongs to a fast run and takes the parity of
 *   its position on that run's subdivision (sixteenth triplets when the gap is a triplet unit, else 32nds).
 *   Runs therefore alternate strictly, a missing note leaves a ghost stroke instead of inverting the rest,
 *   and every beat start (a multiple of both subdivisions) stays a downstroke;
 * - any other on-grid note (tick % 120 === 0) is down on even sixteenths and up on odd ones;
 * - any other off-grid note (eighth-note triplets) alternates from the previous note's pick, or, first in
 *   its bar, takes the parity of its own 32nd or triplet position.
 */
export const assignPicks = (events: readonly { tick: number }[], mode: PickingMode, barLengthTicks: number): Pick[] => {
  if (mode === 'downstrokes') return events.map(() => 'down');
  const barOf = (tick: number) => Math.floor(tick / barLengthTicks);
  const gapTo = (i: number, j: number): number =>
    j >= 0 && j < events.length && barOf(events[j].tick) === barOf(events[i].tick)
      ? Math.abs(events[j].tick - events[i].tick)
      : Infinity;
  const picks: Pick[] = [];
  let prevPick: Pick | null = null;
  let prevBar = -1;
  events.forEach(({ tick }, i) => {
    const bar = barOf(tick);
    if (bar !== prevBar) {
      prevPick = null;
      prevBar = bar;
    }
    const rel = tick - bar * barLengthTicks;
    const gaps = [gapTo(i, i - 1), gapTo(i, i + 1)].filter((g) => g > 0);
    const fastGap = Math.min(...gaps);
    let pick: Pick;
    if (fastGap < SIXTEENTH_TICKS) {
      if (fastGap % TRIPLET_UNIT_TICKS === 0 && rel % TRIPLET_UNIT_TICKS === 0) pick = byParity(rel / TRIPLET_UNIT_TICKS);
      else if (rel % THIRTY_SECOND_TICKS === 0) pick = byParity(rel / THIRTY_SECOND_TICKS);
      else if (rel % TRIPLET_UNIT_TICKS === 0) pick = byParity(rel / TRIPLET_UNIT_TICKS);
      else pick = prevPick === null ? 'down' : flip(prevPick);
    } else if (rel % SIXTEENTH_TICKS === 0) {
      pick = byParity(rel / SIXTEENTH_TICKS);
    } else if (prevPick !== null) {
      pick = flip(prevPick);
    } else if (rel % THIRTY_SECOND_TICKS === 0) {
      pick = byParity(rel / THIRTY_SECOND_TICKS);
    } else if (rel % TRIPLET_UNIT_TICKS === 0) {
      pick = byParity(rel / TRIPLET_UNIT_TICKS);
    } else {
      pick = flip(byParity(Math.floor(rel / SIXTEENTH_TICKS)));
    }
    picks.push(pick);
    prevPick = pick;
  });
  return picks;
};
