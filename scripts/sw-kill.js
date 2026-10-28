/*
 * 紧急下线用的 Service Worker。
 *
 * SW 是唯一「删不干净」的改动：只要曾经注册过，客户端就会一直带着它，
 * 直到出现一个新版把它们顶掉。要退场时：
 *
 *   1. cp scripts/sw-kill.js dist/sw.js
 *   2. 部署一次，等一个发布周期（GitHub Pages 的 Cache-Control 是 10 分钟，
 *     保守等一天），让还在跑的旧 SW 都被它替换掉
 *   3. 再从 main.tsx 里删掉注册代码
 *
 * 顺序不能反：先删注册的话，已经装了 SW 的设备再也没有机会收到这个「自毁」版本。
 */

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const c of clients) c.navigate(c.url)
    })()
  )
})
