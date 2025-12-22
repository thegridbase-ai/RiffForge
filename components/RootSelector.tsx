import React from 'react';
import { NOTES } from '../constants';

interface RootSelectorProps {
  selectedRoot: string;
  onSelectRoot: (root: string) => void;
  isDistorted: boolean;
}

export const RootSelector: React.FC<RootSelectorProps> = ({ selectedRoot, onSelectRoot, isDistorted }) => {
  return (
    <div className="w-full mb-8">
      <div className="flex justify-between items-end mb-2 px-1">
        <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">
          MASTER TUNING
        </span>
        <span className={`text-xs font-mono font-bold ${isDistorted ? 'text-rose-500' : 'text-cyan-500'}`}>
           KEY: {selectedRoot}
        </span>
      </div>
      
      {/* 
        Grid Layout Update:
        - grid-cols-12: Ensures exactly 1 row on larger screens for 12 notes.
        - grid-cols-6: Breaks into 2 even rows on mobile.
        - gap-1: Small gap for separation.
        - Buttons are strictly w-full to fill their grid cell equally.
      */}
      <div className="grid grid-cols-6 md:grid-cols-12 gap-1 bg-neutral-900/50 p-1 rounded-lg border border-white/5">
        {NOTES.map((note) => {
            const isSelected = selectedRoot === note;
            return (
                <button
                    key={note}
                    onClick={() => onSelectRoot(note)}
                    className={`
                        group relative w-full h-10 md:h-12 flex items-center justify-center 
                        font-mono text-sm font-bold transition-all duration-200 overflow-hidden
                        ${isSelected 
                            ? (isDistorted ? 'bg-rose-600 text-white shadow-[0_0_15px_rgba(225,29,72,0.5)]' : 'bg-cyan-600 text-white shadow-[0_0_15px_rgba(8,145,178,0.5)]')
                            : 'bg-neutral-800 text-neutral-500 hover:bg-neutral-700 hover:text-neutral-200'
                        }
                    `}
                >
                    <span className="relative z-10">{note}</span>
                    
                    {/* Active Indicator Line */}
                    {isSelected && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/50"></div>
                    )}
                    
                    {/* Subtle Hover Glint */}
                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                </button>
            );
        })}
      </div>
    </div>
  );
};