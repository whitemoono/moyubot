/* 统一动效：短距离、快出慢收，没有回弹。
   弹层和消息上还有一套 CSS 入场，调用处会关掉它，避免两层动画叠在一起。 */
import type { Transition, Variants } from 'motion/react';

/** 快出慢收，用于列表、消息、弹层。 */
export const rise: Transition = { duration: 0.32, ease: [0.16, 1, 0.3, 1] };

/** 背景遮罩淡入。 */
export const fade: Transition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] };

/** 列表容器：只错开很短一截，长列表不会一直往下抖。 */
export const listContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.012, delayChildren: 0.02 },
  },
};

/** 列表子项：轻微上浮，不左右滑、不缩放。 */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] } },
};

/** 新消息：上浮一点再落定。 */
export const messageItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: rise },
};

/** 弹层：只做短距离上浮，避免缩放带来的发虚。 */
export const sheetItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: rise },
};
