import type React from 'react';

/** Accent classes for the Rhythm Lab. Clean channel = cyan, Distortion channel = rose (full literals for Tailwind). */
export interface RhythmTheme {
  ring: string;
  ringColor: string;
  ringInset: string;
  text: string;
  textStrong: string;
  border: string;
  segmentActive: string;
  underline: string;
  pillActive: string;
  rangeAccent: string;
  hitChord: string;
  hitGlyph: string;
  groupMark: string;
  groupLine: string;
  playhead: string;
  lockedCell: string;
  scrollbar: React.CSSProperties;
  glow: string;
}

const CYAN: RhythmTheme = {
  ring: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-cyan-500',
  ringColor: 'focus-visible:ring-cyan-500',
  ringInset: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400',
  text: 'text-cyan-400',
  textStrong: 'text-cyan-500',
  border: 'border-cyan-500/60',
  segmentActive: 'bg-neutral-800 text-white border border-cyan-900/50',
  underline: 'bg-cyan-500',
  pillActive: 'bg-cyan-500/20 border-cyan-500/60 text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.3)]',
  rangeAccent: 'accent-cyan-500',
  hitChord: 'bg-cyan-500/25 border-cyan-400/70',
  hitGlyph: 'text-cyan-100',
  groupMark: 'border-cyan-400 text-cyan-300',
  groupLine: 'border-cyan-500/40',
  playhead: 'bg-cyan-400/15 border-x border-cyan-400/70',
  lockedCell: 'bg-cyan-500/[0.04]',
  scrollbar: { scrollbarWidth: 'thin', scrollbarColor: 'rgba(34,211,238,0.3) transparent' },
  glow: '0 0 8px rgba(8, 145, 178, 0.6)'
};

const ROSE: RhythmTheme = {
  ring: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-rose-500',
  ringColor: 'focus-visible:ring-rose-500',
  ringInset: 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-400',
  text: 'text-rose-400',
  textStrong: 'text-rose-500',
  border: 'border-rose-500/60',
  segmentActive: 'bg-neutral-800 text-white border border-rose-900/50',
  underline: 'bg-rose-500',
  pillActive: 'bg-rose-500/20 border-rose-500/60 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)]',
  rangeAccent: 'accent-rose-500',
  hitChord: 'bg-rose-500/25 border-rose-400/70',
  hitGlyph: 'text-rose-100',
  groupMark: 'border-rose-400 text-rose-300',
  groupLine: 'border-rose-500/40',
  playhead: 'bg-rose-400/15 border-x border-rose-400/70',
  lockedCell: 'bg-rose-500/[0.05]',
  scrollbar: { scrollbarWidth: 'thin', scrollbarColor: 'rgba(244,63,94,0.3) transparent' },
  glow: '0 0 8px rgba(225, 29, 72, 0.6)'
};

export const rhythmTheme = (isDistorted: boolean): RhythmTheme => (isDistorted ? ROSE : CYAN);

/** Small meaningful labels use neutral-400 (>= 4.5:1 on the dark panels). */
export const SECTION_LABEL = 'text-[10px] font-mono text-neutral-400 uppercase tracking-widest';

/** RiffBar pill, with a 44 px touch height below md. */
export const pillClass = (theme: RhythmTheme, active = false): string => `
  inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] md:min-h-0 md:h-8 rounded-full border
  font-mono text-[10px] uppercase tracking-widest transition-all duration-200
  disabled:opacity-40 disabled:cursor-not-allowed ${theme.ring}
  ${active ? theme.pillActive : 'border-white/10 text-neutral-300 hover:text-white hover:border-white/30'}
`;

/** Segmented-selector option (TuningSelector / VibeSelector look). */
export const segmentClass = (theme: RhythmTheme, active: boolean): string => `
  relative min-h-[44px] md:min-h-0 md:h-10 px-2 flex items-center justify-center text-center
  font-['Oswald'] tracking-widest text-xs font-bold uppercase transition-all duration-200
  focus-visible:outline-none focus-visible:ring-2 focus-visible:z-10 ${theme.ringColor}
  ${active ? theme.segmentActive : 'text-neutral-400 hover:text-neutral-200 border border-transparent'}
`;

export const SEGMENT_GROUP = 'grid gap-1 bg-neutral-900/50 p-1 rounded-lg border border-white/5';
