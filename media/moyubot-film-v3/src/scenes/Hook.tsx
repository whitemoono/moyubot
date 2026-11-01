import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Aurora} from '../components/Aurora';
import {GrokAvatar} from '../components/GrokAvatar';
import {springish} from '../components/ui';
import {STORY} from '../story';

const Cast = STORY.cast;

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const line1Opacity = interpolate(frame, [8, 22, 128, 142], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const line1Y = interpolate(frame, [8, 22], [34, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
  const punchScale = interpolate(frame, [160, 176], [0.55, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
  const punchOpacity = interpolate(frame, [160, 170], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const lift = interpolate(frame, [212, 224], [0, -46], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});

  return (
    <AbsoluteFill style={{backgroundColor: '#05070f'}}>
      <Aurora boost={interpolate(frame, [150, 200], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})} />
      <AbsoluteFill style={{translate: `0 ${lift}px`}}>
        <div
          style={{
            position: 'absolute',
            top: 300,
            left: 0,
            right: 0,
            textAlign: 'center',
            opacity: line1Opacity,
            translate: `0 ${line1Y}px`,
          }}
        >
          <div
            style={{
              fontFamily: '"Cascadia Code", Consolas, monospace',
              fontSize: 96,
              fontWeight: 700,
              color: '#e8f0ff',
              letterSpacing: 4,
            }}
          >
            23:47
          </div>
          <div style={{fontFamily: 'sans-serif', fontSize: 44, color: '#9fb2d8', marginTop: 26, letterSpacing: 2}}>
            方案改到第三版，你还在陪电脑加班。
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            top: 250,
            left: 0,
            right: 0,
            textAlign: 'center',
            opacity: punchOpacity,
            scale: `${punchScale}`,
          }}
        >
          <span style={{fontFamily: 'sans-serif', fontSize: 120, fontWeight: 700, color: '#ffffff', letterSpacing: 6}}>
            换 <span style={{color: '#6ea8ff'}}>AI</span> 来。
          </span>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 120,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-end',
            gap: 34,
          }}
        >
          {Cast.map((bot, i) => {
            const at = 4.6 + i * 0.24;
            const f0 = at * fps;
            const s = interpolate(frame, [f0, f0 + 14], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
            const float = Math.sin((frame - f0) / 9 + i * 1.3) * 7;
            if (frame < f0) {
              return null;
            }
            return (
              <div key={bot.shape} style={{scale: `${s}`, translate: `0 ${float}px`}}>
                <GrokAvatar shape={bot.shape} color={bot.color} size={148} eye="#ffffff" states={[{at: 0.05, state: i % 2 ? bot.mood : 'happy'}]} />
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
