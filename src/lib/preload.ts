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
 * 这条链路还容得下几张预取。
 *
 * 起因是实测：一条 30 KB/s 的链路上，同时铺三张 1800px 大图（约 600KB）
 * 就是 20 秒的带宽 —— 而这二十秒里用户正盯着屏幕等**当前**那张。
 * 预取本来是让人少等的，抢起带宽来反而让人多等，这时候就该退。
 *
 * 读不到 Network Information（Safari / Firefox）时按 1 张算：
 * 只铺下一张，赌错也就是多下一张图。
 */
export function prefetchAllowance(): number {
  const conn = (
    navigator as Navigator & {
      connection?: {
        saveData?: boolean
        effectiveType?: string
        downlink?: number
      }
    }
  ).connection
  if (!conn) return 1
  if (conn.saveData) return 0
  const et = conn.effectiveType
  if (et === 'slow-2g' || et === '2g') return 0
  if (et === '3g') return 1
  if (typeof conn.downlink === 'number' && conn.downlink < 2) return 1
  return 3
}

/**
 * 取一张图并等到「可以直接绘制」。失败返回 null，调用方不用 catch。
 * 同一个 URL 只会真正加载一次，重复调用复用同一个 Promise。
 *
 * signal 用来在翻页时把上一轮的预取撤掉：不撤的话，被丢下的那几张
 * 会继续占着带宽和连接，下一张反而更慢。
 */
export function preloadImage(
  url: string | null | undefined,
  priority: PreloadPriority = 'low',
  signal?: AbortSignal
): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  if (signal?.aborted) return Promise.resolve(null)

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

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          if (settled) return
          settled = true
          inflight.delete(url)
          // 清掉 src 才是真的中止下载；只丢掉引用的话浏览器会继续下完
          try {
            img.src = ''
          } catch {
            /* 忽略 */
          }
          resolve(null)
        },
        { once: true }
      )
    }

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
