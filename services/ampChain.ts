import * as Tone from 'tone';
import { GUITAR_DEAD_SAMPLES, GUITAR_SAMPLE_NOTES, guitarSampleUrl, onsetSeconds, saturationCurve } from '../utils/ampTone';

/**
 * The "New" amp model: a two-stage high-gain preamp, a tone stack, a soft power stage and a speaker-cabinet
 * filter, with a clean path into the same cabinet. Instruments connect to `input`. Every number here is a
 * listening choice (documented in the Rhythm Lab notes), not a model of a specific commercial amp.
 */
export interface ModernAmp {
  input: Tone.Gain;
  /** How long the current channel delays the sound (waveshaper oversampling); clicks wait this long too. */
  latencySec: () => number;
  /** Clean or drive path; ramps over a few ms so switching mid-note does not click. */
  setChannel: (distorted: boolean) => void;
  /** Chord-aware drive: pre-gain trim in dB for the hit starting at `time`. */
  setDriveTrim: (db: number, time: number) => void;
  dispose: () => void;
}

const CHANNEL_RAMP_SEC = 0.05;
const TRIM_TIME_CONSTANT = 0.004;
/**
 * Oversampling filters delay the signal: measured with an impulse in Chrome, 4x = 4.35 ms and 2x = 2.9 ms per
 * waveshaper (WebKit shares the resampler). The drive path uses 4x on stage A, where aliasing is worst, 2x on
 * stage B and none on the gentle power stage: 7.25 ms in total. A compressor would add a fixed 6 ms lookahead,
 * so the clean path has none.
 */
