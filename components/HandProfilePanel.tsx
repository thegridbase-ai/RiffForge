import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useChordStore } from '../stores/chordStore';
import { useHandProfileStore } from '../stores/handProfileStore';
import { SCALE_LENGTH_PRESETS, MM_PER_INCH } from '../engine/geometry';
import {
  CALIBRATION_HIGH_INDEX_FRET,
  CALIBRATION_HIGH_PINKY_RANGE,
  CALIBRATION_LOW_INDEX_FRET,
  CALIBRATION_LOW_PINKY_RANGE,
  PROFILE_LIMITS,
  STRETCH_TOLERANCE_ALLOW
} from '../engine/handProfile';

export const HAND_PROFILE_DISCLAIMER =
  'This is comfort guidance, not a medical or safety assessment. Stop if you feel pain or tension.';

const MAX_FRET_RANGE = [5, 24] as const;
const TEMPO_RANGE = [60, 240] as const;
const TEMPO_STEP = 5;
const CUSTOM_SCALE_ID = 'custom';
const [SCALE_MIN_MM, SCALE_MAX_MM] = PROFILE_LIMITS.scaleLengthMm;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

const presetIdFor = (mm: number): string | null => SCALE_LENGTH_PRESETS.find((p) => Math.abs(p.mm - mm) < 0.05)?.id ?? null;

const useIsDesktop = (): boolean => {
  const query = '(min-width: 768px)';
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return matches;
};

/** Clipboard API first, then a hidden textarea + execCommand for older or locked-down browsers. */
const copyText = async (text: string, host: HTMLElement | null): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: try the fallback
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    (host ?? document.body).appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
};

