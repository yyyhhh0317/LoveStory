import { useImgUrl } from '../hooks/useImgUrl'
import type { Placed } from '../lib/layout'

interface Props {
  placed: Placed
  messageCount: number
  animate: boolean
  onOpen: () => void
  onDragGuard: () => boolean
}

export function PhotoCard({ placed, messageCount, animate, onOpen, onDragGuard }: Props) {
  const { photo, x, y, w, h, tilt, delay } = placed
  const url = useImgUrl(photo.storageKey, 'thumb')

  return (
    <button
      type="button"
      className={`photo-card${photo.featuredAt ? ' is-featured' : ''}`}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        padding: 6,
        ['--tilt' as string]: `${tilt}deg`,
        animation: animate ? undefined : 'none',
        opacity: animate ? undefined : 1,
        animationDelay: `${delay}ms`,
      }}
      onClick={() => {
        if (onDragGuard()) return
        onOpen()
      }}
      aria-label={photo.caption ?? '查看这张照片'}
    >
      {url ? (
        <img src={url} alt={photo.caption ?? ''} draggable={false} decoding="async" />
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'var(--surface-2)' }} />
      )}
      {messageCount > 0 && <span className="badge">{messageCount > 99 ? '99+' : messageCount}</span>}
    </button>
  )
}
