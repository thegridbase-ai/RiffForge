import React, { useState, useMemo } from 'react';
import { audioEngine } from './services/audioEngine';
import { DistortionSwitch } from './components/DistortionSwitch';
import { ChordCard } from './components/ChordCard';
import { RootSelector } from './components/RootSelector';
import { TuningSelector } from './components/TuningSelector';
import { CHORDS } from './constants';
import { Chord, TuningMode } from './types';
import { transposeChord } from './utils/musicTheory';

const App: React.FC = () => {
  const [isDistorted, setIsDistorted] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [activeChordId, setActiveChordId] = useState<string | null>(null);
  const [selectedRoot, setSelectedRoot] = useState('E'); // Default to Standard E
  const [tuningMode, setTuningMode] = useState<TuningMode>(TuningMode.STANDARD);

  // Initialize Audio Context on first interaction
  const handleUserInteraction = async () => {
    if (!isAudioReady) {
      await audioEngine.init();
      setIsAudioReady(true);
    }
  };

  const setDistortionMode = async (shouldBeDistorted: boolean) => {
    // Only act if the mode is actually changing to prevent re-triggering same state unnecessarily
    if (isDistorted === shouldBeDistorted && isAudioReady) return;

    await handleUserInteraction();
    setIsDistorted(shouldBeDistorted);
    audioEngine.setDistortion(shouldBeDistorted);
  };

  const playChord = async (chord: Chord) => {
    await handleUserInteraction();
    audioEngine.playChord(chord.notes);
    
    // Visual trigger for active chord
    setActiveChordId(chord.id);
    setTimeout(() => setActiveChordId(null), 300);
  };

  // Dynamically calculate displayed chords based on selected root and tuning
  const displayedChords = useMemo(() => {
    return CHORDS.map(chord => transposeChord(chord, selectedRoot, tuningMode));
  }, [selectedRoot, tuningMode]);

  return (
    <div className={`min-h-screen transition-colors duration-700 ${isDistorted ? 'bg-[#080505]' : 'bg-[#0a0a0a]'}`}>
      
      {/* Background Ambiance / Noise */}
      <div className="fixed inset-0 opacity-[0.02] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
      
      {/* Main Container - Expanded to max-w-7xl for wider layout */}
      <div className={`relative z-10 max-w-7xl mx-auto px-6 py-12 flex flex-col min-h-screen ${isDistorted ? 'glitch-active' : ''}`}>
        
        {/* Header */}
        <header className="mb-12 text-center">
          <div className="inline-block mb-4">
            <h1 className={`
              text-5xl md:text-7xl font-['Oswald'] font-bold tracking-tighter uppercase
              ${isDistorted 
                ? 'text-transparent bg-clip-text bg-gradient-to-b from-rose-500 to-rose-900 drop-shadow-[0_2px_10px_rgba(225,29,72,0.5)]' 
                : 'text-neutral-100 drop-shadow-lg'
              }
            `}>
              Riff<span className={isDistorted ? 'text-rose-500' : 'text-cyan-500'}>Forge</span>
            </h1>
          </div>
          <p className="font-['Share_Tech_Mono'] text-neutral-500 tracking-widest text-sm uppercase">
            Context-Aware Sonic Prototyping
          </p>
        </header>

        {/* Control Center - Constrained width to keep UI tight while main grid is wide */}
        <div className="w-full max-w-4xl mx-auto">
          <section className="mb-12 sticky top-4 z-50 backdrop-blur-md bg-black/40 p-4 rounded-xl border border-white/5 shadow-2xl">
            <DistortionSwitch isDistorted={isDistorted} onChange={setDistortionMode} />
            
            {/* Status Indicators */}
            <div className="flex justify-between items-center mt-4 px-2 md:px-4 max-w-lg mx-auto">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isAudioReady ? 'bg-green-500 shadow-[0_0_5px_lime]' : 'bg-red-900'}`}></div>
                <span className="text-[10px] font-mono text-neutral-600 uppercase">Engine {isAudioReady ? 'Online' : 'Standby'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-neutral-600 uppercase">Output</span>
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className={`w-1 h-3 ${isDistorted ? 'bg-rose-900' : 'bg-cyan-900'} ${i < 4 ? (isDistorted ? 'bg-rose-500' : 'bg-cyan-500') : ''}`}></div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Tuning & Root Selection */}
          <section className="mb-8">
              <TuningSelector 
                tuning={tuningMode} 
                setTuning={setTuningMode} 
                isDistorted={isDistorted} 
              />
              
              <RootSelector 
                  selectedRoot={selectedRoot} 
                  onSelectRoot={setSelectedRoot} 
                  isDistorted={isDistorted}
              />
          </section>
        </div>

        {/* Chord Grid - Responsive: 1 col mobile, 2 cols tablet, 3 cols desktop */}
        <main className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
          {displayedChords.map((chord) => (
            <div 
              key={chord.id} 
              className={`transition-transform duration-100 h-full ${activeChordId === chord.id ? 'scale-[0.98]' : ''}`}
            >
              <ChordCard 
                chord={chord} 
                isDistorted={isDistorted} 
                onPlay={playChord} 
              />
            </div>
          ))}
        </main>

        {/* Footer */}
        <footer className="mt-auto pt-12 border-t border-neutral-900 text-center">
          <p className="text-neutral-600 text-xs font-mono">
            DESIGNED FOR METAL ARCHITECTS // V0.2.3 BETA
          </p>
        </footer>

      </div>
    </div>
  );
};

export default App;