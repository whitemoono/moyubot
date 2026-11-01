import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Aurora} from '../components/Aurora';
import {StaticAvatar} from '../components/StaticAvatar';
import {BrandChip, MONO, SceneHeader, fade, springish} from '../components/ui';
import {STORY} from '../story';

const neko = STORY.cast.find((c) => c.shape === 'neko')!;

const STATUS = [
  {at: 0, label: '挂起中', color: '#8fa3c8', bg: 'rgba(143,163,200,0.14)', border: 'rgba(143,163,200,0.4)'},
  {at: 2.2, label: '唤醒中…', color: '#f4c76a', bg: 'rgba(244,199,106,0.14)', border: 'rgba(244,199,106,0.45)'},
  {at: 3.4, label: '运行中', color: '#59d78f', bg: 'rgba(89,215,143,0.14)', border: 'rgba(89,215,143,0.45)'},
  {at: 9.7, label: '休眠中', color: '#8fa3c8', bg: 'rgba(143,163,200,0.14)', border: 'rgba(143,163,200,0.4)'},
];

export const CloudWake: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;

  const status = [...STATUS].reverse().find((s) => t >= s.at)!;
  const awake = t >= 2.2;
  const moonOpacity = awake ? 0 : 1;
  const ringDash = interpolate(t % 1.2, [0, 1.2], [10, 160], {extrapolateRight: 'clamp'});

  const lines = [
    {text: '$ cloud_exec  cd /data/home/moyubot/小猫娘', color: '#8fb6ff', at: 3.7},
    {text: '✓ 唤醒完成 · 8.2s（模拟）', color: '#59d78f', at: 5.5},
    {text: '$ python3 backup.py --sync', color: '#cfe0ff', at: 6.3},
    {text: '✓ 已写入 reports/monday.md · exit 0', color: '#59d78f', at: 8.3},
  ];

  return (
    <AbsoluteFill style={{backgroundColor: '#060a18'}}>
      <Aurora hue={-0.12} boost={0.15} opacity={0.55} />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(6,10,24,0.2) 0%, rgba(6,10,24,0.75) 100%)'}} />
      <SceneHeader dark kicker="03 / SHARED CLOUD PC" title="一台云电脑，按需唤醒" sub="InstaBox · 所有云端 Bot 共用 · 纯聊天不唤醒" />
      <BrandChip dark />

      {/* machine card */}
      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 330,
          width: 620,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 24,
          padding: '34px 38px',
          opacity: fade(frame, 12),
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
          <div style={{fontFamily: 'sans-serif', fontSize: 26, fontWeight: 700, color: '#eef4ff'}}>InstaBox 云主机</div>
          <div
            style={{
              fontFamily: 'sans-serif',
              fontSize: 20,
              fontWeight: 700,
              color: status.color,
              background: status.bg,
              border: `1px solid ${status.border}`,
              padding: '8px 20px',
              borderRadius: 999,
            }}
          >
            {status.label}
          </div>
        </div>

        <div style={{display: 'flex', alignItems: 'center', gap: 30, margin: '34px 0'}}>
          <div style={{position: 'relative', width: 120, height: 120}}>
            {awake ? (
              <svg viewBox="0 0 120 120" style={{position: 'absolute', inset: 0}}>
                <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke={status.color}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${ringDash} 400`}
                  rotate={-90}
                  style={{transformOrigin: '60px 60px', transform: 'rotate(-90deg)'}}
                />
              </svg>
            ) : null}
            <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: awake ? 34 : 52}}>
              {awake ? '🖥️' : <span style={{opacity: moonOpacity, filter: 'grayscale(0.2)'}}>🌙</span>}
            </div>
          </div>
          <div style={{fontFamily: MONO, fontSize: 19, color: '#aebfe0', lineHeight: 2.0}}>
            Ubuntu 24.04 · 4 vCPU / 8 GB
            <br />
            {t < 9.7 ? '本次运行 00:00:14（演示）' : '挂起计费 ¥0.00/时'}
            <br />
            autoSuspend 300s · /data 持久保留
          </div>
        </div>

        <div style={{display: 'flex', gap: 12, flexWrap: 'wrap'}}>
          {['cloud_exec', 'cloud_read', 'cloud_write', '桌面操作'].map((c, i) => (
            <div
              key={c}
              style={{
                fontFamily: MONO,
                fontSize: 17,
                color: t >= 3.4 && t < 9.7 ? '#9dd0ff' : '#7e93bb',
                border: '1px solid rgba(143,182,255,0.3)',
                background: 'rgba(143,182,255,0.08)',
                padding: '8px 16px',
                borderRadius: 999,
                opacity: fade(frame, 96 + i * 5),
              }}
            >
              {c}
            </div>
          ))}
        </div>
      </div>

      {/* terminal */}
      <div
        style={{
          position: 'absolute',
          left: 770,
          right: 96,
          top: 330,
          background: '#0d1526',
          border: '1px solid #22304d',
          borderRadius: 20,
          padding: '26px 32px',
          fontFamily: MONO,
          fontSize: 21,
          lineHeight: 2.1,
          opacity: fade(frame, 20),
        }}
      >
        <div style={{color: '#64809f', fontSize: 17, marginBottom: 10}}>MoyuBot · 云端终端</div>
        {lines.map((l, i) => (
          <div key={i} style={{color: l.color, opacity: fade(frame, l.at * fps), whiteSpace: 'pre'}}>
            {l.text}
          </div>
        ))}
        <div style={{color: '#64809f', opacity: fade(frame, 320)}}>
          $ sleep --autoSuspend
          <span style={{color: '#59d78f'}}> ✓ 休眠 · 文件保留</span>
        </div>
      </div>

      {/* suspend strategy note */}
      <div
        style={{
          position: 'absolute',
          left: 770,
          right: 96,
          bottom: 150,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          opacity: fade(frame, 312),
          translate: `0 ${interpolate(frame, [312, 326], [22, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish})}px`,
        }}
      >
        <StaticAvatar shape="neko" color={neko.color} pale={neko.pale} size={54} />
        <div style={{fontFamily: 'sans-serif', fontSize: 22, color: '#c9d7f2', lineHeight: 1.7}}>
          本地空闲 3 分钟 + 服务端 autoSuspend 双重兜底，
          <br />
          忘了关也不会烧配额；下次唤醒文件都还在。
        </div>
      </div>
    </AbsoluteFill>
  );
};
