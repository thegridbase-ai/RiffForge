import * as Tone from 'tone';
import type { PlaybackEvent } from '../engine/types';
import { midiToName } from '../engine/pitch';

export interface SequenceStep {
  notes: string[];
}

export interface RhythmClick {
  timeSec: number;
  strong: boolean;
}

export interface PlayRhythmOptions {
  /** Loop length in seconds (the whole pattern). */
  loopSeconds: number;
  bpm: number;
  /** Metronome pulses inside one loop (beats; eighths in x/8), strong on bar starts. */
  clickTimes: RhythmClick[];
  metronome: boolean;
  /** Called on the UI thread (Tone.Draw) when events[index] sounds. */
  onEvent?: (index: number) => void;
  /** Optional playhead: called with the grid step index every stepSeconds, rests included. */
  stepSeconds?: number;
  onStep?: (step: number) => void;
}

/** Per-string strum spread for rhythm hits; kept tight so chugs stay on the grid. */
const RHYTHM_STRUM_SEC = 0.006;

class AudioEngine {
  private synth: Tone.PolySynth | null = null;
  private distortion: Tone.Distortion | null = null;
  private reverb: Tone.Reverb | null = null;
  private limiter: Tone.Limiter | null = null;
  private clickSynth: Tone.MembraneSynth | null = null;
  private initialized: boolean = false;
  private repeatEventId: number | null = null;
  private metronomeEnabled: boolean = false;
  private rhythmSynth: Tone.PolySynth | null = null;
  private rhythmParts: Tone.Part[] = [];
  private rhythmLoopSeconds = 0;
  private rhythmOffsetSeconds = 0;
  private rhythmMetronome = false;
  private rhythmStopListeners = new Set<() => void>();

  constructor() {
    // Lazy initialization
  }

  public async init() {
    if (this.initialized) return;

    await Tone.start();

    // 1. Master Chain
    this.limiter = new Tone.Limiter(-1).toDestination();

    // 2. Reverb (Atmosphere)
    this.reverb = new Tone.Reverb({
      decay: 4,
      preDelay: 0.1,
      wet: 0.3
    }).connect(this.limiter);

    // 3. Distortion (The "Dirty" Channel)
    // Using a fairly high gain but managing output via wet/dry
    this.distortion = new Tone.Distortion({
      distortion: 0.8,
      oversample: '4x', 
      wet: 0 
    }).connect(this.reverb);

    // 4. Synth (The Guitar Source)
    this.synth = new Tone.PolySynth(Tone.Synth, {
      volume: -5,
      oscillator: {
        type: "triangle" // Clean default
      },
      envelope: {
        attack: 0.05,
        decay: 2,
        sustain: 0.3,
        release: 2
      }
    }).connect(this.distortion);

    // Looped chords overlap their 2s release tails; default 32 voices runs out
    this.synth.maxPolyphony = 64;

    // 5. Metronome click — routed straight to the limiter, OUTSIDE the
    // distortion chain so the click stays clean even in metal mode
    this.clickSynth = new Tone.MembraneSynth({
      volume: -6,
      pitchDecay: 0.008,
      octaves: 2,
      envelope: {
        attack: 0.001,
        decay: 0.08,
        sustain: 0,
        release: 0.05
      }
    }).connect(this.limiter);

    // 6. Rhythm Lab voice: same distortion/reverb/limiter chain, but a percussive envelope so palm-muted
    // 16ths stay tight (the chord synth's 50 ms attack and 2 s release would smear them)
    this.rhythmSynth = new Tone.PolySynth(Tone.Synth, {
      volume: -2,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.003, decay: 0.25, sustain: 0.45, release: 0.08 }
    }).connect(this.distortion);
    this.rhythmSynth.maxPolyphony = 48;

