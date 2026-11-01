import React from 'react';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Aurora} from '../components/Aurora';
import {GrokAvatar} from '../components/GrokAvatar';
import {springish} from '../components/ui';
import {STORY} from '../story';

const Cast = STORY.cast;

const LINKS = [
  {label: '官网', value: 'moyubot.net', at: 78},
  {label: 'GitHub', value: 'whitemoono/moyubot', at: 88},
  {label: 'Telegram', value: 't.me/moyubotnya', at: 98},
  {label: STORY.meta.qq, value: '开发交流群', at: 108},
];

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();

  const logoScale = interpolate(frame, [16, 36], [0.6, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
  const tagOpacity = interpolate(frame, [30, 46], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const stampScale = interpolate(frame, [186, 202], [1.8, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
  const stampOpacity = interpolate(frame, [186, 194], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: '#05070f'}}>
      <Aurora hue={0.05} boost={interpolate(frame, [150, 240], [0.2, 0.9], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />
      <AbsoluteFill style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{scale: `${logoScale}`, display: 'flex', alignItems: 'center', gap: 30}}>
          <img src={staticFile('brand/logo.png')} style={{width: 120, height: 120, borderRadius: 28, boxShadow: '0 24px 70px rgba(61,123,250,0.4)'}} />
          <span style={{fontFamily: 'sans-serif', fontSize: 96, fontWeight: 700, color: '#f4f8ff', letterSpacing: 2}}>MoyuBot</span>
        </div>
        <div style={{fontFamily: 'sans-serif', fontSize: 40, color: '#dbe6ff', marginTop: 30, letterSpacing: 4, opacity: tagOpacity}}>
          让 AI 上班，你负责摸鱼。
        </div>

        <div style={{display: 'flex', gap: 36, marginTop: 64, alignItems: 'flex-end'}}>
          {Cast.map((bot, i) => {
            const f0 = (1.2 + i * 0.14) * 30;
            const s = interpolate(frame, [f0, f0 + 12], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
            const float = Math.sin(frame / 8 + i * 0.9) * 8;
            if (frame < f0) {
              return null;
            }
            return (
              <div key={bot.shape} style={{scale: `${s}`, translate: `0 ${float}px`}}>
                <GrokAvatar shape={bot.shape} color={bot.color} size={110} eye="#ffffff" states={[{at: 0.05, state: bot.mood}]} />
              </div>
            );
          })}
        </div>

        <div style={{display: 'flex', gap: 22, marginTop: 70}}>
          {LINKS.map((l) => (
            <div
              key={l.label}
              style={{
                opacity: interpolate(frame, [l.at, l.at + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 16,
                padding: '16px 26px',
                textAlign: 'center',
              }}
            >
              <div style={{fontFamily: 'sans-serif', fontSize: 17, color: '#8fa5cf', marginBottom: 6}}>{l.label}</div>
              <div style={{fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 21, color: '#e8f0ff'}}>{l.value}</div>
            </div>
          ))}
        </div>

        <div style={{position: 'absolute', right: 220, top: 250, scale: `${stampScale}`, opacity: stampOpacity, rotate: '8deg'}}>
          <div
            style={{
              fontFamily: 'sans-serif',
              fontSize: 44,
              fontWeight: 700,
              color: '#ff6d6d',
              border: '4px solid #ff6d6d',
              borderRadius: 14,
              padding: '10px 26px',
              letterSpacing: 8,
              boxShadow: '0 0 0 2px rgba(255,109,109,0.25)',
            }}
          >
            摸鱼愉快
          </div>
        </div>

        <div style={{position: 'absolute', bottom: 130, fontFamily: 'sans-serif', fontSize: 19, color: 'rgba(174,191,224,0.7)', letterSpacing: 1}}>
          MIT 开源 · Windows 安装包即下即用 · 本片为代码动画功能演示，界面与数据为示例
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
