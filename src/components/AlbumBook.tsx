import { useEffect, useRef, useState } from 'react'
import { useImgUrl } from '../hooks/useImgUrl'
import type { Photo } from '../lib/types'

interface Props {
  cover: Photo | null
  count: number
  onOpen: () => void
}

/** 封面掀开的时长，和 CSS 里的 transition 对齐 */
const OPEN_MS = 500

export function AlbumBook({ cover, count, onOpen }: Props) {
  const url = useImgUrl(cover?.storageKey ?? null, 'thumb')
  const [opening, setOpening] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const list = timers.current
    return () => {
      list.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  /*
   * 掀开封面，再进沉浸视图。
   *
   * 顺序很重要：先把封面转开，等它转到一半（430ms）再挂上沉浸视图，
   * 那里的淡入正好接在后面，看起来就是「书被翻开、光透进来」。
   *
   * 空相册不演这段 —— 那时 onOpen 只会弹一句「相册还空着」，
   * 书白翻一次会让人以为点开了什么。
   *
   * 1500ms 后复位：这时沉浸视图已经完全不透明地盖在上面，
   * 复位是看不见的；等你退出来，书已经合好了。
   */
  const open = () => {
    if (opening) return
    if (count === 0) {
      onOpen()
      return
    }
    setOpening(true)
    timers.current.push(window.setTimeout(onOpen, OPEN_MS))
    timers.current.push(window.setTimeout(() => setOpening(false), 1500))
  }

  return (
    <div
      className={`album${opening ? ' is-opening' : ''}`}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
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
