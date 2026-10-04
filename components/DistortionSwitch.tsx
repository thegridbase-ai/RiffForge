import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { AmpModel } from '../utils/ampTone';

interface DistortionSwitchProps {
  isDistorted: boolean;
  onChange: (mode: boolean) => void;
}

export const DistortionSwitch: React.FC<DistortionSwitchProps> = ({ isDistorted, onChange }) => {
  return (
    <div className="flex w-full gap-2 md:gap-4 h-24 mx-auto">
      {/* Clean Channel Button */}
      <ChannelButton
        isActive={!isDistorted}
        onClick={() => onChange(false)}
        channel="A"
        label="CLEAN"
        activeColor="cyan"
      />

      {/* Dirty Channel Button */}
      <ChannelButton
        isActive={isDistorted}
        onClick={() => onChange(true)}
        channel="B"
        label="DISTORTION"
        activeColor="rose"
        showTexture
      />
    </div>
  );
};

interface ChannelButtonProps {
  isActive: boolean;
  onClick: () => void;
  channel: string;
  label: string;
  activeColor: 'cyan' | 'rose';
  showTexture?: boolean;
}

const ChannelButton: React.FC<ChannelButtonProps> = ({
  isActive,
  onClick,
  channel,
  label,
  activeColor,
  showTexture = false
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    setMousePosition({
      x: (e.clientX - centerX) * 0.1,
      y: (e.clientY - centerY) * 0.1
    });
  };

  const handleMouseLeave = () => {
    setMousePosition({ x: 0, y: 0 });
  };

  const colors = {
    cyan: {
      border: 'border-cyan-500',
      bg: 'bg-cyan-950/30',
      shadow: '0 0 30px rgba(8, 145, 178, 0.4)',
      text: 'text-cyan-400',
      textGlow: '0 0 10px rgba(8, 145, 178, 0.8)',
      labelGlow: '0 0 20px rgba(8, 145, 178, 0.6)'
    },
    rose: {
      border: 'border-rose-600',
      bg: 'bg-rose-950/30',
      shadow: '0 0 40px rgba(225, 29, 72, 0.5)',
      text: 'text-rose-400',
      textGlow: '0 0 10px rgba(225, 29, 72, 0.8)',
      labelGlow: '0 0 20px rgba(225, 29, 72, 0.6)'
    }
  };

  const colorConfig = colors[activeColor];

  return (
    <motion.button
      ref={buttonRef}
      type="button"
      aria-pressed={isActive}
      onClick={onClick}
      className={`
        relative flex-1 group flex flex-col items-center justify-center border-2 overflow-hidden
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black
        ${activeColor === 'cyan' ? 'focus-visible:ring-cyan-500' : 'focus-visible:ring-rose-500'}
        ${isActive
          ? `${colorConfig.border} ${colorConfig.bg}`
          : 'border-neutral-800 bg-neutral-900/20'
        }
      `}
      style={{
        boxShadow: isActive ? colorConfig.shadow : 'none'
      }}
      animate={{
        x: mousePosition.x,
        y: mousePosition.y,
        opacity: isActive ? 1 : 0.6,
        filter: isActive ? 'grayscale(0)' : 'grayscale(1)'
      }}
      whileHover={{
        opacity: 1,
        scale: 1.02,
        filter: 'grayscale(0)'
      }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Animated Glow Background */}
      {isActive && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0.3, 0.5, 0.3],
            background: activeColor === 'cyan'
              ? 'radial-gradient(circle at center, rgba(8, 145, 178, 0.2) 0%, transparent 70%)'
              : 'radial-gradient(circle at center, rgba(225, 29, 72, 0.2) 0%, transparent 70%)'
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Channel Label */}
      <motion.span
        className={`text-[10px] font-mono mb-1 tracking-widest ${isActive ? colorConfig.text : 'text-neutral-500'}`}
        animate={{
          textShadow: isActive ? colorConfig.textGlow : 'none'
        }}
      >
        CHANNEL {channel}
      </motion.span>

      {/* Main Label */}
      <motion.span
        className={`text-2xl md:text-3xl font-['Oswald'] uppercase ${isActive ? 'text-white' : 'text-neutral-600'}`}
        animate={{
          textShadow: isActive ? colorConfig.labelGlow : 'none',
          scale: isActive ? 1 : 0.95
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        {label}
      </motion.span>

      {/* Active Corners - Animated */}
      {isActive && (
        <>
          <motion.div
            className={`absolute w-3 h-3 border-t-2 border-l-2 ${colorConfig.border}`}
            initial={{ top: -10, left: -10, opacity: 0 }}
            animate={{ top: 0, left: 0, opacity: 1 }}
            transition={{ duration: 0.3 }}
          />
          <motion.div
            className={`absolute w-3 h-3 border-b-2 border-r-2 ${colorConfig.border}`}
            initial={{ bottom: -10, right: -10, opacity: 0 }}
            animate={{ bottom: 0, right: 0, opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          />
        </>
      )}

      {/* Texture Overlay for Distortion */}
      {showTexture && isActive && (
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20 pointer-events-none mix-blend-overlay" />
      )}

      {/* Scan Line Effect for Active */}
      {isActive && (
        <motion.div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{
            background: `linear-gradient(transparent 50%, rgba(0,0,0,0.1) 50%)`,
            backgroundSize: '100% 4px'
          }}
          animate={{ opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
    </motion.button>
  );
};

interface AmpModelSwitchProps {
  model: AmpModel;
  isDistorted: boolean;
  onChange: (model: AmpModel) => void;
}

const AMP_OPTIONS: { value: AmpModel; label: string; title: string }[] = [
  { value: 'classic', label: 'Classic', title: 'The original synth and distortion' },
  { value: 'modern', label: 'New', title: 'Two-stage preamp, tone stack and cabinet, with palm-mute and dead-note articulation' }
];

/** A/B between the classic synth chain and the New amp chain; applies to every sound in the app. */
export const AmpModelSwitch: React.FC<AmpModelSwitchProps> = ({ model, isDistorted, onChange }) => {
  const active = isDistorted
    ? 'bg-rose-500/20 border-rose-500/60 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.25)]'
    : 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.25)]';
  const ring = isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500';
  return (
    <div role="group" aria-label="Amp model" className="flex items-center gap-2">
      <span className="text-[10px] font-mono text-neutral-400 uppercase" aria-hidden="true">
        Amp
      </span>
      <div className="flex gap-1 rounded-full border border-white/10 bg-neutral-900/60 p-0.5">
        {AMP_OPTIONS.map((option) => {
          const pressed = option.value === model;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={pressed}
              title={option.title}
              onClick={() => onChange(option.value)}
              className={`min-h-[44px] md:min-h-0 md:h-6 px-3 rounded-full border font-mono text-[10px] uppercase tracking-widest transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 ${ring} ${
                pressed ? active : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
