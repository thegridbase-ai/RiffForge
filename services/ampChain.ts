import * as Tone from 'tone';
import { saturationCurve } from '../utils/ampTone';

/**
 * The "New" amp model: a two-stage high-gain preamp, a tone stack, a soft power stage and a speaker-cabinet
 * filter, with a clean path into the same cabinet. Instruments connect to `input`. Every number here is a
 * listening choice (documented in the Rhythm Lab notes), not a model of a specific commercial amp.
 */
export interface ModernAmp {
  input: Tone.Gain;
  /** Clean or drive path; ramps over a few ms so switching mid-note does not click. */
  setChannel: (distorted: boolean) => void;
  /** Chord-aware drive: pre-gain trim in dB for the hit starting at `time`. */
  setDriveTrim: (db: number, time: number) => void;
  dispose: () => void;
}

const CHANNEL_RAMP_SEC = 0.05;
const TRIM_TIME_CONSTANT = 0.004;

export const createModernAmp = (output: Tone.InputNode): ModernAmp => {
  const input = new Tone.Gain(1);
  const driveSend = new Tone.Gain(0);
  const cleanSend = new Tone.Gain(1);
  input.fan(driveSend, cleanSend);

  // Pre-EQ: tight low end and a mid push into the gain stages (the "tube screamer" move)
  const preHighpass = new Tone.Filter({ type: 'highpass', frequency: 110, Q: 0.7 });
  const preMid = new Tone.Filter({ type: 'peaking', frequency: 750, Q: 0.7, gain: 6 });
  const preLowpass = new Tone.Filter({ type: 'lowpass', frequency: 6500, Q: 0.5 });
  const driveTrim = new Tone.Gain(1);

  // Stage A: asymmetric (biased) clipping, then DC block and a low shelf cut so stage B does not fart out
  const stageAGain = new Tone.Gain(4);
  const stageA = new Tone.WaveShaper(saturationCurve(8, 0.3));
  stageA.oversample = '4x';
  const dcBlock = new Tone.Filter({ type: 'highpass', frequency: 20, Q: 0.5 });
  const interstage = new Tone.Filter({ type: 'lowshelf', frequency: 320, gain: -6 });

  // Stage B: symmetric clipping
  const stageBGain = new Tone.Gain(3);
  const stageB = new Tone.WaveShaper(saturationCurve(5));
  stageB.oversample = '4x';

  // Tone stack: a little bass, scooped low mids, presence
  const bass = new Tone.Filter({ type: 'lowshelf', frequency: 100, gain: 3 });
  const mids = new Tone.Filter({ type: 'peaking', frequency: 650, Q: 0.7, gain: -5 });
  const presence = new Tone.Filter({ type: 'peaking', frequency: 3500, Q: 0.9, gain: 4 });

  // Power stage: gentle extra compression
  const powerGain = new Tone.Gain(1.5);
  const power = new Tone.WaveShaper(saturationCurve(1.5));
  power.oversample = '2x';
  const driveLevel = new Tone.Gain(Tone.dbToGain(-6.5));

  // Clean path: light compression so chords and single notes sit together
  const cleanCompressor = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.005, release: 0.15 });
  const cleanLevel = new Tone.Gain(Tone.dbToGain(14.5));

  // Speaker cabinet (a 4x12 with a dynamic mic, as a filter): no sub rumble, a 2.5 kHz bite, no fizz above 5 kHz
  const cabHighpass = new Tone.Filter({ type: 'highpass', frequency: 70, Q: 1.2 });
  const cabPeak = new Tone.Filter({ type: 'peaking', frequency: 2500, Q: 1.4, gain: 4 });
  const cabLowpass = new Tone.Filter({ type: 'lowpass', frequency: 5000, Q: 0.7, rolloff: -24 });

  // Post: a small room instead of the classic 4 s hall, which washes out fast riffs
  const postHighpass = new Tone.Filter({ type: 'highpass', frequency: 75, Q: 0.7 });
  const room = new Tone.Reverb({ decay: 1.2, preDelay: 0.015, wet: 0.14 });
  const level = new Tone.Gain(Tone.dbToGain(-8));

  driveSend.chain(
    preHighpass,
    preMid,
    preLowpass,
    driveTrim,
    stageAGain,
    stageA,
    dcBlock,
    interstage,
    stageBGain,
    stageB,
    bass,
    mids,
    presence,
    powerGain,
    power,
    driveLevel,
    cabHighpass
  );
  cleanSend.chain(cleanCompressor, cleanLevel, cabHighpass);
  cabHighpass.chain(cabPeak, cabLowpass, postHighpass, room, level, output);

  const nodes: Tone.ToneAudioNode[] = [
    input, driveSend, cleanSend, preHighpass, preMid, preLowpass, driveTrim, stageAGain, stageA, dcBlock, interstage,
    stageBGain, stageB, bass, mids, presence, powerGain, power, driveLevel, cleanCompressor, cleanLevel, cabHighpass,
    cabPeak, cabLowpass, postHighpass, room, level
  ];

  return {
    input,
    setChannel: (distorted) => {
      driveSend.gain.rampTo(distorted ? 1 : 0, CHANNEL_RAMP_SEC);
      cleanSend.gain.rampTo(distorted ? 0 : 1, CHANNEL_RAMP_SEC);
      room.wet.rampTo(distorted ? 0.08 : 0.14, CHANNEL_RAMP_SEC);
    },
    setDriveTrim: (db, time) => {
      driveTrim.gain.setTargetAtTime(Tone.dbToGain(db), time, TRIM_TIME_CONSTANT);
    },
    dispose: () => nodes.forEach((node) => node.dispose())
  };
};

