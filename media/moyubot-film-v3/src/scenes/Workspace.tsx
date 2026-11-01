import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {GrokAvatar} from '../components/GrokAvatar';
import {StaticAvatar} from '../components/StaticAvatar';
import {
  BLUE,
  BrandChip,
  DemoTag,
  INK,
  LINE,
  MockWindow,
  MONO,
  MUTED,
  PANEL,
  PAPER,
  Pill,
  SceneBg,
  SceneHeader,
  SOFT as MOCK_SOFT,
  fade,
  springish,
} from '../components/ui';
import {STORY} from '../story';

const Cast = STORY.cast;

const PREVIEW: Record<string, string> = {
  chibi: '简报已经整理好了！',
  nemu: '再睡五分钟…',
  shiro: '文件我放到 reports/ 了',
  mikan: '这个方案需要再改改。',
  neko: '定时任务已启用喵',
  tsuki: '找到 3 个相关 Issue 啦',
  zeta: '深夜构建完成，无报错',
};

export const Workspace: React.FC = () => {
  const frame = useCurrentFrame();
  const cloud = frame >= 195; // abs 22.0
  const toggleLocal = interpolate(frame, [188, 196], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const winOpacity = fade(frame, 10);
  const winY = interpolate(frame, [10, 26], [46, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});

  return (
    <SceneBg>
      <SceneHeader kicker="01 / YOUR WORKSPACE" title="本地，或云电脑" sub="每个 Bot 有独立的固定对话和工作目录，文件互不可见" />
      <BrandChip />
      <DemoTag />

      <AbsoluteFill style={{opacity: winOpacity, translate: `0 ${winY}px`}}>
        <MockWindow
          title="MoyuBot Desktop · 工作空间"
          style={{position: 'absolute', left: 96, right: 96, top: 292, bottom: 132}}
          titleExtra={
            <div style={{display: 'flex', background: '#eef2f9', borderRadius: 12, padding: 5, gap: 4}}>
              {[
                {label: '本地 Windows', on: !cloud},
                {label: 'InstaBox 云电脑', on: cloud},
              ].map((seg) => (
                <div
                  key={seg.label}
                  style={{
                    fontFamily: 'sans-serif',
                    fontSize: 19,
                    fontWeight: 600,
                    color: seg.on ? '#ffffff' : MUTED,
                    background: seg.on ? BLUE : 'transparent',
                    padding: '8px 20px',
                    borderRadius: 9,
                  }}
                >
                  {seg.label}
                </div>
              ))}
            </div>
          }
        >
          {/* sidebar */}
          <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: 330, background: '#f7f9fd', borderRight: `1px solid ${LINE}`, padding: '22px 14px'}}>
            <div style={{fontFamily: 'sans-serif', fontSize: 17, color: MUTED, padding: '0 12px 14px', letterSpacing: 2}}>BOT 阵容</div>
            {Cast.map((bot, i) => (
              <div
                key={bot.shape}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '10px 12px',
                  borderRadius: 14,
                  background: i === 0 ? '#e8f0ff' : 'transparent',
                  opacity: fade(frame, 12 + i * 3),
                }}
              >
                <StaticAvatar shape={bot.shape} color={bot.color} pale={bot.pale} size={46} />
                <div>
                  <div style={{fontFamily: 'sans-serif', fontSize: 20, fontWeight: 600, color: INK}}>{bot.name}</div>
                  <div style={{fontFamily: 'sans-serif', fontSize: 16, color: MUTED, marginTop: 3, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                    {PREVIEW[bot.shape]}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* chat */}
          <div style={{position: 'absolute', left: 330, right: 400, top: 0, bottom: 0, padding: '34px 44px'}}>
            <div style={{display: 'flex', justifyContent: 'flex-end', opacity: fade(frame, 30)}}>
              <div style={{background: BLUE, color: '#fff', fontFamily: 'sans-serif', fontSize: 22, padding: '16px 24px', borderRadius: '18px 18px 4px 18px', maxWidth: 520}}>
                帮我整理这周的会议记录，同步到工作区。
              </div>
            </div>
            <div style={{display: 'flex', gap: 16, marginTop: 30, opacity: fade(frame, 60)}}>
              <div style={{position: 'relative', width: 60, height: 60}}>
                <GrokAvatar shape="chibi" color={Cast[0].color} size={60} states={[{at: 0.05, state: 'thinking'}, {at: 1.3, state: 'working'}, {at: 2.0, state: 'happy'}]} />
              </div>
              <div style={{flex: 1}}>
                <div style={{fontFamily: 'sans-serif', fontSize: 18, color: MUTED, marginBottom: 8}}>大肥鱼 · DeepSeek</div>
                <div style={{background: PANEL, border: `1px solid ${LINE}`, fontFamily: 'sans-serif', fontSize: 22, color: INK, padding: '16px 22px', borderRadius: '4px 18px 18px 18px', lineHeight: 1.7}}>
                  已整理 12 条记录，写入 <span style={{fontFamily: MONO, color: BLUE}}>meeting-notes.md</span>，并同步到当前工作区。
                  <div style={{display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 14, background: MOCK_SOFT, border: `1px solid #d4e3ff`, borderRadius: 10, padding: '8px 16px'}}>
                    <span style={{fontSize: 18}}>📄</span>
                    <span style={{fontFamily: MONO, fontSize: 18, color: BLUE}}>meeting-notes.md</span>
                    <span style={{fontSize: 16, color: '#3f9d63'}}>✓ 已同步</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* workspace panel */}
          <div style={{position: 'absolute', right: 0, top: 0, bottom: 0, width: 400, background: '#fbfcff', borderLeft: `1px solid ${LINE}`, padding: '26px 26px'}}>
            <div style={{fontFamily: 'sans-serif', fontSize: 17, color: MUTED, letterSpacing: 2, marginBottom: 16}}>工作区</div>
            <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14}}>
              <div style={{width: 10, height: 10, borderRadius: 999, background: '#31b06d', boxShadow: '0 0 0 4px rgba(49,176,109,0.15)'}} />
              <div style={{fontFamily: 'sans-serif', fontSize: 21, fontWeight: 700, color: INK}}>{cloud ? 'InstaBox 云电脑 · 已连接' : '本地 Windows · 已就绪'}</div>
            </div>
            <div style={{fontFamily: MONO, fontSize: 16.5, color: '#41506b', background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 16px', lineHeight: 1.75}}>
              {cloud ? '/data/home/moyubot/大肥鱼/' : 'D:\\Workspace\\大肥鱼\\'}
            </div>
            <div style={{marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10}}>
              {[
                {name: 'meeting-notes.md', meta: cloud ? '同步于 3 分钟前' : '本地保存', at: 70},
                {name: 'reports/', meta: '12 个文件', at: 80},
                {name: 'uploads/', meta: '拖入的附件', at: 90},
              ].map((f) => (
                <div key={f.name} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 16px', opacity: fade(frame, f.at)}}>
                  <span style={{fontFamily: MONO, fontSize: 18, color: INK}}>{f.name}</span>
                  <span style={{fontFamily: 'sans-serif', fontSize: 15, color: MUTED}}>{f.meta}</span>
                </div>
              ))}
            </div>
            <div style={{marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start'}}>
              <Pill fontSize={18} color={BLUE}>锁定到 Bot 子目录</Pill>
              <div style={{fontFamily: 'sans-serif', fontSize: 17, color: MUTED, lineHeight: 1.6}}>
                其它 Bot 看不到这个目录；
                <br />
                休眠不丢文件。
              </div>
            </div>
          </div>
        </MockWindow>
      </AbsoluteFill>
    </SceneBg>
  );
};
