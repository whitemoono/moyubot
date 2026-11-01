import React, {useEffect, useRef} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {grokCharacterCtor, type GrokDrivenCharacter} from '../vendor/grok/load';

export interface AvatarStateEvent {
  /** seconds, relative to the avatar's local timeline */
  at: number;
  state: string;
}

/* Deterministic PRNG: the vendored engine calls Math.random for blink/gaze
   schedules, so each render seeds it identically before constructing. */
const mulberry32 = (a: number) => {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashShape = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const SIM_DT = 1 / 30;

/**
 * 一个真实的 MoyuBot 头像：vendored Grok 角色引擎，driven 模式手动步进。
 * 每一帧都从 t=0 以固定步长重放到当前时间，随机数用固定种子 —— Remotion
 * 任意乱序渲染都得到完全相同的画面。
 */
export const GrokAvatar: React.FC<{
  shape: string;
  color: string;
  size: number;
  states?: AvatarStateEvent[];
  eye?: string;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({shape, color, size, states = [], eye = '#ffffff', opacity = 1, style}) => {
  const ref = useRef<SVGSVGElement | null>(null);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const statesKey = JSON.stringify(states);
  const time = frame / fps;

  useEffect(() => {
    const svg = ref.current;
    const Ctor = grokCharacterCtor();
    if (!svg || !Ctor) {
      return;
    }
    const events: AvatarStateEvent[] = JSON.parse(statesKey);
    const origRandom = Math.random;
    Math.random = mulberry32(hashShape(shape) ^ 0x9e3779b9);
    let char: GrokDrivenCharacter | null = null;
    try {
      char = new Ctor(svg, {
        shape,
        mode: 'hold',
        state: 'idle',
        driven: true,
        loginWrap: true,
        inkFlat: color,
        eyeColor: eye,
        autoTricks: false,
        followPointer: false,
        reduceMotion: false,
        preservePortrait: false,
        sizePx: size,
      });
      const t0 = char.t0;
      const ordered = [...events].sort((a, b) => a.at - b.at);
      let ei = 0;
      const steps = Math.max(0, Math.round(time * 30));
      for (let i = 0; i <= steps; i++) {
        const local = i * SIM_DT;
        while (ei < ordered.length && local >= ordered[ei].at) {
          char.setState(ordered[ei].state, {resetEyes: false});
          ei++;
        }
        char.step(SIM_DT);
      }
      while (ei < ordered.length && time >= ordered[ei].at) {
        char.setState(ordered[ei].state, {resetEyes: false});
        ei++;
      }
    } finally {
      Math.random = origRandom;
    }
    return () => {
      try {
        char?.destroy();
      } catch {
        /* noop */
      }
      svg.innerHTML = '';
    };
  }, [frame, time, shape, color, size, eye, statesKey]);

  return (
    <svg
      ref={ref}
      style={{width: size, height: size, display: 'block', opacity, ...style}}
      viewBox="-15 -15 259 259"
    />
  );
};
