# RiffForge

Context-aware sonic prototyping tool for metal guitarists. Lets users explore chord voicings across tunings (Standard/Drop), vibes (Dark/Melodic/Energetic), and root notes (all 12) with real-time audio playback via Tone.js.

**URL:** https://riffforge.thegridbase.com
**Version:** v0.2.3 Beta

## Tech Stack

- **Runtime:** React 19, TypeScript 5.8, Vite 6
- **State:** Zustand 5 (single store: `stores/chordStore.ts`)
- **Audio:** Tone.js 15 (PolySynth -> Distortion -> Reverb -> Limiter chain)
- **Animation:** Framer Motion 12
- **Styling:** Tailwind CSS 3.4
- **Deploy:** Vercel (SPA with catch-all rewrite)
- **Analytics:** Google Analytics (G-H0EP8LB278)

## Project Structure (Flat - No src/ Directory)

```
/                       # Root is the source root (@ alias -> .)
  App.tsx               # Main app component (all UI orchestration)
  index.tsx             # Entry point (with ErrorBoundary, debug logging)
  index.css             # Tailwind + custom scrollbar + glitch/scanline effects
  types.ts              # Chord, AppMode, TuningMode, VibeMode, AudioState
  constants.ts          # NOTES array, chord fetching/caching (getChords, CHORD_LIBRARY)
  components/
    ChordCard.tsx       # Card with cursor-following glow, lock toggle, play button, tablature
    DistortionSwitch.tsx # Clean/Distortion channel toggle (amp-style UI)
    RootSelector.tsx    # 12-note grid for key selection
    TuningSelector.tsx  # Standard/Drop toggle
    VibeSelector.tsx    # Dark/Melodic/Energetic toggle
    ErrorBoundary.tsx   # Class-based error boundary
  services/
    audioEngine.ts      # Singleton AudioEngine class wrapping Tone.js
  stores/
    chordStore.ts       # Zustand store (audio state, selection, lock state, loading)
  utils/
    musicTheory.ts      # transposeChord, transposeNote, transposeTabs, getSemitoneDistance
  public/
    chords/             # 6 JSON files: {standard,drop}-{dark,melodic,energetic}.json
```

## Architecture Patterns

### Chord Data Flow
1. Chord JSON files live in `public/chords/` (fetched lazily, cached in memory via `chordCache` in constants.ts)
2. Base chords are in key of E (baseRoot: "E")
3. `transposeChord()` in musicTheory.ts handles transposition to selected root
4. Each chord has `relatedChords[]` embedded (denormalized, not ID references)
5. Chords load in batches of 6 (CHORDS_PER_BATCH), with "Load More" pagination

### Dual Mode System (Clean vs Distortion)
- `isDistorted` boolean controls the entire UI theme: cyan (clean) vs rose (distorted)
- AudioEngine toggles oscillator type: triangle (clean) vs sawtooth (distorted)
- Background gradients, borders, glows, text colors all branch on this flag
- Distortion mode adds glitch CSS animation to the main container

### Audio Engine
- Lazy init: Tone.js context starts on first user interaction (browser autoplay policy)
- Signal chain: PolySynth -> Distortion (wet/dry) -> Reverb (decay:4, wet:0.3) -> Limiter(-1dB)
- Strum effect: notes triggered with 30ms delay between each
- Singleton export: `audioEngine` instance

### Lock & Related Chords
- Clicking lock icon on a chord reveals its `relatedChords` in a separate grid section
- Only one chord can be locked at a time
- Related section auto-scrolls into view
- Lock state resets when tuning or vibe changes

## Design Language

- **Fonts:** Oswald (headings), Share Tech Mono (labels/mono), Roboto Condensed (body)
- **Colors:** cyan-500/rose-500 as accent pair, neutral-900/950 backgrounds, white/5 borders
- **Effects:** Cursor-following radial glow on cards, CRT scanline overlay, noise texture overlay, glitch animation in distortion mode
- **Theme:** Brutalist/industrial guitar amp aesthetic. Dark mode only.

## Known Gotchas

1. **Flat structure:** No `src/` dir. The `@` path alias resolves to project root. Imports like `@/types` resolve to `./types.ts`.
2. **StrictMode disabled:** Removed in index.tsx to prevent double-render issues with Tone.js audio context.
3. **Debug logging in index.tsx:** Entry point has extensive console.log/error listeners from a past debugging session. Should be cleaned up.
4. **External texture URLs:** `App.tsx` uses `grainy-gradients.vercel.app/noise.svg`, `DistortionSwitch.tsx` uses `transparenttextures.com/patterns/carbon-fibre.png`. These are external dependencies that could break.
5. **Gemini API key in vite.config.ts:** Env setup exists for `GEMINI_API_KEY` but is not used anywhere yet. Planned for AI chord suggestions.
6. **Denormalized relatedChords:** Each chord JSON embeds full related chord objects (not ID refs). Causes data duplication in the JSON files.
7. **Drop tuning tab transposition:** `transposeTabs()` adds +2 to the lowest string fret for Drop tuning mode.
8. **No tests:** No test framework installed yet. Vitest is the planned choice.
9. **No routing:** Single-page app with no React Router. Everything lives in App.tsx.

## Build & Dev

```bash
npm run dev      # Vite dev server on port 5173
npm run build    # Production build to dist/
npm run preview  # Preview production build
```


## TheGridBase Agent System

This project is part of the TheGridBase portfolio managed by a 29-agent orchestration system. When working on complex tasks, spawn specialized agents:

| Task | Agent | Trigger |
|------|-------|---------|
| Frontend/UI | `craftsman` | React, Tailwind, animations |
| Database | `oracle` | Schema, queries, migrations |
| Security | `sentinel` | Auth, OWASP, vulnerability |
| Testing | `tester` | Unit/integration tests |
| E2E/A11y | `qa` | Playwright, WCAG audits |
| Deploy | `deployer` | Vercel, CI/CD, DNS |
| Performance | `auditor` | Lighthouse, Core Web Vitals |
| Multi-file | `composer` | Cross-module refactoring |
| Architecture | `architect` | System design, planning |
| Git ops | `refinery` | Merge conflicts, rebasing |

Agent definitions: `~/.claude/agents/` | Full system: `MASTER_CONTROL.md`

**Rules:**
- Simple tasks: handle directly, no agent needed
- Complex multi-domain tasks: spawn multiple agents in parallel
- All code changes must follow VBR (Verify-Before-Report) protocol
- Turkish explanations, English code/commits
