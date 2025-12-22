import React from 'react';
import { Chord } from '../types';

interface ChordCardProps {
  chord: Chord;
  isDistorted: boolean;
  onPlay: (chord: Chord) => void;
}

export const ChordCard: React.FC<ChordCardProps> = ({ chord, isDistorted, onPlay }) => {
  return (
    <button
      onClick={() => onPlay(chord)}
      className={`
        relative overflow-hidden p-6 text-left transition-all duration-200 group
        border border-opacity-20 hover:border-opacity-60 active:scale-95 w-full h-full flex flex-col justify-between
        ${isDistorted 
          ? 'bg-neutral-900 border-rose-900 hover:border-rose-500 hover:bg-rose-900/10' 
          : 'bg-neutral-900 border-neutral-700 hover:border-cyan-500 hover:bg-cyan-900/10'
        }
      `}
    >
      {/* Background Number Faded */}
      <span className="absolute -right-4 -bottom-8 text-9xl font-['Oswald'] font-bold text-white opacity-[0.03] select-none pointer-events-none group-hover:opacity-[0.07] transition-opacity">
        {chord.id.substring(0, 2).toUpperCase()}
      </span>

      <div className="relative z-10 w-full">
        <h3 className={`font-['Oswald'] text-2xl uppercase tracking-wide mb-1 ${isDistorted ? 'group-hover:text-rose-400' : 'group-hover:text-cyan-400'}`}>
          {chord.name}
        </h3>
        <p className="font-['Share_Tech_Mono'] text-xs text-neutral-500 mb-4 tracking-wider">
          {chord.subtext}
        </p>
        
        <div className="flex items-end justify-between mb-4">
          <p className="text-sm text-neutral-400 font-light leading-snug max-w-[80%]">
            {chord.description}
          </p>
          
          {/* Play Icon */}
          <div className={`
            shrink-0 w-8 h-8 flex items-center justify-center rounded-full border 
            ${isDistorted ? 'border-rose-900 text-rose-500' : 'border-neutral-700 text-neutral-500'}
            group-hover:border-current transition-colors
          `}>
            <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      </div>
        
      {/* Fretboard Data (Technical look) - Pushed to bottom via flex layout */}
      <div className="relative z-10 w-full pt-3 border-t border-white/5 flex justify-between items-center mt-auto">
         <span className="font-mono text-[10px] text-neutral-600 opacity-60">TABLATURE</span>
         <span className={`font-mono text-sm tracking-[0.25em] font-bold ${
            isDistorted 
              ? 'text-rose-500 drop-shadow-[0_0_8px_rgba(225,29,72,0.6)]' 
              : 'text-cyan-500 drop-shadow-[0_0_8px_rgba(8,145,178,0.6)]'
         }`}>
            {chord.fretboard}
         </span>
      </div>
    </button>
  );
};