import React from 'react';
import type { FingerNumber, Tuning } from '../engine/types';
import { pitchClassName } from '../engine/pitch';

interface VoicingTabProps {
  shape: readonly (number | null)[];
  fingers: readonly (FingerNumber | null)[];
  degreesByString: readonly (string | null)[];
  tuning: Tuning;
  isDistorted: boolean;
  compact?: boolean;
}

const FINGER_LABEL: Record<FingerNumber, string> = { 0: 'T', 1: '1', 2: '2', 3: '3', 4: '4' };
const FINGER_NAME: Record<FingerNumber, string> = { 0: 'thumb', 1: 'index', 2: 'middle', 3: 'ring', 4: 'pinky' };

/** Screen-reader summary, low string first: "E string open, A string fret 2 middle finger, ...". */
export const describeVoicing = (
  shape: readonly (number | null)[],
  fingers: readonly (FingerNumber | null)[],
  tuning: Tuning
): string =>
  shape
    .map((fret, s) => {
      const string = `${pitchClassName(tuning.openMidi[s])} string`;
      if (fret === null) return `${string} muted`;
      if (fret === 0) return `${string} open`;
      const finger = fingers[s];
      return `${string} fret ${fret}${finger !== null && finger !== undefined ? ` ${FINGER_NAME[finger]} finger` : ''}`;
    })
    .join(', ');

/** Tab grid, low string on the left: string names, frets, finger numbers and degrees per string. */
export const VoicingTab: React.FC<VoicingTabProps> = ({ shape, fingers, degreesByString, tuning, isDistorted, compact = false }) => {
  const accent = isDistorted ? 'text-rose-500' : 'text-cyan-500';
  const glow = isDistorted ? '0 0 8px rgba(225, 29, 72, 0.6)' : '0 0 8px rgba(8, 145, 178, 0.6)';
  const cell = compact ? 'w-6' : 'w-7';
  const rowLabel = 'w-11 shrink-0 text-left font-mono text-[11px] uppercase tracking-wider text-neutral-400';

  return (
    <div>
      <p className="sr-only">{describeVoicing(shape, fingers, tuning)}</p>
      <div aria-hidden="true" className="font-mono select-none">
        <div className="flex items-center">
          <span className={rowLabel}>Str</span>
          {shape.map((_, s) => (
            <span key={s} className={`${cell} text-center text-[11px] text-neutral-400`}>
              {pitchClassName(tuning.openMidi[s])}
            </span>
          ))}
        </div>
        <div className="flex items-center">
          <span className={rowLabel}>Fret</span>
          {shape.map((fret, s) => (
            <span
              key={s}
              className={`${cell} text-center font-bold ${compact ? 'text-sm' : 'text-base'} ${fret === null ? 'text-neutral-400' : accent}`}
              style={fret === null ? undefined : { textShadow: glow }}
            >
              {fret === null ? 'x' : fret}
            </span>
          ))}
        </div>
        <div className="flex items-center">
          <span className={rowLabel}>Fing</span>
          {fingers.map((finger, s) => (
            <span key={s} className={`${cell} text-center text-[11px] text-neutral-300`}>
              {finger === null || finger === undefined ? '·' : FINGER_LABEL[finger]}
            </span>
          ))}
        </div>
        <div className="flex items-center">
          <span className={rowLabel}>Deg</span>
          {degreesByString.map((degree, s) => (
            <span key={s} className={`${cell} text-center text-[11px] text-neutral-400`}>
              {degree ?? ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
