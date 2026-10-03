// Public API of the playability engine. Pure TypeScript, no runtime dependencies.
// Vendored into Chord Explorer by its scripts/sync-engine.mjs; bump on any behaviour change.
export const ENGINE_VERSION = '0.1.0';

export * from './types';
export * from './pitch';
export * from './tuning';
export * from './random';
export * from './geometry';
export * from './shape';
export * from './handProfile';
export * from './weights';
export * from './fingering';
export * from './voicingSpec';
export * from './naming';
export * from './playability';
export * from './generateVoicings';
export * from './transition';
export * from './rhythm';
