import React from 'react';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Aurora} from '../components/Aurora';
import {GrokAvatar} from '../components/GrokAvatar';
import {springish} from '../components/ui';
import {STORY} from '../story';

const Cast = STORY.cast;

export const Brand: React.FC = () => {
  const frame = useCurrentFrame();
  const logoScale = interpolate(frame, [12, 34], [0.5, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
  const nameOpacity = interpolate(frame, [18, 30], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const nameY = interpolate(frame, [18, 32], [30, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
  const tagOpacity = interpolate(frame, [30, 44], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const chipsOpacity = interpolate(frame, [42, 56], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const rowOpacity = interpolate(frame, [50, 64], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{backgroundColor: '#05070f'}}>
      <Aurora hue={0.08} boost={0.35} />
      <AbsoluteFill style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0}}>
        <div style={{scale: `${logoScale}`, marginBottom: 26}}>
          <img src={staticFile('brand/logo.png')} style={{width: 148, height: 148, borderRadius: 34, boxShadow: '0 24px 70px rgba(61,123,250,0.35)'}} />
        </div>
        <div style={{opacity: nameOpacity, translate: `0 ${nameY}px`, textAlign: 'center'}}>
          <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 18}}>
            <span style={{fontFamily: 'sans-serif', fontSize: 104, fontWeight: 700, color: '#f4f8ff', letterSpacing: 2}}>MoyuBot</span>
            <span
              style={{
                fontFamily: 'sans-serif',
                fontSize: 30,
                fontWeight: 600,
                color: '#9db8f5',
                border: '1.5px solid rgba(157,184,245,0.5)',
                borderRadius: 999,
                padding: '6px 18px',
              }}
            >
              {STORY.meta.version}
            </span>
          </div>
          <div style={{fontFamily: 'sans-serif', fontSize: 42, color: '#dbe6ff', marginTop: 22, letterSpacing: 3}}>
            让 AI 上班，你负责摸鱼。
          </div>
        </div>
        <div style={{display: 'flex', gap: 20, marginTop: 44, opacity: chipsOpacity}}>
          {['开源 · MIT', 'Windows 桌面端', '任意大模型供应商', '共享云电脑'].map((c) => (
            <div
              key={c}
              style={{
                fontFamily: 'sans-serif',
                fontSize: 24,
                fontWeight: 600,
                color: '#c6d6fa',
                background: 'rgba(110,168,255,0.12)',
                border: '1px solid rgba(110,168,255,0.35)',
                padding: '11px 26px',
                borderRadius: 999,
              }}
            >
              {c}
            </div>
          ))}
        </div>
        <div style={{display: 'flex', gap: 30, marginTop: 72, opacity: rowOpacity, alignItems: 'flex-end'}}>
          {Cast.map((bot, i) => {
            const float = Math.sin(frame / 8 + i * 0.9) * 8;
            return (
              <div key={bot.shape} style={{translate: `0 ${float}px`, textAlign: 'center'}}>
                <GrokAvatar shape={bot.shape} color={bot.color} size={104} eye="#ffffff" states={[{at: 0.05, state: bot.mood}]} />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
