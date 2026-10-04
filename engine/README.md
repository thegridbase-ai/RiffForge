# RiffForge playability engine

Pure TypeScript engine that answers two questions for one guitarist's hand:

1. Which voicings of a chord color can I actually play here, without a barre, and how hard is each one?
2. Which metal rhythm patterns go with them, and how hard are the changes between them?

No React, no Tone.js, no DOM, no Node APIs and no runtime dependencies. Everything is deterministic:
the same input gives the same output in the same order, and the only randomness is a seeded PRNG.
The engine is developed here and vendored into Chord Explorer (`lib/engine/`) by that repo's
`scripts/sync-engine.mjs`. Bump `ENGINE_VERSION` in `index.ts` on any behaviour change.

The hand profile is comfort guidance, not a medical or safety assessment. Stop if you feel pain or tension.

## Conventions

- **String order:** index 0 is the lowest-pitched string, everywhere in the engine.
- **Tuning:** `{ id, name, openMidi }`, low to high. Presets: `E_STANDARD`, `DROP_D`, `D_STANDARD`, `DROP_C`,
  `C_STANDARD`. `validateTuning` accepts 4..8 strictly ascending strings; the UI exposes the first two.
- **Shape:** `(number | null)[]` per string, `null` muted, `0` open.
- **Pitch:** `shapeToMidi(shape, tuning)` is the only shape -> pitch conversion (`openMidi[s] + fret`). Tabs and audio
  must both come from it. Note names are spelled with sharps; flats are accepted when parsing (`Bb2`).
- **Adapters:** `toRiffForgeTab` / `fromRiffForgeTab` ("0 2 2 x x x", low -> high) and `toChordExplorerFrets` /
  `fromChordExplorerFrets` (high -> low, `-1` muted).
- **Imports:** relative only. Never the `@/` alias (it means something else in Chord Explorer).
- **Narrowing:** the apps' tsconfig is not `strict`, so `if (!result.ok)` does not narrow the result unions.
  Write `result.ok === false` / `=== true`.

## Modules

| File | Purpose |
|---|---|
| `types.ts` | Shared types (shapes, profiles, fingerings, costs, families, generation, transitions, rhythm). |
| `pitch.ts` | Pitch classes, MIDI <-> names, interval names, degree labels (`1 b2 2 b3 3 4 b5 5 #5 6 b7 7`). |
| `tuning.ts` | Tuning presets and validation. |
| `random.ts` | `mulberry32`, `seedFromString` (FNV-1a), `createRng` (int, chance, pick, weighted, shuffle, fork). |
| `geometry.ts` | Fret wire distance `d(n) = L - L / 2^(n/12)`, fingertip model, spans, reachable frets, scale presets. |
| `shape.ts` | `shapeToMidi` and shape helpers (sounding/fretted/open strings, interior mutes, fret range), adapters. |
| `handProfile.ts` | `HandProfile`, defaults, calibration conversion, `maxReachMm`, pair limits, validation, migration, hash. |
| `weights.ts` | `PLAYABILITY_WEIGHTS`: every cost weight with the reasoning for its default. |
| `fingering.ts` | Exhaustive finger assignment: barre detection, finger order, reach and pair limits, physical cost. |
| `voicingSpec.ts` | Voicing families (interval recipes), drone variants, UI groups, `matchFamily`, legacy recipes, relaxation ladder. |
| `naming.ts` | Honest degree strings, confident-only chord symbols, descriptive names. |
| `playability.ts` | Full cost (physical, right hand, musical), novelty score, human cost explanations. |
| `generateVoicings.ts` | Windowed, pruned search for playable voicings; diversification; empty-result diagnosis. |
| `transition.ts` | Transition cost between fingered shapes; exact minimax Viterbi; `optimizeSequence`. |
| `rhythm/` | Rhythm grid math, style presets, seeded generator, variation, editing helpers, validation, progression arrangement, playback and MIDI note events. |
| `index.ts` | Public barrel and `ENGINE_VERSION`. |

## Main entry points

