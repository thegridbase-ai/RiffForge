import React from 'react';
import { TuningMode } from '../types';

interface TuningSelectorProps {
  tuning: TuningMode;
  setTuning: (tuning: TuningMode) => void;
  isDistorted: boolean;
}

export const TuningSelector: React.FC<TuningSelectorProps> = ({ tuning, setTuning, isDistorted }) => {
  return (
    <div className="w-full mb-4">
      <div className="flex justify-between items-end mb-2 px-1">
        <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
          STRING TENSION
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-1 bg-neutral-900/50 p-1 rounded-lg border border-white/5">
        
        {/* Standard Button */}
        <button
          onClick={() => setTuning(TuningMode.STANDARD)}
          className={`
            relative h-10 flex items-center justify-center font-['Oswald'] tracking-widest text-sm font-bold transition-all duration-200
            ${tuning === TuningMode.STANDARD
              ? (isDistorted ? 'bg-neutral-800 text-white border border-rose-900/50' : 'bg-neutral-800 text-white border border-cyan-900/50')
              : 'text-neutral-600 hover:text-neutral-400'
            }
          `}
        >
          STANDARD
          {tuning === TuningMode.STANDARD && (
             <div className={`absolute bottom-0 w-1/3 h-0.5 ${isDistorted ? 'bg-rose-500' : 'bg-cyan-500'}`}></div>
          )}
        </button>

        {/* Drop Button */}
        <button
          onClick={() => setTuning(TuningMode.DROP)}
          className={`
            relative h-10 flex items-center justify-center font-['Oswald'] tracking-widest text-sm font-bold transition-all duration-200
            ${tuning === TuningMode.DROP
              ? (isDistorted ? 'bg-neutral-800 text-white border border-rose-900/50' : 'bg-neutral-800 text-white border border-cyan-900/50')
              : 'text-neutral-600 hover:text-neutral-400'
            }
          `}
        >
          DROP
          {tuning === TuningMode.DROP && (
             <div className={`absolute bottom-0 w-1/3 h-0.5 ${isDistorted ? 'bg-rose-500' : 'bg-cyan-500'}`}></div>
          )}
        </button>

      </div>
    </div>
  );
};