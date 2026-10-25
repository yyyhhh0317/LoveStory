import { useImgUrl } from '../hooks/useImgUrl'
import type { Photo } from '../lib/types'

interface Props {
  cover: Photo | null
  count: number
  onOpen: () => void
}

export function AlbumBook({ cover, count, onOpen }: Props) {
  const url = useImgUrl(cover?.storageKey ?? null, 'thumb')

  return (
    <div
      className="album"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      }}
      aria-label={`打开珍藏相册，共 ${count} 张`}
    >
      <div className="album-pages" />
      <div className="album-cover">
        <div className="album-label">
          <h2>珍藏</h2>
          <span>{count > 0 ? `${count} FRAMES` : 'EMPTY'}</span>
        </div>
        <div className="album-photo">
          {url ? (
            <img src={url} alt="相册封面" draggable={false} />
          ) : (
            <div className="placeholder">还空着</div>
          )}
        </div>
      </div>
    </div>
  )
}
