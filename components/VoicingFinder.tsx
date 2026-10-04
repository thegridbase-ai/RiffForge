import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { GeneratedVoicing, HandProfile, Tuning, VoicingFamily, VoicingSort } from '../engine/types';
import { FAMILY_GROUPS, getFamily } from '../engine/voicingSpec';
import { shapeToMidi, toRiffForgeTab } from '../engine/shape';
import { midiToName } from '../engine/pitch';
import { audioEngine } from '../services/audioEngine';
import { useChordStore } from '../stores/chordStore';
import { useHandProfileStore } from '../stores/handProfileStore';
import { useRiffStore, MAX_RIFF_STEPS } from '../stores/riffStore';
import { useRhythmStore, MAX_RHYTHM_SLOTS } from '../stores/rhythmStore';
import { tuningForMode } from '../utils/libraryVoicing';
import { VoicingTab } from './VoicingTab';
import {
  FINDER_DEFAULT_FAMILY,
  FINDER_GENERATE_LIMIT,
  FINDER_SHOW_LIMIT,
  STRING_GROUP_FILTERS,
  explainVoicing,
  familyTitle,
  filterVoicings,
  finderExplorerUrl,
  findVoicings,
  hintText,
  noveltyPercent,
  relaxationHints,
  resultAnnouncement,
  voicingTagLabels,
  type FinderQuery,
  type RelaxationHint,
  type StringGroupFilter
} from '../utils/finder';

const SORT_OPTIONS: readonly { id: VoicingSort; label: string }[] = [
  { id: 'easiest', label: 'Easiest' },
  { id: 'unusual', label: 'Most unusual' }
];

const NOVELTY_SEGMENTS = 5;