const ringClass = (isDistorted: boolean): string =>
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}`;

const SectionLabel: React.FC<{ id?: string; children: React.ReactNode }> = ({ id, children }) => (
  <h3 id={id} className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest mb-2 px-1">
    {children}
  </h3>
);

interface RadioOption {
  value: string;
  label: string;
  ariaLabel?: string;
}

interface SegmentedRadioProps {
  labelledBy: string;
  describedBy?: string;
  options: readonly RadioOption[];
  value: string;
  onChange: (value: string) => void;
  isDistorted: boolean;
}

/** Single-select segmented control with radio semantics: one tab stop, arrow keys move the selection. */
const SegmentedRadio: React.FC<SegmentedRadioProps> = ({ labelledBy, describedBy, options, value, onChange, isDistorted }) => {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 ? selected : 0;

  const select = (index: number) => {
    const next = (index + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (e.key in moves) {
      e.preventDefault();
      select(index + moves[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      select(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      select(options.length - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="grid gap-1 bg-neutral-900/50 p-1 rounded-lg border border-white/5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, i) => {
        const checked = i === selected;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`
              relative h-11 md:h-10 min-w-0 flex items-center justify-center font-['Oswald'] tracking-widest text-xs font-bold transition-all duration-200
              focus-visible:outline-none focus-visible:ring-2 focus-visible:z-10 ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}
              ${checked
                ? `bg-neutral-800 text-white border ${isDistorted ? 'border-rose-900/50' : 'border-cyan-900/50'}`
                : 'text-neutral-400 hover:text-neutral-200 border border-transparent'}
            `}
          >
            {option.label}
            {checked && <span aria-hidden="true" className={`absolute bottom-0 w-1/3 h-0.5 ${isDistorted ? 'bg-rose-500' : 'bg-cyan-500'}`} />}
          </button>
        );
      })}
    </div>
  );
};

interface SwitchRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  isDistorted: boolean;
}

const SwitchRow: React.FC<SwitchRowProps> = ({ label, description, checked, onChange, isDistorted }) => {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      onClick={() => onChange(!checked)}
      className={`w-full min-h-[44px] flex items-center justify-between gap-4 px-3 py-2.5 rounded-lg border text-left transition-colors duration-200 ${ringClass(isDistorted)}
        ${checked
          ? isDistorted ? 'border-rose-500/40 bg-rose-500/[0.07]' : 'border-cyan-500/40 bg-cyan-500/[0.07]'
          : 'border-white/10 bg-neutral-900/50 hover:border-white/25'}`}
    >
      <span className="flex flex-col gap-0.5 min-w-0">
        <span id={labelId} className="font-mono text-xs uppercase tracking-widest text-neutral-100">{label}</span>
        <span id={descriptionId} className="font-mono text-[11px] text-neutral-400 leading-snug">{description}</span>
      </span>
      <span aria-hidden="true" className="flex items-center gap-2 shrink-0">
        <span className={`font-mono text-[10px] uppercase tracking-widest w-6 text-right ${checked ? (isDistorted ? 'text-rose-400' : 'text-cyan-400') : 'text-neutral-400'}`}>
          {checked ? 'On' : 'Off'}
        </span>
        <span className={`relative w-10 h-5 rounded-full border transition-colors duration-200 ${checked ? (isDistorted ? 'border-rose-500/60 bg-rose-500/30' : 'border-cyan-500/60 bg-cyan-500/30') : 'border-white/15 bg-neutral-800'}`}>
          <span
            className={`absolute top-[3px] left-[3px] w-3 h-3 rounded-full transition-transform duration-200 ${checked ? `translate-x-5 ${isDistorted ? 'bg-rose-400' : 'bg-cyan-400'}` : 'translate-x-0 bg-neutral-400'}`}
          />
        </span>
      </span>
    </button>
  );
};

interface StepperRowProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  isDistorted: boolean;
}

const StepperRow: React.FC<StepperRowProps> = ({ label, unit, value, min, max, step, onChange, isDistorted }) => {
  const labelId = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const buttonClass = `w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-full border border-white/15 font-mono text-base text-neutral-200 hover:border-white/40 transition-colors duration-200 disabled:opacity-30 disabled:cursor-default ${ringClass(isDistorted)}`;
  return (
    <div role="group" aria-labelledby={labelId} className="flex items-center justify-between gap-4 px-3 py-1.5 rounded-lg border border-white/10 bg-neutral-900/50">
      <span id={labelId} className="font-mono text-xs uppercase tracking-widest text-neutral-100">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))} className={buttonClass}>
          &minus;
        </button>
        <output aria-live="polite" className="w-14 flex flex-col items-center leading-none">
          <span className={`font-mono text-base font-bold ${isDistorted ? 'text-rose-400' : 'text-cyan-400'}`}>{value}</span>
          <span className="font-mono text-[9px] text-neutral-400 uppercase tracking-widest mt-1">{unit}</span>
        </output>
        <button type="button" aria-label={`Increase ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))} className={buttonClass}>
          +
        </button>
      </div>
    </div>
  );
};

interface HandProfilePanelProps {
  open: boolean;
  onClose: () => void;
}

