import React from 'react';
import {AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {STORY, VOICE_MANIFEST} from '../story';

export const FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';
export const MONO = '"Cascadia Code", "Consolas", "SF Mono", monospace';

export const INK = '#17202e';
export const MUTED = '#5b6a80';
export const LINE = '#dfe7f2';
export const PAPER = '#f4f7fc';
export const PANEL = '#ffffff';
export const BLUE = '#3d7bfa';
export const SOFT = '#edf3ff';
export const DARK_BG = '#0a0f1f';

export const springish = Easing.bezier(0.16, 1, 0.3, 1);
export const outCubic = Easing.bezier(0.33, 1, 0.68, 1);

export const fade = (frame: number, at: number, dur = 8): number =>
  interpolate(frame, [at, at + dur], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: outCubic});

export const fadeOut = (frame: number, at: number, dur = 8): number =>
  interpolate(frame, [at, at + dur], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: outCubic});

/* ---------------------------------------------------------------- header */
export const SceneHeader: React.FC<{
  kicker: string;
  title: string;
  sub?: string;
  dark?: boolean;
  appearAt?: number;
}> = ({kicker, title, sub, dark, appearAt = 4}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: 'absolute',
        top: 64,
        left: 96,
        display: 'flex',
        gap: 26,
        alignItems: 'flex-start',
        opacity: fade(frame, appearAt),
        translate: `0 ${interpolate(frame, [appearAt, appearAt + 14], [26, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: springish})}px`,
      }}
    >
      <div style={{width: 10, borderRadius: 5, background: dark ? '#6ea8ff' : BLUE, alignSelf: 'stretch'}} />
      <div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 22,
            letterSpacing: 6,
            fontWeight: 600,
            color: dark ? '#7fb0ff' : BLUE,
            marginBottom: 12,
          }}
        >
          {kicker}
        </div>
        <div style={{fontFamily: FONT, fontSize: 62, fontWeight: 700, color: dark ? '#f2f6ff' : INK, lineHeight: 1.15}}>
          {title}
        </div>
        {sub ? (
          <div style={{fontFamily: FONT, fontSize: 28, color: dark ? '#9db1d6' : MUTED, marginTop: 12}}>{sub}</div>
        ) : null}
      </div>
    </div>
  );
};

export const BrandChip: React.FC<{dark?: boolean; right?: number; top?: number}> = ({dark, right = 88, top = 76}) => (
  <div
    style={{
      position: 'absolute',
      right,
      top,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      fontFamily: FONT,
      fontSize: 22,
      fontWeight: 600,
      color: dark ? '#aebfe3' : MUTED,
      background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(23,32,46,0.05)',
      border: `1px solid ${dark ? 'rgba(255,255,255,0.12)' : 'rgba(23,32,46,0.1)'}`,
      padding: '10px 20px',
      borderRadius: 999,
    }}
  >
    <img src={staticFile('brand/logo.png')} style={{width: 30, height: 30, borderRadius: 8}} />
    MoyuBot · {STORY.meta.version}
  </div>
);

export const DemoTag: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: 96,
      bottom: 40,
      fontFamily: FONT,
      fontSize: 19,
      color: 'rgba(91,106,128,0.85)',
      border: '1px dashed rgba(91,106,128,0.4)',
      borderRadius: 8,
      padding: '7px 14px',
      letterSpacing: 1,
    }}
  >
    操作流程演示 · 代码动画（示例数据）
  </div>
);

