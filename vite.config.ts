import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 往 HTML 里注入 Supabase 的 preconnect。
 *
 * 首屏最贵的一笔是两条 REST 请求的 TTFB，里面含着一次 DNS + TCP + TLS。
 * 提前把连接建好，这段就能和 432 kB 的 JS 下载并行，而不是排在它后面。
 *
 * 为什么不在 index.html 里写 %VITE_SUPABASE_URL%：
 * env 不存在时 Vite **不替换、原样保留**那个占位符，浏览器会拿它当相对路径
 * 去请求，凭空多一个 404。所以这里在构建期判断，没配置就一条都不加（本地模式）。
 *
 * crossorigin 必须带：REST 请求要带 apikey，属于 CORS；不带 crossorigin 的
 * preconnect 建的是非 CORS 连接，浏览器会为真正的请求另开一条，等于白连。
 */
function supabasePreconnect(): Plugin {
  let origin = ''
  return {
    name: 'supabase-preconnect',
    apply: 'build',
    configResolved(config) {
      const raw = config.env.VITE_SUPABASE_URL
      try {
        origin = raw ? new URL(raw).origin : ''
      } catch {
        origin = ''
      }
    },
    transformIndexHtml() {
      if (!origin) return []
      return [
        {
          tag: 'link',
          injectTo: 'head-prepend',
          attrs: { rel: 'preconnect', href: origin, crossorigin: '' },
        },
        {
          tag: 'link',
          injectTo: 'head-prepend',
          attrs: { rel: 'dns-prefetch', href: origin },
        },
      ]
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), supabasePreconnect()],
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
})
