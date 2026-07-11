import React, { useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { audioEngine } from '../services/audioEngine';
import { useRiffStore, MAX_RIFF_STEPS, MIN_BPM, MAX_BPM } from '../stores/riffStore';
import { useChordStore } from '../stores/chordStore';

const BPM_STEP = 5;

export const RiffBar: React.FC = () => {
  const {
    steps,
    bpm,
    isPlaying,
    currentStep,
    metronomeOn,
    removeStep,
    clearSteps,
    setBpm,
    setIsPlaying,
    setCurrentStep,
    setMetronomeOn
  } = useRiffStore();

  const isDistorted = useChordStore((state) => state.isDistorted);
  const isAudioReady = useChordStore((state) => state.isAudioReady);
  const setIsAudioReady = useChordStore((state) => state.setIsAudioReady);

  const visible = steps.length > 0 || metronomeOn;

  const startPlayback = useCallback(async () => {
    if (!isAudioReady) {
      await audioEngine.init();
      audioEngine.setDistortion(isDistorted);
      setIsAudioReady(true);
    }
    audioEngine.setMetronomeEnabled(useRiffStore.getState().metronomeOn);
    const { steps: currentSteps, bpm: currentBpm } = useRiffStore.getState();
    audioEngine.playSequence(currentSteps, currentBpm, (index) => {
      useRiffStore.getState().setCurrentStep(index);
    });
    setIsPlaying(true);
  }, [isAudioReady, isDistorted, setIsAudioReady, setIsPlaying]);

  const stopPlayback = useCallback(() => {
    audioEngine.stopSequence();
    setIsPlaying(false);
    setCurrentStep(-1);
  }, [setIsPlaying, setCurrentStep]);

  // Restart the loop when the sequence or BPM changes mid-playback
  useEffect(() => {
    if (!isPlaying) return;
    if (steps.length === 0 && !metronomeOn) {
      stopPlayback();
      return;
    }
    startPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, bpm]);

  // Stop cleanly if the bar is dismissed entirely
  useEffect(() => {
    if (!visible && isPlaying) {
      stopPlayback();
    }
  }, [visible, isPlaying, stopPlayback]);

  const handlePlayToggle = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  };

  const handleMetronomeToggle = () => {
    const next = !metronomeOn;
    setMetronomeOn(next);
    audioEngine.setMetronomeEnabled(next);
  };

  const accentText = isDistorted ? 'text-rose-400' : 'text-cyan-400';
  const accentBorder = isDistorted ? 'border-rose-500/60' : 'border-cyan-500/60';
  const accentRing = isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500';
  const accentGlow = isDistorted
    ? 'shadow-[0_0_12px_rgba(244,63,94,0.35)]'
    : 'shadow-[0_0_12px_rgba(34,211,238,0.35)]';

  const controlBase = `
    flex items-center justify-center rounded-full border font-mono uppercase tracking-widest
    transition-all duration-200 cursor-pointer
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${accentRing}
  `;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="fixed bottom-0 inset-x-0 z-50"
        >
          <div className={`backdrop-blur-md border-t border-white/5 ${isDistorted ? 'bg-[#0f0607]/90' : 'bg-black/85'}`}>
            <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">

              {/* Transport controls */}
              <div className="flex items-center gap-2">
                <motion.button
                  type="button"
                  aria-label={isPlaying ? 'Stop riff playback' : 'Play riff loop'}
                  onClick={handlePlayToggle}
                  className={`${controlBase} w-11 h-11 ${
                    isPlaying
                      ? `${accentBorder} ${accentText} ${accentGlow}`
                      : 'border-white/15 text-neutral-300 hover:border-white/40'
                  }`}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
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
                </motion.button>

                {/* Metronome toggle */}
                <motion.button
                  type="button"
                  aria-label={metronomeOn ? 'Turn metronome off' : 'Turn metronome on'}
                  aria-pressed={metronomeOn}
                  title="Metronome"
                  onClick={handleMetronomeToggle}
                  className={`${controlBase} w-11 h-11 ${
                    metronomeOn
                      ? `${accentBorder} ${accentText} ${accentGlow}`
                      : 'border-white/15 text-neutral-400 hover:border-white/40'
                  }`}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 3h6l4 18H5L9 3z" />
                    <line x1="12" y1="15" x2="17" y2="6" />
                  </svg>
                </motion.button>
              </div>

              {/* BPM stepper */}
              <div className="flex items-center gap-1.5">
                <motion.button
                  type="button"
                  aria-label="Decrease BPM"
                  onClick={() => setBpm(useRiffStore.getState().bpm - BPM_STEP)}
                  disabled={bpm <= MIN_BPM}
                  className={`${controlBase} w-8 h-8 text-sm border-white/15 text-neutral-300 hover:border-white/40 disabled:opacity-30 disabled:cursor-default`}
                  whileTap={{ scale: 0.9 }}
                >
                  &minus;
                </motion.button>
                <div className="flex flex-col items-center w-14">
                  <span className={`font-mono text-base font-bold leading-none ${accentText}`}>{bpm}</span>
                  <span className="font-mono text-[9px] text-neutral-500 uppercase tracking-widest">BPM</span>
                </div>
                <motion.button
                  type="button"
                  aria-label="Increase BPM"
                  onClick={() => setBpm(useRiffStore.getState().bpm + BPM_STEP)}
                  disabled={bpm >= MAX_BPM}
                  className={`${controlBase} w-8 h-8 text-sm border-white/15 text-neutral-300 hover:border-white/40 disabled:opacity-30 disabled:cursor-default`}
                  whileTap={{ scale: 0.9 }}
                >
                  +
                </motion.button>
              </div>

              {/* Step count + clear */}
              <div className="flex items-center gap-3 ml-auto order-2 md:order-4">
                <span className="font-mono text-[10px] text-neutral-500 uppercase tracking-widest">
                  {steps.length}/{MAX_RIFF_STEPS}
                </span>
                {steps.length > 0 && (
                  <button
                    type="button"
                    aria-label="Clear riff sequence"
                    onClick={() => {
                      if (isPlaying && !metronomeOn) stopPlayback();
                      clearSteps();
                    }}
                    className={`
                      px-3 h-8 rounded-full border border-white/10 font-mono text-[10px] uppercase tracking-widest
                      text-neutral-400 hover:text-neutral-200 hover:border-white/30 transition-all duration-200
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${accentRing}
                    `}
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Chord chips */}
              <div
                className="basis-full md:basis-0 md:flex-1 order-3 overflow-x-auto"
                style={{ scrollbarWidth: 'thin', scrollbarColor: isDistorted ? 'rgba(244,63,94,0.3) transparent' : 'rgba(34,211,238,0.3) transparent' }}
              >
                {steps.length > 0 ? (
                  <div className="flex items-center gap-2 py-1 min-w-max">
                    {steps.map((step, index) => {
                      const active = isPlaying && index === currentStep;
                      return (
                        <motion.div
                          key={step.key}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: active ? 1.05 : 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className={`
                            flex items-center gap-1.5 pl-3 pr-1.5 h-8 rounded-full border shrink-0
                            font-mono text-[11px] uppercase tracking-wider transition-colors duration-150
                            ${active
                              ? (isDistorted
                                  ? 'bg-rose-500/25 border-rose-400 text-rose-200 shadow-[0_0_14px_rgba(244,63,94,0.5)]'
                                  : 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.5)]')
                              : 'bg-neutral-900/60 border-white/10 text-neutral-300'
                            }
                          `}
                        >
                          <span className="text-neutral-500 mr-0.5">{index + 1}</span>
                          <span className="max-w-[140px] truncate">{step.name}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${step.name} from riff`}
                            onClick={() => removeStep(step.key)}
                            className={`
                              w-5 h-5 flex items-center justify-center rounded-full text-neutral-500
                              hover:text-neutral-100 hover:bg-white/10 transition-colors duration-150
                              focus-visible:outline-none focus-visible:ring-1 ${accentRing}
                            `}
                          >
                            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="font-mono text-[10px] text-neutral-500 uppercase tracking-widest py-2">
                    Click track armed // add chords to forge a riff
                  </p>
                )}
              </div>

            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
