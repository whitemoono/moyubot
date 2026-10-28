import { useId } from 'react';
import type { Bot } from '@moyu/core';
import { GROK_AVATAR } from '../assets/grok/geometry';

/**
 * Bot 头像：把 `assets/grok/avatar-geometry.json` 里的团子轮廓 + idle 眼睛画成 SVG，
 * 轮廓填 Bot 自己的渐变色，眼睛按 handle 哈希挑一种「神情」。
 *
 * 角色几何提炼自 blessonism/grok-icon-study（造型归 xAI），出处与授权说明见 docs/ASSETS.md。
 * 素材被关掉时自动回落到渐变底 + 首字母。
 */

type AvatarBot = Pick<Bot, 'id' | 'name' | 'avatar'> & { handle?: string };

/**
 * 上游只给了 idle 那一组眼睛的坐标，其余 24 组是为旋转过的身形准备的，直接搬过来会越出轮廓。
 * 所以表情差异靠对同一组眼睛做刚体变换得到，坐标中心取团子的 (114, 114)。
 */
const POSES: { label: string; transform: string }[] = [
  { label: '空闲', transform: 'translate(-6 26)' },
  { label: '好奇', transform: 'translate(-58 34)' },
  { label: '专注', transform: 'translate(-18 52)' },
  { label: '俏皮', transform: 'rotate(-9 114 114) translate(-10 40)' },
  { label: '眯眼', transform: 'translate(114 114) scale(1 0.72) translate(-114 -114) translate(-12 40)' },
  { label: '张望', transform: 'translate(-36 18)' },
];

/** 稳定哈希：同一个 Bot 每次启动都是同一张脸。 */
function hashTo(seed: string, count: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % count;
}

export function BotAvatar({
  bot,
  size = 'sm',
  className = '',
}: {
  bot: AvatarBot;
  size?: 'sm' | 'lg' | 'xl';
  className?: string;
}) {
  const gradientId = `blob-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const plate = `bot-avatar${size === 'sm' ? '' : ` bot-avatar--${size}`}${className ? ` ${className}` : ''}`;
  const gradient = `linear-gradient(140deg, ${bot.avatar.from}, ${bot.avatar.to})`;

  if (!GROK_AVATAR) {
    return (
      <span className={plate} style={{ background: gradient }}>
        {bot.avatar.glyph}
      </span>
    );
  }

  const eyes = GROK_AVATAR.eyes[0]!;
  const pose = POSES[hashTo(bot.handle || bot.id || bot.name, POSES.length)]!;

  return (
    <span className={`${plate} bot-avatar--art`} title={`${bot.name} · ${pose.label}`}>
      <svg viewBox={GROK_AVATAR.viewBox.join(' ')} role="img" aria-label={bot.name}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={bot.avatar.from} />
            <stop offset="1" stopColor={bot.avatar.to} />
          </linearGradient>
        </defs>
        <path d={GROK_AVATAR.body} fill={`url(#${gradientId})`} />
        <g className="bot-avatar__eyes" transform={pose.transform}>
          {eyes.rings.map((ring, index) => (
            <path key={index} className="bot-avatar__eye" d={ring} />
          ))}
        </g>
      </svg>
    </span>
  );
}
