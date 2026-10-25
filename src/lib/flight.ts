/** 屏幕坐标里的一个矩形，只留四个数：DOMRect 不能直接塞进 state 比较 */
export interface FrameRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 把 DOMRect 收成 FrameRect。
 * 小于 2px 的直接当没有 —— 那种尺寸飞起来是一道缝，不如不飞。
 */
export function toFrameRect(rect: DOMRect | null | undefined): FrameRect | null {
  if (!rect) return null
  if (!(rect.width > 2) || !(rect.height > 2)) return null
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 飞行时长，和 CSS/关键帧无关，只由 JS 控制 */
export const FLIGHT_MS = 460
