import { useEffect, useRef, useState } from 'react'
import { useImgUrl } from '../hooks/useImgUrl'
import type { Photo } from '../lib/types'

interface Props {
  /** 封面下面那一页放的照片：相册第一张 */
  page: Photo | null
  count: number
  onOpen: (photoId: string | null, rect: DOMRect | null) => void
}

/** 封面转开的时长，和 CSS 里的 transition 对齐 */
const SWING_MS = 330
/**
 * 转开之后几乎不停，就让照片接手。
 *
 * 原来是 140ms —— 那一段停顿读起来像「翻完了，等一下，再去放大」，
 * 中间有一拍空档，所以整体感觉是一顿一顿的。
 * 现在只留 60ms：眼睛刚认出「露出了一页」，放大已经接上，两段连着走。
 */
const HOLD_MS = 60
/** 合回去的时机：这时沉浸视图已经完全不透明地盖住上面了，复位看不见 */
const RESET_MS = 1800

const HEART =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 ' +
  '19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'

export function AlbumBook({ page, count, onOpen }: Props) {
  const url = useImgUrl(page?.storageKey ?? null, 'thumb')
  const [opening, setOpening] = useState(false)
  const pageRef = useRef<HTMLImageElement>(null)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const list = timers.current
    return () => {
      list.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  /*
   * 掀开 → 露一页 → 那张照片飞出去。
   * 三步仍然是分开的（合成一个动作就成了「照片凭空变大」，翻书白做），
   * 但间隔压到最小，让三段在感觉上连成一段。
   *
   * 位置在第 2 步结束时才量：封面一转开，整本书会因为 translateY 挪几像素，
   * 提前量会差一点。
   *
   * 空相册不演这段 —— 那时 onOpen 只会弹一句「相册还空着」。
   */
  const open = () => {
    if (opening) return
    if (count === 0 || !page) {
      onOpen(null, null)
      return
    }
    setOpening(true)
    timers.current.push(
      window.setTimeout(() => {
        const rect = pageRef.current?.getBoundingClientRect() ?? null
        onOpen(page.id, rect)
      }, SWING_MS + HOLD_MS)
    )
    timers.current.push(window.setTimeout(() => setOpening(false), RESET_MS))
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
      {/* 封面下面那一页：一直渲染着（否则量不到位置），平时被封面盖住 */}
      <div className="album-pages">
        <div className="album-page">
          {url ? (
            <img
              ref={pageRef}
              className="album-page-photo"
              src={url}
              alt=""
              draggable={false}
            />
          ) : (
            <span className="album-page-empty">还空着</span>
          )}
        </div>
      </div>

      {/*
        封面是一块纸板，不是一张纸：
          - 正反两面在 Z 轴各偏移半厚，中间由左右两条侧壁连起来
          - 侧壁就是「厚度」，转到 90° 时看到的是它，而不是凭空消失
          - 纸纹、书脊凹槽、顶部受光都是静态层，只光栅一次
      */}
      <div className="album-cover">
        <div className="album-face album-face-front">
          <span className="album-grain" aria-hidden="true" />
          <span className="album-hinge" aria-hidden="true" />

          <svg className="album-doodles" viewBox="0 0 318 424" aria-hidden="true">
            <g fill="currentColor">
              <g transform="translate(30 46) scale(0.95) rotate(-12)">
                <path d={HEART} />
              </g>
              <g transform="translate(252 76) scale(0.7) rotate(14)">
                <path d={HEART} />
              </g>
              <g transform="translate(24 366) scale(0.62) rotate(8)">
                <path d={HEART} />
              </g>
              <g transform="translate(258 350) scale(0.82) rotate(-10)">
                <path d={HEART} />
              </g>
              <g transform="translate(140 68) scale(0.42) rotate(4)">
                <path d={HEART} />
              </g>
            </g>
            <g
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.66"
            >
              <path d="M62 396q16-11 32 0t32 0t32 0t32 0t32 0" />
              <path d="M246 150v14M239 157h14" />
              <path d="M70 258v11M64.5 263.5h11" />
            </g>
          </svg>

          <span className="album-tape" aria-hidden="true" />

          <div className="album-mark">
            <svg className="album-heart" viewBox="0 0 24 24" aria-hidden="true">
              <path d={HEART} fill="currentColor" />
            </svg>
            <h2>珍藏</h2>
            <span className="album-count">
              {count > 0 ? `${count} FRAMES` : 'EMPTY'}
            </span>
          </div>

          <span className="album-sheen" aria-hidden="true" />
        </div>

        <div className="album-face album-face-back" aria-hidden="true">
          <span className="album-grain" aria-hidden="true" />
          <span className="album-hinge" aria-hidden="true" />
          <span className="album-lining" aria-hidden="true" />
        </div>

        {/* 两条侧壁：纸板的厚度，转到侧面时看到的就是它们 */}
        <span className="album-edge album-edge-right" aria-hidden="true" />
        <span className="album-edge album-edge-left" aria-hidden="true" />
      </div>
    </div>
  )
}
