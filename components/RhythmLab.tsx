import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioEngine } from '../services/audioEngine';
import { useChordStore } from '../stores/chordStore';
import { useRiffStore } from '../stores/riffStore';
import { scheduleRhythmRestart, useRhythmHandProfile, useRhythmStore } from '../stores/rhythmStore';
import { gridUnitTicks } from '../engine/rhythm/grid';
import { rhythmToPlaybackEvents } from '../engine/rhythm/playback';
import { validateRhythm } from '../engine/rhythm/validate';
import type { HarmonySlot } from '../engine/types';
import { tuningForMode } from '../utils/libraryVoicing';
import { rhythmToMidi } from '../utils/midi';
import { clickTimes, implicitPowerSlot, loopSeconds, secondsPerTick, toHarmonySlots } from '../utils/rhythmSlots';
import { RhythmStylePanel } from './rhythm/RhythmStylePanel';
import { RhythmTransport } from './rhythm/RhythmTransport';
import { RhythmSlotsStrip } from './rhythm/RhythmSlotsStrip';
import { RhythmGrid } from './rhythm/RhythmGrid';
import { rhythmTheme } from './rhythm/theme';

/** Restart debounce while a slider is dragged during playback. */
const RESTART_DELAY_MS = 60;

/**
 * Metal Rhythm Lab: seeded rhythm patterns over up to four chord slots, with playback, metronome, MIDI
 * export, an editable grid and the fingering optimizer. Self-contained: reads the chord, riff and rhythm stores.
 */
