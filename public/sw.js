/*
 * yyyhhh 的 Service Worker
 *
 * 只做三件事：
 *   1. 把构建产物预缓存，二次访问不再摸网络；
 *   2. 把 Storage 里的照片按 CacheFirst 存下来（URL 带 UUID，内容永不改变）；
 *   3. 断网时仍能开门。
 *
 * **rest/v1 一律不拦。** 留言写成功那一刻只有应用知道哪个 photoId 脏了，
 * SW 拿不到这个语义；缓存陈旧会让留言板在「读不到」和「真的没有」之间撒谎。
 *
 * 由 scripts/build-sw.mjs 在构建时替换下面两个占位符。
 */

const VERSION = '%VERSION%'
const PRECACHE = %PRECACHE%

/* 运行时才知道自己的绝对位置：GitHub Pages 在 /LoveStory/ 下，本地预览在 / 下 */
const SCOPE = self.registration.scope
const INDEX = new URL('index.html', SCOPE).href

/* 版本化的 app shell：新版本部署时整体换掉 */
const CORE = 'ls-core-' + VERSION
/*
 * 图片缓存跨版本复用：storage_key 是 crypto.randomUUID()，
 * 上传用 upsert:false 且把 409 当成功 —— 同名对象永远不会有第二份内容，
 * 语义上等价于 immutable。每发一版就清空等于让用户重下一遍全部照片。
 *
 * **唯一的例外是存量重压。** 那个脚本会覆盖同名对象（见
 * scripts/recompress-photos.mjs），从那一刻起「同名必有同内容」不再成立，
 * 所以它必须同时把这里升到 v2 —— 否则 CacheFirst 会一直吐旧字节，
 * 看起来像「压了个寂寞」。
 */
const IMG_FULL = 'ls-img-full-v2'
const IMG_THUMB = 'ls-img-thumb-v2'
/* 无界缓存是 SW 最常见的自伤：按条数封顶，别把浏览器的配额吃光 */
const FULL_MAX = 60
const THUMB_MAX = 200

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE)
      // addAll 是原子的：任一个 404 就整体失败。宁可这次不装，也不装一份残缺的
      await cache.addAll(PRECACHE.map((p) => new URL(p, SCOPE).href))
      /*
       * 刻意不 skipWaiting。
       * 新版本立刻接管，意味着旧页面还在跑旧 JS、却去请求新版本已经删掉的
       * chunk —— 那就是白屏。等用户下次开页面再换，最多晚一次。
       */
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      /*
       * 只清自己名下的旧桶：上一版的 app shell，以及被 bump 掉的图片版本。
       *
       * 图片桶平时跨版本留着（见上面的注释），但一旦换了版本号，旧桶就是纯垃圾 ——
       * 它永远不会再被读到，而 Cache Storage 的配额是整站共享的。
       * 必须连它一起删，否则存量重压之后旧图会一直占着几十兆。
       */
      const keep = new Set([CORE, IMG_FULL, IMG_THUMB])
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((n) => !keep.has(n) && (n.startsWith('ls-core-') || n.startsWith('ls-img-')))
          .map((n) => caches.delete(n))
      )
    })()
  )
})

async function fetchWithTimeout(request, ms) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(request, { signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 导航请求：网络优先，3.5 秒没回来就用缓存。
 * HTML 必须拿最新的，否则新部署的 hash 对不上，页面会去要已经删掉的 chunk。
 */
async function networkFirst(event) {
  const request = event.request
  const cache = await caches.open(CORE)
  try {
    const res = await fetchWithTimeout(request, 3500)
    if (res && res.ok) {
      /*
       * 写缓存**不能 await**：await 意味着页面要等这一笔磁盘写完才开始解析 HTML。
       * 写盘本身不慢，但它是排队的 —— 首屏同时还有几十个请求在等这条链路。
       */
      event.waitUntil(cache.put(request, res.clone()).catch(() => {}))
    }
    return res
  } catch {
    // 先找这次导航自己的缓存，没有就回落 index.html —— 单页应用任何路径都该能开门
    const hit = (await cache.match(request)) || (await cache.match(INDEX))
    if (hit) return hit
    return new Response('这会儿连不上，等有网了再来。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

/* 计数必须按桶分开：共用一个计数器时，thumb 的写入会把 full 的计数清零，
   full 就永远数不到 8 —— 结果两个桶都只在一半的频率下被修剪，条数能到上限的 2 倍 */
const puts = new Map()

async function maybeTrim(cacheName, max) {
  // 不必每次 put 都数一遍 key，几百条 keys() 也是要花时间的
  const n = (puts.get(cacheName) || 0) + 1
  if (n < 8) {
    puts.set(cacheName, n)
    return
  }
  puts.set(cacheName, 0)
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= max) return
  // keys() 按插入顺序，先删最旧的
  for (const k of keys.slice(0, keys.length - max)) await cache.delete(k)
}

async function cacheFirst(event, cacheName, max) {
  const request = event.request
  const cache = await caches.open(cacheName)
  // ignoreVary：跨域图片的响应头读不到，Vary 匹配会失手
  const hit = await cache.match(request, { ignoreVary: true })
  if (hit) return hit

  const res = await fetch(request)
  /*
   * opaque（跨域 no-cors）也算成功：内容读不了，但正是要缓存的图片。
   *
   * **写缓存绝对不能在返回之前 await。**
   * 这是这个文件里最贵的一个错误：await cache.put() 意味着页面要等这几百 KB
   * 全部写完磁盘才开始收到响应体。图片还好，但它会占住这条链路，
   * 后面排队的请求（氛围层的缩略图、下一张预取）全被一起拖住 ——
   * 表现出来就是「所有图片都在同一秒才完成」。
   *
   * 响应立刻返回，写入交给 waitUntil 在后台做完。
   */
  if (res && (res.ok || res.type === 'opaque')) {
    const copy = res.clone()
    event.waitUntil(
      (async () => {
        try {
          await cache.put(request, copy)
          if (max) await maybeTrim(cacheName, max)
        } catch {
          /* 配额满或响应不可缓存：不算错，下次再试 */
        }
      })()
    )
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(event))
    return
  }

  /* 自己的东西：文件名带内容哈希，内容永不改变 */
  if (url.href.startsWith(SCOPE)) {
    event.respondWith(cacheFirst(event, CORE))
    return
  }

  /* Supabase Storage 的公开图片 */
  if (url.pathname.includes('/storage/v1/object/public/')) {
    /*
     * 带 CORS 的请求直接放行 —— 那是详情页读像素算氛围亮度的采样器。
     * 缓存里存的是 opaque 响应，交给 canvas 会污染画布，getImageData 抛错
     * 被 catch 吞掉，氛围层就静默退化成固定亮度了。
     * 宁可多下一次，也不让一个视觉功能悄悄坏掉。
     */
    if (req.mode === 'cors') return
    const full = url.pathname.endsWith('/full.webp')
    event.respondWith(
      cacheFirst(event, full ? IMG_FULL : IMG_THUMB, full ? FULL_MAX : THUMB_MAX)
    )
    return
  }

  /* 其余（含 rest/v1）一律不拦 */
})
