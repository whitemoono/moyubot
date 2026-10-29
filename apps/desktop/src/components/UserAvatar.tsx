import type { UiSettings } from '@moyu/core';
import { useMoyu } from '../state';
import { BotAvatar } from './BotAvatar';

export const DEFAULT_USER_AVATAR: NonNullable<UiSettings['userAvatar']> = { shape: 'chibi', from: '#5890f0', to: '#5890f0', glyph: '我' };

export function UserAvatar({ value, className = '', animated = true }: { value?: UiSettings['userAvatar']; className?: string; animated?: boolean }) {
  const { settings } = useMoyu();
  const avatar = value ?? settings.ui.userAvatar ?? DEFAULT_USER_AVATAR;
  if (avatar.imageDataUrl) return <span className={`user-avatar user-avatar--uploaded ${className}`}><img src={avatar.imageDataUrl} alt={`${settings.userName || '用户'}的头像`} /></span>;
  return <BotAvatar bot={{ id: 'local-user-profile', name: settings.userName || '用户', avatar }} className={`user-avatar ${className}`} animated={animated} />;
}
