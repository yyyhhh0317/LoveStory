import { useEffect } from 'react'

/**
 * 弹层打开时锁住页面滚动。
 *
 * 为什么不用「position: fixed + 记住 scrollTop」那一套：整个应用本来就是
 * body{overflow:hidden} + 一个内部滚动容器，锁滚动只需要把那个容器的
 * overflow 关掉，不必动文档本身，也就不会有「关掉弹层后跳回顶部」。
 *
 * 用计数器而不是布尔：Viewer 和上传面板将来可能叠在一起（现在路径上不会），
 * 布尔会被后关的那个提前解锁。
 */
let locks = 0

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    if (++locks === 1) document.documentElement.dataset.scroll = 'locked'
    return () => {
      if (--locks === 0) delete document.documentElement.dataset.scroll
    }
  }, [active])
}