    this.initialized = true;
  }

  public setDistortion(isDistorted: boolean) {
    if (!this.synth || !this.distortion) return;

    if (isDistorted) {
      // METAL MODE
      // Aggressive wave shape
      this.synth.set({ 
        oscillator: { type: "sawtooth" },
        volume: -8 // Lower volume to compensate for distortion gain
      });
      this.rhythmSynth?.set({ oscillator: { type: 'sawtooth' }, volume: -8 });
      
      this.distortion.wet.rampTo(1, 0.2);
    } else {
      // CLEAN MODE
      // Softer wave shape
      this.synth.set({ 
        oscillator: { type: "triangle" },
        volume: -2 // Boost volume for clean signal
      });
      this.rhythmSynth?.set({ oscillator: { type: 'triangle' }, volume: -2 });
      
      this.distortion.wet.rampTo(0, 0.2);
    }
  }

  public playChord(notes: string[]) {
    if (!this.synth) return;
    
    // Slight randomization of velocity for "human" feel
    const velocity = 0.8 + Math.random() * 0.2;
    
    // Release previous notes to avoid muddy buildup
    this.synth.releaseAll();
    
    // Strum effect: trigger notes with slight delay
    const now = Tone.now();
    notes.forEach((note, index) => {
      this.synth!.triggerAttackRelease(note, "2n", now + (index * 0.03), velocity);
    });
  }

  public stop() {
    this.synth?.releaseAll();
  }

  public setMetronomeEnabled(enabled: boolean) {
    this.metronomeEnabled = enabled;
  }

  /**
   * Loops a chord sequence on the Transport, one chord per beat (quarter
   * notes) at the given BPM, through the existing synth/distortion chain.
   * With an empty sequence it acts as a standalone click track.
   * Call stopSequence() to cancel; call again to restart with new settings.
   */
  public playSequence(steps: SequenceStep[], bpm: number, onStep?: (index: number) => void) {
    if (!this.initialized) return;

    // The RiffBar and the Rhythm Lab share the Transport: stop the rhythm loop and tell the lab
    if (this.isRhythmPlaying()) this.stopRhythm();

    this.stopSequence();

    const transport = Tone.getTransport();
    transport.bpm.value = bpm;

    let beat = 0;
    this.repeatEventId = transport.scheduleRepeat((time) => {
      const beatInBar = beat % 4;

      // Metronome click: accent on the downbeat (higher pitch + velocity)
      if (this.metronomeEnabled && this.clickSynth) {
        this.clickSynth.triggerAttackRelease(
          beatInBar === 0 ? 'C5' : 'G4',
          '32n',
          time,
          beatInBar === 0 ? 1 : 0.55
        );
      }

      if (steps.length > 0 && this.synth) {
        const index = beat % steps.length;
        this.synth.releaseAll(time);
        steps[index].notes.forEach((note, i) => {
          // Tight strum so chords stay locked to the beat; short duration
          // keeps overlapping release tails within the voice budget
          this.synth!.triggerAttackRelease(note, '8n', time + i * 0.015, 0.85);
        });
        if (onStep) {
          Tone.getDraw().schedule(() => onStep(index), time);
        }
      }

      beat++;
    }, '4n');

    transport.start();
  }

  /** Stops the loop and clears every Transport schedule cleanly. */
  public stopSequence() {
    const transport = Tone.getTransport();
    if (this.repeatEventId !== null) {
      transport.clear(this.repeatEventId);
      this.repeatEventId = null;
    }
    transport.stop();
    transport.cancel();
    Tone.getDraw().cancel();
    this.synth?.releaseAll();
  }

  public isSequencePlaying() {
    return this.repeatEventId !== null;
  }

  public isReady() {
    return this.initialized;
  }

  /**
   * Loops a Rhythm Lab pattern on the Transport: one Tone.Part over the playback events (time = timeSec,
   * looped at loopSeconds), a click Part for the metronome and an optional playhead Part. Calling it while a
   * rhythm plays restarts cleanly at the same position in the loop. Callers stop a running RiffBar sequence
   * (and its store state) first; this method only guards the shared Transport.
   */
  public playRhythm(events: PlaybackEvent[], opts: PlayRhythmOptions) {
    if (!this.initialized || !this.rhythmSynth || !(opts.loopSeconds > 0)) return;

    const transport = Tone.getTransport();
    let offset = 0;
    if (this.rhythmParts.length > 0 && this.rhythmLoopSeconds > 0) {
      // Loop position = start offset + Transport time; keep the same fraction of the new loop
      const position = (this.rhythmOffsetSeconds + transport.seconds) % this.rhythmLoopSeconds;
      const phase = position / this.rhythmLoopSeconds;
      offset = Number.isFinite(phase) ? phase * opts.loopSeconds : 0;
    }
    this.teardownRhythm();
    if (this.repeatEventId !== null) this.stopSequence();

    transport.bpm.value = opts.bpm;
    this.rhythmLoopSeconds = opts.loopSeconds;
    this.rhythmOffsetSeconds = offset;
    this.rhythmMetronome = opts.metronome;
    const synth = this.rhythmSynth;
    const draw = Tone.getDraw();

    const notePart = new Tone.Part<{ time: number; index: number }>((time, value) => {
      const event = events[value.index];
      if (!event || event.midi.length === 0) return;
      const notes = event.midi.map(midiToName);
      const duration = Math.max(0.01, event.durationSec);
      const spread = event.kind === 'dead' ? 0.002 : RHYTHM_STRUM_SEC;
      notes.forEach((note, i) => {
        synth.triggerAttackRelease(note, duration, time + i * spread, event.velocity);
      });
      if (opts.onEvent) draw.schedule(() => opts.onEvent?.(value.index), time);
    }, events.map((event, index) => ({ time: event.timeSec, index })));

    const clickPart = new Tone.Part<{ time: number; strong: boolean }>((time, value) => {
      if (!this.rhythmMetronome || !this.clickSynth) return;
      this.clickSynth.triggerAttackRelease(value.strong ? 'C5' : 'G4', '32n', time, value.strong ? 1 : 0.55);
    }, opts.clickTimes.map((click) => ({ time: click.timeSec, strong: click.strong })));

    this.rhythmParts = [notePart, clickPart];

    if (opts.onStep && opts.stepSeconds !== undefined && opts.stepSeconds > 0) {
      const steps = Math.round(opts.loopSeconds / opts.stepSeconds);
      const onStep = opts.onStep;
      const stepPart = new Tone.Part<{ time: number; step: number }>((time, value) => {
        draw.schedule(() => onStep(value.step), time);
      }, Array.from({ length: steps }, (_, step) => ({ time: step * (opts.stepSeconds as number), step })));
      this.rhythmParts.push(stepPart);
    }

    for (const part of this.rhythmParts) {
      part.loop = true;
      part.loopStart = 0;
      part.loopEnd = opts.loopSeconds;
      part.start(0, offset);
    }
    transport.start();
  }

  /** Stops the rhythm loop and notifies onRhythmStopped listeners (when one was playing). */
  public stopRhythm() {
    const wasPlaying = this.rhythmParts.length > 0;
    this.teardownRhythm();
    if (!wasPlaying) return;
    this.rhythmStopListeners.forEach((listener) => listener());
  }

  public isRhythmPlaying() {
    return this.rhythmParts.length > 0;
  }

  /** Metronome on/off for a running rhythm loop without restarting it. */
  public setRhythmMetronome(enabled: boolean) {
    this.rhythmMetronome = enabled;
  }

  /** Registers a listener for rhythm stops (e.g. the RiffBar took over the Transport). Returns an unsubscribe. */
  public onRhythmStopped(listener: () => void): () => void {
    this.rhythmStopListeners.add(listener);
    return () => {
      this.rhythmStopListeners.delete(listener);
    };
  }

  private teardownRhythm() {
    if (this.rhythmParts.length === 0) return;
    for (const part of this.rhythmParts) {
      part.stop();
      part.dispose();
    }
    this.rhythmParts = [];
    this.rhythmLoopSeconds = 0;
    this.rhythmOffsetSeconds = 0;
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    Tone.getDraw().cancel();
    this.rhythmSynth?.releaseAll();
  }
}

export const audioEngine = new AudioEngine();
