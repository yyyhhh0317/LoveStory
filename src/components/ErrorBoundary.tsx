import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 渲染错误兜底。
 *
 * React 的错误边界必须是 class —— 没有 hooks 版本，这是它唯一的硬约束。
 *
 * 分三处挂载，粒度不同，出事的后果也不同：
 *   page   —— 兜住整个 App，最后一道防线
 *   canvas —— 兜住画布。照片数据在 App 里，画布炸了顶栏和上传仍然可用
 *   viewer —— 兜住沉浸视图。一张照片打不开不该把人赶回白屏
 *
 * 文案刻意不提「错误」「异常」「崩溃」，只说「没画出来」。
 * 因为使用者关心的不是出了什么错，而是「我的照片还在不在」。
 */

type Scope = 'page' | 'canvas' | 'viewer'

interface Props {
  children: ReactNode
  scope?: Scope
  /** 交给外部处理的复位动作，例如关掉出错的详情页 */
  onReset?: () => void
  /** 变化时自动清除错误状态（例如换了一张照片就再给一次机会） */
  resetKey?: unknown
}

interface State {
  error: Error | null
  info: ErrorInfo | null
  /** 已经点过几次「再试一次」。连续失败两次就只劝刷新 */
  attempts: number
}

/** 打包产物换版本后，旧页面去取已经删掉的分块文件，会报这一类错 */
function isStaleBundle(message: string): boolean {
  return /dynamically imported module|Importing a module script failed|Loading chunk|MIME type of "text\/html"/i.test(
    message
  )
}

const COPY: Record<Scope, { badge: string; title: string; body: ReactNode }> = {
  page: {
    badge: '没画出来',
    title: '这一页刚才绊了一下',
    body: (
      <>
        照片都还在，也一张都没丢。
        <br />
        只是这一页自己没画出来 —— 刷新一下通常就好。
      </>
    ),
  },
  canvas: {
    badge: '画布没画出来',
    title: '这一圈没摆好',
    body: (
      <>
        照片还在，只是画布这次没排好。
        <br />
        可以让它重摆一次；上面那排按钮也都还能用。
      </>
    ),
  },
  viewer: {
    badge: '没打开',
    title: '这一张没能打开',
    body: (
      <>
        别的照片都还在。
        <br />
        关掉这一页，回画布上再挑一张就好。
      </>
    ),
  },
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, attempts: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, info: null, attempts: 0 })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info })
    // 留一条完整日志给排查。生产环境没有 reactor 面板，只能靠控制台。
    console.error(`[渲染失败:${this.props.scope ?? 'page'}]`, error, info.componentStack)
  }

  private retry = () => {
    this.setState((s) => ({ error: null, info: null, attempts: s.attempts + 1 }))
    this.props.onReset?.()
  }

  private reload = () => {
    window.location.reload()
  }

  render() {
    const { error, info, attempts } = this.state
    if (!error) return this.props.children

    const scope = this.props.scope ?? 'page'
    const stale = isStaleBundle(error.message ?? '')
    const copy = stale
      ? {
          badge: '版本变了',
          title: '新版本刚上线',
          body: (
            <>
              页面还是旧的，文件已经换过了。
              <br />
              刷新一下就能接上，照片不受影响。
            </>
          ),
        }
      : COPY[scope]

    // 连续两次重试都没救回来，就不再劝「再试一次」，直接给刷新
    const showRetry = !stale && attempts < 2
    // 已经有一枚主按钮时，刷新降成次级，避免两个实心按钮抢注意力
    const hasPrimary = scope === 'viewer' || showRetry

    return (
      <div
        className={`status-screen${scope === 'viewer' ? ' is-overlay' : ''}${
          scope === 'canvas' ? ' is-inline' : ''
        }`}
        role="alert"
      >
        <div className="status-card">
          <div className="status-badge">
            <span className="status-dot" />
            {copy.badge}
          </div>

          <h2>{copy.title}</h2>
          <p>{copy.body}</p>

          <div className="status-actions">
            {scope === 'viewer' && (
              <button type="button" className="solid-btn status-retry" onClick={this.retry}>
                关掉这一页
              </button>
            )}

            {scope !== 'viewer' && showRetry && (
              <button type="button" className="solid-btn status-retry" onClick={this.retry}>
                再试一次
              </button>
            )}

            <button
              type="button"
              className={hasPrimary ? 'ghost-btn' : 'solid-btn status-retry'}
              onClick={this.reload}
            >
              刷新页面
            </button>
          </div>

          <details className="status-detail">
            <summary>看看原因</summary>
            <code>
              {error.name}: {error.message}
              {info?.componentStack ? `\n${info.componentStack.trim()}` : ''}
            </code>
          </details>
        </div>
      </div>
    )
  }
}
