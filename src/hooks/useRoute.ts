import { useCallback, useEffect, useState } from 'react'

export type Route = 'home' | 'board' | 'album' | 'plans'

/**
 * 路由表。'/' 和空串都是首页 —— 首次进来 location.hash 是空串，
 * 手动写了 #/ 也要认。
 */
const TABLE: Record<string, Route> = {
  '': 'home',
  '/': 'home',
  '/board': 'board',
  '/album': 'album',
  '/plans': 'plans',
}

const TITLE: Record<Route, string> = {
  home: 'yyyhhh',
  board: '留言板 · yyyhhh',
  album: '相册 · yyyhhh',
  plans: '计划清单 · yyyhhh',
}

function readHash(): Route {
  const raw = window.location.hash.replace(/^#/, '')
  return isKnown(raw) ? TABLE[raw] : 'home'
}

/* 用 hasOwnProperty 而不是 `in`：后者会把 toString / valueOf 也当成路由 */
function isKnown(raw: string): boolean {
  return Object.prototype.hasOwnProperty.call(TABLE, raw)
}

function hashOf(route: Route): string {
  return route === 'home' ? '#/' : `#/${route}`
}

/**
 * 用 hash 而不是 path 的三个理由：
 *   1. GitHub Pages 没有 SPA 回退，/album 硬刷新会 404；hash 永远只请求 index.html
 *   2. 现在浏览器返回键会直接离开站点（从没 push 过 history），有了 hash 就能站内逐级退
 *   3. PWA standalone 下地址栏看不见，但 hash 依然驱动 UI
 */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(readHash)

  useEffect(() => {
    const onChange = () => {
      const raw = window.location.hash.replace(/^#/, '')
      // 认不出来的 hash 归一到首页，用 replace 免得在历史里留一条死记录
      if (!isKnown(raw)) window.history.replaceState(null, '', hashOf('home'))
      setRoute(readHash())
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  useEffect(() => {
    document.title = TITLE[route]
  }, [route])

  const navigate = useCallback((next: Route) => {
    const target = hashOf(next)
    // 同一个 hash 再赋值不会触发 hashchange，先判等；state 只由事件更新，避免双写
    if (window.location.hash !== target) window.location.hash = target
    else setRoute(next)
  }, [])

  return [route, navigate]
}