/** Hand profile drawer: right panel on md+, bottom sheet on mobile. Modal, focus-trapped, Escape closes. */
export const HandProfilePanel: React.FC<HandProfilePanelProps> = ({ open, onClose }) => {
  const isDistorted = useChordStore((s) => s.isDistorted);
  const profile = useHandProfileStore((s) => s.profile);
  const calibration = useHandProfileStore((s) => s.calibration);
  const setCalibration = useHandProfileStore((s) => s.setCalibration);
  const resetProfile = useHandProfileStore((s) => s.resetProfile);
  const exportProfileJson = useHandProfileStore((s) => s.exportProfileJson);

  const reduceMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const titleId = useId();
  const scaleLabelId = useId();
  const lowQuestionId = useId();
  const highQuestionId = useId();
  const customInputId = useId();
  const customErrorId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [customMode, setCustomMode] = useState(() => presetIdFor(calibration.scaleLengthMm) === null);
  const [customText, setCustomText] = useState(() => String(Math.round(calibration.scaleLengthMm * 10) / 10));
  const [status, setStatus] = useState('');

  // Focus in on open, trap Tab, close on Escape, and hand focus back to the opener on close
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => titleRef.current?.focus());

    // Tab order only: roving radios (tabindex -1) and the programmatic title focus are not stops
    const focusables = (): HTMLElement[] =>
      panelRef.current ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0) : [];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && index <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && (index === -1 || index === items.length - 1)) {
        e.preventDefault();
        items[0].focus();
      }
    };
    // Anything that still lands focus outside (a click elsewhere, assistive tech) is pulled back in
    const onFocusIn = (e: FocusEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) titleRef.current?.focus();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      document.body.style.overflow = previousOverflow;
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const scaleValue = customMode ? CUSTOM_SCALE_ID : presetIdFor(calibration.scaleLengthMm) ?? CUSTOM_SCALE_ID;
  const customNumber = Number(customText);
  const customValid = customText.trim() !== '' && Number.isFinite(customNumber) && customNumber >= SCALE_MIN_MM && customNumber <= SCALE_MAX_MM;

  const onScaleChange = (id: string) => {
    if (id === CUSTOM_SCALE_ID) {
      setCustomMode(true);
      setCustomText(String(Math.round(calibration.scaleLengthMm * 10) / 10));
      return;
    }
    const preset = SCALE_LENGTH_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setCustomMode(false);
    setCalibration({ scaleLengthMm: preset.mm });
  };

  const onCustomChange = (text: string) => {
    setCustomText(text);
    const mm = Number(text);
    if (text.trim() !== '' && Number.isFinite(mm) && mm >= SCALE_MIN_MM && mm <= SCALE_MAX_MM) setCalibration({ scaleLengthMm: mm });
  };

  const onCopy = useCallback(async () => {
    const ok = await copyText(exportProfileJson(), panelRef.current);
    copyButtonRef.current?.focus();
    setStatus(ok ? 'Profile JSON copied. Paste it into Chord Explorer to use the same hand there.' : 'Copy failed: the browser blocked clipboard access.');
  }, [exportProfileJson]);

  const onReset = () => {
    resetProfile();
    setCustomMode(false);
    setStatus('Hand profile reset to the defaults.');
  };

  const accentText = isDistorted ? 'text-rose-400' : 'text-cyan-400';
  const pillClass = `flex items-center justify-center gap-1.5 px-4 h-11 md:h-9 rounded-full border font-mono text-[10px] uppercase tracking-widest transition-all duration-200 ${ringClass(isDistorted)}`;

  const transition = reduceMotion ? { duration: 0.12 } : { duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] as const };
  const hidden = reduceMotion ? { opacity: 0 } : isDesktop ? { x: '100%' } : { y: '100%' };
  const shown = reduceMotion ? { opacity: 1 } : isDesktop ? { x: 0 } : { y: 0 };

  const lowReach = Math.round(profile.reachAtLowMm);
  const highReach = Math.round(profile.reachAtHighMm);
  const stretchOn = calibration.allowStretches;

  return (
    <AnimatePresence>
      {open && (
        <div key="hand-profile" className="fixed inset-0 z-[70]">
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={hidden}
            animate={shown}
            exit={hidden}
            transition={transition}
            className={`
              absolute inset-x-0 bottom-0 max-h-[85vh] flex flex-col rounded-t-2xl border-t
              md:inset-x-auto md:right-0 md:top-0 md:bottom-0 md:h-full md:max-h-none md:w-full md:max-w-md md:rounded-none md:border-t-0 md:border-l
              shadow-[0_-12px_40px_rgba(0,0,0,0.6)] md:shadow-[-12px_0_40px_rgba(0,0,0,0.6)]
              ${isDistorted ? 'bg-[#0f0607]/95 border-rose-900/40' : 'bg-[#0b0b0c]/95 border-white/10'}
            `}
          >
            <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-white/5">
              <div className="min-w-0">
                <h2
                  id={titleId}
                  ref={titleRef}
                  tabIndex={-1}
                  className="font-['Oswald'] text-2xl font-bold uppercase tracking-wide text-neutral-100 focus:outline-none"
                >
                  Hand <span className={accentText}>profile</span>
                </h2>
                <p className="font-['Share_Tech_Mono'] text-xs text-neutral-400 tracking-wider mt-1">
                  Calibrate reach so every shape fits your fretting hand.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close hand profile"
                className={`shrink-0 w-11 h-11 flex items-center justify-center rounded-full border border-white/15 text-neutral-300 hover:border-white/40 hover:text-neutral-100 transition-colors duration-200 ${ringClass(isDistorted)}`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-6"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: isDistorted ? 'rgba(244,63,94,0.3) transparent' : 'rgba(34,211,238,0.3) transparent'
              }}
            >
              <section>
                <SectionLabel id={scaleLabelId}>Scale length</SectionLabel>
                <SegmentedRadio
                  labelledBy={scaleLabelId}
                  options={[
                    ...SCALE_LENGTH_PRESETS.map((p) => ({ value: p.id, label: p.label, ariaLabel: `${p.label.replace('"', '')} inch scale` })),
                    { value: CUSTOM_SCALE_ID, label: 'Custom', ariaLabel: 'Custom scale length' }
                  ]}
                  value={scaleValue}
                  onChange={onScaleChange}
                  isDistorted={isDistorted}
                />
                {scaleValue === CUSTOM_SCALE_ID && (
                  <div className="mt-3 px-1">
                    <label htmlFor={customInputId} className="block font-mono text-[11px] text-neutral-300 mb-1.5">
                      Scale length in mm ({SCALE_MIN_MM} to {SCALE_MAX_MM})
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        id={customInputId}
                        type="number"
                        inputMode="decimal"
                        min={SCALE_MIN_MM}
                        max={SCALE_MAX_MM}
                        step={0.1}
                        value={customText}
                        onChange={(e) => onCustomChange(e.target.value)}
                        aria-invalid={!customValid}
                        aria-describedby={customValid ? undefined : customErrorId}
                        className={`w-32 h-11 md:h-10 px-3 rounded-lg bg-neutral-900/80 border font-mono text-sm text-neutral-100 ${ringClass(isDistorted)}
                          ${customValid ? 'border-white/15' : 'border-amber-400/70'}`}
                      />
                      {customValid && (
                        <span className="font-mono text-[11px] text-neutral-400">= {(customNumber / MM_PER_INCH).toFixed(2)}"</span>
                      )}
                    </div>
                    {!customValid && (
                      <p id={customErrorId} className="mt-1.5 font-mono text-[11px] text-amber-300">
                        Enter a length between {SCALE_MIN_MM} and {SCALE_MAX_MM} mm.
                      </p>
                    )}
                  </div>
                )}
              </section>

              <section>
                <SectionLabel>Reach check 1</SectionLabel>
                <p id={lowQuestionId} className="px-1 mb-2.5 text-sm text-neutral-300 font-light leading-snug">
                  Index finger on fret {CALIBRATION_LOW_INDEX_FRET} of the low string. Which is the highest fret your pinky
                  reaches comfortably on the same string?
                </p>
                <SegmentedRadio
                  labelledBy={lowQuestionId}
                  options={range(...CALIBRATION_LOW_PINKY_RANGE).map((f) => ({ value: String(f), label: String(f), ariaLabel: `Fret ${f}` }))}
                  value={String(calibration.lowPinkyFret)}
                  onChange={(v) => setCalibration({ lowPinkyFret: Number(v) })}
                  isDistorted={isDistorted}
                />
              </section>

              <section>
                <SectionLabel>Reach check 2</SectionLabel>
                <p id={highQuestionId} className="px-1 mb-2.5 text-sm text-neutral-300 font-light leading-snug">
                  Index finger on fret {CALIBRATION_HIGH_INDEX_FRET} of the low string. Which is the highest fret your pinky
                  reaches comfortably on the same string?
                </p>
                <SegmentedRadio
                  labelledBy={highQuestionId}
                  options={range(...CALIBRATION_HIGH_PINKY_RANGE).map((f) => ({ value: String(f), label: String(f), ariaLabel: `Fret ${f}` }))}
                  value={String(calibration.highPinkyFret)}
                  onChange={(v) => setCalibration({ highPinkyFret: Number(v) })}
                  isDistorted={isDistorted}
                />
              </section>

              <section className="space-y-2">
                <SectionLabel>Rules</SectionLabel>
                <SwitchRow
                  label="No barre chords"
                  description="Every finger presses one string."
                  checked={calibration.noBarre}
                  onChange={(noBarre) => setCalibration({ noBarre })}
                  isDistorted={isDistorted}
                />
                <SwitchRow
                  label="Allow stretches"
                  description={`+${Math.round((STRETCH_TOLERANCE_ALLOW - 1) * 100)} percent reach on top of your comfort.`}
                  checked={calibration.allowStretches}
                  onChange={(allowStretches) => setCalibration({ allowStretches })}
                  isDistorted={isDistorted}
                />
                <SwitchRow
                  label="Allow open strings"
                  description="Open strings can ring inside a shape."
                  checked={calibration.allowOpenStrings}
                  onChange={(allowOpenStrings) => setCalibration({ allowOpenStrings })}
                  isDistorted={isDistorted}
                />
                <StepperRow
                  label="Highest fret"
                  unit="Fret"
                  value={calibration.maxFret}
                  min={MAX_FRET_RANGE[0]}
                  max={MAX_FRET_RANGE[1]}
                  step={1}
                  onChange={(maxFret) => setCalibration({ maxFret })}
                  isDistorted={isDistorted}
                />
                <StepperRow
                  label="Comfortable 16th-note tempo"
                  unit="BPM"
                  value={calibration.comfortableSixteenthBpm}
                  min={TEMPO_RANGE[0]}
                  max={TEMPO_RANGE[1]}
                  step={TEMPO_STEP}
                  onChange={(comfortableSixteenthBpm) => setCalibration({ comfortableSixteenthBpm })}
                  isDistorted={isDistorted}
                />
              </section>

              <section>
                <SectionLabel>Your reach</SectionLabel>
                <dl aria-live="polite" className="rounded-lg border border-white/5 bg-black/40 divide-y divide-white/5 font-mono text-xs">
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <dt className="text-neutral-400">Low reach</dt>
                    <dd className="text-neutral-100">
                      <span className={`font-bold ${accentText}`}>{lowReach} mm</span> (fret {CALIBRATION_LOW_INDEX_FRET} &rarr; {calibration.lowPinkyFret})
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <dt className="text-neutral-400">High reach</dt>
                    <dd className="text-neutral-100">
                      <span className={`font-bold ${accentText}`}>{highReach} mm</span> (fret {CALIBRATION_HIGH_INDEX_FRET} &rarr; {calibration.highPinkyFret})
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <dt className="text-neutral-400">With stretch</dt>
                    <dd className="text-neutral-100 text-right">
                      {Math.round(profile.reachAtLowMm * STRETCH_TOLERANCE_ALLOW)} / {Math.round(profile.reachAtHighMm * STRETCH_TOLERANCE_ALLOW)} mm{' '}
                      <span className={stretchOn ? accentText : 'text-neutral-400'}>({stretchOn ? 'allowed' : 'off'})</span>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <div className="px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/5 space-y-3">
              <p className="flex gap-2 font-mono text-[11px] leading-snug text-neutral-300">
                <svg className="w-3.5 h-3.5 mt-px shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{HAND_PROFILE_DISCLAIMER}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  ref={copyButtonRef}
                  type="button"
                  onClick={onCopy}
                  className={`${pillClass} ${isDistorted ? 'bg-rose-500/20 border-rose-500/60 text-rose-400 hover:bg-rose-500/30' : 'bg-cyan-500/20 border-cyan-500/60 text-cyan-400 hover:bg-cyan-500/30'}`}
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy profile JSON
                </button>
                <button
                  type="button"
                  onClick={onReset}
                  className={`${pillClass} border-white/10 text-neutral-300 hover:text-neutral-100 hover:border-white/30`}
                >
                  Reset
                </button>
                <p role="status" aria-live="polite" className="flex-1 min-w-[8rem] font-mono text-[11px] leading-snug text-neutral-300">
                  {status}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
