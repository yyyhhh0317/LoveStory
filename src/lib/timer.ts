/**
 * 在一起的起点。
 *
 * 必须用数字构造。`new Date('2025-03-17')` 会被当成 UTC 零点解析，
 * 在东八区算出来的每一天都会差 8 小时 —— 首页那个数字就会莫名其妙少一天。
 */
export const START_AT = new Date(2025, 2, 17, 0, 0, 0, 0)

export interface Elapsed {
  days: number
  hours: number
  minutes: number
  seconds: number
  /** 设备时钟走到起点之前（时钟错乱），界面显示 0 而不是负数 */
  pending: boolean
}

const ZERO: Elapsed = { days: 0, hours: 0, minutes: 0, seconds: 0, pending: false }

/**
 * 时长拆分，不是「日历日相减」。
 *
 * 中国没有夏令时，两者结果一致；但「在一起多久了」问的是经历了多长时间，
 * 时长拆分是唯一不会在某一天多出一小时或吞掉一小时的读法。
 *
 * 每次都从 Date.now() 重新算，不做 prev + 1000 的累加 ——
 * 标签页休眠回来、系统改时间之后，下一次 tick 会自己对齐。
 */
export function elapsedSince(start: Date, now: number): Elapsed {
  const ms = now - start.getTime()
  if (!Number.isFinite(ms)) return ZERO
  if (ms < 0) return { ...ZERO, pending: true }

  const s = Math.floor(ms / 1000)
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
    pending: false,
  }
}

/** 给读屏用的整句，分钟级变化，不做每秒播报 */
export function elapsedSentence(e: Elapsed): string {
  if (e.pending) return '这一天还没到'
  return `${e.days} 天 ${e.hours} 小时 ${e.minutes} 分钟`
}