const ringClass = (isDistorted: boolean): string =>
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}`;

const activePill = (isDistorted: boolean): string =>
  isDistorted
    ? 'bg-rose-500/20 border-rose-500/60 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
    : 'bg-cyan-500/20 border-cyan-500/60 text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.3)]';

const inactivePill = 'bg-neutral-900/50 border-white/10 text-neutral-400 hover:text-neutral-200 hover:border-white/30';

const profileSummary = (profile: HandProfile, isDistorted: boolean): string =>
  [
    profile.noBarre ? 'No barre' : 'Barres allowed',
    `reach ${Math.round(profile.reachAtLowMm)} mm${profile.stretchTolerance > 1 ? ' + stretch' : ''}`,
    `up to fret ${profile.maxFret}`,
    profile.allowOpenStrings ? null : 'no open strings',
    isDistorted ? 'ranked for gain' : 'ranked for clean'
  ]
    .filter(Boolean)
    .join(' · ');

interface SegmentedProps {
  label: string;
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  isDistorted: boolean;
}

/** The app's segmented selector (aria-pressed buttons), sized for 44 px touch targets on mobile. */
const Segmented: React.FC<SegmentedProps> = ({ label, options, value, onChange, isDistorted }) => (
  <div role="group" aria-label={label} className="grid gap-1 bg-neutral-900/50 p-1 rounded-lg border border-white/5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map((option) => {
      const active = option.id === value;
      return (
        <button
          key={option.id}
          type="button"
          aria-pressed={active}
          onClick={() => onChange(option.id)}
          className={`
            relative h-11 md:h-10 min-w-0 px-1 flex items-center justify-center font-['Oswald'] tracking-widest text-xs font-bold uppercase transition-all duration-200
            focus-visible:outline-none focus-visible:ring-2 focus-visible:z-10 ${isDistorted ? 'focus-visible:ring-rose-500' : 'focus-visible:ring-cyan-500'}
            ${active
              ? `bg-neutral-800 text-white border ${isDistorted ? 'border-rose-900/50' : 'border-cyan-900/50'}`
              : 'text-neutral-400 hover:text-neutral-200 border border-transparent'}
          `}
        >
          <span className="truncate">{option.label}</span>
          {active && <span aria-hidden="true" className={`absolute bottom-0 w-1/3 h-0.5 ${isDistorted ? 'bg-rose-500' : 'bg-cyan-500'}`} />}
        </button>
      );
    })}
  </div>
);

const ControlLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="block text-[10px] font-mono text-neutral-400 uppercase tracking-widest mb-2 px-1">{children}</span>
);

const NoveltyMeter: React.FC<{ novelty: number; isDistorted: boolean }> = ({ novelty, isDistorted }) => {
  const percent = noveltyPercent(novelty);
  const lit = Math.round((percent / 100) * NOVELTY_SEGMENTS);
  return (
    <div className="flex items-center gap-1.5 shrink-0" title="Distance from common open and CAGED shapes">
      <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-400">Unusual</span>
      <span aria-hidden="true" className="flex gap-0.5">
        {Array.from({ length: NOVELTY_SEGMENTS }, (_, i) => (
          <span key={i} className={`w-1 h-3 ${i < lit ? (isDistorted ? 'bg-rose-500' : 'bg-cyan-500') : (isDistorted ? 'bg-rose-950' : 'bg-cyan-950')}`} />
        ))}
      </span>
      <span className={`font-mono text-[10px] font-bold ${isDistorted ? 'text-rose-400' : 'text-cyan-400'}`}>{percent}%</span>
    </div>
  );
};

interface FinderCardProps {
  voicing: GeneratedVoicing;
  index: number;
  root: string;
  family: VoicingFamily;
  tuning: Tuning;
  profile: HandProfile;
  showNovelty: boolean;
  canAdd: boolean;
  canSlot: boolean;
  isDistorted: boolean;
  reduceMotion: boolean;
  onPlay: (voicing: GeneratedVoicing) => void;
  onAdd: (voicing: GeneratedVoicing) => void;
  onSlot: (voicing: GeneratedVoicing) => void;
}

const FinderCard: React.FC<FinderCardProps> = ({
  voicing,
  index,
  root,
  family,
  tuning,
  profile,
  showNovelty,
  canAdd,
  canSlot,
  isDistorted,
  reduceMotion,
  onPlay,
  onAdd,
  onSlot
}) => {
  const tab = toRiffForgeTab(voicing.shape);
  const explorerUrl = finderExplorerUrl(root, family.id, voicing, tuning);
  const tags = voicingTagLabels(voicing.tags);
  const ring = ringClass(isDistorted);
  const roundButton = `shrink-0 w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-full border transition-colors duration-200 ${ring}`;

  return (
    <motion.article
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: reduceMotion ? 0 : Math.min(index, 8) * 0.03, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative h-full flex flex-col rounded-lg p-5"
      style={
        isDistorted
          ? { border: '1px solid rgba(127, 29, 29, 0.35)', background: 'rgba(0, 0, 0, 0.2)' }
          : { border: '1px solid rgba(115, 115, 115, 0.25)', background: 'rgba(0, 0, 0, 0.15)' }
      }
      data-tab={tab}
      aria-label={`${voicing.name}, ${tab}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-['Oswald'] text-xl tracking-wide text-neutral-100 break-words">{voicing.name}</h3>
          <p className="font-['Share_Tech_Mono'] text-xs text-neutral-400 tracking-wider mt-0.5">
            <span className="sr-only">Degrees low to high: </span>
            {voicing.degrees}
          </p>
        </div>
        {showNovelty && <NoveltyMeter novelty={voicing.novelty} isDistorted={isDistorted} />}
      </div>

      <div className="mt-3 pt-3 border-t border-white/5">
        <VoicingTab
          shape={voicing.shape}
          fingers={voicing.fingering.fingers}
          degreesByString={voicing.degreesByString}
          tuning={tuning}
          isDistorted={isDistorted}
          compact
        />
      </div>

      <p className="mt-3 font-mono text-[11px] leading-relaxed text-neutral-300">{explainVoicing(voicing, profile)}</p>

      {tags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map((tag) => (
            <li key={tag} className="px-2 py-0.5 rounded-full border border-white/10 font-mono text-[10px] uppercase tracking-widest text-neutral-300">
              {tag}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-4 flex items-center gap-2">
        <button
          type="button"
          aria-label={`Play ${voicing.name}, ${tab}`}
          onClick={() => onPlay(voicing)}
          className={`${roundButton} ${isDistorted ? 'border-rose-900 text-rose-400 hover:border-rose-500' : 'border-neutral-700 text-cyan-400 hover:border-cyan-400'}`}
        >
          <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={`Add ${voicing.name}, ${tab} to riff`}
          title={canAdd ? 'Add to riff' : `Riff is full (${MAX_RIFF_STEPS} steps)`}
          disabled={!canAdd}
          onClick={() => onAdd(voicing)}
          className={`flex items-center gap-1.5 px-3 h-11 md:h-9 rounded-full border font-mono text-[10px] uppercase tracking-widest transition-all duration-200 disabled:opacity-40 disabled:cursor-default ${ring} ${inactivePill}`}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Riff
        </button>
        <button
          type="button"
          aria-label={`Send ${voicing.name}, ${tab} to a Rhythm Lab chord slot`}
          title={canSlot ? 'Use as a Rhythm Lab chord slot' : `Rhythm Lab already has ${MAX_RHYTHM_SLOTS} slots`}
          disabled={!canSlot}
          onClick={() => onSlot(voicing)}
          className={`flex items-center gap-1.5 px-3 h-11 md:h-9 rounded-full border font-mono text-[10px] uppercase tracking-widest transition-all duration-200 disabled:opacity-40 disabled:cursor-default ${ring} ${inactivePill}`}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <line x1="9" y1="6" x2="9" y2="18" />
            <line x1="15" y1="6" x2="15" y2="18" />
          </svg>
          Slot
        </button>
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener"
            aria-label={`Open ${voicing.name} in Chord Explorer (new tab)`}
            title="Open in Chord Explorer"
            className={`${roundButton} ml-auto border-white/10 text-neutral-400 ${isDistorted ? 'hover:text-rose-400 hover:border-rose-500/50' : 'hover:text-cyan-400 hover:border-cyan-500/50'}`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
      </div>
    </motion.article>
  );
};

interface VoicingFinderProps {
  onOpenHandProfile: () => void;
  handProfileOpen?: boolean;
}

/** Playable voicings of one family on the selected root and tuning, ranked for the stored hand profile. */
export const VoicingFinder: React.FC<VoicingFinderProps> = ({ onOpenHandProfile, handProfileOpen = false }) => {
  const isDistorted = useChordStore((s) => s.isDistorted);
  const selectedRoot = useChordStore((s) => s.selectedRoot);
  const tuningMode = useChordStore((s) => s.tuningMode);
  const profile = useHandProfileStore((s) => s.profile);
  const setCalibration = useHandProfileStore((s) => s.setCalibration);
  const riffLength = useRiffStore((s) => s.steps.length);
  const addStep = useRiffStore((s) => s.addStep);
  const slotCount = useRhythmStore((s) => s.slots.length);
  const addSlot = useRhythmStore((s) => s.addSlot);
  const reduceMotion = useReducedMotion() ?? false;

  const titleId = useId();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [familyId, setFamilyId] = useState(FINDER_DEFAULT_FAMILY);
  const [sort, setSort] = useState<VoicingSort>('easiest');
  const [stringGroup, setStringGroup] = useState<StringGroupFilter>('all');
  const [pedalOnly, setPedalOnly] = useState(false);
  // "One more muted inner string" is not a calibration answer: it stays a finder-only override for one query
  const [extraMuteFor, setExtraMuteFor] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  const tuning = tuningForMode(tuningMode);
  const family = getFamily(familyId) ?? (getFamily(FINDER_DEFAULT_FAMILY) as VoicingFamily);
  const overrideKey = `${selectedRoot}|${family.id}|${tuning.id}`;
  const extraMute = extraMuteFor === overrideKey;

  const effectiveProfile = useMemo(
    () => (extraMute ? { ...profile, maxInteriorMutes: profile.maxInteriorMutes + 1 } : profile),
    [profile, extraMute]
  );

  const query: FinderQuery = useMemo(
    () => ({ root: selectedRoot, familyId: family.id, tuning, profile: effectiveProfile, distortion: isDistorted, sort }),
    [selectedRoot, family.id, tuning, effectiveProfile, isDistorted, sort]
  );
  const result = useMemo(() => findVoicings(query), [query]);
  const filtered = useMemo(() => filterVoicings(result.voicings, { stringGroup, pedalOnly }), [result, stringGroup, pedalOnly]);
  const shown = filtered.slice(0, FINDER_SHOW_LIMIT);
  const hints = useMemo(() => (result.voicings.length === 0 ? relaxationHints(query, extraMute) : []), [result, query, extraMute]);

  const filtersActive = stringGroup !== 'all' || pedalOnly;
  const capped = !filtersActive && result.voicings.length >= FINDER_GENERATE_LIMIT;
  const announcement = resultAnnouncement(filtered.length, selectedRoot, family);
  const canAdd = riffLength < MAX_RIFF_STEPS;

  useEffect(() => {
    if (!actionMessage) return;
    const timer = setTimeout(() => setActionMessage(''), 3000);
    return () => clearTimeout(timer);
  }, [actionMessage]);

  const playVoicing = useCallback(
    async (voicing: GeneratedVoicing) => {
      const chord = useChordStore.getState();
      if (!chord.isAudioReady) {
        await audioEngine.init();
        audioEngine.setDistortion(chord.isDistorted);
        chord.setIsAudioReady(true);
      }
      // Same shape as the tab on the card
      audioEngine.playChord(shapeToMidi(voicing.shape, tuning).map(midiToName));
    },
    [tuning]
  );

  const addVoicing = useCallback(
    (voicing: GeneratedVoicing) => {
      const tab = toRiffForgeTab(voicing.shape);
      const added = addStep({
        id: `finder:${family.id}:${tab}`,
        name: voicing.name,
        subtext: `${family.label} · ${tab}`,
        notes: shapeToMidi(voicing.shape, tuning).map(midiToName)
      });
      setActionMessage(added ? `Added ${voicing.name} to the riff.` : `The riff is full (${MAX_RIFF_STEPS} steps).`);
    },
    [addStep, family, tuning]
  );

  const slotVoicing = useCallback(
    (voicing: GeneratedVoicing) => {
      const added = addSlot({
        label: voicing.name,
        root: selectedRoot,
        source: { kind: 'family', familyId: voicing.familyId },
        shape: [...voicing.shape],
        tuningId: tuning.id
      });
      setActionMessage(
        added
          ? `${voicing.name} is now Rhythm Lab slot ${useRhythmStore.getState().slots.length}.`
          : `The Rhythm Lab already has ${MAX_RHYTHM_SLOTS} chord slots.`
      );
    },
    [addSlot, selectedRoot, tuning]
  );

  const applyHint = (hint: RelaxationHint) => {
    if (hint.kind === 'calibration') setCalibration(hint.patch);
    else setExtraMuteFor(overrideKey);
    // The hint button disappears with the empty state; keep keyboard focus on the result status
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  const clearFilters = () => {
    setStringGroup('all');
    setPedalOnly(false);
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  const accentText = isDistorted ? 'text-rose-400' : 'text-cyan-400';
  const ring = ringClass(isDistorted);

  return (
    <section aria-labelledby={titleId} className="pb-20">
      <div className="rounded-xl border border-white/5 bg-black/40 backdrop-blur-md p-4 md:p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[10px] font-mono text-neutral-400 uppercase tracking-widest">
              Voicing finder
            </h2>
            <p className="font-['Oswald'] text-2xl md:text-3xl font-bold uppercase tracking-wide text-neutral-100 mt-1">
              <span className={accentText}>{selectedRoot}</span>
              <span className="text-neutral-500 mx-2" aria-hidden="true">&middot;</span>
              <span className="sr-only"> in </span>
              {tuning.name}
            </p>
            <p className="font-mono text-[11px] text-neutral-400 mt-1">{profileSummary(effectiveProfile, isDistorted)}</p>
          </div>
          <button
            type="button"
            onClick={onOpenHandProfile}
            aria-haspopup="dialog"
            aria-expanded={handProfileOpen}
            className={`flex items-center gap-1.5 px-3 h-11 md:h-8 rounded-full border font-mono text-[10px] uppercase tracking-widest transition-all duration-200 ${ring} ${inactivePill}`}
          >
            <HandIcon />
            Hand profile
          </button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FAMILY_GROUPS.map((group) => (
            <div key={group.id} role="group" aria-label={group.label}>
              <ControlLabel>{group.label}</ControlLabel>
              <div className="flex flex-wrap gap-1.5">
                {group.familyIds.map((id) => {
                  const f = getFamily(id);
                  if (!f) return null;
                  const active = id === family.id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      title={f.description}
                      onClick={() => setFamilyId(id)}
                      className={`min-h-[44px] min-w-[44px] md:min-h-[32px] md:min-w-0 px-3 rounded-full border font-mono text-xs transition-all duration-200 ${ring} ${active ? activePill(isDistorted) : inactivePill}`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 px-1 text-sm text-neutral-400 font-light leading-snug">{family.description}</p>

        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] md:items-end">
          <div>
            <ControlLabel>Sort</ControlLabel>
            <Segmented label="Sort voicings" options={SORT_OPTIONS} value={sort} onChange={(v) => setSort(v as VoicingSort)} isDistorted={isDistorted} />
          </div>
          <div>
            <ControlLabel>Strings</ControlLabel>
            <Segmented
              label="String group"
              options={STRING_GROUP_FILTERS}
              value={stringGroup}
              onChange={(v) => setStringGroup(v as StringGroupFilter)}
              isDistorted={isDistorted}
            />
          </div>
          <div>
            <ControlLabel>Pedal</ControlLabel>
            <button
              type="button"
              aria-pressed={pedalOnly}
              onClick={() => setPedalOnly(!pedalOnly)}
              title="Low string unused or open on the root or fifth, so a pedal note can ring under the shape"
              className={`w-full md:w-auto flex items-center justify-center gap-2 px-4 h-11 md:h-[50px] rounded-lg border font-mono text-[10px] uppercase tracking-widest transition-all duration-200 ${ring} ${pedalOnly ? activePill(isDistorted) : inactivePill}`}
            >
              <span aria-hidden="true" className={`w-2 h-2 rounded-full ${pedalOnly ? (isDistorted ? 'bg-rose-400' : 'bg-cyan-400') : 'border border-neutral-500'}`} />
              Pedal compatible
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 px-1">
        <p ref={statusRef} tabIndex={-1} className="font-mono text-xs text-neutral-400 tracking-wider focus:outline-none">
          <span className={`font-bold ${accentText}`}>
            {filtered.length}
            {capped ? '+' : ''}
          </span>{' '}
          {filtered.length === 1 ? 'voicing' : 'voicings'} for {familyTitle(selectedRoot, family)}
          {filtered.length > shown.length ? ` · showing ${shown.length}` : ''}
          {filtersActive && result.voicings.length > filtered.length ? ` · ${result.voicings.length - filtered.length} filtered out` : ''}
        </p>
        {extraMute && (
          <button
            type="button"
            onClick={() => setExtraMuteFor(null)}
            aria-label="Remove the extra muted inner string"
            className={`flex items-center gap-1.5 px-3 h-11 md:h-8 rounded-full border font-mono text-[10px] uppercase tracking-widest transition-all duration-200 ${ring} ${activePill(isDistorted)}`}
          >
            +1 inner mute
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <p className="sr-only" aria-live="polite">
        {actionMessage}
      </p>

      {shown.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {shown.map((voicing, index) => (
            <FinderCard
              key={toRiffForgeTab(voicing.shape)}
              voicing={voicing}
              index={index}
              root={selectedRoot}
              family={family}
              tuning={tuning}
              profile={effectiveProfile}
              showNovelty={sort === 'unusual'}
              canAdd={canAdd}
              canSlot={slotCount < MAX_RHYTHM_SLOTS}
              isDistorted={isDistorted}
              reduceMotion={reduceMotion}
              onPlay={playVoicing}
              onAdd={addVoicing}
              onSlot={slotVoicing}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 bg-black/30 px-5 py-10 text-center">
          {result.voicings.length === 0 ? (
            <>
              <p className={`font-['Share_Tech_Mono'] text-sm uppercase tracking-widest ${accentText}`}>No playable shape here</p>
              <p className="mt-3 max-w-2xl mx-auto font-mono text-xs leading-relaxed text-neutral-300">
                {result.empty?.message ?? 'No voicing fits this recipe and your hand profile.'}
              </p>
              {hints.length > 0 && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {hints.map((hint) => (
                    <button
                      key={hint.label}
                      type="button"
                      onClick={() => applyHint(hint)}
                      className={`flex items-center gap-1.5 px-4 min-h-[44px] md:min-h-[36px] rounded-full border font-mono text-[11px] tracking-wide transition-all duration-200 ${ring} ${activePill(isDistorted)}`}
                    >
                      {hintText(hint)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className={`font-['Share_Tech_Mono'] text-sm uppercase tracking-widest ${accentText}`}>No voicings match these filters</p>
              <p className="mt-3 font-mono text-xs text-neutral-300">
                {result.voicings.length} {result.voicings.length === 1 ? 'voicing fits' : 'voicings fit'} your hand without them.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                className={`mt-5 inline-flex items-center px-4 min-h-[44px] md:min-h-[36px] rounded-full border font-mono text-[10px] uppercase tracking-widest transition-all duration-200 ${ring} ${inactivePill}`}
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
};

const HandIcon: React.FC = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 11V6a2 2 0 0 0-4 0" />
    <path d="M14 10V4a2 2 0 0 0-4 0v2" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);
