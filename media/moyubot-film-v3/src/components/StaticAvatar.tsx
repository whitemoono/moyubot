import React from 'react';
import {grokPortrait} from '../vendor/grok/load';

/** 静态头像：渲染 vendored 引擎里每个 shape 的官方矢量路径（与应用内旧消息同款）。 */
export const StaticAvatar: React.FC<{
  shape: string;
  color: string;
  size: number;
  pale?: string;
  style?: React.CSSProperties;
}> = ({shape, color, size, pale, style}) => {
  const portrait = grokPortrait(shape);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '28%',
        background: pale ?? 'transparent',
        overflow: 'hidden',
        flexShrink: 0,
        ...style,
      }}
    >
      {portrait ? (
        <svg viewBox="-15 -15 259 259" style={{width: '100%', height: '100%', display: 'block'}}>
          <path d={portrait.path} fill={color} />
          {portrait.decals?.map((decal, index) => (
            <path key={index} d={decal.d} fill={decal.fill} fillRule={decal.rule ?? 'evenodd'} />
          ))}
          {portrait.iconFace?.anchors.map(([x, y], index) => (
            <rect
              key={index}
              x={x - portrait.iconFace!.rx}
              y={y - portrait.iconFace!.ry}
              width={portrait.iconFace!.rx * 2}
              height={portrait.iconFace!.ry * 2}
              rx={portrait.iconFace!.rx}
              fill={portrait.iconFace!.ink ?? '#1a1a1f'}
            />
          ))}
        </svg>
      ) : null}
    </div>
  );
};
