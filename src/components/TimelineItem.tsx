import { memo, useRef } from 'react'
import { useImgUrl } from '../hooks/useImgUrl'
import type { Photo } from '../lib/types'
import { StarIcon } from './icons'

interface Props {
  photo: Photo
  messageCount: number
  /** 首屏那几张先下载，其余交给浏览器 */
  priority: 'high' | 'low' | 'auto'
  onOpen: (photo: Photo, rect: DOMRect | null) => void
}

/**
 * 时间轴上的一张照片。
 *
 * memo 是必要的：切主题、弹 toast 都会让上层重渲染，
 * 而这里每一次重渲染都要重新走一遍图片地址解析。onOpen 必须引用稳定，
 * 否则 memo 直接失效。
 */
export const TimelineItem = memo(function TimelineItem({
  photo,
  messageCount,
  priority,
  onOpen,
}: Props) {
  const url = useImgUrl(photo.storageKey, 'thumb')
  const frameRef = useRef<HTMLSpanElement>(null)

  return (
    <button
      type="button"
      className={`tl-item${photo.featuredAt ? ' is-featured' : ''}`}
      onClick={() => {
        /*
         * 把照片此刻在屏幕上的位置交出去，详情页据此从这里放大过去。
         * 量的是图框而不是整个按钮 —— 按钮还包着简介文字，框会大一圈。
         */
        onOpen(photo, frameRef.current?.getBoundingClientRect() ?? null)
      }}
      aria-label={photo.caption ?? '查看这张照片'}
    >
      <span className="tl-frame" ref={frameRef}>
        {url ? (
          <img
            src={url}
            alt={photo.caption ?? ''}
            /* 宽高属性给浏览器算比例：解码前就占好位，滚动位置才恢复得准 */
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
            fetchPriority={priority}
            draggable={false}
          />
        ) : (
          <span className="tl-blank" style={{ aspectRatio: photo.aspect || 1 }} />
        )}
        {photo.featuredAt && (
          <span className="tl-star" title="已收进精选">
            <StarIcon size={12} filled />
          </span>
        )}
      </span>

      {photo.caption && <span className="tl-cap">{photo.caption}</span>}

      {messageCount > 0 && (
        <span className="tl-badge">{messageCount > 99 ? '99+' : messageCount}</span>
      )}
    </button>
  )
})
