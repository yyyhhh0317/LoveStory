import type { FriendlyError } from '../lib/errors'

/**
 * 「加载中」与「连接失败」两个状态。
 *
 * 存在的唯一目的：让「读不到」在视觉上和「真的没有」彻底分开。
 * 空态是页面自己的事（"还什么都没有"），这里绝不能出现任何与「空」有关的措辞。
 *
 * variant='page'：贴进 .page-scroll 里当内容，不再 fixed 盖住整屏 ——
 * 一页读不出来时，页头和底部导航还得能用。
 */

interface LoadingProps {
  label?: string
  variant?: 'page'
}

export function LoadingScreen({ label = '正在打开', variant }: LoadingProps) {
  return (
    <div
      className={`status-screen${variant === 'page' ? ' is-page' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="status-loading">
        <span className="status-line" />
        <p>{label}</p>
      </div>
    </div>
  )
}

interface FailProps {
  error: FriendlyError | null
  retrying: boolean
  onRetry: () => void
  variant?: 'page'
}

export function ConnectFail({ error, retrying, onRetry, variant }: FailProps) {
  return (
    <div
      className={`status-screen${variant === 'page' ? ' is-page' : ''}`}
      role="alert"
    >
      <div className="status-card">
        <div className="status-badge">
          <span className="status-dot" />
          没连上
        </div>

        <h2>相册暂时没打开</h2>

        <p>
          照片都还在，只是这会儿读不到。
          <br />
          可能是网络走神，也可能是太久没来、它打了个盹。
        </p>

        <button
          type="button"
          className="solid-btn status-retry"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? '正在连接…' : '再试一次'}
        </button>

        {error?.reason && <p className="status-reason">{error.reason}</p>}
        {error?.hint && <p className="status-hint">{error.hint}</p>}

        {error?.detail && (
          <details className="status-detail">
            <summary>看看原因</summary>
            <code>{error.detail}</code>
          </details>
        )}
      </div>
    </div>
  )
}
