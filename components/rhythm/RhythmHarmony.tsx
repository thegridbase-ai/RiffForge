import React from 'react';
import type { FingerNumber, HandProfile, Tuning } from '../../engine/types';
import { degreesByString } from '../../engine/naming';
import { midiToName, parsePitchClass } from '../../engine/pitch';
import { toRiffForgeTab } from '../../engine/shape';
import { MAX_PROGRESSION_CHORDS, type ProgressionArrangement } from '../../engine/rhythm/progression';
import { useRiffStore } from '../../stores/riffStore';
import { useRhythmStore, type ChordChange, type HarmonySource, type RhythmSlot } from '../../stores/rhythmStore';
import {
  displayFingering,
  distinctChords,
  progressionOverrideKey,
  sameChordIds,
  slotCandidates,
  slotShapesKey
} from '../../utils/rhythmSlots';
import { VoicingTab } from '../VoicingTab';
import { RhythmSlotsStrip } from './RhythmSlotsStrip';
import { Segmented, type SegmentOption } from './RhythmStylePanel';
import { SECTION_LABEL, pillClass, type RhythmTheme } from './theme';

interface RhythmHarmonyProps {
  theme: RhythmTheme;
  isDistorted: boolean;
  tuning: Tuning;
  profile: HandProfile;
  /** Power chord on the selected root, played by chord hits while there is nothing else to play. */
  implicitSlot: RhythmSlot | null;
  /** The RiffBar as the lab plays it (current tuning, lab voicings applied). */
  progression: RhythmSlot[];
  /** The figure laid over the progression, when chords change by bar or half bar. */
  arrangement: ProgressionArrangement | null;
  onAnnounce: (message: string) => void;
}

const SOURCE_OPTIONS: SegmentOption<HarmonySource>[] = [
  { value: 'riffbar', label: 'RiffBar', aria: 'Play the RiffBar chords in order' },
  { value: 'slots', label: 'Own slots', aria: "Play the lab's own chord slots" }
];

const CHANGE_OPTIONS: SegmentOption<ChordChange>[] = [
  { value: 'bar', label: 'Every bar', aria: 'Change chord every bar' },
  { value: 'halfBar', label: 'Half bar', aria: 'Change chord every half bar' },
  { value: 'accents', label: 'On accents', aria: 'Change chord on accented hits' }
];

const CHANGE_SPOKEN: Record<ChordChange, string> = {
  bar: 'RiffBar chords change every bar',
  halfBar: 'RiffBar chords change every half bar',
  accents: 'accented hits move between the first four different RiffBar chords'
};

