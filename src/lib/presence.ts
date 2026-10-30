import { useEffect, useState } from 'react'
import { prefersReducedMotion } from './flight'

/**
 * 退场时长（毫秒），对齐 CSS 的 --dur-2。
 *
 * 两个数值必须一致：CSS 那边负责把这一层淡到 0，JS 这边负责在这之后
 * 才真正卸载。JS 略慢一点点（多 20ms）是故意的 —— 宁可多留一帧透明层，
 * 也不要动画还没走完就被摘掉，那会看到最后一帧「跳」一下。
 */
export const DISSOLVE_MS = 260

/**
 * 延迟卸载。
 *
 * React 没有 Vue 的 <Transition>，条件渲染一旦为假就立刻从 DOM 里摘掉，
 * 于是只能做入场动画、做不了退场 —— 点关闭是「啪」地消失。
 * 这个 hook 把「还在不在 DOM 里」和「该不该显示」拆成两件事：
 *
 * - `mounted` 在 open 变 false 之后再撑 DISSOLVE_MS 毫秒；
 * - `closing` 在这段时间里为 true，组件借它挂一段淡出。
 *
 * 传进去的 `ms` 只该在很特殊的地方改（比如整页级的过场），
 * 面板、提示条这类浮动层一律用默认值，否则几个层退场节奏不齐会显得很脏。
 */
export function usePresence(open: boolean, ms = DISSOLVE_MS) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    /*
     * 减弱动效下 CSS 已经把 animation-duration 压到 0.01ms，
     * 再等 260ms 只是让一个不可见的层挂在 DOM 上，直接摘掉更干净。
     */
    if (prefersReducedMotion()) {
      setMounted(false)
      setClosing(false)
      return
    }
    setClosing(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, ms)
    return () => window.clearTimeout(timer)
  }, [open, mounted, ms])

  return { mounted, closing }
}
