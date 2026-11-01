import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {StaticAvatar} from '../components/StaticAvatar';
import {BLUE, BrandChip, DemoTag, INK, LINE, MONO, MUTED, PANEL, SceneBg, SceneHeader, fade, springish} from '../components/ui';
import {STORY} from '../story';

const Cast = STORY.cast;

const MEMORIES = [
  {pin: true, text: '用户偏好深夜工作，早上别安排提醒', at: 36},
  {pin: false, text: '项目简报固定放在 reports/ 目录', at: 48},
  {pin: false, text: '汇报风格：先结论，再细节', at: 60},
];

const USAGE_BARS = [42, 68, 35, 80, 55, 30, 62];
const RANK = [
  {shape: 'chibi', pct: 42},
  {shape: 'zeta', pct: 23},
  {shape: 'nemu', pct: 15},
  {shape: 'neko', pct: 11},
];

export const MemoryScene: React.FC = () => {
  const frame = useCurrentFrame();

  const card = (delay: number): React.CSSProperties => ({
    opacity: fade(frame, delay),
    translate: `0 ${interpolate(frame, [delay, delay + 12], [30, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish})}px`,
  });

  return (
    <SceneBg>
      <SceneHeader kicker="05 / MEMORY & RHYTHM" title="记得住，也守得住节奏" sub="长期记忆 · 定时任务 · Token 用量" />
      <BrandChip />
      <DemoTag />

      <div style={{position: 'absolute', left: 96, right: 96, top: 312, bottom: 138, display: 'flex', gap: 34}}>
        {/* memory */}
        <div style={{...card(14), flex: 1, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 22, padding: '30px 32px', display: 'flex', flexDirection: 'column'}}>
          <div style={{fontSize: 26, fontWeight: 700, color: INK, marginBottom: 6}}>📚 长期记忆</div>
          <div style={{fontSize: 18, color: MUTED, marginBottom: 24}}>按 Bot / 群聊隔离，去重后注入</div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
            {MEMORIES.map((m) => (
              <div key={m.text} style={{background: '#fbfcff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '15px 18px', fontSize: 20, color: INK, lineHeight: 1.6, ...card(m.at)}}>
                {m.pin ? '📌 ' : '· '}
                {m.text}
              </div>
            ))}
          </div>
          <div style={{flex: 1}} />
          <div style={{fontSize: 17, color: MUTED, ...card(80)}}>关键词 + 语义混合检索 · 「资料库」页可搜索管理</div>
        </div>

        {/* schedules */}
        <div style={{...card(140), flex: 1, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 22, padding: '30px 32px', display: 'flex', flexDirection: 'column'}}>
          <div style={{fontSize: 26, fontWeight: 700, color: INK, marginBottom: 6}}>⏰ 定时任务</div>
          <div style={{fontSize: 18, color: MUTED, marginBottom: 20}}>在聊天里说一句就能安排</div>
          <div style={{background: '#f2f5fa', border: `1px solid ${LINE}`, borderRadius: 14, padding: '13px 18px', fontSize: 20, color: '#31405c', ...card(158)}}>
            「把晨报改到每天 10 点」
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18}}>
            {[
              {name: '晨报速递', meta: '每天 10:00', on: true, at: 168},
              {name: '每 30 分钟检查项目', meta: '例行 · cron', on: true, at: 180},
              {name: '明天 09:00 提醒交周报', meta: '一次性', on: false, at: 192},
            ].map((task) => (
              <div key={task.name} style={{display: 'flex', alignItems: 'center', gap: 14, background: '#fbfcff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 18px', ...card(task.at)}}>
                <div style={{fontSize: 20, color: INK, flex: 1, fontWeight: 600}}>{task.name}</div>
                <div style={{fontSize: 16, color: MUTED, fontFamily: MONO}}>{task.meta}</div>
                <div style={{width: 46, height: 26, borderRadius: 999, background: task.on ? '#31b06d' : '#c9d2e0', position: 'relative'}}>
                  <div style={{position: 'absolute', top: 3, left: task.on ? 23 : 3, width: 20, height: 20, borderRadius: 999, background: '#fff', transition: 'none'}} />
                </div>
              </div>
            ))}
          </div>
          <div style={{flex: 1}} />
          <div style={{fontSize: 17, color: MUTED, ...card(210)}}>5 段 cron · 本地时区 · 同一任务不重叠执行</div>
        </div>

        {/* usage */}
        <div style={{...card(212), flex: 1, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 22, padding: '30px 32px', display: 'flex', flexDirection: 'column'}}>
          <div style={{fontSize: 26, fontWeight: 700, color: INK}}>📊 Token 用量</div>
          <div style={{display: 'flex', gap: 8, marginTop: 10}}>
            {['24 小时', '7 天', '30 天'].map((w, i) => (
              <div key={w} style={{fontSize: 15, padding: '4px 12px', borderRadius: 999, fontWeight: 600, color: i === 1 ? '#fff' : MUTED, background: i === 1 ? BLUE : '#f2f5fa'}}>
                {w}
              </div>
            ))}
          </div>
          <div style={{fontSize: 18, color: MUTED, margin: '12px 0 18px'}}>每次请求独立记账，含工具链与群聊</div>
          <div style={{position: 'relative', height: 104, flexShrink: 0, opacity: fade(frame, 228)}}>
            {USAGE_BARS.map((h, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: `${(i * 100) / USAGE_BARS.length + 1.2}%`,
                  width: `${100 / USAGE_BARS.length - 2.4}%`,
                  height: `${Math.round(interpolate(frame, [228 + i * 3, 244 + i * 3], [0, h]))}px`,
                  maxHeight: 104,
                  background: `linear-gradient(180deg, #7cb8ff, ${BLUE})`,
                  borderRadius: '8px 8px 4px 4px',
                  opacity: 0.9,
                }}
              />
            ))}
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22}}>
            {RANK.map((r, i) => {
              const bot = Cast.find((c) => c.shape === r.shape)!;
              return (
                <div key={r.shape} style={{display: 'flex', alignItems: 'center', gap: 12, ...card(252 + i * 8)}}>
                  <StaticAvatar shape={bot.shape} color={bot.color} pale={bot.pale} size={34} />
                  <div style={{fontSize: 18, color: INK, width: 70}}>{bot.name}</div>
                  <div style={{flex: 1, height: 12, background: '#edf1f8', borderRadius: 999, overflow: 'hidden'}}>
                    <div style={{width: `${interpolate(frame, [252 + i * 8, 276 + i * 8], [0, r.pct])}%`, height: '100%', background: bot.color, borderRadius: 999}} />
                  </div>
                  <div style={{fontSize: 16, color: MUTED, fontFamily: MONO, width: 44, textAlign: 'right'}}>{r.pct}%</div>
                </div>
              );
            })}
          </div>
          <div style={{flex: 1}} />
          <div style={{fontSize: 17, color: MUTED, ...card(290)}}>usage.jsonl 本地记账 · 不上传消息正文（演示数据）</div>
        </div>
      </div>
    </SceneBg>
  );
};
