import React, { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { RhythmPattern } from '../../engine/types';
import { barUnits, buildGroups, cycleGrouping, isPolymeter } from '../../engine/rhythm/grid';
import { useRhythmStore } from '../../stores/rhythmStore';
import {
  describeCell,
  gridColumns,
  laneIdOf,
  rhythmLanes,
  toggleTargetFor,
  unitPosition,
  type GridColumn,
  type RhythmLane,
  type UnitPosition
} from '../../utils/rhythmSlots';
import { SECTION_LABEL, SEGMENT_GROUP, segmentClass, type RhythmTheme } from './theme';

type EditKind = 'hit' | 'accent' | 'palmMute' | 'clear';

const TOOLS: { id: EditKind; label: string; key: string }[] = [
  { id: 'hit', label: 'Hit', key: 'Space' },
  { id: 'accent', label: 'Accent', key: 'A' },
  { id: 'palmMute', label: 'PM', key: 'P' },
  { id: 'clear', label: 'Clear', key: 'Del' }
];

const TOOL_NAMES: Record<EditKind, string> = { hit: 'Toggle hit', accent: 'Cycle accent', palmMute: 'Toggle palm mute', clear: 'Clear cell' };

interface RhythmGridProps {
  theme: RhythmTheme;
  slotLabels: readonly string[];
  /** One "Chord" lane: the RiffBar chord of the bar plays, not a numbered slot. */
  chordLane?: boolean;
  onAnnounce: (message: string) => void;
}

const GLYPH: Record<string, string> = { pedal: '●', slot: '■', dyad: 'dy', dead: 'x' };

interface CellProps {
  laneIndex: number;
  lane: RhythmLane;
  column: GridColumn;
  position: UnitPosition;
  groupStart: boolean;
  locked: boolean;
  focused: boolean;
  label: string;
  theme: RhythmTheme;
  register: (key: string, el: HTMLDivElement | null) => void;
  onActivate: (laneIndex: number, unit: number) => void;
  onFocusCell: (laneIndex: number, unit: number) => void;
}

const Cell: React.FC<CellProps> = memo(
  ({ laneIndex, lane, column, position, groupStart, locked, focused, label, theme, register, onActivate, onFocusCell }) => {
    const own = column.lane === lane.id ? column.events.filter((e) => laneIdOf(e.target) === lane.id) : [];
    const first = own[0];
    const held = !first && column.heldLane === lane.id;
    const attack = first && !first.tie;
    const kind = first?.target.kind;
    const separator = position.isBarStart
      ? 'border-l-2 border-l-white/40'
      : position.isBeatStart
        ? 'border-l border-l-white/20'
        : 'border-l border-l-white/[0.05]';
    const hitStyle = !first
      ? ''
      : first.tie
        ? `border border-dashed ${theme.border}`
        : kind === 'pedal'
          ? 'bg-neutral-700/60 border border-neutral-400/50'
          : kind === 'dead'
            ? 'border border-dashed border-neutral-400/70'
            : `border ${theme.hitChord}`;

    return (
      <div
        ref={(el) => register(`${laneIndex}:${column.unit}`, el)}
        role="gridcell"
        tabIndex={focused ? 0 : -1}
        aria-label={label}
        onClick={() => onActivate(laneIndex, column.unit)}
        onFocus={() => onFocusCell(laneIndex, column.unit)}
        className={`relative shrink-0 w-[var(--cell)] h-11 md:h-10 cursor-pointer select-none ${separator} ${
          locked ? theme.lockedCell : ''
        } hover:bg-white/[0.04] ${theme.ringInset}`}
      >
        {groupStart && !position.isBarStart && (
          <span aria-hidden="true" className={`absolute inset-y-0 left-0 border-l border-dotted ${theme.groupLine}`} />
        )}
        {held && <span aria-hidden="true" className="absolute left-0 right-1 top-1/2 h-0.5 -translate-y-1/2 bg-neutral-500/70" />}
        {first && (
          <span
            aria-hidden="true"
            className={`absolute inset-[3px] rounded-sm flex flex-col items-center justify-between py-px font-mono leading-none ${hitStyle}`}
          >
            <span className="h-2.5 text-[9px] font-bold text-neutral-100">{attack && first.accent > 0 ? '>'.repeat(first.accent) : ''}</span>
            <span className={`text-[11px] font-bold ${kind === 'pedal' || kind === 'dead' || first.tie ? 'text-neutral-100' : theme.hitGlyph}`}>
              {first.tie ? '~' : GLYPH[kind ?? 'slot']}
            </span>
            <span className="h-2.5 text-[8px] text-neutral-200 tracking-tighter whitespace-nowrap">
              {attack && first.palmMute ? 'PM' : ''}
              {attack ? own.filter((e) => !e.tie).map((e) => (e.pick === 'down' ? '↓' : '↑')).join('') : ''}
            </span>
          </span>
        )}
      </div>
    );
  }
);
Cell.displayName = 'RhythmGridCell';

/** Playhead column highlight; subscribes on its own so the grid does not re-render on every step. */
const Playhead: React.FC<{ theme: RhythmTheme; reduceMotion: boolean }> = ({ theme, reduceMotion }) => {
  const unit = useRhythmStore((s) => s.playheadUnit);
  const isPlaying = useRhythmStore((s) => s.isPlaying);
  const previous = useRef(-1);
  const wrapped = unit < previous.current;
  useEffect(() => {
    previous.current = unit;
  }, [unit]);
  if (!isPlaying || unit < 0) return null;
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-[var(--cell)] ${theme.playhead} ${
        reduceMotion || wrapped ? '' : 'transition-transform duration-75 ease-linear'
      }`}
      style={{ transform: `translateX(calc(var(--label) + var(--cell) * ${unit}))` }}
    />
  );
};

const groupSummary = (pattern: RhythmPattern): string => {
  const sizes = cycleGrouping(pattern.params, pattern.seed);
  const unit = pattern.params.grid === '16th-triplet' ? '16th triplets' : '16ths';
  const meter = `${pattern.meter.numerator}/${pattern.meter.denominator}`;
  const cycle = sizes.reduce((a, b) => a + b, 0);
  return isPolymeter(pattern.params)
    ? `Accent groups ${sizes.join('+')} (${unit}): a ${cycle}-unit cycle drifting over ${meter}`
    : `Accent groups ${sizes.join('+')} (${unit}) per ${cycle === barUnits(pattern.meter, pattern.params.grid) ? 'bar' : 'cycle'} in ${meter}`;
};

/**
 * The rhythm grid: one lane per target (Pedal, Slot 1..N, Dead), one column per grid unit. A single tab stop
 * (role="grid", roving tabindex): arrows move, Home/End jump, PageUp/PageDown move a bar, Space or Enter
 * toggles a hit in the lane, A cycles the accent, P toggles palm mute, Delete/Backspace clears. Clicks and
 * taps apply the selected tool.
 */
export const RhythmGrid: React.FC<RhythmGridProps> = ({ theme, slotLabels, chordLane = false, onAnnounce }) => {
  const pattern = useRhythmStore((s) => s.pattern);
  const lockedBars = useRhythmStore((s) => s.lockedBars);
  const toggleLockBar = useRhythmStore((s) => s.toggleLockBar);
  const reduceMotion = useReducedMotion() ?? false;
  const hintId = useId();
  const [tool, setTool] = useState<EditKind>('hit');

  const columns = useMemo(() => gridColumns(pattern), [pattern]);
  const positions = useMemo(
    () => columns.map((c) => unitPosition(c.unit, pattern.meter, pattern.params.grid)),
    [columns, pattern.meter, pattern.params.grid]
  );
  const lanes = useMemo(
    () => rhythmLanes(pattern.params.slotCount, slotLabels, chordLane),
    [pattern.params.slotCount, slotLabels, chordLane]
  );
  const groups = useMemo(() => buildGroups(pattern.params, pattern.seed), [pattern.params, pattern.seed]);
  const groupStarts = useMemo(() => new Map(groups.map((g) => [g.startUnit, g.length])), [groups]);
  const unitsPerBar = barUnits(pattern.meter, pattern.params.grid);
  const lockedSet = useMemo(() => new Set(lockedBars), [lockedBars]);

  const [focus, setFocus] = useState({ lane: 0, unit: 0 });
  const laneIndex = Math.min(focus.lane, lanes.length - 1);
  const unitIndex = Math.min(focus.unit, columns.length - 1);
  const cells = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef(false);

  const register = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) cells.current.set(key, el);
    else cells.current.delete(key);
  }, []);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const el = cells.current.get(`${laneIndex}:${unitIndex}`);
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [laneIndex, unitIndex]);

  // Latest values for the stable callbacks the memoized cells receive
  const latest = useRef({ lanes, columns, tool, pattern });
  latest.current = { lanes, columns, tool, pattern };

  const applyEdit = useCallback(
    (kind: EditKind, l: number, u: number) => {
      const { lanes: ls, columns: cs } = latest.current;
      const lane = ls[l];
      const column = cs[u];
      if (!lane || !column) return;
      const store = useRhythmStore.getState();
      const before = store.pattern;
      if (kind === 'hit') store.toggleHitAt(u, toggleTargetFor(lane, column));
      else if (kind === 'accent') store.cycleAccentAt(u);
      else if (kind === 'palmMute') store.togglePalmMuteAt(u);
      else store.clearHitAt(u);

      const after = useRhythmStore.getState().pattern;
      const position = unitPosition(u, after.meter, after.params.grid);
      const nextColumn = gridColumns(after)[u];
      if (JSON.stringify(after.events) === JSON.stringify(before.events)) {
        onAnnounce(`${TOOL_NAMES[kind]}: nothing to change here. ${describeCell(position, lane, nextColumn)}`);
        return;
      }
      const nextLanes = rhythmLanes(after.params.slotCount, slotLabels, chordLane);
      const owner = nextLanes.find((x) => x.id === nextColumn.lane) ?? lane;
      onAnnounce(describeCell(position, owner, nextColumn));
    },
    [onAnnounce, slotLabels, chordLane]
  );

  const onFocusCell = useCallback((l: number, u: number) => {
    setFocus((f) => (f.lane === l && f.unit === u ? f : { lane: l, unit: u }));
  }, []);

  const onActivate = useCallback(
    (l: number, u: number) => {
      setFocus({ lane: l, unit: u });
      applyEdit(latest.current.tool, l, u);
    },
    [applyEdit]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey) return;
    let l = laneIndex;
    let u = unitIndex;
    const key = e.key;
    if ((key === ' ' || key === 'Enter') && !e.ctrlKey) {
      e.preventDefault();
      applyEdit('hit', l, u);
      return;
    }
    if ((key === 'a' || key === 'A') && !e.ctrlKey) {
      e.preventDefault();
      applyEdit('accent', l, u);
      return;
    }
    if ((key === 'p' || key === 'P') && !e.ctrlKey) {
      e.preventDefault();
      applyEdit('palmMute', l, u);
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      applyEdit('clear', l, u);
      return;
    }
    switch (key) {
      case 'ArrowUp':
        l -= 1;
        break;
      case 'ArrowDown':
        l += 1;
        break;
      case 'ArrowLeft':
        u -= 1;
        break;
      case 'ArrowRight':
        u += 1;
        break;
      case 'Home':
        u = 0;
        if (e.ctrlKey) l = 0;
        break;
      case 'End':
        u = columns.length - 1;
        if (e.ctrlKey) l = lanes.length - 1;
        break;
      case 'PageUp':
        u -= unitsPerBar;
        break;
      case 'PageDown':
        u += unitsPerBar;
        break;
      default:
        return;
    }
    e.preventDefault();
    const next = { lane: Math.max(0, Math.min(lanes.length - 1, l)), unit: Math.max(0, Math.min(columns.length - 1, u)) };
    pendingFocus.current = true;
    setFocus(next);
    if (next.lane === laneIndex && next.unit === unitIndex) {
      pendingFocus.current = false;
      cells.current.get(`${laneIndex}:${unitIndex}`)?.focus();
    }
  };

  const bars = Array.from({ length: pattern.bars }, (_, b) => b);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-2 px-1">
        <div role="group" aria-label="Tap tool" className="min-w-0">
          <span className={`${SECTION_LABEL} block mb-1.5`} aria-hidden="true">
            Tap tool
          </span>
          <div className={`${SEGMENT_GROUP} grid-cols-4 w-full max-w-xs`}>
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tool === t.id}
                aria-label={`Tap tool: ${TOOL_NAMES[t.id]} (key ${t.key})`}
                onClick={() => setTool(t.id)}
                className={segmentClass(theme, tool === t.id)}
              >
                {t.label}
                {tool === t.id && <span aria-hidden="true" className={`absolute bottom-0 w-1/3 h-0.5 ${theme.underline}`} />}
              </button>
            ))}
          </div>
        </div>
        <p id={hintId} className="font-mono text-[10px] text-neutral-400 leading-relaxed max-w-md">
          Keys: arrows move, Home/End jump, PgUp/PgDn bar, Space hit, A accent, P palm mute, Del clears.
        </p>
      </div>

      <div
        className="overflow-x-auto overscroll-x-contain rounded-lg border border-white/5 bg-black/50 [--cell:44px] md:[--cell:28px] lg:[--cell:32px] [--label:52px] md:[--label:116px]"
        style={theme.scrollbar}
      >
        <div className="min-w-max">
          {/* Bars with lock toggles: outside the grid so the grid stays one tab stop */}
          <div className="flex items-stretch border-b border-white/5">
            <div className={`sticky left-0 z-20 w-[var(--label)] shrink-0 bg-neutral-950 px-2 flex items-center ${SECTION_LABEL}`}>
              Bar
            </div>
            {bars.map((b) => {
              const locked = lockedSet.has(b);
              return (
                <div
                  key={b}
                  className="flex items-center gap-2 pl-1.5 pr-1 py-1 border-l-2 border-l-white/40"
                  style={{ width: `calc(var(--cell) * ${unitsPerBar})` }}
                >
                  <span className="font-['Oswald'] text-xs font-bold uppercase tracking-widest text-neutral-200">Bar {b + 1}</span>
                  <button
                    type="button"
                    aria-pressed={locked}
                    aria-label={`Lock bar ${b + 1} when generating new ideas`}
                    onClick={() => toggleLockBar(b)}
                    className={`inline-flex items-center gap-1 px-2 min-h-[44px] md:min-h-0 md:h-7 rounded-full border font-mono text-[10px] uppercase tracking-widest transition-colors ${theme.ring} ${
                      locked ? theme.pillActive : 'border-white/10 text-neutral-400 hover:text-neutral-100 hover:border-white/30'
                    }`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="10" rx="1" />
                      <path d={locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} />
                    </svg>
                    {locked ? 'Locked' : 'Lock'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Accent groups (visual brackets; the summary below says the same in words) */}
          <div className="flex border-b border-white/5" aria-hidden="true">
            <div className={`sticky left-0 z-20 w-[var(--label)] shrink-0 bg-neutral-950 px-2 flex items-center ${SECTION_LABEL}`}>
              Groups
            </div>
            {columns.map((c) => {
              const length = groupStarts.get(c.unit);
              return (
                <div
                  key={c.unit}
                  className={`shrink-0 w-[var(--cell)] h-5 border-t-2 ${theme.groupLine} ${length ? `border-l-2 ${theme.groupMark}` : ''} font-mono text-[9px] pl-0.5 leading-4`}
                >
                  {length ?? ''}
                </div>
              );
            })}
          </div>

          <div
            role="grid"
            aria-label={`Rhythm grid, ${pattern.bars} bar${pattern.bars === 1 ? '' : 's'} of ${pattern.meter.numerator}/${pattern.meter.denominator}`}
            aria-describedby={hintId}
            onKeyDown={onKeyDown}
            className="relative"
          >
            <Playhead theme={theme} reduceMotion={reduceMotion} />
            <div role="row" className="flex border-b border-white/10">
              <div role="columnheader" className={`sticky left-0 z-20 w-[var(--label)] shrink-0 bg-neutral-950 px-2 flex items-center ${SECTION_LABEL}`}>
                Count
              </div>
              {positions.map((p, u) => (
                <div
                  key={u}
                  role="columnheader"
                  aria-label={`Bar ${p.bar}, beat ${p.beat}${p.sub ? `, ${p.sub}` : ''}`}
                  className={`shrink-0 w-[var(--cell)] h-6 flex items-center justify-center font-mono ${
                    p.isBarStart ? 'border-l-2 border-l-white/40' : p.isBeatStart ? 'border-l border-l-white/20' : 'border-l border-l-white/[0.05]'
                  } ${p.isBeatStart ? 'text-[11px] font-bold text-neutral-100' : 'text-[9px] text-neutral-400'}`}
                >
                  {p.label}
                </div>
              ))}
            </div>
            {lanes.map((lane, l) => (
              <div role="row" key={lane.id} className="flex border-b border-white/[0.06] last:border-b-0">
                <div
                  role="rowheader"
                  aria-label={lane.spoken}
                  className="sticky left-0 z-20 w-[var(--label)] shrink-0 bg-neutral-950 px-2 flex items-center font-mono text-[10px] uppercase tracking-wider text-neutral-300"
                >
                  <span className="md:hidden">{lane.short}</span>
                  <span className="hidden md:inline truncate">{lane.label}</span>
                </div>
                {columns.map((column, u) => (
                  <Cell
                    key={u}
                    laneIndex={l}
                    lane={lane}
                    column={column}
                    position={positions[u]}
                    groupStart={groupStarts.has(u)}
                    locked={lockedSet.has(Math.floor(u / unitsPerBar))}
                    focused={l === laneIndex && u === unitIndex}
                    label={describeCell(positions[u], lane, column)}
                    theme={theme}
                    register={register}
                    onActivate={onActivate}
                    onFocusCell={onFocusCell}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 px-1 flex flex-col gap-1 font-mono text-[10px] text-neutral-400 leading-relaxed">
        <p>{groupSummary(pattern)}</p>
        <p aria-hidden="true">
          <span className="text-neutral-200">{GLYPH.slot}</span> chord <span className="text-neutral-200 ml-2">dy</span> dyad{' '}
          <span className="text-neutral-200 ml-2">{GLYPH.pedal}</span> pedal <span className="text-neutral-200 ml-2">x</span> dead{' '}
          <span className="text-neutral-200 ml-2">~</span> tie <span className="text-neutral-200 ml-2">&gt; &gt;&gt;</span> accent{' '}
          <span className="text-neutral-200 ml-2">PM</span> palm mute <span className="text-neutral-200 ml-2">{'↓↑'}</span> pick{' '}
          <span className="text-neutral-200 ml-2">&mdash;</span> held
        </p>
      </div>
    </div>
  );
};
