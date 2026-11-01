import { TogetherTimer } from '../TogetherTimer'
import { isRemote } from '../../lib/repo'

/**
 * 首页只有计时器。
 *
 * 刻意不依赖 album 数据 —— 这决定了「Supabase 挂了 / 慢十秒」的时候，
 * 进来第一眼看到的仍然是那个在跳动的数字，而不是一张加载页。
 */
export function HomePage() {
  return (
    <div className="page page--home">
      <TogetherTimer />
      {!isRemote && (
        <p className="home-note" title="尚未配置 Supabase，数据只存在这台设备上">
          本地模式 · 数据只在这台设备上
        </p>
      )}
    </div>
  )
}
