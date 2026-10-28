import type { CSSProperties } from 'react';
import type { BotAvatar as Avatar } from '@moyu/core';
import { BotAvatar } from './BotAvatar';

export const PORTRAIT_CHOICES = [
  { id: 'chibi', name: 'DeepSeek', color: '#5890f0' },
  { id: 'shiro', name: 'ChatGPT', color: '#cdbfef' },
  { id: 'mikan', name: 'Claude', color: '#f7844c' },
  { id: 'neko', name: 'Gemini', color: '#91a7f7' },
  { id: 'tsuki', name: 'Grok', color: '#f6d7b4' },
  { id: 'nemu', name: 'Qwen', color: '#a8b8fd' },
  { id: 'zeta', name: 'GLM', color: '#343542' },
];
const COLORS = [{ name: '黑色', hex: '#202020' }, { name: '棕色', hex: '#a27952' }, { name: '红色', hex: '#ff304f' }, { name: '橙色', hex: '#ff781c' }, { name: '黄色', hex: '#ff9800' }, { name: '绿色', hex: '#00bd73' }, { name: '青色', hex: '#13b8ac' }, { name: '蓝色', hex: '#5890f0' }, { name: '紫色', hex: '#9256f7' }, { name: '粉色', hex: '#ed459a' }, { name: '灰色', hex: '#959595' }];

export function AvatarPicker({ value, onChange }: { value: Avatar; onChange: (avatar: Avatar) => void }) {
  return <div className="avatar-picker">
    <div className="avatar-choices" role="group" aria-label="选择 Bot 头像">
      {PORTRAIT_CHOICES.map((choice) => <button type="button" className="avatar-choice" key={choice.id} aria-label={`${choice.name} 头像`} aria-pressed={!value.imageDataUrl && (value.shape ?? 'chibi') === choice.id} onClick={() => onChange({ ...value, imageDataUrl: undefined, shape: choice.id, from: choice.color, to: choice.color })}>
        <BotAvatar bot={{ id: `portrait-choice-${choice.id}`, name: choice.name, avatar: { ...value, imageDataUrl: undefined, shape: choice.id, from: choice.color, to: choice.color } }} size="lg" animated={false} />
        <span>{choice.name}</span>
      </button>)}
    </div>
    {!value.imageDataUrl ? <div className="avatar-colors" role="group" aria-label="头像主题色">
      {COLORS.map((color) => <button type="button" key={color.hex} aria-label={`${color.name}主题色`} aria-pressed={value.from.toLowerCase() === color.hex} style={{ '--swatch': color.hex } as CSSProperties} onClick={() => onChange({ ...value, from: color.hex, to: color.hex })} />)}
    </div> : null}
  </div>;
}
