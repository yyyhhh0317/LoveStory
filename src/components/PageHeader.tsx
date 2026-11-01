import type { ReactNode } from 'react'

export type Theme = 'cream' | 'blush'

interface Props {
  theme: Theme
  onTheme: (theme: Theme) => void
  className?: string
}

/**
 * 两段式胶囊，不是单按钮 toggle —— 现在在哪个主题里是看得见的。
 * 搬出来是因为首页右上角和三个子页的页头都要用同一个。
 */
export function ThemeSwitch({ theme, onTheme, className }: Props) {
  return (
    <div
      className={`theme-switch${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="切换主题"
    >
      <button
        type="button"
        className={theme === 'blush' ? 'on' : ''}
        onClick={() => onTheme('blush')}
      >
        莓奶
      </button>
      <button
        type="button"
        className={theme === 'cream' ? 'on' : ''}
        onClick={() => onTheme('cream')}
      >
        奶油
      </button>
    </div>
  )
}

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
