import { pad } from './format'
import type { Photo } from './types'

/** 「星期日」→「周日」：时间轴那列只有一窄条，全称放不下 */
const WEEKDAYS_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 本地时区的 YYYY-MM-DD。不转 UTC —— 全站对日期一律按本地日界理解 */
function dayKeyOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 按拍摄时间升序 */
function sortByTakenAt(photos: Photo[]): Photo[] {
  return [...photos].sort(
    (a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()
  )
}

export interface DayGroup {
  /** YYYY-MM-DD，用作 React key */
  key: string
  /**
   * 拆开的日期碎片，时间轴的日期列按这些排。
   * 年份单独给，是因为一年只在轴线顶部出现一次，不做成每行都重复。
   */
  year: number
  month: number
  dayOfMonth: number
  weekday: string
  /** 组内已按时间升序 */
  photos: Photo[]
}

/**
 * 按天分组。
 *
 * dir = 'desc'（默认）：日期从新到旧，但**组内仍是时间升序** ——
 * 一天是一个可读的整体，在这一天里从上往下看是顺着过的；
 * 换到下一天才往回跳。想整条时间轴从故事开头读起就传 'asc'。
 */
export function groupByDay(photos: Photo[], dir: 'desc' | 'asc' = 'desc'): DayGroup[] {
  const buckets = new Map<string, Photo[]>()
  for (const photo of sortByTakenAt(photos)) {
    const key = dayKeyOf(photo.takenAt)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(photo)
    else buckets.set(key, [photo])
  }

  const groups: DayGroup[] = []
  for (const [key, list] of buckets) {
    const d = new Date(list[0].takenAt)
    /* 坏时间戳归到 0，界面上退回「日期不详」，别渲染成 NaN */
    const valid = !Number.isNaN(d.getTime())
    groups.push({
      key,
      year: valid ? d.getFullYear() : 0,
      month: valid ? d.getMonth() + 1 : 0,
      dayOfMonth: valid ? d.getDate() : 0,
      weekday: valid ? WEEKDAYS_SHORT[d.getDay()] ?? '' : '',
      photos: list,
    })
  }

  return dir === 'desc' ? groups.reverse() : groups
}

/** 组展平 = 屏幕上从上到下的顺序，沉浸视图的左右翻页直接用它 */
export function flattenGroups(groups: DayGroup[]): Photo[] {
  return groups.flatMap((g) => g.photos)
}

/**
 * 星标照片，按「被收藏的时间」升序。
 *
 * 注意排的是 featuredAt 而不是 takenAt：这描述的是你一张张攒下来的顺序，
 * 收藏顺序才是你挑它的顺序。画布时代的中心相册用的就是这条规则
 * （原 lib/layout.ts 的 albumOrder），画布下线时一起没了，这里补回来。
 *
 * 收藏时间缺失或坏掉的扔到最后，别让一条坏数据插到最前面。
 */
export function starredOrder(photos: Photo[]): Photo[] {
  const at = (p: Photo) => (p.featuredAt ? new Date(p.featuredAt).getTime() : NaN)
  return photos
    .filter((p) => Boolean(p.featuredAt))
    .sort((a, b) => {
      const ta = at(a)
      const tb = at(b)
      if (Number.isNaN(ta)) return 1
      if (Number.isNaN(tb)) return -1
      return ta - tb
    })
}
