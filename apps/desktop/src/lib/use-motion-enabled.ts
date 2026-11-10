/* 动效开关：设置里的「减少动效」和系统偏好都关掉时，motion 直接落到终态。 */
import { useEffect, useState } from 'react';
import { useMoyu } from '../state';

export function useMotionEnabled(): boolean {
  const { settings } = useMoyu();
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return !settings.ui.reduceMotion && !systemReduced;
}