export const RhythmLab: React.FC = () => {
  const isDistorted = useChordStore((s) => s.isDistorted);
  const tuningMode = useChordStore((s) => s.tuningMode);
  const selectedRoot = useChordStore((s) => s.selectedRoot);
  const riffStepCount = useRiffStore((s) => s.steps.length);
  const profile = useRhythmHandProfile();

  const pattern = useRhythmStore((s) => s.pattern);
  const slots = useRhythmStore((s) => s.slots);
  const bpm = useRhythmStore((s) => s.bpm);
  const isPlaying = useRhythmStore((s) => s.isPlaying);
  const metronomeOn = useRhythmStore((s) => s.metronomeOn);
  const setBpm = useRhythmStore((s) => s.setBpm);
  const setMetronome = useRhythmStore((s) => s.setMetronome);
  const setIsPlaying = useRhythmStore((s) => s.setIsPlaying);
  const newIdea = useRhythmStore((s) => s.newIdea);
  const mutate = useRhythmStore((s) => s.mutate);

  const theme = rhythmTheme(isDistorted);
  const tuning = tuningForMode(tuningMode);
  const implicitSlot = useMemo(() => implicitPowerSlot(selectedRoot, tuning, profile), [selectedRoot, tuning, profile]);
  const harmony: HarmonySlot[] = useMemo(
    () => (slots.length > 0 ? toHarmonySlots(slots) : implicitSlot ? toHarmonySlots([implicitSlot]) : []),
    [slots, implicitSlot]
  );
  const slotLabels = useMemo(() => slots.map((s) => s.label), [slots]);

  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => {
    // Clearing first makes screen readers repeat an identical message
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(message), 30);
  }, []);

  // Slots follow the app tuning (Standard / Drop): re-voice the ones made for the other tuning
  useEffect(() => {
    const dropped = useRhythmStore.getState().retuneSlots(tuning, profile);
    if (dropped > 0) announce(`${dropped} slot${dropped === 1 ? '' : 's'} had no playable voicing in ${tuning.name} and were removed.`);
  }, [tuning, profile, announce]);

  const latest = useRef({ harmony, tuning });
  latest.current = { harmony, tuning };

  const play = useCallback(() => {
    const state = useRhythmStore.getState();
    const { pattern: current, bpm: tempo } = state;
    const events = rhythmToPlaybackEvents(current, latest.current.harmony, latest.current.tuning, tempo);
    audioEngine.playRhythm(events, {
      loopSeconds: loopSeconds(current, tempo),
      bpm: tempo,
      clickTimes: clickTimes(current, tempo),
      metronome: state.metronomeOn,
      stepSeconds: gridUnitTicks(current.params.grid) * secondsPerTick(tempo),
      onStep: (unit) => useRhythmStore.getState().setPlayheadUnit(unit)
    });
  }, []);

  const startPlayback = useCallback(async () => {
    const chord = useChordStore.getState();
    if (!chord.isAudioReady || !audioEngine.isReady()) {
      await audioEngine.init();
      audioEngine.setDistortion(chord.isDistorted);
      chord.setIsAudioReady(true);
    }
    // The RiffBar shares the Transport: stop it and reset its state before the rhythm takes over
    const riff = useRiffStore.getState();
    if (riff.isPlaying || audioEngine.isSequencePlaying()) {
      audioEngine.stopSequence();
      riff.setIsPlaying(false);
      riff.setCurrentStep(-1);
    }
    play();
    setIsPlaying(true);
  }, [play, setIsPlaying]);

  const stopPlayback = useCallback(() => {
    audioEngine.stopRhythm();
    setIsPlaying(false);
  }, [setIsPlaying]);

  // The RiffBar (playSequence) stops the rhythm through the engine: mirror it in the store
  useEffect(
    () =>
      audioEngine.onRhythmStopped(() => {
        useRhythmStore.getState().setIsPlaying(false);
      }),
    []
  );

  // Restart cleanly (same loop position) when the pattern, slots, tuning or tempo change mid-playback
  useEffect(() => {
    if (!useRhythmStore.getState().isPlaying) return;
    return scheduleRhythmRestart(play, RESTART_DELAY_MS);
  }, [pattern, harmony, tuning, bpm, play]);

  useEffect(
    () => () => {
      if (audioEngine.isRhythmPlaying()) audioEngine.stopRhythm();
      useRhythmStore.getState().setIsPlaying(false);
    },
    []
  );

  const handleMetronome = () => {
    const next = !metronomeOn;
    setMetronome(next);
    audioEngine.setRhythmMetronome(next);
  };

  const handleNewIdea = () => {
    newIdea();
    const { pattern: next, lockedBars } = useRhythmStore.getState();
    announce(`New idea: ${next.name}${lockedBars.length > 0 ? `, locked bars kept: ${lockedBars.map((b) => b + 1).join(', ')}` : ''}.`);
  };

  const handleMutate = () => {
    const changed = mutate();
    announce(changed ? 'Mutated: one small change outside the locked bars.' : 'No mutation found outside the locked bars.');
  };

  const handleExportMidi = () => {
    const { pattern: current, bpm: tempo } = useRhythmStore.getState();
    const bytes = rhythmToMidi(current, harmony, tuning, tempo);
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `rhythm-${current.params.style}-${tempo}bpm.mid`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    announce(`Exported ${anchor.download}.`);
  };

  const handleUseRiffChords = () => {
    const made = useRhythmStore.getState().useRiffBarChords(tuning, profile);
    announce(made > 0 ? `${made} RiffBar chord${made === 1 ? '' : 's'} loaded as slots.` : 'No playable RiffBar chords to load.');
  };

  const warnings = useMemo(
    () => validateRhythm(pattern, { bpm, comfortableSixteenthBpm: profile.comfortableSixteenthBpm }).warnings,
    [pattern, bpm, profile.comfortableSixteenthBpm]
  );

  const meter = `${pattern.meter.numerator}/${pattern.meter.denominator}`;

  return (
    <section
      aria-labelledby="rhythm-lab-heading"
      className="w-full rounded-xl border border-white/5 bg-black/40 backdrop-blur-md p-4 md:p-6 shadow-2xl"
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mb-5">
        <div className="min-w-0">
          <h2 id="rhythm-lab-heading" className="font-['Oswald'] text-2xl md:text-3xl font-bold uppercase tracking-tight text-neutral-100">
            Rhythm <span className={theme.textStrong} style={{ textShadow: theme.glow }}>Lab</span>
          </h2>
          <p className="font-['Share_Tech_Mono'] text-xs text-neutral-400 uppercase tracking-widest truncate">
            {pattern.name} // {meter} // {pattern.bars} bar{pattern.bars === 1 ? '' : 's'} // {tuning.name}
          </p>
        </div>
        {pattern.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Pattern tags">
            {pattern.tags.map((tag) => (
              <li key={tag} className="px-2 py-0.5 rounded-full border border-white/10 font-mono text-[10px] uppercase tracking-widest text-neutral-300">
                {tag}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="space-y-6">
        <RhythmStylePanel theme={theme} onAnnounce={announce} />

        <RhythmTransport
          theme={theme}
          isPlaying={isPlaying}
          metronomeOn={metronomeOn}
          bpm={bpm}
          riffStepCount={riffStepCount}
          onPlayToggle={isPlaying ? stopPlayback : startPlayback}
          onMetronomeToggle={handleMetronome}
          onBpmChange={setBpm}
          onNewIdea={handleNewIdea}
          onMutate={handleMutate}
          onExportMidi={handleExportMidi}
          onUseRiffChords={handleUseRiffChords}
        />

        <RhythmSlotsStrip
          theme={theme}
          isDistorted={isDistorted}
          tuning={tuning}
          profile={profile}
          implicitSlot={implicitSlot}
          onAnnounce={announce}
        />

        <RhythmGrid theme={theme} slotLabels={slotLabels} onAnnounce={announce} />

        <div role="status" aria-live="polite" className="space-y-2">
          {warnings.map((w) => (
            <p
              key={w.code}
              className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-100/90 font-light leading-snug"
            >
              <span className="font-mono text-[10px] uppercase tracking-widest text-amber-300 mr-2">Tempo note</span>
              {w.message} Comfortable up to about {w.bpmLimit} BPM for this pattern. This is comfort guidance, not a
              medical or safety assessment. Stop if you feel pain or tension.
            </p>
          ))}
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </div>
    </section>
  );
};
