export const GROK_ENGINE_ENABLED = false;
export type { GrokCharacterInstance } from './grok-engine';

export const createGrokCharacter: typeof import('./grok-engine').createGrokCharacter = () => null;
export const grokPortrait: typeof import('./grok-engine').grokPortrait = () => undefined;
