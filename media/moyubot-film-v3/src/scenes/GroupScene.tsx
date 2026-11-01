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
  SOFT,
  SceneBg,
  SceneHeader,
  fade,
  springish,
} from '../components/ui';
import {STORY} from '../story';

const Cast = STORY.cast;
const byShape = (s: string) => Cast.find((c) => c.shape === s)!;

const REPLIES = [
  {shape: 'chibi', at: 30, text: '建议 v0.1.5，带上用量导出，最近群里要的最多。'},
  {shape: 'neko', at: 63, text: '先修云电脑休眠的小 bug 喵，不然周一又要手动重启。'},
  {shape: 'zeta', at: 96, text: '深夜发版没问题，changelog 我来同步。'},
];

const SUBAGENTS = [
  {label: '查 Release 日志', at: 231},
  {label: '扫 Issue 区', at: 246},
  {label: '对比同类工具', at: 261},
  {label: '整理群聊决议', at: 276},
];

export const GroupScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneBg>
      <SceneHeader kicker="04 / GROUP & SUBAGENTS" title="群聊接力，子代理并行" sub="2–12 个成员按顺序发言 · 各自的模型、工具与权限" />
      <BrandChip />
      <DemoTag />

      {/* group chat */}
      <MockWindow title="摸鱼突击队 · 3 名成员" style={{position: 'absolute', left: 96, top: 300, width: 880, bottom: 132}}>
        <div style={{padding: '26px 30px', height: '100%', display: 'flex', flexDirection: 'column', gap: 20}}>
          <div style={{display: 'flex', justifyContent: 'flex-end', opacity: fade(frame, 18)}}>
            <div style={{background: BLUE, color: '#fff', fontFamily: 'sans-serif', fontSize: 22, padding: '14px 22px', borderRadius: '16px 16px 4px 16px'}}>
              这周发什么版本？
            </div>
          </div>
          {REPLIES.map((r) => {
            const bot = byShape(r.shape);
            return (
              <div key={r.shape} style={{display: 'flex', gap: 14, opacity: fade(frame, r.at), translate: `0 ${interpolate(frame, [r.at, r.at + 10], [18, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish})}px`}}>
                <div style={{width: 58}}>
                  <GrokAvatar shape={bot.shape} color={bot.color} size={56} states={[{at: 0.05, state: r.shape === 'neko' ? 'playful' : r.shape === 'zeta' ? 'curious' : 'happy'}]} />
                </div>
                <div style={{flex: 1}}>
                  <div style={{fontFamily: 'sans-serif', fontSize: 17, color: MUTED, marginBottom: 6}}>
                    {bot.name} · {r.shape === 'chibi' ? 'DeepSeek' : r.shape === 'neko' ? 'GPT-5.2' : 'Kimi'}
                  </div>
                  <div style={{background: PANEL, border: `1px solid ${LINE}`, fontFamily: 'sans-serif', fontSize: 21, color: INK, padding: '13px 20px', borderRadius: '4px 16px 16px 16px', lineHeight: 1.65, maxWidth: 620}}>
                    {r.text}
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{flex: 1}} />
          <div style={{display: 'flex', gap: 12, alignItems: 'center', opacity: fade(frame, 128)}}>
            <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
              {Cast.slice(0, 3).map((bot) => (
                <StaticAvatar key={bot.shape} shape={bot.shape} color={bot.color} pale={bot.pale} size={34} />
              ))}
            </div>
            <div style={{fontFamily: 'sans-serif', fontSize: 17, color: MUTED}}>顺序执行 · 停止可取消后续成员 · 群记忆独立保存</div>
          </div>
        </div>
      </MockWindow>

      {/* subagent orchestration */}
      <div
        style={{
          position: 'absolute',
          left: 1020,
          right: 96,
          top: 300,
          bottom: 132,
          background: PANEL,
          border: `1px solid ${LINE}`,
          borderRadius: 22,
          boxShadow: '0 30px 80px rgba(23,42,84,0.14)',
          padding: '30px 34px',
          opacity: fade(frame, 208),
          translate: `0 ${interpolate(frame, [208, 224], [40, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish})}px`,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24}}>
          <GrokAvatar shape="chibi" color={byShape('chibi').color} size={52} states={[{at: 0.05, state: 'working'}]} />
          <div style={{fontFamily: 'sans-serif', fontSize: 22, fontWeight: 700, color: INK}}>大肥鱼 派出 4 个只读子代理</div>
          <div style={{flex: 1}} />
          <div style={{fontFamily: MONO, fontSize: 17, color: BLUE, background: SOFT, borderRadius: 999, padding: '7px 16px'}}>run_script</div>
        </div>

        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
          {SUBAGENTS.map((s, i) => {
            const bot = Cast[(i + 1) % 7];
            const progress = interpolate(frame, [s.at, s.at + 34], [0, 100], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
            const done = frame >= s.at + 34;
            return (
              <div key={s.label} style={{background: '#fbfcff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 18px', opacity: fade(frame, s.at)}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                  <StaticAvatar shape={bot.shape} color={bot.color} pale={bot.pale} size={40} />
                  <div style={{fontFamily: 'sans-serif', fontSize: 19, fontWeight: 600, color: INK, flex: 1}}>{s.label}</div>
                  <div style={{fontFamily: 'sans-serif', fontSize: 15, color: done ? '#20713d' : MUTED}}>{done ? '✓' : `${Math.round(progress)}%`}</div>
                </div>
                <div style={{height: 8, background: '#edf1f8', borderRadius: 999, marginTop: 12, overflow: 'hidden'}}>
                  <div style={{width: `${progress}%`, height: '100%', background: bot.color, borderRadius: 999}} />
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 22,
            background: '#eefaf1',
            border: '1px solid #bfe6cc',
            borderRadius: 14,
            padding: '16px 20px',
            fontFamily: 'sans-serif',
            fontSize: 20,
            color: '#20713d',
            fontWeight: 600,
            opacity: fade(frame, 334),
          }}
        >
          ✓ 4 份调研已汇总 · 进度胶囊实时可见（演示数据）
        </div>

        <div style={{display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap'}}>
          {['spawn_agent ×4 并行', '不继承主对话历史', 'subagent_fork 带上下文分身', 'job_list 随时中止'].map((c) => (
            <div key={c} style={{fontFamily: 'sans-serif', fontSize: 17, color: '#41506b', background: '#f2f5fa', border: `1px solid ${LINE}`, borderRadius: 999, padding: '8px 16px', opacity: fade(frame, 300)}}>
              {c}
            </div>
          ))}
        </div>
      </div>
    </SceneBg>
  );
};
