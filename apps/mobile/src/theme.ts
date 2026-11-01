/** 设计令牌 —— 直接取自 apps/web/src/glass.css 的 .studio/.phone-screen（PWA 实际配色）。 */
export const colors = {
  glassFill: 'rgba(255, 255, 255, 0.43)',
  glassStroke: 'rgba(255, 255, 255, 0.9)',
  glassRim: 'rgba(74, 96, 73, 0.13)',
  glassShadow: 'rgba(56, 81, 52, 0.09)',
  glassHighlight: 'rgba(255, 255, 255, 0.88)',
  muted: '#737f70',
  softInk: '#5c6d5f',
  ink: '#151517',
  blue: '#0A84FF',
  green: '#34C759',
  /** 主按钮/发送的绿色渐变 */
  primaryFrom: '#67875d',
  primaryTo: '#2c4e3b',
  /** 用户消息气泡的浅绿渐变 */
  userFrom: '#e9f2db',
  userTo: '#d7e6c3',
  userBorder: 'rgba(248, 255, 241, 0.77)',
  rowPressed: 'rgba(120, 120, 128, 0.09)',
  inputBg: 'rgba(255, 255, 255, 0.43)',
  /** 兼容别名（旧屏幕引用） */
  gray: '#737f70',
  gray2: '#AEAEB2',
  name: '#3a3a3c',
  groupHead: '#737f70',
} as const;

/** 原型 .glass 白渐变（聊天气泡等白玻璃面仍在用）。 */
export const glass = {
  gradient: ['rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.56)', 'rgba(255, 255, 255, 0.68)'] as const,
  msgGradient: ['rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0.72)'] as const,
  border: 'rgba(255, 255, 255, 0.9)',
  highlight: 'rgba(255, 255, 255, 0.95)',
  blurIntensity: 45,
};

export const radius = {
  card: 23,
  computerCard: 25,
  bubble: 21,
  bubbleTail: 8,
  input: 15,
  search: 24,
  composer: 29,
  nav: 36,
  sheet: 30,
} as const;

export const shadow = {
  glass: '0 8px 24px -10px rgba(56, 81, 52, 0.09)',
  nav: '0 10px 30px rgba(73, 102, 64, 0.11)',
  composer: '0 10px 28px rgba(73, 102, 64, 0.11)',
};
