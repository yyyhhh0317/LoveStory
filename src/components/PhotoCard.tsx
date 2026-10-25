import { memo } from 'react'
import { useImgUrl } from '../hooks/useImgUrl'
import type { Placed } from '../lib/layout'
import type { Photo } from '../lib/types'

interface Props {
  placed: Placed
  messageCount: number
  animate: boolean
  /** 画布放大到一定程度时换成 2048 大图，否则 720 缩略图会被拉伸变糊 */
  hiRes: boolean
  onOpen: (photo: Photo) => void
  onDragGuard: () => boolean
}

/**
 * memo 是必要的：平移画布时 CanvasWall 每帧都会重渲染，
 * 卡片位置写在 style 里、由父级 transform 带着走，不需要跟着重渲染。
 * onOpen / onDragGuard 必须保持引用稳定，否则 memo 失效。
 */
export const PhotoCard = memo(function PhotoCard({
  placed,
  messageCount,
  animate,
  hiRes,
  onOpen,
  onDragGuard,
}: Props) {
  const { photo, x, y, w, h, tilt, delay } = placed
  const url = useImgUrl(photo.storageKey, hiRes ? 'full' : 'thumb')

  return (
    <button
      type="button"
      className={`photo-card${photo.featuredAt ? ' is-featured' : ''}${animate ? '' : ' no-anim'}`}
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
        onOpen(photo)
      }}
      aria-label={photo.caption ?? '查看这张照片'}
    >
      <span className="photo-crop">
        {url ? (
          <img
            src={url}
            alt={photo.caption ?? ''}
            draggable={false}
            decoding="async"
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