```ts
generateVoicings({ root, family, tuning, profile, distortion, context, musical, limit, sort, seed, referenceShapes, diversify })
  -> { voicings: GeneratedVoicing[]; stats; empty?: { constraint, message } }
findClosestVoicing(params)            // exact recipe, then the relaxation ladder; { result, relaxed, exactEmpty? }
findBestFingering(shape, profile)     // -> { ok: true, fingering } | { ok: false, reason, detail }
classifyShape(shape, profile)         // needs-barre classification for curated shapes
fromLegacyNotes(notes, baseRoot)      // RiffForge JSON `notes` -> recipe
nameVoicing(shape, tuning, rootPc)    // degrees, symbol, name
scoreVoicing / explainCost(breakdown, fingering, profile) / noveltyScore
resolveFamilyId(id)                   // registered and relaxed ('power5_b2~anyBass') family ids
transitionCost / optimizeSequence(candidates, timing, { profile }) / describeTransition
generateRhythm / mutateRhythm / regenerateRhythm / validateRhythm / setSlotCount / buildGroups
toggleHit / cycleAccent / togglePalmMute / clearHit / eventAtUnit / eventsInUnit
rhythmToPlaybackEvents / rhythmToMidiNotes(pattern, slots, tuning, ..., { slotAt })
arrangeProgression(pattern, chordCount, 'bar' | 'halfBar') / progressionChangeBeats(arrangement)
profileFromCalibration / calibrationFromProfile / validateHandProfile / migrateHandProfile / handProfileHash
```

## How generation works

1. For every window anchored at its lowest fretted fret `w` (1..maxFret), the window reaches up to
   `highestReachableFret(w, maxReachMm(w) * stretchTolerance)`. One extra pass covers open-string-only shapes.
2. Each string can be muted, open (if allowed and its pitch class fits) or fretted inside the window on an allowed
   pitch class.
3. Depth-first search with pruning: missing required pitch classes vs strings left, note count, fretted notes vs
   available fingers (no-barre), interior mutes, and a structural lower bound on the fingers a shape needs.
4. Leaves go through `matchFamily` (exact pitch classes, nothing outside required + optional, bass by pitch, drone
   rule), then `findBestFingering`, then `scoreVoicing`. Above `LAZY_SEARCH_MIN_SHAPES` (2048) feasible shapes the
   fingering search is lazy and exact (same voicings, partial fingering-stage counts in `stats`).
5. Candidates are sorted by cost (`easiest`) or novelty (`unusual`), then picked greedily for diversity (+0.6 per
   already-picked voicing on the same string set within 2 frets). Results come back in that pick order, so a later
   voicing can be cheaper than an earlier one when the earlier one opened a new position or string set.
6. An empty result runs a wider diagnostic search and names the rule that blocks the most nearly-valid shapes
   (`REACH`, `NEEDS_BARRE`, `NO_DRONE_STRING`, ...).

Fingering rules: each fretted note needs a finger (1 index .. 4 pinky; thumb 0 only when allowed, lowest string
only). In no-barre mode every finger presses exactly one string, so more than 4 fretted notes is `NEEDS_BARRE`.
A barre is detected from the assignment (one finger on 2+ strings), never from a name. Lower-numbered fingers may
not sit on higher frets than higher-numbered ones. The fingertip span must fit `maxReachMm(lowestFret) *
stretchTolerance`, and each consecutive finger pair must fit its share of that span.

## Assumptions

Defaults chosen where the spec left room. Change them deliberately; most have tests.

- Scale length defaults to 25.5" (647.7 mm). The fingertip sits 70 percent of the way from the previous fret wire.
- Default reach = fingertip span index fret 1 -> pinky fret 4 (99.0 mm) and index fret 7 -> pinky fret 11 (90.8 mm),
  linear in between and constant outside.
- Pair limits as fractions of the allowed span: index-middle 0.65, middle-ring 0.35, ring-pinky 0.40. Non-adjacent
  fingers get the sum of the limits between them. The original plan said index-middle 0.45, but that rejected
  chord-book no-barre shapes such as `x 3 5 5 5 x` and `x 5 7 7 7 x` (index two frets behind the middle finger), so
  it was raised. With these defaults middle (fret 1) and ring (fret 2) are 0.3 mm over their limit, so first-position
  shapes sometimes use the pinky instead of the ring finger.
