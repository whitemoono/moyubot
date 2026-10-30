import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Bot } from '@moyu/core';
import { useMoyu } from '../state';
import { GROK_ENGINE_ENABLED, createGrokCharacter, grokPortrait, type GrokCharacterInstance } from '../assets/grok/grok-engine';
import { BOT_ACTIVITY } from '../lib/bot-activity';
import type { BotActivityKind } from '../lib/bot-activity';

/**
 * Bot 头像 = vendored 的 Grok 角色引擎实例（登录页同款，64px 设计）。
 * 身形使用 ai girl bot 的七套角色，未指定时默认 DeepSeek（chibi）；
 * 表情根据这个 Bot 的真实活动切换；消息可覆盖状态，旧消息使用静态角色。
 * 动作规则见 docs/BOT-ACTIVITY.md，授权与出处见 docs/ASSETS.md。
 */

type AvatarBot = Pick<Bot, 'id' | 'name' | 'avatar'> & { handle?: string };

/** Stable ids from the portrait files; unknown legacy values use DeepSeek. */
const PORTRAITS = ['chibi', 'shiro', 'mikan', 'neko', 'tsuki', 'nemu', 'zeta'];
const IDLE_EXPRESSIONS = ['curious', 'happy', 'playful', 'excited', 'proud', 'shy', 'laughing'];
const randomDelay = (min: number, max: number) => min + Math.random() * (max - min);

export function BotAvatar({
  bot,
  size = 'sm',
  className = '',
  animated = true,
  activity,
}: {
  bot: AvatarBot;
  size?: 'sm' | 'lg' | 'xl';
  className?: string;
  animated?: boolean;
  activity?: BotActivityKind;
}) {
  const { botActivities, settings } = useMoyu();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const charRef = useRef<GrokCharacterInstance | null>(null);
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reduceMotion = !animated || settings.ui.reduceMotion || systemReducedMotion;
  const shape = PORTRAITS.includes(bot.avatar.shape ?? '') ? bot.avatar.shape! : 'chibi';
  const kind = activity ?? botActivities[bot.id]?.kind ?? 'idle';
  const mood = BOT_ACTIVITY[kind].motion;
  const portrait = grokPortrait(shape);
  const customImage = bot.avatar.imageDataUrl && /^data:image\/(?:png|jpeg|webp|gif);base64,/.test(bot.avatar.imageDataUrl) ? bot.avatar.imageDataUrl : undefined;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (customImage || !GROK_ENGINE_ENABLED || !svgRef.current || reduceMotion) return;
    const char = createGrokCharacter(svgRef.current, {
      shape,
      mode: 'hold',
      loginWrap: true,
      inkFlat: 'var(--avatar-ink)',
      eyeColor: 'var(--avatar-void)',
      reduceMotion,
      preservePortrait: false,
      autoTricks: false,
      onChange: ({ state }) => {
        if (svgRef.current?.parentElement) svgRef.current.parentElement.dataset.expression = state;
      },
    });
    charRef.current = char;
    return () => {
      char?.destroy();
      charRef.current = null;
    };
  }, [reduceMotion, shape, customImage]);

  // Pause the rAF engine while offscreen or when the window is hidden, so many
  // avatars (sidebar + status) don't keep animating and drop frames.
  useEffect(() => {
    if (customImage || reduceMotion) return;
    const host = svgRef.current?.parentElement;
    if (!host) return;
    const observer = new IntersectionObserver((entries) => {
      charRef.current?.setPaused(!entries[0]?.isIntersecting);
    }, { rootMargin: '240px' });
    observer.observe(host);
    const onVisibility = () => charRef.current?.setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduceMotion, shape, customImage]);

  useEffect(() => {
    const char = charRef.current;
    if (!char) return;
    char.setMode('hold');
    char.setState(mood, { resetEyes: false });
    if (kind === 'thinking' && !reduceMotion) {
      const cycle = ['curious', 'thinking', 'searching', 'thinking'];
      let index = 0;
      const timer = window.setInterval(() => {
        index = (index + 1) % cycle.length;
        char.setState(cycle[index]!, { resetEyes: false });
      }, 2300);
      return () => window.clearInterval(timer);
    }
    // Ambient expressions belong to identity surfaces; reply avatars follow the message.
    if (kind !== 'idle' || activity !== undefined || reduceMotion) return;

    let timer: number;
    let previous = '';
    const rest = () => {
      char.setState('idle', { resetEyes: false });
      timer = window.setTimeout(react, randomDelay(3200, 6200));
    };
    const react = () => {
      const choices = IDLE_EXPRESSIONS.filter((name) => name !== previous);
      previous = choices[Math.floor(Math.random() * choices.length)]!;
      char.setState(previous, { resetEyes: false });
      timer = window.setTimeout(rest, randomDelay(1800, 2800));
    };
    const greet = () => {
      window.clearTimeout(timer);
      char.setState('happy', { resetEyes: false });
      timer = window.setTimeout(rest, 1800);
    };
    const host = svgRef.current?.parentElement;
    host?.addEventListener('pointerenter', greet);
    timer = window.setTimeout(react, randomDelay(1200, 2400));
    return () => {
      window.clearTimeout(timer);
      host?.removeEventListener('pointerenter', greet);
    };
  }, [mood, kind, activity, reduceMotion, shape, customImage]);

  const plate = `bot-avatar${size === 'sm' ? '' : ` bot-avatar--${size}`}${className ? ` ${className}` : ''}`;

  if (customImage) return <span className={`${plate} bot-avatar--uploaded`} data-activity={kind} title={`${bot.name} · ${BOT_ACTIVITY[kind].label}`}><img src={customImage} alt={`${bot.name} 头像`} /></span>;

  if (!GROK_ENGINE_ENABLED) {
    return <span className={`${plate} bot-avatar--plain`}>{bot.avatar.glyph}</span>;
  }

  return (
    <span className={`${plate} bot-avatar--art bot-avatar--portrait`} data-activity={kind} data-animated={!reduceMotion} style={{ '--bot-color': bot.avatar.from, '--avatar-ink': bot.avatar.from, '--avatar-void': '#ffffff' } as CSSProperties} title={`${bot.name} · ${BOT_ACTIVITY[kind].label}`}>
      <svg key={`${shape}-${reduceMotion ? 'static' : 'live'}`} ref={svgRef} role="img" aria-label={`${bot.name} · ${BOT_ACTIVITY[kind].label}`} viewBox="-15 -15 259 259">
        {reduceMotion && portrait ? <g><path d={portrait.path} fill={bot.avatar.from} />{portrait.decals?.map((decal, index) => <path key={index} d={decal.d} fill={decal.fill} fillRule={decal.rule ?? 'evenodd'} />)}{portrait.iconFace?.anchors.map(([x, y], index) => <rect key={index} x={x - portrait.iconFace!.rx} y={y - portrait.iconFace!.ry} width={portrait.iconFace!.rx * 2} height={portrait.iconFace!.ry * 2} rx={portrait.iconFace!.rx} fill={portrait.iconFace!.ink ?? '#1a1a1f'} />)}</g> : null}
      </svg>
    </span>
  );
}
