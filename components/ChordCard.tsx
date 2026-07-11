import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Chord } from '../types';
import { buildChordExplorerUrl } from '../utils/chordExplorer';

interface ChordCardProps {
  chord: Chord;
  isDistorted: boolean;
  onPlay: (chord: Chord) => void;
  onLockToggle?: (chord: Chord) => void;
  onFavoriteToggle?: (chord: Chord) => void;
  onAddToRiff?: (chord: Chord) => void;
  canAddToRiff?: boolean;
  isFavorite?: boolean;
  isLocked?: boolean;
  index?: number;
  skipInitialAnimation?: boolean;
}

export const ChordCard: React.FC<ChordCardProps> = ({
  chord,
  isDistorted,
  onPlay,
  onLockToggle,
  onFavoriteToggle,
  onAddToRiff,
  canAddToRiff = true,
  isFavorite = false,
  isLocked = false,
  index = 0,
  skipInitialAnimation = false
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const glowFrameRef = useRef<number | null>(null);
  const [glowPosition, setGlowPosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [hasAnimated, setHasAnimated] = useState(skipInitialAnimation);

  // Mark as animated after first render
  useEffect(() => {
    if (!hasAnimated) {
      const timer = setTimeout(() => setHasAnimated(true), 600);
      return () => clearTimeout(timer);
    }
  }, [hasAnimated]);

  // Cancel any pending glow frame on unmount
  useEffect(() => {
    return () => {
      if (glowFrameRef.current !== null) {
        cancelAnimationFrame(glowFrameRef.current);
      }
    };
  }, []);

  // rAF-gated: at most one glow update per frame
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (glowFrameRef.current !== null) return;
    const { clientX, clientY } = e;
    glowFrameRef.current = requestAnimationFrame(() => {
      glowFrameRef.current = null;
      if (!cardRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      setGlowPosition({
        x: clientX - rect.left,
        y: clientY - rect.top
      });
    });
  };

  const glowColor = isDistorted
    ? 'rgba(225, 29, 72, 0.4)'
    : 'rgba(8, 145, 178, 0.4)';

  const accentColor = isDistorted ? 'rose' : 'cyan';

  return (
    <motion.div
      ref={cardRef}
      className="relative w-full h-full group"
      style={{ pointerEvents: 'auto', isolation: 'isolate' }}
      initial={hasAnimated ? false : { opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: hasAnimated ? 0.2 : 0.5,
        delay: hasAnimated ? 0 : index * 0.08,
        ease: [0.25, 0.46, 0.45, 0.94]
      }}
      whileHover={{ y: -8 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Cursor-following Glow Effect */}
      <motion.div
        className="absolute inset-0 pointer-events-none rounded-lg opacity-0"
        style={{
          background: `radial-gradient(600px circle at ${glowPosition.x}px ${glowPosition.y}px, ${glowColor}, transparent 40%)`,
          opacity: isHovering ? 1 : 0,
          transition: 'opacity 0.3s ease'
        }}
      />

      {/* Main Card */}
      <motion.div
        className="relative overflow-hidden p-6 text-left transition-all duration-300 group w-full h-full flex flex-col justify-between rounded-lg"
        style={{
          pointerEvents: 'auto',
          ...(isLocked
            ? isDistorted
              ? {
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  background: 'linear-gradient(to bottom, rgba(225, 29, 72, 0.15) 0%, rgba(30, 7, 7, 0.25) 50%, rgba(30, 7, 7, 0.2) 100%)',
                  boxShadow: '0 -8px 25px rgba(225, 29, 72, 0.25), inset 0 0 40px rgba(225, 29, 72, 0.1)'
                }
              : {
                  border: '1px solid rgba(6, 182, 212, 0.5)',
                  background: 'linear-gradient(to bottom, rgba(8, 145, 178, 0.15) 0%, rgba(8, 47, 73, 0.25) 50%, rgba(8, 47, 73, 0.2) 100%)',
                  boxShadow: '0 -8px 25px rgba(8, 145, 178, 0.25), inset 0 0 40px rgba(8, 145, 178, 0.1)'
                }
            : isDistorted
              ? {
                  border: '1px solid rgba(127, 29, 29, 0.35)',
                  background: 'rgba(0, 0, 0, 0.2)'
                }
              : {
                  border: '1px solid rgba(115, 115, 115, 0.25)',
                  background: 'rgba(0, 0, 0, 0.15)'
                }
          )
        }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('button[aria-label="Lock as main chord"]')) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }
        }}
      >
        {/* Border Glow on Hover */}
        <motion.div
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{
            background: `radial-gradient(400px circle at ${glowPosition.x}px ${glowPosition.y}px, ${isDistorted ? 'rgba(225, 29, 72, 0.15)' : 'rgba(8, 145, 178, 0.15)'}, transparent 40%)`,
            opacity: isHovering ? 1 : 0,
            transition: 'opacity 0.3s ease'
          }}
        />

        {/* Background Text Faded - First 2 letters of chord name */}
        <motion.span
          className="absolute -right-4 -bottom-8 text-9xl font-['Oswald'] font-bold text-white select-none pointer-events-none"
          initial={{ opacity: 0.03 }}
          whileHover={{ opacity: 0.08 }}
          style={{ opacity: isHovering ? 0.08 : 0.03 }}
        >
          {chord.name.substring(0, 2).toUpperCase()}
        </motion.span>

        {/* Main Clickable Area */}
        {/* Main clickable area: div (not button) so the nested lock/play buttons stay valid */}
        <div
          onClick={(e) => {
            const target = e.target as HTMLElement;
            const innerButton = target.closest('button');
            if (innerButton) {
              e.stopPropagation();
              return;
            }
            onPlay(chord);
          }}
          className="relative z-10 w-full text-left flex-1 flex flex-col cursor-pointer"
          style={{ pointerEvents: 'auto' }}
        >
          <div className="relative z-10 w-full">
            {/* Header with Title and Lock Switch */}
            <div className="flex items-start justify-between mb-1">
              <div className="flex-1 overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.h3
                    key={chord.name}
                    className={`font-['Oswald'] text-2xl uppercase tracking-wide text-neutral-100`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.15 }}
                    whileHover={{
                      color: isDistorted ? '#fb7185' : '#22d3ee',
                      textShadow: isDistorted
                        ? '0 0 20px rgba(225, 29, 72, 0.5)'
                        : '0 0 20px rgba(8, 145, 178, 0.5)'
                    }}
                  >
                    {chord.name}
                  </motion.h3>
                </AnimatePresence>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={chord.subtext}
                    className="font-['Share_Tech_Mono'] text-xs text-neutral-400 mb-4 tracking-wider"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.1 }}
                  >
                    {chord.subtext}
                  </motion.p>
                </AnimatePresence>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-4">
              {/* Add to Riff Button */}
              {onAddToRiff && (
                <motion.button
                  type="button"
                  aria-label={`Add ${chord.name} to riff`}
                  title={canAddToRiff ? 'Add to riff' : 'Riff is full (16 steps)'}
                  disabled={!canAddToRiff}
                  className={`relative w-10 h-10 rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'} ${canAddToRiff ? 'cursor-pointer' : 'cursor-default opacity-40'}`}
                  whileHover={canAddToRiff ? { scale: 1.1 } : undefined}
                  whileTap={canAddToRiff ? { scale: 0.9 } : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canAddToRiff) onAddToRiff(chord);
                  }}
                  style={{
                    zIndex: 10,
                    background: 'radial-gradient(circle at 30% 30%, rgba(40, 40, 40, 0.8), rgba(20, 20, 20, 0.9))',
                    boxShadow: '0 0 0 1px rgba(100, 100, 100, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.05)'
                  }}
                >
                  <svg
                    className="w-4 h-4 relative z-10 transition-colors duration-200"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: '#a3a3a3' }}
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </motion.button>
              )}

              {/* Favorite Button */}
              {onFavoriteToggle && (
                <motion.button
                  type="button"
                  aria-label={isFavorite ? `Remove ${chord.name} from favorites` : `Add ${chord.name} to favorites`}
                  aria-pressed={isFavorite}
                  title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  className={`relative w-10 h-10 rounded-full flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}`}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFavoriteToggle(chord);
                  }}
                  style={{
                    zIndex: 10,
                    background: 'radial-gradient(circle at 30% 30%, rgba(40, 40, 40, 0.8), rgba(20, 20, 20, 0.9))',
                    boxShadow: isFavorite
                      ? (isDistorted
                          ? '0 0 0 1px rgba(244, 63, 94, 0.6), 0 0 20px rgba(244, 63, 94, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.1)'
                          : '0 0 0 1px rgba(34, 211, 238, 0.6), 0 0 20px rgba(34, 211, 238, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.1)')
                      : '0 0 0 1px rgba(100, 100, 100, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.05)'
                  }}
                >
                  <svg
                    className="w-4 h-4 relative z-10 transition-colors duration-200"
                    viewBox="0 0 24 24"
                    fill={isFavorite ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      color: isFavorite ? (isDistorted ? '#fb7185' : '#22d3ee') : '#a3a3a3',
                      filter: isFavorite
                        ? (isDistorted
                            ? 'drop-shadow(0 0 6px rgba(244, 63, 94, 0.9))'
                            : 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.9))')
                        : 'none'
                    }}
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </motion.button>
              )}

              {/* Lock Button - Animated */}
              {onLockToggle && (
                <motion.div
                  className="relative shrink-0"
                  style={{ pointerEvents: 'auto', zIndex: 10 }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    e.nativeEvent.stopImmediatePropagation();
                    if (onLockToggle) onLockToggle(chord);
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <motion.button
                    type="button"
                    className={`relative w-10 h-10 rounded-full flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}`}
                    data-locked={isLocked ? 'true' : 'false'}
                    title={isLocked ? "Unlock chord" : "Lock chord"}
                    aria-label={isLocked ? "Unlock chord" : "Lock chord"}
                    style={{
                      pointerEvents: 'auto',
                      position: 'relative',
                      zIndex: 10,
                      background: isLocked
                        ? 'radial-gradient(circle at 30% 30%, rgba(30, 30, 30, 0.9), rgba(10, 10, 10, 0.95))'
                        : 'radial-gradient(circle at 30% 30%, rgba(40, 40, 40, 0.8), rgba(20, 20, 20, 0.9))',
                      boxShadow: isLocked
                        ? '0 0 0 1px rgba(239, 68, 68, 0.6), 0 0 20px rgba(239, 68, 68, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.1)'
                        : '0 0 0 1px rgba(100, 100, 100, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.05)'
                    }}
                    animate={{
                      boxShadow: isLocked
                        ? [
                            '0 0 0 1px rgba(239, 68, 68, 0.6), 0 0 20px rgba(239, 68, 68, 0.4)',
                            '0 0 0 1px rgba(239, 68, 68, 0.8), 0 0 30px rgba(239, 68, 68, 0.6)',
                            '0 0 0 1px rgba(239, 68, 68, 0.6), 0 0 20px rgba(239, 68, 68, 0.4)'
                          ]
                        : '0 0 0 1px rgba(100, 100, 100, 0.2)'
                    }}
                    transition={{ duration: 2, repeat: isLocked ? Infinity : 0 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (onLockToggle) onLockToggle(chord);
                    }}
                  >
                    {/* Lock Icon SVG */}
                    <motion.svg
                      className="w-4 h-4 relative z-10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                      animate={{
                        color: isLocked ? '#ef4444' : '#a3a3a3',
                        filter: isLocked
                          ? 'drop-shadow(0 0 6px rgba(239, 68, 68, 1))'
                          : 'none'
                      }}
                    >
                      {isLocked ? (
                        <>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </>
                      ) : (
                        <>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 9.33-2.5" />
                        </>
                      )}
                    </motion.svg>

                    {/* Top Highlight */}
                    <div
                      className="absolute top-[15%] left-1/2 -translate-x-1/2 w-3 h-3 rounded-full pointer-events-none"
                      style={{
                        background: isLocked
                          ? 'radial-gradient(circle, rgba(255, 255, 255, 0.15) 0%, transparent 70%)'
                          : 'radial-gradient(circle, rgba(255, 255, 255, 0.08) 0%, transparent 70%)'
                      }}
                    />
                  </motion.button>
                </motion.div>
              )}
              </div>
            </div>

            <div className="flex items-end justify-between mb-4">
              <p className="text-sm text-neutral-400 font-light leading-snug max-w-[80%]">
                {chord.description}
              </p>

              {/* Play Button - Animated */}
              <motion.button
                type="button"
                aria-label={`Play ${chord.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(chord);
                }}
                className={`
                  shrink-0 w-8 h-8 flex items-center justify-center rounded-full border
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black
                  ${isDistorted
                    ? 'border-rose-900 text-rose-500 focus-visible:ring-rose-500'
                    : 'border-neutral-700 text-neutral-500 focus-visible:ring-cyan-500'}
                `}
                whileHover={{
                  scale: 1.2,
                  borderColor: isDistorted ? '#f43f5e' : '#22d3ee',
                  boxShadow: isDistorted
                    ? '0 0 20px rgba(244, 63, 94, 0.5)'
                    : '0 0 20px rgba(34, 211, 238, 0.5)'
                }}
                whileTap={{ scale: 0.9 }}
              >
                <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </motion.button>
            </div>
          </div>

          {/* Fretboard Data */}
          <div className="relative z-10 w-full pt-3 border-t border-white/5 flex justify-between items-center mt-auto">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-neutral-400">TABLATURE</span>
              <motion.a
                href={buildChordExplorerUrl(chord)}
                target="_blank"
                rel="noopener"
                aria-label="Open in Chord Explorer"
                title="Open in Chord Explorer"
                onClick={(e) => e.stopPropagation()}
                className={`
                  w-7 h-7 flex items-center justify-center rounded-full border border-white/10 text-neutral-500
                  transition-colors duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black
                  ${isDistorted ? 'hover:text-rose-400 hover:border-rose-500/50 focus-visible:ring-rose-500' : 'hover:text-cyan-400 hover:border-cyan-500/50 focus-visible:ring-cyan-500'}
                `}
                whileHover={{ scale: 1.15 }}
                whileTap={{ scale: 0.9 }}
              >
                <svg
                  className="w-3 h-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </motion.a>
            </div>
            <motion.span
              className={`font-mono text-sm tracking-[0.25em] font-bold ${
                isDistorted
                  ? 'text-rose-500'
                  : 'text-cyan-500'
              }`}
              animate={{
                textShadow: isHovering
                  ? (isDistorted
                      ? '0 0 15px rgba(225, 29, 72, 0.8)'
                      : '0 0 15px rgba(8, 145, 178, 0.8)')
                  : (isDistorted
                      ? '0 0 8px rgba(225, 29, 72, 0.6)'
                      : '0 0 8px rgba(8, 145, 178, 0.6)')
              }}
            >
              {chord.fretboard}
            </motion.span>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
