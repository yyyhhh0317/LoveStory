import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('缺少 #root 节点')

/*
 * 清掉看门狗留下的 _r=1（见 index.html）。
 *
 * 能走到这里说明入口 chunk 都拿到了，那次救援已经成功，标记就该收回去 ——
 * 否则 URL 会一直挂着一个没意义的参数，而且下一次真的白屏时会被当成
 * 「已经救过」，直接放弃。
 *
 * 用 replaceState 而不是 location.replace：不新增历史记录，也不触发导航。
 */
if (location.search.includes('_r=1')) {
  const url = new URL(location.href)
  url.searchParams.delete('_r')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary scope="page">
      <App />
    </ErrorBoundary>
  </StrictMode>
)

/*
 * Service Worker 只在生产环境注册。
 *
 * dev server 的模块图是 /src/x.tsx?t=...，一旦进了缓存，热更新会变成玄学，
 * 所以这里用 PROD 挡掉。
 *
 * 用 document.baseURI 解析路径：GitHub Pages 部署在 /LoveStory/ 下、本地
 * preview 在 / 下，同一个写法都对，不需要把子路径写死。
 *
 * 注册失败不影响任何功能，只是没有离线缓存 —— 静默吞掉即可。
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {})
  })
}
