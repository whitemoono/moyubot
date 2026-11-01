import story from '../story.json';
import voiceManifest from '../output/audio/voice-manifest.json';

export interface Scene {
  id: string;
  start: number;
  end: number;
  label: string;
}
export interface CastMember {
  shape: string;
  name: string;
  color: string;
  pale: string;
  tag: string;
  mood: string;
}
export interface Cue {
  id: string;
  start: number;
  text: string;
}
export interface SfxEvent {
  time: number;
  name: string;
  gain?: number;
}
export interface Story {
  meta: {
    title: string;
    version: string;
    fps: number;
    width: number;
    height: number;
    brand: string;
    site: string;
    github: string;
    telegram: string;
    qq: string;
  };
  scenes: Scene[];
  cast: CastMember[];
  cues: Cue[];
  sfx: SfxEvent[];
  music: {bpm: number; key: string; sections: {name: string; start: number; end: number; notes: string}[]};
}

export const STORY = story as unknown as Story;
export const FPS = STORY.meta.fps;
export const DURATION_SEC = STORY.scenes[STORY.scenes.length - 1].end;
export const TOTAL_FRAMES = Math.round(DURATION_SEC * FPS);

export const scene = (id: string): Scene => {
  const s = STORY.scenes.find((x) => x.id === id);
  if (!s) {
    throw new Error(`scene ${id} not found`);
  }
  return s;
};

export const sec = (s: number): number => Math.round(s * FPS);
export const sceneFrames = (id: string): {from: number; durationInFrames: number} => {
  const s = scene(id);
  return {from: sec(s.start), durationInFrames: sec(s.end) - sec(s.start)};
};

export interface VoiceManifestEntry {
  id: string;
  start: number;
  dur: number;
  file: string;
  text: string;
}
export const VOICE_MANIFEST = voiceManifest as unknown as VoiceManifestEntry[];

/** Per-sound-effect base gain so the library sits at a sane level before story overrides. */
export const SFX_GAIN: Record<string, number> = {
  swoosh: 0.42,
  pop: 0.62,
  boop: 0.5,
  ping: 0.5,
  ping2: 0.46,
  chime: 0.55,
  sparkle: 0.4,
  click: 0.4,
  key: 0.4,
  notify: 0.45,
  bubble: 0.55,
  page: 0.4,
  power_up: 0.6,
  power_down: 0.55,
};
