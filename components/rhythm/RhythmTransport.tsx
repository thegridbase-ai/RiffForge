import React from 'react';
import { MAX_BPM, MIN_BPM } from '../../stores/rhythmStore';
import { SECTION_LABEL, pillClass, type RhythmTheme } from './theme';

export const BPM_STEP = 5;

interface RhythmTransportProps {
  theme: RhythmTheme;
  isPlaying: boolean;
  metronomeOn: boolean;
  bpm: number;
  onPlayToggle: () => void;
  onMetronomeToggle: () => void;
  onBpmChange: (bpm: number) => void;
  onNewIdea: () => void;
  onMutate: () => void;
  onExportMidi: () => void;
}

const roundButton = (theme: RhythmTheme, active: boolean): string => `
  flex items-center justify-center w-11 h-11 rounded-full border transition-all duration-200 ${theme.ring}
  ${active ? `${theme.pillActive}` : 'border-white/15 text-neutral-300 hover:border-white/40 hover:text-white'}
`;

const Icon: React.FC<{ path: React.ReactNode; className?: string }> = ({ path, className = 'w-3.5 h-3.5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

/** Play/stop, metronome, BPM, idea actions and MIDI export. */
export const RhythmTransport: React.FC<RhythmTransportProps> = ({
  theme,
  isPlaying,
  metronomeOn,
  bpm,
  onPlayToggle,
  onMetronomeToggle,
  onBpmChange,
  onNewIdea,
  onMutate,
  onExportMidi
}) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={isPlaying ? 'Stop rhythm' : 'Play rhythm loop'}
        onClick={onPlayToggle}
        className={roundButton(theme, isPlaying)}
      >
        {isPlaying ? (
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" />
          </svg>
        ) : (
          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        aria-label="Metronome"
        aria-pressed={metronomeOn}
        title="Metronome"
        onClick={onMetronomeToggle}
        className={roundButton(theme, metronomeOn)}
      >
        <Icon className="w-4 h-4" path={<><path d="M9 3h6l4 18H5L9 3z" /><line x1="12" y1="15" x2="17" y2="6" /></>} />
      </button>
    </div>

    <div className="flex items-center gap-1" role="group" aria-label="Tempo">
      <button
        type="button"
        aria-label="Decrease rhythm BPM"
        onClick={() => onBpmChange(bpm - BPM_STEP)}
        disabled={bpm <= MIN_BPM}
        className={`${roundButton(theme, false)} text-base disabled:opacity-30 disabled:cursor-not-allowed md:w-8 md:h-8`}
      >
        &minus;
      </button>
      <div className="flex flex-col items-center w-14" aria-live="off">
        <span className={`font-mono text-base font-bold leading-none ${theme.text}`}>{bpm}</span>
        <span className={SECTION_LABEL}>BPM</span>
      </div>
      <button
        type="button"
        aria-label="Increase rhythm BPM"
        onClick={() => onBpmChange(bpm + BPM_STEP)}
        disabled={bpm >= MAX_BPM}
        className={`${roundButton(theme, false)} text-base disabled:opacity-30 disabled:cursor-not-allowed md:w-8 md:h-8`}
      >
        +
      </button>
    </div>

    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onNewIdea} className={pillClass(theme)}>
        <Icon path={<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>} />
        New idea
      </button>
      <button type="button" onClick={onMutate} className={pillClass(theme)}>
        <Icon path={<><path d="M4 7h10l-3-3" /><path d="M20 17H10l3 3" /></>} />
        Mutate
      </button>
      <button type="button" onClick={onExportMidi} aria-label="Export rhythm as MIDI" className={pillClass(theme)}>
        <Icon path={<><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 19h16" /></>} />
        MIDI
      </button>
    </div>
  </div>
);
