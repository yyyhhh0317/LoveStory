import type { Route } from '../hooks/useRoute'
import { ListIcon, MessageIcon, PhotoIcon } from './icons'

interface Props {
  active: Route
  onNavigate: (route: Route) => void
}

const ITEMS = [
  { route: 'board' as const, label: '留言板', Icon: MessageIcon },
  { route: 'album' as const, label: '相册', Icon: PhotoIcon },
  { route: 'plans' as const, label: '计划清单', Icon: ListIcon },
]

/**
 * 首页不在导航里：它是落地页，不是第四个标签。
 * 所以在首页时三个按钮全部不高亮 —— 视觉上就说明「你现在不在任何一页里」，
 * 回首页靠页头的品牌名（和浏览器返回键）。
 */
export function BottomNav({ active, onNavigate }: Props) {
  return (
    <nav className="nav" aria-label="主导航">
      {ITEMS.map(({ route, label, Icon }) => {
        const on = active === route
        return (
          <button
            key={route}
            type="button"
            className={`nav-item${on ? ' on' : ''}`}
            aria-current={on ? 'page' : undefined}
            // 再点一次当前这一项 = 回首页，这是移动端很自然的下意识动作
            onClick={() => onNavigate(on ? 'home' : route)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
