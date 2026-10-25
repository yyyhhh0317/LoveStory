import type { Photo } from './types'
import { hashString } from './format'

/** 黄金角，让照片在平面上疏密均匀、不排成规则的环 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** 时间线螺旋的起始半径：贴着中心相册外缘开始，保证一进来就能看到照片 */
const START_RADIUS = 400
/** 螺旋松紧：决定了相邻照片之间的平均间距 */
const SPREAD = 185
/** 单张照片在画布上的最长边（画布单位） */
const MAX_EDGE = 250
/** 相纸白边的总宽度 */
const FRAME = 12

export interface Placed {
  photo: Photo
  x: number
  y: number
  w: number
  h: number
  tilt: number
  delay: number
}

export const PHOTO_FRAME = FRAME

/**
 * 时间线排布：按拍摄时间升序，沿黄金角螺旋向外展开。
 * 每张照片的坐标只由它自己的时间序号决定，因此新增照片永远不会挪动旧照片。
 */
export function layoutTimeline(photos: Photo[]): Placed[] {
  const sorted = [...photos].sort(
    (a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()
  )

  return sorted.map((photo, i) => {
    const angle = i * GOLDEN_ANGLE
    const radius = START_RADIUS + SPREAD * Math.sqrt(i)

    let innerW = MAX_EDGE
    let innerH = MAX_EDGE
    const aspect = photo.aspect || 1
    if (aspect >= 1) {
      innerW = MAX_EDGE
      innerH = MAX_EDGE / aspect
    } else {
      innerH = MAX_EDGE
      innerW = MAX_EDGE * aspect
    }

    const h = hashString(photo.id)
    const tilt = ((h % 1000) / 1000 - 0.5) * 3.2

    return {
      photo,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      w: innerW + FRAME,
      h: innerH + FRAME,
      tilt,
      delay: Math.min(i * 26, 900),
    }
  })
}

/** 相册内页顺序：按被收进相册的时间 */
export function albumOrder(photos: Photo[]): Photo[] {
  return photos
    .filter((p) => p.featuredAt)
    .sort((a, b) => new Date(a.featuredAt!).getTime() - new Date(b.featuredAt!).getTime())
}

/** 时间线顺序，用于沉浸视图里左右翻页 */
export function timelineOrder(photos: Photo[]): Photo[] {
  return [...photos].sort(
    (a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()
  )
}

export function albumCover(photos: Photo[]): Photo | null {
  const list = albumOrder(photos)
  return list.length ? list[list.length - 1] : null
}
