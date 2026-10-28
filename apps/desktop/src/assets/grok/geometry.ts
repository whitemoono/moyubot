import payload from './avatar-geometry.json';

export interface AvatarGeometry {
  viewBox: number[];
  body: string;
  eyes: { id: number; rings: string[] }[];
}

/**
 * 想彻底去掉这套第三方角色素材：把下面的导出改成 `null` 即可，
 * `BotAvatar` 会自动回落到「渐变底 + 首字母」头像，其它代码不用动。
 * 素材来源与授权说明见 docs/ASSETS.md。
 */
export const GROK_AVATAR: AvatarGeometry | null = payload;
