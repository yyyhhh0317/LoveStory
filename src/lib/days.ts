import { formatDayCn, pad } from './format'
import type { Photo } from './types'

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 本地时区的 YYYY-MM-DD。不转 UTC —— 全站对日期一律按本地日界理解 */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function weekdayCn(d: Date): string {
  return WEEKDAYS[d.getDay()] ?? ''
}

/** 按拍摄时间升序。原 layout.timelineOrder，画布拆掉后搬到这儿 */
export function sortByTakenAt(photos: Photo[]): Photo[] {
  return [...photos].sort(
    (a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()
  )
}

export interface DayGroup {
  /** YYYY-MM-DD，用作 React key */
  key: string
  /** 「2026 年 11 月 1 日 · 星期日」 */
  label: string
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
    const day = formatDayCn(list[0].takenAt)
    groups.push({
      key,
      label: day ? `${day} · ${weekdayCn(d)}` : '日期不详',
      photos: list,
    })
  }

  return dir === 'desc' ? groups.reverse() : groups
}

/** 组展平 = 屏幕上从上到下的顺序，沉浸视图的左右翻页直接用它 */
export function flattenGroups(groups: DayGroup[]): Photo[] {
  return groups.flatMap((g) => g.photos)
}
