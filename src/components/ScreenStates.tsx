import type { FriendlyError } from '../lib/errors'

/**
 * 「加载中」与「连接失败」两个整屏状态。
 *
 * 存在的唯一目的：让「读不到」在视觉上和「真的没有照片」彻底分开。
 * 后者用的是画布自己的空态（中间那本相册 + 「还什么都没有」），
 * 这里绝不能出现任何与「空」有关的措辞。
 */

export function LoadingScreen() {
  return (
    <div className="status-screen" role="status" aria-live="polite">
      <div className="status-loading">
        <span className="status-line" />
        <p>正在翻开相册</p>
      </div>
    </div>
  )
}

interface FailProps {
  error: FriendlyError | null
  retrying: boolean
  onRetry: () => void
}

export function ConnectFail({ error, retrying, onRetry }: FailProps) {
  return (
    <div className="status-screen" role="alert">
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
          {retrying ? '正在连…' : '再试一次'}
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
