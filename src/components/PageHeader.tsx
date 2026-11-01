import type { ReactNode } from 'react'

interface HeadProps {
  title: string
  sub?: string
  action?: ReactNode
  onHome: () => void
}

/**
 * 三个子页共用的页头。
 *
 * 标题 yyyyhhh 本身是个按钮 —— 视觉上是标题，交互上是回首页的门。
 * 底部只有三个按钮，没有第四个位置留给「首页」，入口就在这里。
 */
export function PageHeader({ title, sub, action, onHome }: HeadProps) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        <button type="button" className="page-head-brand" onClick={onHome} aria-label="回到首页">
          yyyhhh
        </button>
        <h1 className="page-head-title">
          {title}
          {sub && <span>{sub}</span>}
        </h1>
      </div>
      {action && <div className="page-head-actions">{action}</div>}
    </header>
  )
}
