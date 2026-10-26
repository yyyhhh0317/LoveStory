import { memo, useRef, useState } from 'react'
import { useImgUrl } from '../hooks/useImgUrl'
import type { Placed } from '../lib/layout'
import type { Photo } from '../lib/types'

interface Props {
  placed: Placed
  messageCount: number
  animate: boolean
  /** 画布放大到一定程度时换成 1800 大图，否则 560 缩略图会被拉伸变糊 */
  hiRes: boolean
  /** 在视口正中就 high，落在留边那一圈就 low —— 让先看到的那几张先下载 */
  priority: 'high' | 'low' | 'auto'
  onOpen: (photo: Photo, rect: DOMRect | null) => void
  onDragGuard: () => boolean
}

/**
 * memo 是必要的：平移画布时 CanvasWall 会重渲染，
 * 卡片位置写在 style 里、由父级 transform 带着走，不需要跟着重渲染。
 * onOpen / onDragGuard 必须保持引用稳定，否则 memo 失效。
 */
export const PhotoCard = memo(function PhotoCard({
  placed,
  messageCount,
  animate,
  hiRes,
  priority,
  onOpen,
  onDragGuard,
}: Props) {
  const { photo, x, y, w, h, tilt, delay } = placed
  const url = useImgUrl(photo.storageKey, hiRes ? 'full' : 'thumb')
  const imgRef = useRef<HTMLImageElement>(null)
  const boxRef = useRef<HTMLButtonElement>(null)
  /*
   * 入场动画只在**挂载那一刻**决定播不播。
   * 之前是跟着 settled 走：手指一碰画布 settled 变 true，正播到一半的卡片
   * 会瞬间从 opacity:0 跳到 1 —— 那是一排照片同时「啪」地出现。
   */
  const [enter] = useState(animate)

  return (
    <button
      type="button"
      ref={boxRef}
      className={`photo-card${photo.featuredAt ? ' is-featured' : ''}${enter ? '' : ' no-anim'}`}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        ['--tilt' as string]: `${tilt}deg`,
        animationDelay: `${delay}ms`,
      }}
      onClick={() => {
        if (onDragGuard()) return
        /*
         * 把缩略图此刻在屏幕上的位置交出去，详情页据此从这儿放大过去。
         * 优先量 img：卡片本身带 6px 相纸边，用卡片的框会大一圈。
         * 图还没加载出来时退回卡片框，飞起来也不至于从 0 尺寸开始。
         */
        const el = imgRef.current ?? boxRef.current
        onOpen(photo, el?.getBoundingClientRect() ?? null)
      }}
      aria-label={photo.caption ?? '查看这张照片'}
    >
      <span className="photo-crop">
        {url ? (
          <img
            ref={imgRef}
            src={url}
            alt={photo.caption ?? ''}
            draggable={false}
            decoding="async"
            fetchPriority={priority}
          />
        ) : (
          <span className="photo-blank" />
        )}
      </span>
      {messageCount > 0 && (
        <span className="badge">{messageCount > 99 ? '99+' : messageCount}</span>
      )}
    </button>
  )
})
