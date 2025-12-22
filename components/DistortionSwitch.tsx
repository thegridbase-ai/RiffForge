import React from 'react';

interface DistortionSwitchProps {
  isDistorted: boolean;
  onChange: (mode: boolean) => void;
}

export const DistortionSwitch: React.FC<DistortionSwitchProps> = ({ isDistorted, onChange }) => {
  return (
    <div className="flex w-full gap-2 md:gap-4 h-24 mx-auto">
      {/* Clean Channel Button */}
      <button
        onClick={() => onChange(false)}
        className={`
          relative flex-1 group flex flex-col items-center justify-center border-2 transition-all duration-300 overflow-hidden
          ${!isDistorted 
            ? 'border-cyan-500 bg-cyan-950/30 shadow-[0_0_20px_rgba(8,145,178,0.3)]' 
            : 'border-neutral-800 bg-neutral-900/20 opacity-60 hover:opacity-100 hover:border-neutral-700 grayscale'
          }
        `}
      >
        <span className={`text-[10px] font-mono mb-1 tracking-widest ${!isDistorted ? 'text-cyan-400' : 'text-neutral-500'}`}>CHANNEL A</span>
        <span className={`text-2xl md:text-3xl font-['Oswald'] uppercase ${!isDistorted ? 'text-cyan-100 drop-shadow-[0_0_5px_rgba(8,145,178,0.8)]' : 'text-neutral-600'}`}>
          CLEAN
        </span>
        
        {/* Active Corners for Clean */}
        {!isDistorted && (
            <>
             <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-cyan-500"></div>
             <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-cyan-500"></div>
            </>
        )}
      </button>

      {/* Dirty Channel Button */}
      <button
        onClick={() => onChange(true)}
        className={`
          relative flex-1 group flex flex-col items-center justify-center border-2 transition-all duration-300 overflow-hidden
          ${isDistorted 
            ? 'border-rose-600 bg-rose-950/30 shadow-[0_0_30px_rgba(225,29,72,0.4)]' 
            : 'border-neutral-800 bg-neutral-900/20 opacity-60 hover:opacity-100 hover:border-neutral-700 grayscale'
          }
        `}
      >
        <span className={`text-[10px] font-mono mb-1 tracking-widest ${isDistorted ? 'text-rose-400' : 'text-neutral-500'}`}>CHANNEL B</span>
        <span className={`text-2xl md:text-3xl font-['Oswald'] uppercase ${isDistorted ? 'text-rose-100 drop-shadow-[0_0_8px_rgba(225,29,72,0.8)]' : 'text-neutral-600'}`}>
          DISTORTION
        </span>
        
         {/* Active Corners for Dirty */}
         {isDistorted && (
            <>
             <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-rose-600"></div>
             <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-rose-600"></div>
             {/* Texture Overlay */}
             <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 pointer-events-none mix-blend-overlay"></div>
            </>
        )}
      </button>
    </div>
  );
};