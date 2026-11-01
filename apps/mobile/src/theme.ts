/** 液态玻璃设计令牌 —— 与 prototype/liquid-glass/styles.css 的 :root 一一对应。 */
export const colors = {
  blue: '#0A84FF',
  green: '#34C759',
  ink: '#151517',
  gray: '#8E8E93',
  gray2: '#AEAEB2',
  bg: '#F3F3F6',
  bgDeep: '#e8e8ee',
  name: '#3a3a3c',
  groupHead: '#98A0A8',
  rowPressed: 'rgba(120, 120, 128, 0.09)',
  inputBg: 'rgba(120, 120, 128, 0.13)',
  amberFrom: '#B2832A',
  amberTo: '#996C13',
} as const;

export const glass = {
  /** .glass 的白渐变底（叠在 BlurView 上面） */
  gradient: ['rgba(255, 255, 255, 0.84)', 'rgba(255, 255, 255, 0.56)', 'rgba(255, 255, 255, 0.68)'] as const,
  border: 'rgba(255, 255, 255, 0.6)',
  highlight: 'rgba(255, 255, 255, 0.95)',
  blurIntensity: 60,
  msgGradient: ['rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0.72)'] as const,
};

export const radius = {
  row: 24,
  bubble: 21,
  bubbleTail: 8,
  card: 28,
  input: 14,
  pill: 999,
} as const;

export const shadow = {
  glass: '0 12px 30px -12px rgba(45, 50, 85, 0.25)',
  bubble: '0 3px 12px -4px rgba(55, 60, 95, 0.14)',
  amber: '0 7px 18px -7px rgba(150, 106, 18, 0.55)',
  hero: '0 8px 22px -8px rgba(60, 55, 90, 0.28)',
};
