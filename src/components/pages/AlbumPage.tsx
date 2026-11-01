import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TimelineItem } from '../TimelineItem'
import { ConnectFail, LoadingScreen } from '../ScreenStates'
import { BookIcon, CloseIcon, HeartIcon, PlusIcon, StarIcon } from '../icons'
import type { AlbumPhase } from '../../hooks/useAlbum'
import { starredOrder, type DayGroup } from '../../lib/days'
import type { FriendlyError } from '../../lib/errors'
import type { Throwback } from '../../lib/throwback'
import type { Photo } from '../../lib/types'

interface Props {
  photos: Photo[]
  /** 由 App 传下来：同一份 photos 只分一次组，页面和沉浸视图共用结果 */
  groups: DayGroup[]
  counts: Record<string, number>
  phase: AlbumPhase
  error: FriendlyError | null
  refreshing: boolean
  onRetry: () => void
  /** from 决定详情页在哪一串照片里翻页：从星标点开就只在星标里翻 */
  onOpenPhoto: (photo: Photo, rect: DOMRect | null, from?: 'timeline' | 'starred') => void
  onRequestUpload: () => void
  throwback: Throwback | null
  onOpenThrowback: () => void
  onDismissThrowback: () => void
}

/** 相册的两种看法：按时间摊开，或者只看自己挑出来的 */
type View = 'timeline' | 'starred'

/**
 * 切到别的标签再切回来时，滚到原来那一屏。
 *
 * 存在模块作用域而不是 ref：组件会随路由卸载，ref 跟着没了。
 * 只记一个页面，容量 1 就够。
 */
let lastScroll = 0

export function AlbumPage({
  photos,
  groups,
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>('timeline')

  /*
   * 星标视图的数据源。
   *
   * 按收藏时间升序，和拍摄时间无关 —— 这描述的是"你一张张攒下来的顺序"，
   * 画布时代中心相册用的就是这条规则（原 lib/layout.ts 的 albumOrder）。
   * 别改成按拍摄时间：收藏顺序才是你挑它的顺序。
   */
  const starred = useMemo(() => starredOrder(photos), [photos])

  /*
   * 星标视图的打开回调要单独稳定一份：写成内联箭头函数的话，
   * 每次重渲染都是新函数，TimelineItem 的 memo 直接失效。
   */
  const openStarred = useCallback(
    (photo: Photo, rect: DOMRect | null) => onOpenPhoto(photo, rect, 'starred'),
    [onOpenPhoto]
  )

  /*
   * 用 layout effect 而不是 effect：必须在浏览器绘制之前把位置放好，
   * 否则会先闪一帧顶部再跳下去。
   * 照片的 width/height 都写在 img 上，解码前就占好位，所以这里量的高度是准的。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && lastScroll > 0) el.scrollTop = lastScroll
  }, [])

  /*
   * 换视图要回到顶部：两个视图高度差很多，留在原位只会落在半截。
   * lastScroll 也要一起清 —— 它会在 onScroll 里被重新写，但不切视图就跳回来时
   * 不该沿用上一个视图的位置。
   */
  const switchView = (next: View) => {
    if (next === view) return
    setView(next)
    lastScroll = 0
    scrollRef.current?.scrollTo({ top: 0 })
  }

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

          {/* 一张照片都没有的时候没什么可切，切换条不出现 */}
          {photos.length > 0 && (
            <div className="tl-switch" role="group" aria-label="相册视图">
              <button
                type="button"
                className="tl-switch-btn"
                aria-pressed={view === 'timeline'}
                onClick={() => switchView('timeline')}
              >
                全部
                <span className="tl-switch-n" aria-hidden="true">
                  {photos.length}
                </span>
              </button>
              <button
                type="button"
                className="tl-switch-btn"
                aria-pressed={view === 'starred'}
                onClick={() => switchView('starred')}
              >
                <StarIcon size={12} filled={view === 'starred'} />
                星标
                <span className="tl-switch-n" aria-hidden="true">
                  {starred.length}
                </span>
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
                加入相册
              </button>
            </div>
          ) : view === 'starred' ? (
            starred.length === 0 ? (
              <div className="tl-empty">
                <p className="tl-empty-title">还没有星标</p>
                <p className="tl-empty-body">
                  点开一张照片，按下那颗星星，
                  <br />
                  就会收在这里。
                </p>
              </div>
            ) : (
              /*
               * 星标视图不走中轴：这里是"挑出来的那些"，
               * 一格格铺开比串在时间线上更像一本集子。
               */
              <div className="tl-grid">
                {starred.map((photo, i) => (
                  <TimelineItem
                    key={photo.id}
                    photo={photo}
                    messageCount={counts[photo.id] ?? 0}
                    priority={i < 3 ? 'high' : 'auto'}
                    onOpen={openStarred}
                  />
                ))}
              </div>
            )
          ) : (
            /*
             * 中轴 + 一左一右交替：第 1、3、5 天（索引 0/2/4）日期在左、照片在右，
             * 下一天反过来。只换 grid-column，DOM 顺序始终是「日期 / 节点 / 照片」，
             * 读屏念出来才是通顺的一句话。
             */
            <div className="tl-timeline">
              {groups.map((group, gi) => {
                const photosRight = gi % 2 === 0

                return (
                  <section
                    key={group.key}
                    className={`tl-day${photosRight ? '' : ' tl-day--flip'}`}
                  >
                    <div className="tl-date">
                      {group.month > 0 ? (
                        <>
                          {/* 年份每天都写：横跨两年，光靠换年的分隔处会数不清 */}
                          <span className="tl-date-main">
                            {group.year} 年 {group.month} 月 {group.dayOfMonth} 日
                          </span>
                          <span className="tl-date-meta">
                            {group.photos.length > 1
                              ? `${group.weekday} · ${group.photos.length} 张`
                              : group.weekday}
                          </span>
                        </>
                      ) : (
                        <span className="tl-date-main">日期不详</span>
                      )}
                    </div>

                    <div className="tl-axis" aria-hidden="true">
                      <span className="tl-node">
                        <HeartIcon size={14} filled />
                      </span>
                    </div>

                    <div className="tl-photos">
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
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