- Fretting fingers sit side by side along the neck in hand order, each inside its own fret space, at least 12.5 mm
  apart (`MIN_FINGER_SPACING_MM`). On a 25.5" scale three fingers share one fret only up to fret 7 and four never do;
  a shape that needs more is `NEEDS_BARRE` (a barre in disguise).
- The pair-stretch cost measures stretch beyond the relaxed one-fret-per-finger spacing, not the raw ratio to the
  limit; the raw ratio would make the ordinary hand frame look maximally hard.
- Thumb (only when `allowThumb`): lowest string only, within one fret of the lowest finger, excluded from reach, pair
  limits and finger order.
- Two-string partial barres (only when `allowTwoStringPartialBarre`) need adjacent strings at the same fret.
- Barre mode (only when `noBarre` is false, used to classify curated shapes): the index barres at the shape's lowest
  fret over a contiguous range whose ends are at that fret and that contains no open or muted string. Only when no
  fingering exists that way, fingers 2-4 may also flatten over 2-3 adjacent strings at one fret (A-shape barres).
- `classifyShape(...).needsBarre` is true only when the shape fails without a barre because it needs one, not when it is
  out of reach for other reasons.
- Families: triads, sus2/sus4 and add9/m(add9) allow up to 6 notes so open-string voicings such as `0 2 2 1 0 0` and
  `0 2 4 0 0 0` are included; shells, quartal and clusters cap at 4; power5, dyad_b2, tritone and fourth at 4;
  power5_b2 at 5; phrygian at 6.
- Drone variants (power5, fourth, sus2, m(add9), quartal, phrygian) require an open string sounding the root or fifth,
  and the fifth only counts when the recipe allows it. Without such a string the result is empty with `NO_DRONE_STRING`.
- Legacy recipes (`fromLegacyNotes`): pitch classes of the JSON `notes` relative to `baseRoot`, the lowest parsed note
  as the bass interval, note count capped to 6. The curated `fretboard` strings are not trusted (most do not sound
  their own `notes`).
- Relaxation ladder (cumulative): any bass note, then no 5th, then no extensions (9/11/13), then any note count.
  Musical relaxations only; the hand profile is never relaxed behind the player's back. A step is skipped when it would
  leave an invertible dyad over a free bass (inverting a dyad changes its only interval), so power chords, dyads,
  sus and triads mostly fall back to "any note count" or stay empty with their binding constraint.
- Chord symbols only for confident template matches. `(no5)` only for a perfect fifth, `(no3)` only for `7` and
  `maj7`, `(no root)` only when the caller's root is absent; any omission still needs 3 sounding pitch classes.
  Dyads and clusters get descriptive names (`E + F (minor 2nd)`, `E cluster (1 b2 2)`). An inverted dyad names the
  interval that sounds from the bass up (`E over A (perfect 5th)`). The words "cluster" and "Quartal" are only used
  when the sounding notes really contain a close second or stacked fourths.
- `explainCost(..., profile)` reports reach as a share of the comfortable reach (stretch tolerance excluded) and adds
  "(a stretch)" above 100 percent. Without a profile it says "percent of your allowed reach".
- Novelty compares relative fret patterns against common open/CAGED/power shapes (and optional references); moving
  shapes match at any position, open-string shapes only as written. It is a ranking axis, never part of difficulty.
- Transition cost = finger travel along the neck, string changes, fingers lifted and placed, slides (discounted) and
  hand shift; anchors (same finger, string and fret) discount the whole change by up to 50 percent. It is divided by
  the time available (`beats * 60 / bpm`, floored at 0.05 s). Thumbs follow the hand and are ignored per finger.
- `optimizeSequence` minimizes the hardest transition first (exact two-phase minimax), then the sum; it treats the
  riff as a loop by default. With `{ profile }` it also chooses each slot's fingering together with its neighbours
  (the attached fingering or the cheapest valid one per other finger set) and returns them in `fingerings`.
