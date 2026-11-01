/** Bot 头像（手机端）：与桌面端 BotAvatar 的静态渲染分支同一份数据、同一套画法。
 *  数据来自 scripts/dump-grok.cjs 从桌面运行时提取的 grok-portraits.json（shape → path/decals/iconFace）。 */
import React from 'react';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import portraits from '../assets/grok-portraits.json';

interface GrokPortrait { path: string; decals?: { fill: string; d: string; rule?: 'evenodd' | 'nonzero' }[]; iconFace?: { anchors: number[][]; rx: number; ry: number; ink?: string } }
const SHAPE_DATA = portraits as unknown as Record<string, GrokPortrait>;

export const AVATAR_COLORS = ['#5b8def', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export function BotAvatar({ bot, size = 44 }: { bot: { name: string; avatar?: { shape?: string; from?: string; glyph?: string } }; size?: number }) {
  const shape = bot.avatar?.shape && SHAPE_DATA[bot.avatar.shape] ? bot.avatar.shape : 'chibi';
  const portrait = SHAPE_DATA[shape];
  const color = bot.avatar?.from || AVATAR_COLORS[0];
  if (!portrait) {
    // 未知名形/数据缺失：单色底 + 首字符（与桌面端降级一致）
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel={`${bot.name} 头像`}>
        <Circle cx={50} cy={50} r={50} fill={color} />
        <SvgText x={50} y={64} fontSize={40} textAnchor="middle" fill="#fff">{bot.avatar?.glyph || bot.name.slice(0, 1)}</SvgText>
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="-15 -15 259 259" accessibilityLabel={`${bot.name} 头像`}>
      <Path d={portrait.path} fill={color} />
      {portrait.decals?.map((decal, index) => <Path key={index} d={decal.d} fill={decal.fill} fillRule={decal.rule ?? 'evenodd'} />)}
      {portrait.iconFace?.anchors.map(([x, y], index) => (
        <Rect key={index} x={x - portrait.iconFace!.rx} y={y - portrait.iconFace!.ry} width={portrait.iconFace!.rx * 2} height={portrait.iconFace!.ry * 2} rx={portrait.iconFace!.rx} fill={portrait.iconFace!.ink ?? '#1a1a1f'} />
      ))}
    </Svg>
  );
}