export const DRIVE_LATENCY_SEC = 0.00725;

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
  stageB.oversample = '2x';

  // Tone stack: a little bass, scooped low mids, presence
  const bass = new Tone.Filter({ type: 'lowshelf', frequency: 100, gain: 3 });
  const mids = new Tone.Filter({ type: 'peaking', frequency: 650, Q: 0.7, gain: -5 });
  const presence = new Tone.Filter({ type: 'peaking', frequency: 3500, Q: 0.9, gain: 4 });

  // Power stage: gentle extra compression (soft enough to run without oversampling)
  const powerGain = new Tone.Gain(1.5);
  const power = new Tone.WaveShaper(saturationCurve(1.5));
  const driveLevel = new Tone.Gain(Tone.dbToGain(-8));

  // Clean path: straight into the cabinet
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
  cleanSend.chain(cleanLevel, cabHighpass);
  cabHighpass.chain(cabPeak, cabLowpass, postHighpass, room, level, output);

  const nodes: Tone.ToneAudioNode[] = [
    input, driveSend, cleanSend, preHighpass, preMid, preLowpass, driveTrim, stageAGain, stageA, dcBlock, interstage,
    stageBGain, stageB, bass, mids, presence, powerGain, power, driveLevel, cleanLevel, cabHighpass,
    cabPeak, cabLowpass, postHighpass, room, level
  ];

  let distortedNow = false;

  return {
    input,
    latencySec: () => (distortedNow ? DRIVE_LATENCY_SEC : 0),
    setChannel: (distorted) => {
      distortedNow = distorted;
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

/** What the engine needs from a note source: Tone.PolySynth and Tone.Sampler both fit. */
export interface NoteVoice {
  triggerAttackRelease: (note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity?: number) => unknown;
  releaseAll: (time?: Tone.Unit.Time) => unknown;
}

/**
 * Sources for the New model: chord (played cards and the RiffBar), open and palm-muted rhythm hits, and dead
 * notes. Palm mutes get a low-passed thump (700 to 300 Hz in 60 ms) that dies within about 120 ms, so they ring
 * for the grid step without smearing.
 */
export interface ModernVoices {
  kind: 'synth' | 'samples';
  chord: NoteVoice;
  open: NoteVoice;
  mute: NoteVoice;
  /** Palm-mute filter sweep for a hit at `time` (sample voices share one filter; synth voices have their own). */
  muteSweep: (time: number) => void;
  /** Longest a palm-muted note is held before its release. */
  muteHoldSec: number;
  dead: (time: number, velocity: number) => void;
  releaseAll: (time?: Tone.Unit.Time) => void;
  dispose: () => void;
}

const SAW = { type: 'sawtooth' as const };

/** Synth voices: used until the guitar samples have loaded, or when they cannot load (offline). */
export const createModernVoices = (amp: ModernAmp): ModernVoices => {
  const chord = new Tone.PolySynth(Tone.MonoSynth, {
    volume: -10,
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
  const noise = new Tone.NoiseSynth({
    volume: -10,
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 }
  }).connect(deadFilter);

  return {
    kind: 'synth',
    chord,
    open,
    mute,
    muteSweep: () => undefined,
    muteHoldSec: Infinity,
    dead: (time, velocity) => noise.triggerAttackRelease(0.02, time, velocity),
    releaseAll: (time) => {
      chord.releaseAll(time);
      open.releaseAll(time);
      mute.releaseAll(time);
    },
    dispose: () => {
      [chord, open, mute, noise, deadFilter].forEach((node) => node.dispose());
    }
  };
};

/** Decoded Emilyguitar DI samples, trimmed to their attack. */
export interface GuitarSamples {
  notes: Map<number, Tone.ToneAudioBuffer>;
  dead: Tone.ToneAudioBuffer[];
}

const trimToAttack = (buffer: Tone.ToneAudioBuffer): Tone.ToneAudioBuffer => {
  const start = onsetSeconds(buffer.getChannelData(0), buffer.sampleRate);
  return start > 0 ? buffer.slice(start) : buffer;
};

/** Downloads and decodes the CC0 Emilyguitar samples (about 600 KB). Rejects when any file fails. */
export const loadGuitarSamples = async (): Promise<GuitarSamples> => {
  const notes = await Promise.all(
    Object.entries(GUITAR_SAMPLE_NOTES).map(async ([midi, name]) => {
      const buffer = await Tone.ToneAudioBuffer.fromUrl(guitarSampleUrl(name));
      return [Number(midi), trimToAttack(buffer)] as const;
    })
  );
  const dead = await Promise.all(GUITAR_DEAD_SAMPLES.map(async (name) => trimToAttack(await Tone.ToneAudioBuffer.fromUrl(guitarSampleUrl(name)))));
  return { notes: new Map(notes), dead };
};

const PALM_MUTE_HOLD_SEC = 0.12;

/**
 * Sample voices: real DI strings into the amp, repitched from the nearest recorded note. Palm mutes run through
 * one shared low-pass whose cutoff sweeps 700 to 300 Hz on every muted hit; dead notes are recorded muted-string
 * hits, alternating between two takes.
 */
export const createSampleVoices = (amp: ModernAmp, samples: GuitarSamples): ModernVoices => {
  const urls = Object.fromEntries([...samples.notes].map(([midi, buffer]) => [midi, buffer]));
  const chord = new Tone.Sampler({ urls, release: 0.6, volume: 0 }).connect(amp.input);
  const open = new Tone.Sampler({ urls, release: 0.08, volume: -4.5 }).connect(amp.input);

  const muteFilter = new Tone.Filter({ type: 'lowpass', frequency: 300, Q: 1, rolloff: -24 }).connect(amp.input);
  const sweep = new Tone.FrequencyEnvelope({ attack: 0.001, decay: 0.06, sustain: 0, release: 0.05, baseFrequency: 300, octaves: Math.log2(700 / 300) });
  sweep.connect(muteFilter.frequency);
  const mute = new Tone.Sampler({ urls, release: 0.04, volume: -2.5 }).connect(muteFilter);

  const deadGain = new Tone.Gain(Tone.dbToGain(-4)).connect(amp.input);
  const deadPlayers = samples.dead.map((buffer) => new Tone.Player(buffer).connect(deadGain));
  let deadCount = 0;

  return {
    kind: 'samples',
    chord,
    open,
    mute,
    muteSweep: (time) => sweep.triggerAttackRelease(0.06, time),
    muteHoldSec: PALM_MUTE_HOLD_SEC,
    dead: (time) => {
      deadPlayers[deadCount++ % Math.max(1, deadPlayers.length)]?.start(time);
    },
    releaseAll: (time) => {
      chord.releaseAll(time);
      open.releaseAll(time);
      mute.releaseAll(time);
    },
    dispose: () => {
      [chord, open, mute, muteFilter, sweep, deadGain, ...deadPlayers].forEach((node) => node.dispose());
    }
  };
};
