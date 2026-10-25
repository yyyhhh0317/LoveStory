import type { Photo } from './types'

export interface Throwback {
  photos: Photo[]
  /** 「三年前的今天」或「往年的今天」 */
  label: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 今天（本地时区）的键，用来记住「今天不再提示」 */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * 那年今日：找出「往年」同月同日拍的照片。
 *
 * 三个判断都是刻意的：
 *
 * 1. **按本地时区比月日**。EXIF 里的时间是按当地墙上时间构造 Date 再转成 ISO
 *    存的（见 `image.ts` 的 readExifDate），所以 `new Date(iso)` 拿回来仍是同一
 *    面钟，直接比月日不会错一天。改用 UTC 比反而会在东八区跨日出错。
 * 2. **今年的不算**。今天拍的今天看，不叫「那年」。
 * 3. **闰日严格匹配**。今天 2/29 就只找 2/29，不把 2/28 凑进来 ——
 *    宁可那天什么都不显示，也不要拿错一天的照片冒充。
 */
export function findThrowback(photos: Photo[], now = new Date()): Throwback | null {
  const year = now.getFullYear()
  const month = now.getMonth()
  const date = now.getDate()

  const hits = photos
    .filter((p) => {
      const t = new Date(p.takenAt)
      if (Number.isNaN(t.getTime())) return false
      return t.getFullYear() < year && t.getMonth() === month && t.getDate() === date
    })
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt))

  if (!hits.length) return null

  const years = new Set(hits.map((p) => new Date(p.takenAt).getFullYear()))
  const label =
    years.size > 1 ? '往年的今天' : `${year - [...years][0]} 年前的今天`

  return { photos: hits, label }
}
