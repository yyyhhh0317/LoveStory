/**
 * 图片预取 / 预解码。
 *
 * 为什么需要它：`<img src>` 只是「发起请求」，浏览器要在**真正绘制的那一帧**才解码。
 * 一张 1800px 的 WebP 解码要 60–180ms（手机上更久），而详情页换图正好发生在
 * 翻页动画的第一帧 —— 这就是「切换照片那一下卡住」的主因。
 * 提前把下一张 `decode()` 掉，换过去时就只剩一次合成，帧时间跌回 16ms 以内。
 *
 * 只留极小的 keep 表：解码后的位图常驻内存（1800×1350 ≈ 9.7MB/张），
 * 留多了反而把手机的内存吃满，反过来触发 GC 抖动。
 */

/** 解码后常驻的图张数：够放下前一张、后一张、再远一点的一张 */
const MAX_KEEP = 3

const keep = new Map<string, HTMLImageElement>()
const inflight = new Map<string, Promise<HTMLImageElement | null>>()

export type PreloadPriority = 'high' | 'low' | 'auto'

/**
 * 取一张图并等到「可以直接绘制」。失败返回 null，调用方不用 catch。
 * 同一个 URL 只会真正加载一次，重复调用复用同一个 Promise。
 */
export function preloadImage(
  url: string | null | undefined,
  priority: PreloadPriority = 'low'
): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)

  const cached = keep.get(url)
  if (cached) {
    // 命中即刷新 LRU 顺序
    keep.delete(url)
    keep.set(url, cached)
    return Promise.resolve(cached)
  }

  const running = inflight.get(url)
  if (running) return running

  const task = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    // fetchPriority 在旧内核上不存在，赋值失败也不影响流程
    try {
      img.fetchPriority = priority
    } catch {
      /* 忽略 */
    }

    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      inflight.delete(url)
      if (!ok) {
        resolve(null)
        return
      }
      keep.set(url, img)
      while (keep.size > MAX_KEEP) {
        const oldest = keep.keys().next().value
        if (oldest === undefined) break
        keep.delete(oldest)
      }
      resolve(img)
    }

    img.onerror = () => finish(false)
    img.src = url

    if (typeof img.decode === 'function') {
      // decode() 在部分内核（Safari 老版本）对已缓存图会 reject，兜一层 complete 检查
      img.decode().then(
        () => finish(true),
        () => finish(img.complete && img.naturalWidth > 0)
      )
    } else {
      img.onload = () => finish(true)
    }
  })

  inflight.set(url, task)
  return task
}

/** 让出主线程：空闲回调优先，不支持就退回一个短定时器 */
export function whenIdle(timeout = 500): Promise<void> {
  return new Promise((resolve) => {
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }).requestIdleCallback
    if (typeof ric === 'function') ric(() => resolve(), { timeout })
    else window.setTimeout(resolve, Math.min(timeout, 240))
  })
}
