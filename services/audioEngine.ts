import * as Tone from 'tone';

export interface SequenceStep {
  notes: string[];
}

class AudioEngine {
  private synth: Tone.PolySynth | null = null;
  private distortion: Tone.Distortion | null = null;
  private reverb: Tone.Reverb | null = null;
  private limiter: Tone.Limiter | null = null;
  private clickSynth: Tone.MembraneSynth | null = null;
  private initialized: boolean = false;
  private repeatEventId: number | null = null;
  private metronomeEnabled: boolean = false;

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
      
      this.distortion.wet.rampTo(1, 0.2);
    } else {
      // CLEAN MODE
      // Softer wave shape
      this.synth.set({ 
        oscillator: { type: "triangle" },
        volume: -2 // Boost volume for clean signal
      });
      
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
}

export const audioEngine = new AudioEngine();
