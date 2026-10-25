import { useEffect, useState } from 'react'
import { repo } from '../lib/repo'
import type { ImageVariant } from '../lib/types'

/** 同步先拿缓存地址，未就绪再异步加载，避免图片区域闪烁 */
export function useImgUrl(storageKey: string | null, variant: ImageVariant): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    storageKey ? repo.peekUrl(storageKey, variant) : null
  )

  useEffect(() => {
    if (!storageKey) {
      setUrl(null)
      return
    }
    const cached = repo.peekUrl(storageKey, variant)
    if (cached) {
      setUrl(cached)
      return
    }
    let alive = true
    setUrl(null)
    repo
      .resolveUrl(storageKey, variant)
      .then((u) => {
        if (alive && u) setUrl(u)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [storageKey, variant])

  return url
}
