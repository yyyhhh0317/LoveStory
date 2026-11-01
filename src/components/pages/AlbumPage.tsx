import { useLayoutEffect, useMemo, useRef } from 'react'
import { TimelineItem } from '../TimelineItem'
import { ConnectFail, LoadingScreen } from '../ScreenStates'
import { groupByDay } from '../../lib/days'
import { BookIcon, CloseIcon, PlusIcon } from '../icons'
import type { AlbumPhase } from '../../hooks/useAlbum'
import type { FriendlyError } from '../../lib/errors'
import type { Throwback } from '../../lib/throwback'
import type { Photo } from '../../lib/types'

interface Props {
  photos: Photo[]
  counts: Record<string, number>
  phase: AlbumPhase
  error: FriendlyError | null
  refreshing: boolean
  onRetry: () => void
  onOpenPhoto: (photo: Photo, rect: DOMRect | null) => void
  onRequestUpload: () => void
  throwback: Throwback | null
  onOpenThrowback: () => void
  onDismissThrowback: () => void
}

/**
 * 切到别的标签再切回来时，滚到原来那一屏。
 *
 * 存在模块作用域而不是 ref：组件会随路由卸载，ref 跟着没了。
 * 只记一个页面，容量 1 就够。
 */
let lastScroll = 0

export function AlbumPage({
  photos,
  counts,
  phase,
  error,
  refreshing,
  onRetry,
  onOpenPhoto,
  onRequestUpload,
  throwback,
  onOpenThrowback,
  onDismissThrowback,
}: Props) {
  const groups = useMemo(() => groupByDay(photos, 'desc'), [photos])
  const scrollRef = useRef<HTMLDivElement>(null)

  /*
   * 用 layout effect 而不是 effect：必须在浏览器绘制之前把位置放好，
   * 否则会先闪一帧顶部再跳下去。
   * 照片的 width/height 都写在 img 上，解码前就占好位，所以这里量的高度是准的。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && lastScroll > 0) el.scrollTop = lastScroll
  }, [])

  return (
    <div
      className="page-scroll"
      ref={scrollRef}
      onScroll={() => {
        lastScroll = scrollRef.current?.scrollTop ?? 0
      }}
    >
      {phase === 'loading' && <LoadingScreen variant="page" label="正在翻开相册" />}

      {phase === 'error' && (
        <ConnectFail
          variant="page"
          error={error}
          retrying={refreshing}
          onRetry={onRetry}
        />
      )}

      {phase === 'ready' && (
        <div className="tl-list">
          {throwback && (
            <div className="tb-banner">
              <button type="button" className="tb-main" onClick={onOpenThrowback}>
                <BookIcon size={14} />
                <span className="tb-kicker">那年今日</span>
                <span className="tb-desc">
                  {throwback.label} · {throwback.photos.length} 张
                </span>
              </button>
              <button
                type="button"
                className="tb-close"
                onClick={onDismissThrowback}
                aria-label="今天不再提示"
                title="今天不再提示"
              >
                <CloseIcon size={12} />
              </button>
            </div>
          )}

          {photos.length === 0 ? (
            <div className="tl-empty">
              <p className="tl-empty-title">还什么都没有</p>
              <p className="tl-empty-body">
                第一张照片放上来，这里就开始了。
                <br />
                时间会自己往下排。
              </p>
              <button type="button" className="solid-btn" onClick={onRequestUpload}>
                <PlusIcon size={15} />
                放第一张
              </button>
            </div>
          ) : (
            groups.map((group, gi) => (
              <section key={group.key} className="tl-day">
                <h2 className="tl-day-head">
                  <span className="tl-dot" aria-hidden="true" />
                  <span className="tl-day-label">{group.label}</span>
                  <span className="tl-day-count">{group.photos.length} 张</span>
                </h2>
                {group.photos.map((photo, pi) => (
                  <TimelineItem
                    key={photo.id}
                    photo={photo}
                    messageCount={counts[photo.id] ?? 0}
                    /*
                     * 最先能看到的这三张先下：不这么做的话，
                     * 第一屏永远是空框，等懒加载排到它们时人已经滚过去了。
                     */
                    priority={gi === 0 && pi < 3 ? 'high' : 'auto'}
                    onOpen={onOpenPhoto}
                  />
                ))}
              </section>
            ))
          )}
        </div>
      )}
    </div>
  )
}
