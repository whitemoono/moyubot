import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {GrokAvatar} from '../components/GrokAvatar';
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
  Pill,
  SceneBg,
  SceneHeader,
  SOFT,
  fade,
  springish,
} from '../components/ui';
import {STORY} from '../story';

const Cast = STORY.cast;

const TOOLS = [
  {icon: '⌨️', label: '执行命令', detail: '$ python3 collect.py --week current', result: '✓ 读取 12 个项目', appear: 94},
  {icon: '📝', label: '读写文件', detail: 'reports/summary.md · 写入 3.2 KB', result: '✓ 完成', appear: 126},
  {icon: '🌐', label: '网页搜索', detail: '「MoyuBot 更新日志」', result: '✓ 3 条结果', appear: 158},
  {icon: '🎨', label: '生成图片', detail: 'banner.png · 1024×1024', result: '✓ 已保存', appear: 190},
];

export const AgentLoop: React.FC = () => {
  const frame = useCurrentFrame();

  const approvalOpacity = interpolate(frame, [252, 264], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const approvalScale = interpolate(frame, [252, 266], [0.85, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});
  const approveBtn = frame >= 330;
  const approvalGone = interpolate(frame, [354, 366], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const compress = interpolate(frame, [378, 404], [87, 41], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish});

  return (
    <SceneBg>
      <SceneHeader kicker="02 / AGENT LOOP" title="一句话，变成一连串动作" sub="25 个内置工具 · 自动执行或每步审批 · 计划模式" />
      <BrandChip />
      <DemoTag />

      {/* chat */}
      <MockWindow title="与大肥鱼对话" style={{position: 'absolute', left: 96, top: 300, width: 620, bottom: 132}}>
        <div style={{padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 22, height: '100%'}}>
          <div style={{display: 'flex', justifyContent: 'flex-end', opacity: fade(frame, 26)}}>
            <div style={{background: BLUE, color: '#fff', fontFamily: 'sans-serif', fontSize: 22, padding: '15px 22px', borderRadius: '16px 16px 4px 16px'}}>
              整理本周项目文件，生成一份简报。
            </div>
          </div>
          <div style={{display: 'flex', gap: 14, alignItems: 'center', opacity: fade(frame, 66)}}>
            <GrokAvatar shape="chibi" color={Cast[0].color} size={54} states={[{at: 0.05, state: 'thinking'}, {at: 2.2, state: 'searching'}, {at: 5.4, state: 'happy'}]} />
            <div style={{fontFamily: 'sans-serif', fontSize: 19, color: MUTED}}>正在调用工具…</div>
            <div style={{display: 'flex', gap: 5}}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: '#9db4d8',
                    translate: `0 ${Math.max(0, -4 * Math.sin(frame / 6 - i * 0.9))}px`,
                  }}
                />
              ))}
            </div>
          </div>
          <div style={{opacity: fade(frame, 232), background: '#eefaf1', border: '1px solid #bfe6cc', borderRadius: 16, padding: '18px 22px'}}>
            <div style={{fontFamily: 'sans-serif', fontSize: 22, fontWeight: 700, color: '#20713d'}}>✓ 任务完成</div>
            <div style={{fontFamily: 'sans-serif', fontSize: 19, color: '#3f7a52', marginTop: 8, lineHeight: 1.7}}>
              8 步工具调用 · 2 分 14 秒（演示数据）
              <br />
              简报与横幅已写入工作区。
            </div>
          </div>
          <div style={{flex: 1}} />
          <div style={{display: 'flex', gap: 10, opacity: fade(frame, 275)}}>
            {['自动执行', '每步审批', '计划模式'].map((m, i) => (
              <Pill
                key={m}
                fontSize={18}
                color={i === 1 ? '#ffffff' : MUTED}
                bg={i === 1 ? BLUE : PANEL}
                borderColor={i === 1 ? 'transparent' : LINE}
              >
                {m}
              </Pill>
            ))}
          </div>
        </div>
      </MockWindow>

      {/* tool stream */}
      <div style={{position: 'absolute', left: 760, right: 96, top: 300, bottom: 132}}>
        {TOOLS.map((t, i) => (
          <div
            key={t.label}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: i * 118,
              opacity: fade(frame, t.appear),
              translate: `0 ${interpolate(frame, [t.appear, t.appear + 12], [24, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish})}px`,
            }}
          >
            <div style={{background: PANEL, border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 18, boxShadow: '0 8px 26px rgba(23,42,84,0.07)'}}>
              <div style={{width: 52, height: 52, borderRadius: 14, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26}}>{t.icon}</div>
              <div style={{flex: 1}}>
                <div style={{fontFamily: 'sans-serif', fontSize: 21, fontWeight: 700, color: INK}}>{t.label}</div>
                <div style={{fontFamily: MONO, fontSize: 17.5, color: '#41506b', marginTop: 5}}>{t.detail}</div>
              </div>
              <div style={{fontFamily: 'sans-serif', fontSize: 18, fontWeight: 600, color: '#20713d', opacity: fade(frame, t.appear + 22)}}>{t.result}</div>
            </div>
          </div>
        ))}

        {/* approval overlay */}
        <AbsoluteFill style={{opacity: frame > 366 ? approvalGone : approvalOpacity, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none'}}>
          <div
            style={{
              scale: `${frame > 366 ? 1 - (1 - approvalGone) * 0 : approvalScale}`,
              width: 560,
              background: 'rgba(255,255,255,0.9)',
              backdropFilter: 'blur(18px)',
              border: '1px solid rgba(255,255,255,0.6)',
              borderRadius: 22,
              boxShadow: '0 40px 100px rgba(10,20,50,0.35)',
              padding: '26px 30px',
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16}}>
              <div style={{width: 12, height: 12, borderRadius: 999, background: '#f4a53f'}} />
              <div style={{fontFamily: 'sans-serif', fontSize: 23, fontWeight: 700, color: INK}}>审批请求 · 执行命令</div>
            </div>
            <div style={{fontFamily: MONO, fontSize: 19, color: '#31405c', background: '#f2f5fa', borderRadius: 12, padding: '14px 18px', marginBottom: 20}}>rm -rf tmp/cache</div>
            <div style={{display: 'flex', gap: 12}}>
              {['允许', '仅此一次', '拒绝'].map((b) => (
                <div
                  key={b}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    fontFamily: 'sans-serif',
                    fontSize: 20,
                    fontWeight: 700,
                    padding: '12px 0',
                    borderRadius: 12,
                    color: approveBtn && b === '允许' ? '#fff' : INK,
                    background: approveBtn && b === '允许' ? BLUE : '#f2f5fa',
                    border: `1px solid ${approveBtn && b === '允许' ? 'transparent' : LINE}`,
                  }}
                >
                  {b}
                </div>
              ))}
            </div>
          </div>
        </AbsoluteFill>

        {/* context compaction */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            background: PANEL,
            border: `1px solid ${LINE}`,
            borderRadius: 16,
            padding: '18px 24px',
            opacity: fade(frame, 376),
            display: 'flex',
            alignItems: 'center',
            gap: 20,
          }}
        >
          <div style={{fontFamily: 'sans-serif', fontSize: 20, fontWeight: 700, color: INK, whiteSpace: 'nowrap'}}>上下文压缩</div>
          <div style={{flex: 1, height: 16, background: '#edf1f8', borderRadius: 999, overflow: 'hidden'}}>
            <div style={{width: `${compress}%`, height: '100%', background: 'linear-gradient(90deg, #f4a53f, #7cb8ff)', borderRadius: 999}} />
          </div>
          <div style={{fontFamily: MONO, fontSize: 19, color: BLUE, whiteSpace: 'nowrap'}}>{Math.round(compress)}%</div>
          <div style={{fontFamily: 'sans-serif', fontSize: 17, color: MUTED, whiteSpace: 'nowrap'}}>保留决定 · 待办 · 长期偏好</div>
        </div>
      </div>
    </SceneBg>
  );
};
