/*
 * Grok 角色引擎 · vendored。
 *
 * 这层把上游 blessonism/grok-icon-study（对 Grok Bot.app v0.18.0 登录页角色动效的学习复刻）
 * 拆开的 8 个 IIFE 脚本按 index.html 的顺序加载，并给 React 侧一个有类型的入口。
 * 引擎全部几何/状态数据见 ./engine/，来源与授权说明见 docs/ASSETS.md。
 *
 * 想彻底关掉这套第三方角色素材：把 GROK_ENGINE_ENABLED 改成 false，
 * BotAvatar 自动回落到「单色底 + 首字母」，其它代码不用动。
 */
import './engine/geometry-data';
import './engine/math';
import './engine/tables';
import './engine/pose';
import './engine/tricks';
import './engine/fx';
import './engine/eyes';
import './engine/character';

export const GROK_ENGINE_ENABLED = true;

export type GrokMode = 'onboarding' | 'hold';

export interface GrokCharacterOptions {
  shape?: string;
  color?: string;
  scheme?: 'light' | 'dark';
  mode?: GrokMode;
  state?: string;
  sizePx?: number | null;
  loginWrap?: boolean;
  inkFlat?: string | null;
  eyeColor?: string | null;
  followPointer?: boolean;
  emphasis?: boolean;
  paused?: boolean;
  reduceMotion?: boolean;
  onChange?: (snapshot: GrokSnapshot) => void;
}

export interface GrokSnapshot {
  state: string;
  mode: string;
  shape: string;
  eyeFrom: number;
  eyeTo: number;
}

export interface GrokCharacterInstance {
  setState(name: string, opts?: { resetEyes?: boolean }): void;
  setMode(mode: GrokMode): void;
  setShape(name: string): void;
  setPaused(v: boolean): void;
  setEmphasis(v: boolean): void;
  destroy(): void;
  snapshot(): GrokSnapshot;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function createGrokCharacter(svg: SVGSVGElement, opts: GrokCharacterOptions): GrokCharacterInstance | null {
  if (!GROK_ENGINE_ENABLED) return null;
  const Ctor = (window as any).GrokCharacter;
  if (typeof Ctor !== 'function') return null;
  return new Ctor(svg, opts) as GrokCharacterInstance;
}

/** 可用身形列表（vendored 数据里现查，避免硬编码漂移）。 */
export function grokShapeNames(): string[] {
  const geo = (window as any).GROK_GEO;
  return geo?.shapes ? Object.keys(geo.shapes) : [];
}
