import React from 'react';
import type { FingerNumber, HandProfile, Tuning } from '../../engine/types';
import { getTuning } from '../../engine/tuning';
import { degreesByString } from '../../engine/naming';
import { midiToName, parsePitchClass } from '../../engine/pitch';
import { toRiffForgeTab } from '../../engine/shape';
import { useRiffStore } from '../../stores/riffStore';
import { MAX_RHYTHM_SLOTS, useRhythmStore, type RhythmSlot } from '../../stores/rhythmStore';
import { displayFingering, slotCandidates, slotShapesKey } from '../../utils/rhythmSlots';
import { VoicingTab } from '../VoicingTab';
import { SECTION_LABEL, pillClass, type RhythmTheme } from './theme';

interface RhythmSlotsStripProps {
  theme: RhythmTheme;
  isDistorted: boolean;
  tuning: Tuning;
  profile: HandProfile;
  /** Power chord on the selected root, played by slot hits while there are no slots. */
  implicitSlot: RhythmSlot | null;
  onAnnounce: (message: string) => void;
}

const slotTuning = (slot: RhythmSlot, fallback: Tuning): Tuning => getTuning(slot.tuningId) ?? fallback;

const SlotTab: React.FC<{ slot: RhythmSlot; fingers: readonly (FingerNumber | null)[]; tuning: Tuning; isDistorted: boolean }> = ({
  slot,
  fingers,
  tuning,
  isDistorted
}) => (
  <VoicingTab
    shape={slot.shape}
    fingers={fingers}
    degreesByString={degreesByString(slot.shape, tuning, parsePitchClass(slot.root) ?? 0)}
    tuning={tuning}
    isDistorted={isDistorted}
    compact
  />
);

/** Up to four harmony slots with finger numbers, voicing cycling, removal and the fingering optimizer. */
export const RhythmSlotsStrip: React.FC<RhythmSlotsStripProps> = ({ theme, isDistorted, tuning, profile, implicitSlot, onAnnounce }) => {
  const slots = useRhythmStore((s) => s.slots);
  const optimization = useRhythmStore((s) => s.optimization);
  const removeSlot = useRhythmStore((s) => s.removeSlot);
  const setSlotShape = useRhythmStore((s) => s.setSlotShape);
  const optimizeSlots = useRhythmStore((s) => s.optimizeSlots);
  const riffStepCount = useRiffStore((s) => s.steps.length);

  const optimized = optimization !== null && optimization.shapesKey === slotShapesKey(slots) ? optimization : null;

  const fingersFor = (slot: RhythmSlot, index: number): (FingerNumber | null)[] =>
    optimized?.fingers[index] ?? displayFingering(slot.shape, slotTuning(slot, tuning), profile)?.fingers ?? slot.shape.map(() => null);

  const cycleVoicing = (slot: RhythmSlot, index: number) => {
    const candidates = slotCandidates(slot, tuning, profile);
    const keys = candidates.map((c) => toRiffForgeTab(c.shape));
    const current = keys.indexOf(toRiffForgeTab(slot.shape));
    const next = candidates[(current + 1) % Math.max(1, candidates.length)];
    if (!next || candidates.length < 2) {
      onAnnounce(`Slot ${index + 1}: no other playable voicing for your hand profile.`);
      return;
    }
    setSlotShape(slot.id, next.shape);
    onAnnounce(`Slot ${index + 1}, ${slot.label}: now ${toRiffForgeTab(next.shape)}, ${next.name}.`);
  };

  const handleOptimize = () => {
    const out = optimizeSlots(profile, tuning);
    onAnnounce(out.ok === true ? `Fingerings optimized. ${out.text}` : out.message);
  };

  const handleCopyRiff = () => {
    const made = useRhythmStore.getState().useRiffBarChords(tuning, profile);
    onAnnounce(made > 0 ? `${made} RiffBar chord${made === 1 ? '' : 's'} copied into the slots.` : 'No playable RiffBar chords to copy.');
  };

  const handleRemove = (slot: RhythmSlot, index: number) => {
    removeSlot(slot.id);
    onAnnounce(`Removed slot ${index + 1}, ${slot.label}.`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
        <h3 className={SECTION_LABEL}>
          Chord slots <span className="text-neutral-300">{slots.length}/{MAX_RHYTHM_SLOTS}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyRiff}
            disabled={riffStepCount === 0}
            title={riffStepCount === 0 ? 'Add chords to the RiffBar first' : 'Replace the slots with the first four different RiffBar chords'}
            className={pillClass(theme)}
          >
            Copy from RiffBar
          </button>
          <button
            type="button"
            onClick={handleOptimize}
            disabled={slots.length < 2}
            title={slots.length < 2 ? 'Needs at least two slots' : 'Choose the voicings whose hardest change is easiest at this tempo'}
            className={pillClass(theme)}
          >
            Optimize fingerings
          </button>
        </div>
      </div>

      {optimized && (
        <p className="mb-2 px-1 font-mono text-[11px] text-neutral-300 leading-snug">
          <span className={theme.text}>Optimized:</span> {optimized.text}
        </p>
      )}

      {slots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-black/30 p-4 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-neutral-200">No chord slots yet.</p>
            <p className="mt-1 text-sm text-neutral-400 font-light leading-snug">
              Send voicings here from the Voicing Finder, or copy the RiffBar. Up to four slots; accented hits move the
              harmony between them. Slots stay put when the RiffBar changes.
            </p>
            {implicitSlot && (
              <p className="mt-2 font-mono text-[11px] text-neutral-400">
                Until then, chord hits play <span className={theme.text}>{implicitSlot.label}</span> on the selected root.
              </p>
            )}
          </div>
          {implicitSlot && (
            <div className="shrink-0" aria-label={`Implicit ${implicitSlot.label} power chord`}>
              <SlotTab
                slot={implicitSlot}
                fingers={displayFingering(implicitSlot.shape, tuning, profile)?.fingers ?? implicitSlot.shape.map(() => null)}
                tuning={tuning}
                isDistorted={isDistorted}
              />
            </div>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {slots.map((slot, index) => {
            const own = slotTuning(slot, tuning);
            return (
              <li key={slot.id} className="rounded-lg border border-white/5 bg-black/40 p-3 flex flex-col gap-2 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className={SECTION_LABEL}>Slot {index + 1}</span>
                    <p className="font-['Oswald'] text-lg font-bold uppercase tracking-wide text-neutral-100 truncate leading-tight">
                      {slot.label}
                    </p>
                    <p className="font-mono text-[10px] text-neutral-400 truncate">
                      Pedal {slot.pedalMidi === null ? 'bass note' : midiToName(slot.pedalMidi)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => cycleVoicing(slot, index)}
                      aria-label={`Try another voicing for slot ${index + 1}, ${slot.label}`}
                      title="Next playable voicing"
                      className={`w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full border border-white/10 text-neutral-300 hover:text-white hover:border-white/30 font-mono text-[10px] uppercase transition-colors ${theme.ring}`}
                    >
                      Alt
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(slot, index)}
                      aria-label={`Remove slot ${index + 1}, ${slot.label}`}
                      className={`w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full border border-white/10 text-neutral-400 hover:text-white hover:border-white/30 transition-colors ${theme.ring}`}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
                <SlotTab slot={slot} fingers={fingersFor(slot, index)} tuning={own} isDistorted={isDistorted} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
