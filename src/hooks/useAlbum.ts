import { useCallback, useEffect, useRef, useState } from 'react'
import { repo } from '../lib/repo'
import { describeError, type FriendlyError } from '../lib/errors'
import type { NewPhotoInput, Photo } from '../lib/types'

/**
 * 三态机：
 *
 *   loading ──成功──▶ ready（照片为 0 张时才是「真的空」）
 *      │                  ▲
 *      └──失败/超时──▶ error ──重试成功──┘
 *
 * 关键在于「读不到」和「真的没有」必须是两个状态，否则界面会撒谎。
 */
export type AlbumPhase = 'loading' | 'ready' | 'error'

/** 免费项目被暂停时请求会一直挂着，没有超时就会永远停在加载页 */
const LOAD_TIMEOUT_MS = 15000

export function useAlbum() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [phase, setPhase] = useState<AlbumPhase>('loading')
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const photosRef = useRef<Photo[]>(photos)
  photosRef.current = photos
  const phaseRef = useRef<AlbumPhase>(phase)
  phaseRef.current = phase
  /** 代次守卫：只有最后一次发起的加载允许改状态，避免慢请求把新状态覆盖回去 */
  const gen = useRef(0)

  const reload = useCallback(async () => {
    const my = ++gen.current
    setRefreshing(true)
    /*
     * 什么时候退回加载页：
     * - 手上已有内容 → 不退回，否则画布被卸载、视口位置丢掉
     * - 正停在「连不上」页 → 不退回，留在原卡片上把按钮改成「正在连…」，
     *   比整页闪成加载态更连贯
     */
    if (photosRef.current.length === 0 && phaseRef.current !== 'error') setPhase('loading')

    let timer: number | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('TIMEOUT')), LOAD_TIMEOUT_MS)
    })

    try {
      const list = await Promise.race([repo.listPhotos(), timeout])
      if (my !== gen.current) return
      setPhotos(list)
      setError(null)
      setPhase('ready')

      // 留言数读不到不该拖垮整本相册，失败就降级为空
      repo
        .countMessages()
        .then((next) => {
          if (my === gen.current) setCounts(next)
        })
        .catch(() => undefined)
    } catch (err) {
      if (my !== gen.current) return
      setError(describeError(err))
      // 已经有照片时保住画面，不要把用户踢到错误页
      setPhase(photosRef.current.length === 0 ? 'error' : 'ready')
    } finally {
      window.clearTimeout(timer)
      if (my === gen.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 断网恢复后自动再试一次，省得用户回来手动点
  useEffect(() => {
    const onOnline = () => {
      if (phaseRef.current === 'error') void reload()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [reload])

  const addPhotos = useCallback(async (items: NewPhotoInput[]) => {
    const created: Photo[] = []
    for (const item of items) {
      created.push(await repo.createPhoto(item))
    }
    setPhotos((prev) => [...prev, ...created])
    return created
  }, [])

  const setCaption = useCallback(async (id: string, caption: string | null) => {
    const trimmed = caption && caption.trim() ? caption.trim() : null
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, caption: trimmed } : p)))
    await repo.patchPhoto(id, { caption: trimmed })
  }, [])

  const toggleFeatured = useCallback(async (id: string) => {
    let next: string | null = null
    setPhotos((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        next = p.featuredAt ? null : new Date().toISOString()
        return { ...p, featuredAt: next }
      })
    )
    await repo.patchPhoto(id, { featuredAt: next })
  }, [])

  const removePhoto = useCallback(async (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id))
    await repo.softDeletePhoto(id)
  }, [])

  const bumpMessageCount = useCallback((photoId: string, delta: number) => {
    setCounts((prev) => {
      const next = { ...prev, [photoId]: Math.max(0, (prev[photoId] ?? 0) + delta) }
      if (next[photoId] === 0) delete next[photoId]
      return next
    })
  }, [])

  return {
    photos,
    counts,
    phase,
    error,
    refreshing,
    reload,
    addPhotos,
    setCaption,
    toggleFeatured,
    removePhoto,
    bumpMessageCount,
  }
}
