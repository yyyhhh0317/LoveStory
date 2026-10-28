import type { Photo } from './types'

/**
 * 上一次成功拿到的相册快照。
 *
 * 为什么是 localStorage 而不是 IndexedDB：必须**同步**读。
 * useAlbum 要在 useState 的初始化器里用它把 phase 直接定成 ready，
 * 一旦走 IndexedDB 就要 await，第一帧必然是 loading —— 也就必然闪一下
 * 加载页，那正是这个缓存要消灭的东西。
 * 三百张大约 60–90 kB，5 MB 配额够用几十倍。
 */
const KEY = 'yyyhhh:album:v1'
/** 结构版本：字段有增减就 +1，旧缓存自动作废，不用写迁移 */
const V = 1
/**
 * 留言数最多信一天。
 * 照片列表不设过期 —— 宁可显示一周前的正确快照，也不要一个空白加载页；
 * 但徽标上的数字长期停在错的值，比不显示更糟。
 */
const COUNTS_TTL = 24 * 60 * 60 * 1000

export interface AlbumSnapshot {
  photos: Photo[]
  counts: Record<string, number>
}

interface Stored {
  v: number
  savedAt: number
  photos: Photo[]
  counts: Record<string, number>
}

function looksLikePhoto(v: unknown): v is Photo {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.storageKey === 'string' &&
    typeof p.takenAt === 'string' &&
    typeof p.aspect === 'number'
  )
}

/**
 * 读快照。任何不对劲的地方都返回 null 当作没有缓存，绝不抛错 ——
 * 缓存只是锦上添花，不能因为它让整页打不开。
 */
export function readAlbumCache(): AlbumSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<Stored>
    if (data.v !== V || !Array.isArray(data.photos)) return null
    /*
     * 空数组一律当没有。
     * 否则「服务器真的返回 0 张」会被伪装成缓存命中，
     * 「读不到」和「真的没有」这两件事就又糊在一起了。
     */
    if (data.photos.length === 0) return null
    if (!data.photos.every(looksLikePhoto)) return null

    const fresh = typeof data.savedAt === 'number' && Date.now() - data.savedAt < COUNTS_TTL
    const counts =
      fresh && data.counts && typeof data.counts === 'object'
        ? (data.counts as Record<string, number>)
        : {}

    return { photos: data.photos, counts }
  } catch {
    return null
  }
}

/**
 * 写快照。整份替换，**不做增量合并** ——
 * 合并会把已经删掉的照片留成幽灵，那才是真正的画布错位来源。
 */
export function writeAlbumCache(photos: Photo[], counts: Record<string, number>): void {
  if (!photos.length) return

  // 只留还活着的照片的计数，免得徽标挂到别的照片上
  const live = new Set(photos.map((p) => p.id))
  const kept: Record<string, number> = {}
  for (const [id, n] of Object.entries(counts)) {
    if (live.has(id) && n > 0) kept[id] = n
  }

  try {
    const payload: Stored = { v: V, savedAt: Date.now(), photos, counts: kept }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // 配额满、隐私模式禁写：都是可接受的，主流程不该受影响
  }
}

/** 结构升级或调试时用；升 V 也能达到同样效果 */
export function clearAlbumCache(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 同上 */
  }
}
