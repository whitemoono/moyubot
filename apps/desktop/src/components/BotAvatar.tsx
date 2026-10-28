import { useEffect, useRef } from 'react';
import type { Bot } from '@moyu/core';
import { useMoyu } from '../state';
import { GROK_ENGINE_ENABLED, createGrokCharacter, type GrokCharacterInstance } from '../assets/grok/grok-engine';

/**
 * Bot 头像 = vendored 的 Grok 角色引擎实例（登录页同款，64px 设计）。
 * 身形固定 blob 圆团子，眼睛走上游 25 组多边形播放表；
 * 表情只看这个 Bot 自己的运行活动：审批请求 → listening，Agent 事件流 →
 * thinking / working / searching / writing / loading，空闲时进入上游
 * onboarding 轮换（idle ↔ curious ↔ happy…）。云电脑状态由状态球表达，
 * 不映射到头像。授权与出处见 docs/ASSETS.md。
 */

type AvatarBot = Pick<Bot, 'id' | 'name' | 'avatar'> & { handle?: string };

/**
 * 身形固定 blob（上游登录页官方形状，近圆的团子）：头像位是圆形容器，
 * 其他身形（teardrop / capsule 等）是纵向拉长的，放进去会显成椭圆。
 * Bot 的个性差异走表情轮换（onboarding）与运行状态，不靠身形。
 */
const AVATAR_SHAPE = 'blob';

export function BotAvatar({
  bot,
  size = 'sm',
  className = '',
}: {
  bot: AvatarBot;
  size?: 'sm' | 'lg' | 'xl';
  className?: string;
}) {
  const { bot: activeBot, running, approval, agentPhase, settings } = useMoyu();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const charRef = useRef<GrokCharacterInstance | null>(null);

  // 表情只看这个 Bot 自己的活动：审批 → 倾听，本会话在跑 → agent 阶段，其余 → 登录页式表情轮换。
  // 云电脑状态（休眠/唤醒/执行）由云电脑自己的状态球表达，不让所有头像一起睡觉。
  const mood =
    approval?.botId === bot.id
      ? 'listening'
      : activeBot?.id === bot.id && running
        ? agentPhase ?? 'thinking'
        : null;

  useEffect(() => {
    if (!GROK_ENGINE_ENABLED || !svgRef.current) return;
    const char = createGrokCharacter(svgRef.current, {
      shape: AVATAR_SHAPE,
      mode: 'onboarding',
      loginWrap: true,
      inkFlat: 'var(--avatar-ink)',
      eyeColor: 'var(--avatar-void)',
      reduceMotion: settings.ui.reduceMotion,
    });
    charRef.current = char;
    return () => {
      char?.destroy();
      charRef.current = null;
    };
  }, [settings.ui.reduceMotion]);

  useEffect(() => {
    const char = charRef.current;
    if (!char) return;
    if (mood) {
      char.setMode('hold');
      char.setState(mood, { resetEyes: false });
    } else {
      char.setMode('onboarding');
    }
  }, [mood]);

  const plate = `bot-avatar${size === 'sm' ? '' : ` bot-avatar--${size}`}${className ? ` ${className}` : ''}`;

  if (!GROK_ENGINE_ENABLED) {
    return <span className={`${plate} bot-avatar--plain`}>{bot.avatar.glyph}</span>;
  }

  return (
    <span className={`${plate} bot-avatar--art`} title={`${bot.name} · ${mood ?? '轮换中'}`}>
      <svg ref={svgRef} role="img" aria-label={bot.name} />
    </span>
  );
}
