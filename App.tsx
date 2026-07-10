import React, { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { audioEngine } from './services/audioEngine';
import { DistortionSwitch } from './components/DistortionSwitch';
import { ChordCard } from './components/ChordCard';
import { RootSelector } from './components/RootSelector';
import { TuningSelector } from './components/TuningSelector';
import { VibeSelector } from './components/VibeSelector';
import { useChordStore } from './stores/chordStore';
import { Chord, TuningMode, VibeMode } from './types';
import { transposeChord } from './utils/musicTheory';
import { syncUrlState } from './utils/urlState';
import { getChords } from './constants';

const CHORDS_PER_BATCH = 6;
const RELATED_CHORDS_COUNT = 6;

const App: React.FC = () => {
  const {
    isDistorted,
    isAudioReady,
    activeChordId,
    selectedRoot,
    tuningMode,
    vibeMode,
    lockedChordId,
    relatedChords,
    displayedChords,
    isLoadingChords,
    chordsToLoad,
    totalChordsAvailable,
    setIsDistorted,
    setIsAudioReady,
    setActiveChordId,
    setSelectedRoot,
    setTuningMode,
    setVibeMode,
    setLockedChordId,
    setRelatedChords,
    setDisplayedChords,
    setIsLoadingChords,
    setChordsToLoad,
    setTotalChordsAvailable,
    resetLockState,
    incrementChordsToLoad
  } = useChordStore();

  const relatedSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    resetLockState();
  }, [tuningMode, vibeMode, resetLockState]);

  // Keep the query string shareable: ?root=C&tuning=drop&vibe=dark
  useEffect(() => {
    syncUrlState(selectedRoot, tuningMode, vibeMode);
  }, [selectedRoot, tuningMode, vibeMode]);

  const handleUserInteraction = useCallback(async () => {
    if (!isAudioReady) {
      await audioEngine.init();
      setIsAudioReady(true);
    }
  }, [isAudioReady, setIsAudioReady]);

  const setDistortionMode = useCallback(async (shouldBeDistorted: boolean) => {
    if (isDistorted === shouldBeDistorted && isAudioReady) return;
    await handleUserInteraction();
    setIsDistorted(shouldBeDistorted);
    audioEngine.setDistortion(shouldBeDistorted);
  }, [isDistorted, isAudioReady, handleUserInteraction, setIsDistorted]);

  const playChord = useCallback(async (chord: Chord) => {
    await handleUserInteraction();
    audioEngine.playChord(chord.notes);
    setActiveChordId(chord.id);
    setTimeout(() => setActiveChordId(null), 300);
  }, [handleUserInteraction, setActiveChordId]);

  const handleChordClick = useCallback(async (chord: Chord) => {
    await playChord(chord);
  }, [playChord]);

  const handleLockToggle = useCallback(async (chord: Chord) => {
    if (lockedChordId === chord.id) {
      setLockedChordId(null);
      setRelatedChords([]);
    } else {
      await playChord(chord);
      setLockedChordId(chord.id);

      const baseChords = await getChords(tuningMode, vibeMode);

      const originalParent = baseChords.find((p: Chord) => {
        const transposed = transposeChord(p, selectedRoot, tuningMode);
        return transposed.id === chord.id;
      });

      if (originalParent && originalParent.relatedChords && originalParent.relatedChords.length > 0) {
        const transposedRelated = originalParent.relatedChords
          .slice(0, RELATED_CHORDS_COUNT)
          .map((relatedChord: Chord) => transposeChord(relatedChord, selectedRoot, tuningMode));
        setRelatedChords(transposedRelated);

        setTimeout(() => {
          relatedSectionRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }, 350);
      } else {
        setRelatedChords([]);
      }
    }
  }, [lockedChordId, playChord, selectedRoot, tuningMode, vibeMode, setLockedChordId, setRelatedChords]);

  const isChordLocked = useCallback((chord: Chord) => {
    if (!lockedChordId) return false;
    return chord.id === lockedChordId;
  }, [lockedChordId]);

  useEffect(() => {
    setIsLoadingChords(true);
    setDisplayedChords([]);
    setChordsToLoad(6);

    const loadChords = async () => {
      try {
        const baseChords = await getChords(tuningMode, vibeMode);

        if (!baseChords || baseChords.length === 0) {
          setDisplayedChords([]);
          setIsLoadingChords(false);
          return;
        }

        setTotalChordsAvailable(baseChords.length);

        const firstBatch = baseChords.slice(0, CHORDS_PER_BATCH);
        const strippedChords = firstBatch.map((chord: Chord) => ({
          ...chord,
          relatedChords: undefined
        }));

        setDisplayedChords(strippedChords as Chord[]);
        setIsLoadingChords(false);

        setTimeout(() => {
          const transposed = firstBatch.map((chord: Chord) => {
            try {
              return transposeChord(chord, selectedRoot, tuningMode);
            } catch {
              return chord;
            }
          });
          setDisplayedChords(transposed);
        }, 150);
      } catch {
        setDisplayedChords([]);
        setIsLoadingChords(false);
      }
    };

    loadChords();
  }, [selectedRoot, tuningMode, vibeMode, setDisplayedChords, setIsLoadingChords, setChordsToLoad, setTotalChordsAvailable]);

  const loadMoreChords = useCallback(async () => {
    if (isLoadingChords) return;

    setIsLoadingChords(true);

    try {
      const baseChords = await getChords(tuningMode, vibeMode);
      if (!baseChords || baseChords.length === 0) {
        setIsLoadingChords(false);
        return;
      }

      const nextBatch = baseChords.slice(chordsToLoad, chordsToLoad + CHORDS_PER_BATCH);

      if (nextBatch.length === 0) {
        setIsLoadingChords(false);
        return;
      }

      setDisplayedChords([...displayedChords, ...(nextBatch as Chord[])]);
      incrementChordsToLoad(CHORDS_PER_BATCH);

      setTimeout(() => {
        const transposed = nextBatch.map((chord: Chord) => {
          try {
            return transposeChord(chord, selectedRoot, tuningMode);
          } catch {
            return chord;
          }
        });

        const newChords = [...displayedChords];
        const startIndex = displayedChords.length;
        transposed.forEach((chord: Chord, i: number) => {
          newChords[startIndex + i] = chord;
        });
        setDisplayedChords(newChords);
      }, 100);

      setIsLoadingChords(false);
    } catch {
      setIsLoadingChords(false);
    }
  }, [chordsToLoad, tuningMode, vibeMode, selectedRoot, isLoadingChords, displayedChords, setDisplayedChords, setIsLoadingChords, incrementChordsToLoad]);

  return (
    <motion.div
      className={`min-h-screen transition-colors duration-700 ${isDistorted ? 'bg-[#080505]' : 'bg-[#0a0a0a]'}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute w-[800px] h-[800px] rounded-full opacity-20"
          style={{
            background: isDistorted
              ? 'radial-gradient(circle, rgba(225, 29, 72, 0.3) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(8, 145, 178, 0.3) 0%, transparent 70%)',
            left: '50%',
            top: '20%',
            transform: 'translate(-50%, -50%)',
            filter: 'blur(100px)'
          }}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.15, 0.25, 0.15]
          }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="fixed inset-0 opacity-[0.02] pointer-events-none bg-[url('/noise.svg')]"></div>

      <div className={`relative z-10 max-w-7xl mx-auto px-6 py-12 flex flex-col min-h-screen ${isDistorted ? 'glitch-active' : ''}`}>
        <motion.header
          className="mb-12 text-center"
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          <div className="inline-block mb-4">
            <motion.h1
              className={`
                text-5xl md:text-7xl font-['Oswald'] font-bold tracking-tighter uppercase
                ${isDistorted
                  ? 'text-transparent bg-clip-text bg-gradient-to-b from-rose-500 to-rose-900'
                  : 'text-neutral-100'
                }
              `}
              animate={{
                textShadow: isDistorted
                  ? '0 2px 20px rgba(225, 29, 72, 0.5)'
                  : '0 2px 10px rgba(255, 255, 255, 0.1)'
              }}
            >
              Riff<motion.span
                className={isDistorted ? 'text-rose-500' : 'text-cyan-500'}
                animate={{
                  textShadow: isDistorted
                    ? ['0 0 20px rgba(225, 29, 72, 0.8)', '0 0 40px rgba(225, 29, 72, 0.5)', '0 0 20px rgba(225, 29, 72, 0.8)']
                    : ['0 0 20px rgba(8, 145, 178, 0.8)', '0 0 40px rgba(8, 145, 178, 0.5)', '0 0 20px rgba(8, 145, 178, 0.8)']
                }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >Forge</motion.span>
            </motion.h1>
          </div>
          <motion.p
            className="font-['Share_Tech_Mono'] text-neutral-500 tracking-widest text-sm uppercase"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            Context-Aware Sonic Prototyping
          </motion.p>
        </motion.header>

        <div className="w-full max-w-4xl mx-auto">
          <section className="mb-12 sticky top-4 z-50 backdrop-blur-md bg-black/40 p-4 rounded-xl border border-white/5 shadow-2xl">
            <DistortionSwitch isDistorted={isDistorted} onChange={setDistortionMode} />

            <div className="flex justify-between items-center mt-4 px-2 md:px-4 max-w-lg mx-auto">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isAudioReady ? 'bg-green-500 shadow-[0_0_5px_lime]' : 'bg-red-900'}`}></div>
                <span className="text-[10px] font-mono text-neutral-400 uppercase">Engine {isAudioReady ? 'Online' : 'Standby'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-neutral-400 uppercase">Output</span>
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className={`w-1 h-3 ${isDistorted ? 'bg-rose-900' : 'bg-cyan-900'} ${i < 4 ? (isDistorted ? 'bg-rose-500' : 'bg-cyan-500') : ''}`}></div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="mb-8">
              <TuningSelector
                tuning={tuningMode}
                setTuning={setTuningMode}
                isDistorted={isDistorted}
              />

              <VibeSelector
                vibe={vibeMode}
                setVibe={setVibeMode}
                isDistorted={isDistorted}
              />

              <RootSelector
                  selectedRoot={selectedRoot}
                  onSelectRoot={setSelectedRoot}
                  isDistorted={isDistorted}
              />
          </section>
        </div>

        <main className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 pb-20" style={{ isolation: 'isolate' }}>
          {displayedChords && displayedChords.length > 0 ? (
            <>
              {displayedChords.map((chord, index) => {
                const locked = isChordLocked(chord);
                return (
                  <div
                    key={`chord-slot-${index}`}
                    className="h-full relative"
                    style={{ isolation: 'isolate', zIndex: 'auto' }}
                  >
                    <ChordCard
                      chord={chord}
                      isDistorted={isDistorted}
                      onPlay={handleChordClick}
                      onLockToggle={handleLockToggle}
                      isLocked={locked}
                      index={index}
                      skipInitialAnimation={index < 6}
                    />
                  </div>
                );
              })}

              {chordsToLoad < totalChordsAvailable && (
                <motion.div
                  className="col-span-full flex justify-center py-8"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  {isLoadingChords ? (
                    <div className="flex items-center gap-3 text-neutral-400">
                      <motion.div
                        className={`w-5 h-5 border-2 ${isDistorted ? 'border-rose-500' : 'border-cyan-500'} border-t-transparent rounded-full`}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      />
                      <span className="font-mono text-sm">Loading chords...</span>
                    </div>
                  ) : (
                    <motion.button
                      onClick={loadMoreChords}
                      className={`px-6 py-3 ${isDistorted ? 'bg-rose-500/20 hover:bg-rose-500/30 border-rose-500/50 hover:border-rose-500 text-rose-400' : 'bg-cyan-500/20 hover:bg-cyan-500/30 border-cyan-500/50 hover:border-cyan-500 text-cyan-400'} border rounded-lg font-mono text-sm uppercase tracking-wider`}
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      Load More Chords ({totalChordsAvailable - displayedChords.length} remaining)
                    </motion.button>
                  )}
                </motion.div>
              )}
            </>
          ) : (
            <motion.div
              className="col-span-full text-center text-neutral-500 py-12"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="flex flex-col items-center gap-4">
                <motion.div
                  className={`w-8 h-8 border-2 ${isDistorted ? 'border-rose-500' : 'border-cyan-500'} border-t-transparent rounded-full`}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
                <p className="font-mono text-sm">Loading chords...</p>
              </div>
            </motion.div>
          )}
        </main>

        <AnimatePresence>
          {relatedChords.length > 0 && lockedChordId && (
            <motion.section
              ref={relatedSectionRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-12 scroll-mt-4"
            >
              {(() => {
                const lockedChord = displayedChords.find(c => c.id === lockedChordId);
                return (
                  <div className="flex flex-col items-center gap-3 mb-6">
                    <div className="flex items-center gap-4 w-full">
                      <div className={`h-px flex-1 ${isDistorted ? 'bg-rose-500/30' : 'bg-cyan-500/30'}`} />
                      <h3 className={`font-['Share_Tech_Mono'] text-sm uppercase tracking-widest ${isDistorted ? 'text-rose-400' : 'text-cyan-400'}`}>
                        Related Variations
                      </h3>
                      <div className={`h-px flex-1 ${isDistorted ? 'bg-rose-500/30' : 'bg-cyan-500/30'}`} />
                    </div>

                    {lockedChord && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className={`flex items-center gap-3 px-4 py-2 rounded-lg border backdrop-blur-sm ${
                          isDistorted
                            ? 'bg-rose-500/10 border-rose-500/30'
                            : 'bg-cyan-500/10 border-cyan-500/30'
                        }`}
                      >
                        <span className={`font-['Oswald'] text-2xl font-bold ${
                          isDistorted ? 'text-rose-400' : 'text-cyan-400'
                        }`}>
                          {selectedRoot}
                        </span>

                        <div className={`w-px h-6 ${isDistorted ? 'bg-rose-500/40' : 'bg-cyan-500/40'}`} />

                        <span className="font-['Oswald'] text-lg text-neutral-200 uppercase tracking-wide">
                          {lockedChord.name}
                        </span>

                        <motion.div
                          className={`w-2 h-2 rounded-full ${isDistorted ? 'bg-rose-500' : 'bg-cyan-500'}`}
                          animate={{
                            boxShadow: isDistorted
                              ? ['0 0 8px rgba(244, 63, 94, 0.8)', '0 0 16px rgba(244, 63, 94, 0.4)', '0 0 8px rgba(244, 63, 94, 0.8)']
                              : ['0 0 8px rgba(34, 211, 238, 0.8)', '0 0 16px rgba(34, 211, 238, 0.4)', '0 0 8px rgba(34, 211, 238, 0.8)']
                          }}
                          transition={{ duration: 2, repeat: Infinity }}
                        />
                      </motion.div>
                    )}
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {relatedChords.map((chord, index) => (
                  <motion.div
                    key={`related-${chord.id}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="h-full relative"
                  >
                    <ChordCard
                      chord={chord}
                      isDistorted={isDistorted}
                      onPlay={handleChordClick}
                      isLocked={false}
                      index={index}
                      skipInitialAnimation={false}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <motion.footer
          className="mt-auto pt-12 border-t border-neutral-900 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
        >
          <motion.p
            className="text-neutral-400 text-xs font-mono"
            whileHover={{ color: isDistorted ? '#f43f5e' : '#22d3ee' }}
          >
            DESIGNED FOR METAL ARCHITECTS // V0.2.3 BETA
          </motion.p>
        </motion.footer>

      </div>
    </motion.div>
  );
};

export default App;
