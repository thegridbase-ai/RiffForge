import React from 'react';
import { VibeMode } from '../types';

interface VibeSelectorProps {
  vibe: VibeMode;
  setVibe: (vibe: VibeMode) => void;
  isDistorted: boolean;
}

export const VibeSelector: React.FC<VibeSelectorProps> = ({ vibe, setVibe, isDistorted }) => {
  return (
    <div className="w-full mb-4">
      <div className="flex justify-between items-end mb-2 px-1">
        <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
          SONIC CHARACTER
        </span>
      </div>
      
      <div className="grid grid-cols-3 gap-1 bg-neutral-900/50 p-1 rounded-lg border border-white/5">
        
        {/* Dark Button */}
        <button
          type="button"
          onClick={() => setVibe(VibeMode.DARK)}
          aria-label="Dark vibe"
          aria-pressed={vibe === VibeMode.DARK}
          className={`
            relative h-10 flex items-center justify-center font-['Oswald'] tracking-widest text-xs font-bold transition-all duration-200
            focus-visible:outline-none focus-visible:ring-2 focus-visible:z-10
            ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}
            ${vibe === VibeMode.DARK
              ? (isDistorted ? 'bg-neutral-800 text-white border border-rose-900/50' : 'bg-neutral-800 text-white border border-cyan-900/50')
              : `text-neutral-400 hover:text-neutral-200 border border-transparent`
            }
          `}
        >
          DARK
          {vibe === VibeMode.DARK && (
             <div className={`absolute bottom-0 w-1/3 h-0.5 ${isDistorted ? 'bg-rose-500' : 'bg-cyan-500'}`}></div>
          )}
        </button>

        {/* Melodic Button */}
        <button
          type="button"
          onClick={() => setVibe(VibeMode.MELODIC)}
          aria-label="Melodic vibe"
          aria-pressed={vibe === VibeMode.MELODIC}
          className={`
            relative h-10 flex items-center justify-center font-['Oswald'] tracking-widest text-xs font-bold transition-all duration-200
            focus-visible:outline-none focus-visible:ring-2 focus-visible:z-10
            ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}
            ${vibe === VibeMode.MELODIC
              ? (isDistorted ? 'bg-neutral-800 text-white border border-rose-900/50' : 'bg-neutral-800 text-white border border-cyan-900/50')
              : `text-neutral-400 hover:text-neutral-200 border border-transparent`
            }
          `}
        >
          MELODIC
          {vibe === VibeMode.MELODIC && (
             <div className={`absolute bottom-0 w-1/3 h-0.5 ${isDistorted ? 'bg-rose-500' : 'bg-cyan-500'}`}></div>
          )}
        </button>

        {/* Energetic Button */}
        <button
          type="button"
          onClick={() => setVibe(VibeMode.ENERGETIC)}
          aria-label="Energetic vibe"
          aria-pressed={vibe === VibeMode.ENERGETIC}
          className={`
            relative h-10 flex items-center justify-center font-['Oswald'] tracking-widest text-xs font-bold transition-all duration-200
            focus-visible:outline-none focus-visible:ring-2 focus-visible:z-10
            ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}
            ${vibe === VibeMode.ENERGETIC
              ? (isDistorted ? 'bg-neutral-800 text-white border border-rose-900/50' : 'bg-neutral-800 text-white border border-cyan-900/50')
              : `text-neutral-400 hover:text-neutral-200 border border-transparent`
            }
          `}
        >
          ENERGETIC
          {vibe === VibeMode.ENERGETIC && (
             <div className={`absolute bottom-0 w-1/3 h-0.5 ${isDistorted ? 'bg-rose-500' : 'bg-cyan-500'}`}></div>
          )}
        </button>

      </div>
    </div>
  );
};



