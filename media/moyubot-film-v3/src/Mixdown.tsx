import React from 'react';
import {Audio} from '@remotion/media';
import {staticFile} from 'remotion';
import {FPS, SFX_GAIN, STORY, VOICE_MANIFEST} from './story';

/** 音乐在人声窗口内自动闪避（ducking），两侧 0.2s 平滑坡。 */
const duck = (() => {
  const windows = VOICE_MANIFEST.map((c) => ({
    s: c.start - 0.15,
    e: c.start + c.dur + 0.25,
  }));
  return (f: number): number => {
    const t = f / FPS;
    let v = 1;
    for (const w of windows) {
      if (t >= w.s && t <= w.e) {
        v = Math.min(v, 0.4);
      } else if (t > w.s - 0.22 && t < w.s) {
        v = Math.min(v, 0.4 + (1 - (w.s - t) / 0.22) * 0.6 * 0 + ((w.s - t) / 0.22) * 0.6);
      } else if (t > w.e && t < w.e + 0.45) {
        v = Math.min(v, 0.4 + ((t - w.e) / 0.45) * 0.6);
      }
    }
    return v;
  };
})();

export const Mixdown: React.FC = () => {
  return (
    <>
      <Audio src={staticFile('audio/music.wav')} volume={duck} />
      {VOICE_MANIFEST.map((c) => (
        <Audio key={c.id} from={Math.round(c.start * FPS)} src={staticFile(c.file)} volume={0.96} />
      ))}
      {STORY.sfx.map((e, i) => (
        <Audio
          key={`${e.time}-${e.name}-${i}`}
          from={Math.round(e.time * FPS)}
          src={staticFile(`audio/sfx/${e.name}.wav`)}
          volume={(SFX_GAIN[e.name] ?? 0.5) * (e.gain ?? 1)}
        />
      ))}
    </>
  );
};
