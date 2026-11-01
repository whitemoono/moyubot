import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {GrokAvatar} from '../components/GrokAvatar';
import {BrandChip, fade, springish} from '../components/ui';
import {STORY} from '../story';

const Cast = STORY.cast;

const SLIDE_START = 3.8;
const SLIDE_DUR = 1.85;

const STATE_DEMO: {state: string; label: string; at: number; color: string}[] = [
  {state: 'thinking', label: '思考中', at: 17.0, color: '#3d7bfa'},
  {state: 'searching', label: '搜索中', at: 17.8, color: '#7c5cd6'},
  {state: 'working', label: '干活中', at: 18.6, color: '#20835c'},
  {state: 'listening', label: '等待审批', at: 19.35, color: '#d97a2b'},
  {state: 'happy', label: '完成！', at: 20.0, color: '#20713d'},
];

export const BotsShowcase: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  const titleOpacity = interpolate(frame, [12, 30, 102, 114], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const titleScale = interpolate(frame, [12, 34], [0.92, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});

  const currentState = [...STATE_DEMO].reverse().find((s) => t >= s.at) ?? STATE_DEMO[0];

  return (
    <AbsoluteFill style={{backgroundColor: '#f6f8fd', fontFamily: 'sans-serif'}}>
      <BrandChip />

      {/* per-bot washes */}
      {Cast.map((bot, i) => {
        const s0 = SLIDE_START + SLIDE_DUR * i;
        const opacity = interpolate(t, [s0 - 0.35, s0, s0 + SLIDE_DUR, s0 + SLIDE_DUR + 0.35], [0, 0.9, 0.9, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        if (opacity <= 0) {
          return null;
        }
        return (
          <AbsoluteFill
            key={bot.shape}
            style={{
              opacity,
              background: `radial-gradient(1100px 760px at 34% 52%, ${bot.pale} 0%, rgba(246,248,253,0.4) 62%, #f6f8fd 100%)`,
            }}
          />
        );
      })}

      {/* title */}
      <AbsoluteFill style={{opacity: titleOpacity, scale: `${titleScale}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24}}>
        <div style={{fontSize: 84, fontWeight: 700, color: '#17202e', letterSpacing: 4}}>七套内置角色</div>
        <div style={{fontSize: 32, color: '#5b6a80', letterSpacing: 2}}>表情会随状态动起来 · 人格与模型供应商互相独立</div>
        <div style={{display: 'flex', gap: 16, marginTop: 8}}>
          {Cast.map((bot) => (
            <div key={bot.shape} style={{width: 16, height: 16, borderRadius: 999, background: bot.color}} />
          ))}
        </div>
      </AbsoluteFill>

      {/* carousel slides */}
      {Cast.map((bot, i) => {
        const s0 = SLIDE_START + SLIDE_DUR * i;
        const f0 = s0 * fps;
        const opacity = interpolate(t, [s0, s0 + 0.28, s0 + SLIDE_DUR, s0 + SLIDE_DUR + 0.25], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        if (t < s0 - 0.05 || t > s0 + SLIDE_DUR + 0.3 || opacity <= 0) {
          return null;
        }
        const enter = interpolate(frame, [f0, f0 + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
        const avatarScale = interpolate(frame, [f0, f0 + 14], [0.55, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
        return (
          <AbsoluteFill key={bot.shape} style={{opacity}}>
            <div style={{position: 'absolute', left: 300, top: 200, scale: `${avatarScale}`}}>
              <div style={{width: 600, height: 600, borderRadius: 999, background: 'rgba(255,255,255,0.75)', boxShadow: `0 40px 120px ${bot.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                <GrokAvatar shape={bot.shape} color={bot.color} size={440} eye="#ffffff" states={[{at: 0.05, state: bot.mood}]} />
              </div>
            </div>
            <div style={{position: 'absolute', left: 1010, top: 350, right: 120, translate: `0 ${interpolate(enter, [0, 1], [40, 0])}px`}}>
              <div style={{fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 24, letterSpacing: 5, color: bot.color, fontWeight: 700, marginBottom: 18}}>
                BOT 0{i + 1} · {bot.shape.toUpperCase()}
              </div>
              <div style={{fontSize: 92, fontWeight: 700, color: '#17202e', letterSpacing: 3}}>{bot.name}</div>
              <div style={{fontSize: 38, color: '#5b6a80', marginTop: 26, letterSpacing: 1}}>{bot.tag}</div>
              <div style={{display: 'flex', gap: 14, marginTop: 42, alignItems: 'center'}}>
                <div style={{width: 22, height: 22, borderRadius: 8, background: bot.color, boxShadow: `0 6px 18px ${bot.color}66`}} />
                <div style={{fontSize: 24, color: '#8a97ad'}}>主题色跟随角色 · 新建 Bot 时任选</div>
              </div>
            </div>
          </AbsoluteFill>
        );
      })}

      {/* family row + state demo */}
      <AbsoluteFill style={{opacity: fade(frame, 500)}}>
        <div style={{position: 'absolute', top: 150, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 46}}>
          {Cast.map((bot, i) => (
            <div key={bot.shape} style={{textAlign: 'center', scale: `${interpolate(frame, [502 + i * 4, 514 + i * 4], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish})}`}}>
              <GrokAvatar shape={bot.shape} color={bot.color} size={124} eye="#ffffff" states={[{at: 0.05, state: bot.mood}]} />
              <div style={{fontSize: 24, fontWeight: 600, color: '#41506b', marginTop: 12}}>{bot.name}</div>
            </div>
          ))}
        </div>

        <div style={{position: 'absolute', top: 480, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 90}}>
          <GrokAvatar
            shape="chibi"
            color={Cast[0].color}
            size={330}
            eye="#ffffff"
            states={STATE_DEMO.map((s) => ({at: s.at - 17.0, state: s.state}))}
            style={{translate: '0 0px'}}
          />
          <div>
            <div style={{fontSize: 30, color: '#5b6a80', marginBottom: 16}}>回复前，头像先开口：</div>
            <div
              style={{
                display: 'inline-block',
                fontSize: 56,
                fontWeight: 700,
                color: '#fff',
                background: currentState.color,
                padding: '16px 40px',
                borderRadius: 20,
                boxShadow: `0 18px 50px ${currentState.color}55`,
              }}
            >
              {currentState.label}
            </div>
            <div style={{display: 'flex', gap: 14, marginTop: 30, flexWrap: 'wrap', maxWidth: 560}}>
              {['审批中 → 倾听', '出图 → 灵感闪现', '云电脑休眠 → 睡觉', '旧消息 → 静态头像'].map((chip) => (
                <div key={chip} style={{fontSize: 21, color: '#41506b', background: '#fff', border: '1px solid #dfe7f2', borderRadius: 999, padding: '9px 20px'}}>
                  {chip}
                </div>
              ))}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