/**
 * Sources for the New model. Open hits get a pluck-like filter sweep; palm mutes a low-passed thump (700 to
 * 300 Hz in 60 ms) with a 120 ms decay and no sustain, so they ring for the whole grid step without smearing;
 * dead notes are a 20 ms band-passed noise click instead of pitched notes.
 */
export interface ModernVoices {
  chord: Tone.PolySynth<Tone.MonoSynth>;
  open: Tone.PolySynth<Tone.MonoSynth>;
  mute: Tone.PolySynth<Tone.MonoSynth>;
  dead: Tone.NoiseSynth;
  releaseAll: (time?: Tone.Unit.Time) => void;
  dispose: () => void;
}

const SAW = { type: 'sawtooth' as const };

export const createModernVoices = (amp: ModernAmp): ModernVoices => {
  const chord = new Tone.PolySynth(Tone.MonoSynth, {
    volume: -11,
    oscillator: SAW,
    filter: { type: 'lowpass', rolloff: -24, Q: 0.8 },
    filterEnvelope: { attack: 0.003, decay: 0.6, sustain: 0.3, release: 0.8, baseFrequency: 700, octaves: 2.6 },
    envelope: { attack: 0.003, decay: 1.6, sustain: 0.35, release: 0.9 }
  }).connect(amp.input);
  chord.maxPolyphony = 48;

  const open = new Tone.PolySynth(Tone.MonoSynth, {
    volume: -12,
    oscillator: SAW,
    filter: { type: 'lowpass', rolloff: -24, Q: 0.8 },
    filterEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.35, release: 0.15, baseFrequency: 900, octaves: 2.5 },
    envelope: { attack: 0.002, decay: 0.4, sustain: 0.6, release: 0.1 }
  }).connect(amp.input);
  open.maxPolyphony = 48;

  const mute = new Tone.PolySynth(Tone.MonoSynth, {
    volume: -14,
    oscillator: SAW,
    filter: { type: 'lowpass', rolloff: -24, Q: 1 },
    filterEnvelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.05, baseFrequency: 300, octaves: Math.log2(700 / 300) },
    envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.04 }
  }).connect(amp.input);
  mute.maxPolyphony = 48;

  const deadFilter = new Tone.Filter({ type: 'bandpass', frequency: 1800, Q: 1 }).connect(amp.input);
  const dead = new Tone.NoiseSynth({
    volume: -10,
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 }
  }).connect(deadFilter);

  return {
    chord,
    open,
    mute,
    dead,
    releaseAll: (time) => {
      chord.releaseAll(time);
      open.releaseAll(time);
      mute.releaseAll(time);
    },
    dispose: () => {
      [chord, open, mute, dead, deadFilter].forEach((node) => node.dispose());
    }
  };
};
