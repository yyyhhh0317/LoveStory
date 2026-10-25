import { useEffect, useState } from 'react'
import { repo } from '../lib/repo'
import type { ImageVariant } from '../lib/types'

interface State {
  key: string | null
  url: string | null
}

/**
 * 地址先同步取缓存，未就绪再异步加载。
 * 只在 storageKey 变化时清空：同一张照片只是切换清晰度档位时，
 * 保留旧图直到新图就绪，避免画面闪白。
 */
export function useImgUrl(storageKey: string | null, variant: ImageVariant): string | null {
  const [state, setState] = useState<State>(() => ({
    key: storageKey,
    url: storageKey ? repo.peekUrl(storageKey, variant) : null,
  }))

  // 换了照片：立刻跟着换（没缓存就先空着，避免显示上一张）
  if (state.key !== storageKey) {
    setState({ key: storageKey, url: storageKey ? repo.peekUrl(storageKey, variant) : null })
  }

  useEffect(() => {
    if (!storageKey) return
    const cached = repo.peekUrl(storageKey, variant)
    if (cached) {
      setState((s) => (s.key === storageKey && s.url === cached ? s : { key: storageKey, url: cached }))
      return
    }
    let alive = true
    repo
      .resolveUrl(storageKey, variant)
      .then((u) => {
        if (alive && u) setState({ key: storageKey, url: u })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [storageKey, variant])

  return state.key === storageKey ? state.url : null
}
