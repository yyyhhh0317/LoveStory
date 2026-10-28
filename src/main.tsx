import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('缺少 #root 节点')

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