/* ---------------------------------------------------------------- window */
export const MockWindow: React.FC<{
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  titleExtra?: React.ReactNode;
}> = ({title, children, style, titleExtra}) => (
  <div
    style={{
      background: PANEL,
      borderRadius: 22,
      border: '1px solid #e4ebf5',
      boxShadow: '0 30px 80px rgba(23,42,84,0.14), 0 4px 18px rgba(23,42,84,0.08)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}
  >
    <div
      style={{
        height: 58,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        borderBottom: '1px solid #edf1f8',
        background: '#fbfcff',
        gap: 14,
      }}
    >
      <div style={{display: 'flex', gap: 9}}>
        {['#f26d5f', '#f4bd4f', '#5fc465'].map((c) => (
          <div key={c} style={{width: 14, height: 14, borderRadius: 999, background: c}} />
        ))}
      </div>
      <div style={{fontFamily: FONT, fontSize: 21, color: MUTED, fontWeight: 600}}>{title}</div>
      <div style={{flex: 1}} />
      {titleExtra}
    </div>
    <div style={{flex: 1, position: 'relative', overflow: 'hidden'}}>{children}</div>
  </div>
);

/* ---------------------------------------------------------------- atoms */
export const Pill: React.FC<{
  children: React.ReactNode;
  color?: string;
  bg?: string;
  borderColor?: string;
  fontSize?: number;
  style?: React.CSSProperties;
}> = ({children, color = BLUE, bg = SOFT, borderColor = 'transparent', fontSize = 22, style}) => (
  <div
    style={{
      fontFamily: FONT,
      fontSize,
      fontWeight: 600,
      color,
      background: bg,
      border: `1px solid ${borderColor}`,
      padding: '9px 20px',
      borderRadius: 999,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Field: React.FC<{label: string; value: string; width?: number; active?: boolean}> = ({
  label,
  value,
  width = 420,
  active,
}) => (
  <div style={{width}}>
    <div style={{fontFamily: FONT, fontSize: 19, color: MUTED, marginBottom: 8}}>{label}</div>
    <div
      style={{
        fontFamily: FONT,
        fontSize: 23,
        color: active ? INK : '#8a97ad',
        border: `1.5px solid ${active ? BLUE : '#dde5f0'}`,
        borderRadius: 12,
        padding: '12px 18px',
        background: active ? '#f7faff' : '#fbfcfe',
      }}
    >
      {value}
    </div>
  </div>
);

export const TerminalCard: React.FC<{
  lines: {text: string; color?: string; appear: number}[];
  style?: React.CSSProperties;
  title?: string;
}> = ({lines, style, title}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        background: '#101828',
        borderRadius: 16,
        border: '1px solid #1f2c44',
        padding: '20px 26px',
        fontFamily: MONO,
        fontSize: 22,
        lineHeight: 1.9,
        color: '#cfe0ff',
        ...style,
      }}
    >
      {title ? <div style={{color: '#7189b4', fontSize: 19, marginBottom: 8}}>{title}</div> : null}
      {lines.map((l, i) => (
        <div key={i} style={{opacity: fade(frame, l.appear), whiteSpace: 'pre', color: l.color ?? '#cfe0ff'}}>
          {l.text}
        </div>
      ))}
    </div>
  );
};

/* ---------------------------------------------------------------- caption */
export const Caption: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const active = VOICE_MANIFEST.find((c) => t >= c.start - 0.1 && t <= c.start + c.dur + 0.28);
  if (!active) {
    return null;
  }
  const local = (t - active.start) * fps;
  const opacity = interpolate(local, [0, 7, (active.dur + 0.14) * fps - 9, (active.dur + 0.28) * fps], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 44,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontSize: 34,
          fontWeight: 600,
          color: '#ffffff',
          background: 'rgba(9,14,27,0.74)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 16,
          padding: '16px 34px',
          maxWidth: 1400,
          textAlign: 'center',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        }}
      >
        {active.text}
      </div>
    </div>
  );
};

export const SceneBg: React.FC<{dark?: boolean; children?: React.ReactNode}> = ({dark, children}) => (
  <AbsoluteFill
    style={{
      background: dark
        ? 'linear-gradient(180deg, #070b1c 0%, #0b1226 55%, #0d1730 100%)'
        : `radial-gradient(1200px 800px at 18% 8%, #eef4ff 0%, ${PAPER} 52%, #eef2f9 100%)`,
      fontFamily: FONT,
    }}
  >
    {children}
  </AbsoluteFill>
);