- Rhythm: 480 PPQ; 16th = 120 ticks, 16th triplet = 80, 32nd = 60. One monophonic event stream; rests are gaps.
  Alternate picking follows the 16th grid (even down, odd up) for plain 16ths. A run faster than 16ths (32nds,
  sixteenth triplets) follows its own subdivision (tick/60 or tick/80 parity, bar-relative), so runs alternate
  strictly, gaps leave ghost strokes and every beat start is a downstroke; isolated eighth-note triplets alternate by
  event. `halftimeStomp` defaults to downstrokes.
- Rhythm harmony: slots change only on accented hits, and every slot is used when there are enough accents.
  `regenerateRhythm` keeps the locked bars' events and their sound (entry slot, ties of pushes) and changes harmony only
  on accents across the merge. Grid edits act on whole cells (a 32nd tremolo cell is one cell).
- Rhythm grouping `even`: one group per beat in x/4; odd x/8 as 2+2+...+3 eighths (7/8 = 4+4+6 sixteenths).
  `fiveOverFour` repeats a 5-sixteenth [3,2] cycle across barlines.
- Rhythm playback: base velocity 0.7, accent +0.12 / +0.22, palm mute x0.75 velocity and 35 percent duration, dead
  notes 0.3 velocity and at most 30 ms, ties extend the sounding note. Pedal hits use the active slot's pedal note,
  falling back to its lowest sounding note.
- Progressions (`arrangeProgression`): the figure repeats until it and the progression line up again (least common
  multiple of their lengths, capped at 64 bars, else rounded up to whole figures), so the loop restarts on the first
  chord and the first beat. With `slotAt`, playback and MIDI pick the chord by time (bar or half bar), not by the
  hit's slot index, and pedal hits follow that chord. `progressionChangeBeats` gives each chord the time from its
  last attack to the next chord's first attack, for `optimizeSequence`.
- `tooFastForProfile` is a warning only: it fires when the fastest attack rate at the given BPM exceeds the profile's
  comfortable sixteenth-note tempo.

- RiffForge app defaults (outside the engine, recorded here so they live next to the engine's):
  - A library card's title is the engine's name for what sounds. The curated nickname ("Drop " removed, its root
    moved to the selected root) and descriptive subtext ("m2 Clash") form the secondary line; key-bound symbols such
    as "Bb(VI)" or "Em(add9)" are dropped because the card's root follows the selected root.
  - A library card shows the generated shape closest to its curated idea: bass register (2 per octave, capped at 2
    octaves), note count (0.5 per note), the curated tab moved rigidly to the new root (0 to 1) and neck position
    (0.08 per fret, capped at 10 frets); engine cost decides between equally faithful shapes.
  - Chord Explorer links use the selected root and a type from the first engine family whose pitch classes match
    (bass and note count ignored), else the largest full formula present without a contradicting third. Power chords,
    dyads, the tritone, fourths, quartal stacks and clusters get no type. The shape travels as gv only in E Standard.
  - Library data: the "Am Add9" and "Drop Gm Add9" rows (and their related copies) had no minor third, so they
    sounded sus2; their notes now include the b3. "Drop Fm Mediant" had a fourth where its minor third belongs.

## Heuristics that are not research-backed

- All cost weights in `weights.ts` and `TRANSITION_WEIGHTS` (their relative order follows ISMIR 2023: finger
  positioning highest, right-hand skips next, change speed lowest).
- Pair-limit fractions, the 70 percent fingertip position, 10.5 mm string spacing, the 12.5 mm side-by-side finger
  spacing, the thumb window, the 0.6 diversity penalty, the low-mud threshold (E3, intervals under a perfect fourth),
  the anchor discount cap, and every rhythm style rate (accent, push, variation, dead-note and slot-coverage rules).
- No peer-reviewed millimetre comfort limit was found, which is why reach comes from calibration.

## Tests

`npx vitest run engine` covers every module, including a property test over 12 roots x 20 base families x
{E Standard, Drop D} (every voicing matches its recipe, has a no-barre fingering inside reach and pair limits, and
sounds exactly its tab), drone coverage, determinism, a brute-force completeness check for the search, and a
generation time budget.
