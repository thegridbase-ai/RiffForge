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
      <div className="grid grid-cols-6 md:grid-cols-12 gap-1.5 bg-neutral-900/50 p-1.5 rounded-lg border border-white/5">
        {NOTES.map((note) => {
            const isSelected = selectedRoot === note;
            return (
                <button
                    key={note}
                    type="button"
                    onClick={() => onSelectRoot(note)}
                    aria-label={`Root note ${note}`}
                    aria-pressed={isSelected}
                    className={`
                        group relative w-full h-10 md:h-12 flex items-center justify-center
                        font-mono text-sm font-bold transition-all duration-300 overflow-hidden
                        rounded-sm
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:z-10
                        ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}
                        ${isSelected ? 'active:scale-95' : 'active:scale-[0.98]'}
                    `}
                    style={{
                      ...(isSelected 
                        ? isDistorted
                          ? {
                              background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.9) 0%, rgba(185, 28, 28, 0.95) 100%)',
                              border: '1px solid rgba(239, 68, 68, 0.8)',
                              boxShadow: '0 0 20px rgba(239, 68, 68, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 2px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.4)',
                              color: '#ffffff',
                              textShadow: '0 0 8px rgba(239, 68, 68, 0.8)'
                            }
                          : {
                              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.9) 0%, rgba(14, 116, 144, 0.95) 100%)',
                              border: '1px solid rgba(6, 182, 212, 0.8)',
                              boxShadow: '0 0 20px rgba(6, 182, 212, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 2px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.4)',
                              color: '#ffffff',
                              textShadow: '0 0 8px rgba(6, 182, 212, 0.8)'
                            }
                        : {
                            background: 'linear-gradient(135deg, rgba(38, 38, 38, 0.9) 0%, rgba(23, 23, 23, 0.95) 100%)',
                            border: '1px solid rgba(82, 82, 82, 0.4)',
                            boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.5), inset 0 -1px 2px rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.3)',
                            color: '#a3a3a3'
                          }
                      )
                    }}
                >
                    {/* Retro Button Inner Glow - Selected State */}
                    {isSelected && (
                      <div 
                        className="absolute inset-0 opacity-30"
                        style={{
                          background: isDistorted
                            ? 'radial-gradient(circle at center, rgba(239, 68, 68, 0.4) 0%, transparent 70%)'
                            : 'radial-gradient(circle at center, rgba(6, 182, 212, 0.4) 0%, transparent 70%)',
                          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                        }}
                      />
                    )}
                    
                    {/* Retro Button Highlight - Top Edge */}
                    <div 
                      className="absolute top-0 left-0 right-0 h-px pointer-events-none"
                      style={{
                        background: isSelected
                          ? isDistorted
                            ? 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent)'
                            : 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent)'
                          : 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent)'
                      }}
                    />
                    
                    <span className="relative z-10">{note}</span>
                    
                    {/* Hover Effect - Retro Glint */}
                    <div 
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
                      style={{
                        background: isSelected
                          ? 'none'
                          : 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, transparent 50%)'
                      }}
                    />
                </button>
            );
        })}
      </div>
    </div>
  );
};