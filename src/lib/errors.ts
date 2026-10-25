/**
 * 把原始错误翻成人话。
 *
 * 相册读不到的原因就那么几种，直接抛 `Failed to fetch` 给用户看没有意义，
 * 但排查时又需要原文——所以分成「一句话原因」+「原始信息」两部分。
 */
export interface FriendlyError {
  /** 显示在界面上的简短原因 */
  reason: string
  /** 折叠在「看看原因」里的原文 */
  detail: string
  /** 针对性的下一步提示，没有就是 null */
  hint: string | null
}

const PAUSED_HINT =
  '如果有一阵子没打开过，可以去 Supabase 面板点一下 Restore 把它唤醒，照片不会丢。'

export function describeError(err: unknown): FriendlyError {
  const detail = err instanceof Error ? err.message : String(err ?? '未知错误')
  const m = detail.toLowerCase()

  if (m.includes('timeout') || m.includes('timed out')) {
    return { reason: '等了太久，一直没有回应', detail, hint: PAUSED_HINT }
  }

  if (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('load failed') ||
    m.includes('offline')
  ) {
    return { reason: '网络好像没接上', detail, hint: PAUSED_HINT }
  }

  if (m.includes('paused') || m.includes('project is paused')) {
    return { reason: '项目被暂停了', detail, hint: PAUSED_HINT }
  }

  if (
    m.includes('permission') ||
    m.includes('row-level') ||
    m.includes('jwt') ||
    /\b(401|403)\b/.test(detail)
  ) {
    return {
      reason: '后台权限被改过了',
      detail,
      hint: '检查一下 Supabase 的 API key 是否还在、RLS 策略有没有被改动。',
    }
  }

  if (
    /\b5\d\d\b/.test(detail) ||
    /unavailable|bad gateway|gateway timeout|internal server|service error/i.test(detail)
  ) {
    return { reason: '服务器在打盹', detail, hint: PAUSED_HINT }
  }

  // 兜底也给暂停提示：这个项目最常见的原因就是免费版闲置被暂停
  return { reason: '这次没读出来', detail, hint: PAUSED_HINT }
}
