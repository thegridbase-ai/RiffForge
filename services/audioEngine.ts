import * as Tone from 'tone';

class AudioEngine {
  private synth: Tone.PolySynth | null = null;
  private distortion: Tone.Distortion | null = null;
  private reverb: Tone.Reverb | null = null;
  private limiter: Tone.Limiter | null = null;
  private initialized: boolean = false;

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

  public isReady() {
    return this.initialized;
  }
}

export const audioEngine = new AudioEngine();