/** Where a chord sits in the progression: its bar, its half bar, or its slot on accents. */
const positionLabel = (change: ChordChange, index: number): string => {
  if (change === 'bar') return `Bar ${index + 1}`;
  if (change === 'halfBar') return `Bar ${Math.floor(index / 2) + 1} · ${index % 2 === 0 ? '1st' : '2nd'} half`;
  return `Slot ${index + 1}`;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

const ChordTab: React.FC<{ chord: RhythmSlot; fingers: readonly (FingerNumber | null)[]; tuning: Tuning; isDistorted: boolean }> = ({
  chord,
  fingers,
  tuning,
  isDistorted
}) => (
  <VoicingTab
    shape={chord.shape}
    fingers={fingers}
    degreesByString={degreesByString(chord.shape, tuning, parsePitchClass(chord.root) ?? 0)}
    tuning={tuning}
    isDistorted={isDistorted}
    compact
  />
);

/** The RiffBar as the lab plays it: chords in order, lab-only voicings, the playing chord and the optimizer. */
const ProgressionStrip: React.FC<Omit<RhythmHarmonyProps, 'theme'> & { theme: RhythmTheme; change: ChordChange }> = ({
  theme,
  isDistorted,
  tuning,
  profile,
  implicitSlot,
  progression,
  arrangement,
  change,
  onAnnounce
}) => {
  const riffStepCount = useRiffStore((s) => s.steps.length);
  const overrides = useRhythmStore((s) => s.progressionOverrides);
  const optimization = useRhythmStore((s) => s.optimization);
  const isPlaying = useRhythmStore((s) => s.isPlaying);
  const playheadChord = useRhythmStore((s) => s.playheadChord);
  const figureBars = useRhythmStore((s) => s.pattern.bars);
  const setProgressionShape = useRhythmStore((s) => s.setProgressionShape);
  const resetProgressionShapes = useRhythmStore((s) => s.resetProgressionShapes);
  const optimizeHarmony = useRhythmStore((s) => s.optimizeHarmony);

  const shown = change === 'accents' ? distinctChords(progression) : progression;
  const optimized = optimization !== null && optimization.shapesKey === slotShapesKey(shown) ? optimization : null;
  const labVoiced = (chord: RhythmSlot) => overrides[progressionOverrideKey(chord.id, tuning.id)] !== undefined;
  const hasLabVoicings = progression.some(labVoiced);
  const playing = isPlaying && change !== 'accents' ? playheadChord : -1;
  const notPlayed = Math.max(0, riffStepCount - progression.length);

  const fingersFor = (chord: RhythmSlot, index: number): (FingerNumber | null)[] =>
    optimized?.fingers[index] ?? displayFingering(chord.shape, tuning, profile)?.fingers ?? chord.shape.map(() => null);

  const cycleVoicing = (chord: RhythmSlot, index: number) => {
    const candidates = slotCandidates(chord, tuning, profile);
    const keys = candidates.map((c) => toRiffForgeTab(c.shape));
    const next = candidates[(keys.indexOf(toRiffForgeTab(chord.shape)) + 1) % Math.max(1, candidates.length)];
    const where = positionLabel(change, index);
    if (!next || candidates.length < 2) {
      onAnnounce(`${where}: no other playable voicing for your hand profile.`);
      return;
    }
    // On accents a slot is every step that is the same chord; otherwise each step keeps its own voicing
    setProgressionShape(change === 'accents' ? sameChordIds(progression, chord) : chord.id, next.shape);
    onAnnounce(`${where}, ${chord.label}: now ${toRiffForgeTab(next.shape)} in the lab. The RiffBar keeps its voicing.`);
  };

  const handleOptimize = () => {
    const out = optimizeHarmony(profile, tuning);
    onAnnounce(out.ok === true ? `Fingerings optimized. ${out.text}` : out.message);
  };

  const handleReset = () => {
    resetProgressionShapes();
    onAnnounce('Lab voicings reset: the lab plays the RiffBar voicings again.');
  };

  const summary =
    change === 'accents'
      ? `Accented hits move between the first ${plural(shown.length, 'different chord')}; the figure decides when.`
      : arrangement
        ? `${plural(progression.length, 'chord')}, ${change === 'bar' ? 'one per bar' : 'one per half bar'}. Loop: ${plural(
            arrangement.pattern.bars,
            'bar'
          )} (the ${figureBars}-bar figure ${arrangement.passes}×).`
        : '';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
        <h3 className={SECTION_LABEL}>
          RiffBar progression{' '}
          <span className="text-neutral-300">
            {progression.length}/{MAX_PROGRESSION_CHORDS}
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasLabVoicings}
            title={hasLabVoicings ? 'Play the voicings the RiffBar chords were added with' : 'No lab voicings in this tuning'}
            className={pillClass(theme)}
          >
            Reset voicings
          </button>
          <button
            type="button"
            onClick={handleOptimize}
            disabled={shown.length < 2}
            title={shown.length < 2 ? 'Needs at least two different chords' : 'Choose the voicings whose hardest change is easiest at this tempo'}
            className={pillClass(theme)}
          >
            Optimize fingerings
          </button>
        </div>
      </div>

      {summary && <p className="mb-2 px-1 font-mono text-[11px] text-neutral-400 leading-snug">{summary}</p>}
      {optimized && (
        <p className="mb-2 px-1 font-mono text-[11px] text-neutral-300 leading-snug">
          <span className={theme.text}>Optimized:</span> {optimized.text}
        </p>
      )}

      {progression.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-black/30 p-4 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-neutral-200">
              {riffStepCount === 0 ? 'The RiffBar is empty.' : `No RiffBar chord has a playable voicing in ${tuning.name}.`}
            </p>
            <p className="mt-1 text-sm text-neutral-400 font-light leading-snug">
              Add chords to the RiffBar from the Library or the Voicing Finder. The lab plays them in order with this rhythm,
              repeats included, up to {MAX_PROGRESSION_CHORDS}.
            </p>
            {implicitSlot && (
              <p className="mt-2 font-mono text-[11px] text-neutral-400">
                Until then, chord hits play <span className={theme.text}>{implicitSlot.label}</span> on the selected root.
              </p>
            )}
          </div>
          {implicitSlot && (
            <div className="shrink-0" aria-label={`Implicit ${implicitSlot.label} power chord`}>
              <ChordTab
                chord={implicitSlot}
                fingers={displayFingering(implicitSlot.shape, tuning, profile)?.fingers ?? implicitSlot.shape.map(() => null)}
                tuning={tuning}
                isDistorted={isDistorted}
              />
            </div>
          )}
        </div>
      ) : (
        <ol
          className="relative flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory"
          style={theme.scrollbar}
          aria-label="RiffBar chords as the lab plays them"
        >
          {shown.map((chord, index) => {
            const active = index === playing;
            const where = positionLabel(change, index);
            return (
              <li
                key={chord.id}
                aria-current={active ? 'true' : undefined}
                className={`snap-start shrink-0 w-[13.5rem] rounded-lg border p-3 flex flex-col gap-2 transition-colors duration-150 ${
                  active ? `${theme.border} bg-white/[0.04]` : 'border-white/5 bg-black/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className={`${SECTION_LABEL} ${active ? theme.text : ''}`}>{where}</span>
                    <p className="font-['Oswald'] text-lg font-bold tracking-wide text-neutral-100 truncate leading-tight">{chord.label}</p>
                    <p className="font-mono text-[10px] text-neutral-400 truncate">
                      Pedal {chord.pedalMidi === null ? 'bass note' : midiToName(chord.pedalMidi)}
                      {labVoiced(chord) && <span className={theme.text}> · lab voicing</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cycleVoicing(chord, index)}
                    aria-label={`Try another voicing for ${where}, ${chord.label}, in the lab only`}
                    title="Next playable voicing (lab only, the RiffBar keeps its own)"
                    className={`shrink-0 w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-full border border-white/10 text-neutral-300 hover:text-white hover:border-white/30 font-mono text-[10px] uppercase transition-colors ${theme.ring}`}
                  >
                    Alt
                  </button>
                </div>
                <ChordTab chord={chord} fingers={fingersFor(chord, index)} tuning={tuning} isDistorted={isDistorted} />
              </li>
            );
          })}
        </ol>
      )}

      {notPlayed > 0 && progression.length > 0 && (
        <p className="mt-1 px-1 font-mono text-[11px] text-neutral-400 leading-snug">
          {plural(notPlayed, 'RiffBar chord')} not played: the lab plays up to {MAX_PROGRESSION_CHORDS} and skips chords with no
          playable voicing in {tuning.name}.
        </p>
      )}
    </div>
  );
};

/** Where the lab's chords come from (the RiffBar, live, or its own slots) and how they change. */
export const RhythmHarmony: React.FC<RhythmHarmonyProps> = (props) => {
  const { theme, isDistorted, tuning, profile, implicitSlot, onAnnounce } = props;
  const source = useRhythmStore((s) => s.harmonySource);
  const change = useRhythmStore((s) => s.chordChange);
  const setHarmonySource = useRhythmStore((s) => s.setHarmonySource);
  const setChordChange = useRhythmStore((s) => s.setChordChange);

  const chooseSource = (next: HarmonySource) => {
    setHarmonySource(next);
    onAnnounce(next === 'riffbar' ? `Chords from the RiffBar: ${CHANGE_SPOKEN[useRhythmStore.getState().chordChange]}.` : "Chords from the lab's own slots.");
  };

  const chooseChange = (next: ChordChange) => {
    setChordChange(next);
    onAnnounce(`${CHANGE_SPOKEN[next].charAt(0).toUpperCase()}${CHANGE_SPOKEN[next].slice(1)}.`);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,15rem)_minmax(0,22rem)] gap-x-6 gap-y-3">
        <Segmented label="Chords from" options={SOURCE_OPTIONS} value={source} onChange={chooseSource} theme={theme} />
        {source === 'riffbar' && <Segmented label="Chord change" options={CHANGE_OPTIONS} value={change} onChange={chooseChange} theme={theme} />}
      </div>
      {source === 'riffbar' ? (
        <ProgressionStrip {...props} change={change} />
      ) : (
        <RhythmSlotsStrip theme={theme} isDistorted={isDistorted} tuning={tuning} profile={profile} implicitSlot={implicitSlot} onAnnounce={onAnnounce} />
      )}
    </div>
  );
};
