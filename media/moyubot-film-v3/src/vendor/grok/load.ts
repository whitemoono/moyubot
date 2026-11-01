/*
 * MoyuBot 的七个 Bot 头像引擎（vendored，与应用内 BotAvatar 同源）。
 * 侧效导入后挂在 window：GROK_GEO（几何/调色）与 GrokCharacter（角色实例）。
 * 来源与授权见 src/vendor/grok/LICENSE.ai-girl-bot 与仓库 docs/ASSETS.md。
 */
import './geometry-data';
import './chibi-shape';
import './shiro-shape';
import './mikan-shape';
import './neko-shape';
import './tsuki-shape';
import './nemu-shape';
import './zeta-shape';
import './math';
import './tables';
import './pose';
import './tricks';
import './fx';
import './eyes';
import './character';

export interface GrokStaticPortrait {
  path: string;
  decals?: {fill: string; d: string; rule?: 'evenodd' | 'nonzero'}[];
  iconFace?: {anchors: [number, number][]; rx: number; ry: number; ink?: string};
}

export const grokGeo = (): {shapes: Record<string, GrokStaticPortrait>} | null => {
  return (window as unknown as {GROK_GEO?: {shapes: Record<string, GrokStaticPortrait>}}).GROK_GEO ?? null;
};

export const grokPortrait = (shape: string): GrokStaticPortrait | undefined => {
  return grokGeo()?.shapes?.[shape];
};

export const grokCharacterCtor =
  (): (new (svg: SVGSVGElement, opts: Record<string, unknown>) => GrokDrivenCharacter) | null => {
    return ((window as unknown as {GrokCharacter?: (new (svg: SVGSVGElement, opts: Record<string, unknown>) => GrokDrivenCharacter) | undefined}).GrokCharacter ?? null);
  };

export interface GrokDrivenCharacter {
  t0: number;
  step(dt: number): void;
  setState(name: string, opts?: {resetEyes?: boolean}): void;
  destroy(): void;
}
