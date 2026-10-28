import { useCallback, useEffect, useRef, useState } from 'react'
import { isRemote, repo } from '../lib/repo'
import { describeError, type FriendlyError } from '../lib/errors'
import { readAlbumCache, writeAlbumCache } from '../lib/albumCache'
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

/**
 * 内容签名：判断「刷新回来的东西和手上的一不一样」。
 * 一样就不换数组 —— CanvasWall 的 layoutTimeline 以 photos 引用为依赖，
 * PhotoCard 又以 placed 引用做 memo 比较，一次「什么都没变」的后台刷新
 * 会白白重渲染同屏三十几张卡片。
 */
function photoSig(list: Photo[]): string {
  let s = ''
  for (const p of list) s += `${p.id}:${p.takenAt}:${p.caption ?? ''}:${p.featuredAt ?? ''}|`
  return s
}

export function useAlbum() {
  /*
   * 上一次成功拿到的快照，同步读出来（见 lib/albumCache.ts）。
   * 有它的时候首帧就是 ready，加载页压根不出现。
   * 本地模式的数据本来就在 localStorage 里，再套一层缓存没意义。
   */
  const [seed] = useState(() => (isRemote ? readAlbumCache() : null))
  const [photos, setPhotos] = useState<Photo[]>(seed?.photos ?? [])
  const [counts, setCounts] = useState<Record<string, number>>(seed?.counts ?? {})
  const [phase, setPhase] = useState<AlbumPhase>(seed ? 'ready' : 'loading')
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  /** 只有真联网成功过一次，才允许把数据写回快照 */
  const [synced, setSynced] = useState(false)
  /**
   * 上次同步的时刻，给「切回前台重验」做节流。
   *
   * 初值是「现在」而不是 0：页面刚开时浏览器也可能抛一次 visibilitychange
   * （预渲染转正式、后台标签被唤醒），用 0 会让首屏白跑一轮完整查询。
   */
  const lastSync = useRef(Date.now())

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

    /*
     * 两个查询同时发出。
     *
     * 原来是 await 完 listPhotos 才调 countMessages —— 1.40s 接 522ms 首尾相接，
     * 正好凑成那两秒的加载页。它们之间没有任何依赖，没有理由排队。
     *
     * 但不能写成 Promise.all：那等于把留言数的 522ms 变成 phase 的前置条件，
     * 只是把串行换了个位置。超时守卫也只该罩着照片列表。
     */
    const countsTask = repo.countMessages().catch(() => null)
    const listTask = repo.listPhotos()

    try {
      const list = await Promise.race([listTask, timeout])
      if (my !== gen.current) return
      if (photoSig(list) !== photoSig(photosRef.current)) setPhotos(list)
      setError(null)
      setPhase('ready')
      setSynced(true)
      lastSync.current = Date.now()

      // 留言数读不到不该拖垮整本相册，失败就降级为空
      void countsTask.then((next) => {
        if (next && my === gen.current) setCounts(next)
      })
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

  /*
   * 写回快照：一个 effect 兜住所有写路径。
   * 上传、软删、星标、改简介、留言数最后都会落到 photos / counts 上，
   * 所以不必在 addPhotos、removePhoto 里各插一行 —— 那样必漏。
   *
   * synced 是门槛：没成功联网过就写，等于把「刚用缓存初始化的数据」
   * 当成真数据存一遍，savedAt 也会被刷成现在，留言数的 24 小时 TTL
   * 就永远不会过期。
   */
  useEffect(() => {
    if (!isRemote || !synced || phase !== 'ready') return
    const t = window.setTimeout(() => writeAlbumCache(photos, counts), 400)
    return () => window.clearTimeout(t)
  }, [photos, counts, phase, synced])

  /*
   * 从别的标签页 / 后台切回来时对一眼。
   * 不做定时轮询 —— 两个人的相册，没必要像监控那样一直跑。
   * 60 秒内刚同步过就跳过，来回切标签时不会连着发请求。
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastSync.current < 60_000) return
      void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  /**
   * 逐张上传，失败的不打断整批。
   * 返回 created / failed 两份，面板据此决定是关掉还是留在原地续传。
   * 重试时调用方会传回同一批 items（storageKey 不变），仓储层已做幂等。
   */
  const addPhotos = useCallback(async (items: NewPhotoInput[]) => {
    const created: Photo[] = []
    const failed: NewPhotoInput[] = []
    for (const item of items) {
      try {
        const photo = await repo.createPhoto(item)
        if (!created.some((p) => p.id === photo.id)) created.push(photo)
      } catch {
        failed.push(item)
      }
    }
    if (created.length) {
      setPhotos((prev) => {
        const seen = new Set(prev.map((p) => p.id))
        return [...prev, ...created.filter((p) => !seen.has(p.id))]
      })
    }
    return { created, failed }
  }, [])

  /*
   * 下面三个写操作都是「先改界面、再发请求」，但**失败必须回滚并抛出去**。
   *
   * 之所以敢用乐观更新：这两个人点星标、改简介、删照片的手感全在这里，
   * 等一个来回网络请求再变界面会明显发木。
   * 之所以必须回滚：不回滚的话界面显示成功、数据库没改，刷新之后才发现，
   * 那是最糟的一种——你不知道哪一次操作是真的生效了。
   *
   * 回滚都带条件：只有当值还是「这次写进去的那个」才回滚，
   * 避免把用户紧接着的第二次修改一起抹掉。
   */

  const setCaption = useCallback(async (id: string, caption: string | null) => {
    const trimmed = caption && caption.trim() ? caption.trim() : null
    const prev = photosRef.current.find((p) => p.id === id)?.caption ?? null
    setPhotos((cur) => cur.map((p) => (p.id === id ? { ...p, caption: trimmed } : p)))
    try {
      await repo.patchPhoto(id, { caption: trimmed })
    } catch (err) {
      setPhotos((cur) =>
        cur.map((p) => (p.id === id && p.caption === trimmed ? { ...p, caption: prev } : p))
      )
      throw err
    }
  }, [])

  const toggleFeatured = useCallback(async (id: string) => {
    const current = photosRef.current.find((p) => p.id === id)
    if (!current) return

    /*
     * 这里原本是在 setPhotos 的回调里算 next、算完立刻读出来发请求。
     * 它现在能跑，是因为 React 对空队列的 setState 会「急切求值」顺手把
     * 回调执行了一次；换个时机（并发、批量、连点两下）就轮不到那次执行，
     * next 会一直停在初始值 null，于是「点上星标」被写成「取消星标」。
     * 改成从 ref 里读当前值、先算好再更新，不依赖任何执行时机的巧合。
     */
    const next = current.featuredAt ? null : new Date().toISOString()
    setPhotos((cur) => cur.map((p) => (p.id === id ? { ...p, featuredAt: next } : p)))
    try {
      await repo.patchPhoto(id, { featuredAt: next })
    } catch (err) {
      setPhotos((cur) =>
        cur.map((p) =>
          p.id === id && p.featuredAt === next ? { ...p, featuredAt: current.featuredAt } : p
        )
      )
      throw err
    }
  }, [])

  const removePhoto = useCallback(async (id: string) => {
    const before = photosRef.current
    const at = before.findIndex((p) => p.id === id)
    if (at < 0) return
    setPhotos((cur) => cur.filter((p) => p.id !== id))
    try {
      await repo.softDeletePhoto(id)
    } catch (err) {
      // 放回原来的位置，而不是追加到末尾
      setPhotos((cur) =>
        cur.some((p) => p.id === id)
          ? cur
          : [...cur.slice(0, at), before[at], ...cur.slice(at)]
      )
      throw err
    }
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
