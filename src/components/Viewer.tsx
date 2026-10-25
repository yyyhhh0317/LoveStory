import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { useImgUrl } from '../hooks/useImgUrl'
import { formatDayCn } from '../lib/format'
import type { Photo } from '../lib/types'
import { FLIGHT_MS, prefersReducedMotion, type FrameRect } from '../lib/flight'
import { FlightPhoto } from './FlightPhoto'
import { MessageBoard } from './MessageBoard'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  MessageIcon,
  StarIcon,
  TrashIcon,
} from './icons'

interface Props {
  photos: Photo[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  onToggleFeatured: (photo: Photo) => void
  onSaveCaption: (photo: Photo, caption: string | null) => Promise<boolean>
  onDelete: (photo: Photo) => void
  messageCount: number
  onMessageCountChange: (delta: number) => void
  /** 相册模式才翻书：新照片从侧面带着倾角翻进来，时间线浏览仍用原来的淡入 */
  flip?: boolean
  /** 点开时那张缩略图在屏幕上的位置：有就从这里放大过来，没有就直接淡入 */
  origin?: FrameRect | null
}

export function Viewer({
  photos,
  index,
  onIndexChange,
  onClose,
  onToggleFeatured,
  onSaveCaption,
  onDelete,
  messageCount,
  onMessageCountChange,
  flip = false,
  origin = null,
}: Props) {
  const photo = photos[index]
  const fullUrl = useImgUrl(photo?.storageKey ?? null, 'full')
  const thumbUrl = useImgUrl(photo?.storageKey ?? null, 'thumb')

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [annotOpen, setAnnotOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [ambLum, setAmbLum] = useState<number | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const firstPhotoId = useRef(photo?.id)
  /* 有起点就飞一次；第一次进来时先别让 img 自己淡入，会和飞行层叠在一起 */
  const [flew] = useState(Boolean(origin) && !prefersReducedMotion())
  const [flight, setFlight] = useState<{ from: FrameRect; to: FrameRect; src: string } | null>(null)
  const [landed, setLanded] = useState(!flew)
  /*
   * 翻书方向。
   *
   * 不能用「index >= 上一次渲染的 index」这种每次渲染都重算的写法：
   * 换照片时组件会因为别的原因（读亮度、取图片地址）再渲染一次，
   * 那时 index 已经等于 prevIndex，方向会翻回 +1 —— 往前翻页的新一页
   * 就会从右边飞进来。
   *
   * 改成只在 index 真的变化时算一次，并且存住。0 表示刚打开、
   * 还没翻过：这时不播翻页动画，第一页是由封面掀开露出来的，不该再飞一次。
   */
  const lastIndex = useRef(index)
  const turnRef = useRef(0)
  if (index !== lastIndex.current) {
    turnRef.current = index > lastIndex.current ? 1 : -1
    lastIndex.current = index
  }
  const turn = turnRef.current
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setEditing(false)
    setConfirmDelete(false)
    setAnnotOpen(false)
  }, [photo?.id])

  useEffect(() => {
    if (editing) textRef.current?.focus()
  }, [editing])

  /*
   * 读一下这张照片的平均亮度，用来给氛围层定亮度。
   * 不分照片一律提亮的话：白墙/雪景会把背景冲成浅灰，深色夜景又黑得发闷。
   * 缩略图走 Supabase 公开桶，带 Access-Control-Allow-Origin: *，可以安全读像素。
   */
  useEffect(() => {
    setAmbLum(null)
    if (!thumbUrl) return
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, 8, 8)
        const data = ctx.getImageData(0, 0, 8, 8).data
        let sum = 0
        let count = 0
        for (let i = 0; i < data.length; i += 4) {
          sum +=
            (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
          count++
        }
        if (alive && count > 0) setAmbLum(sum / count)
      } catch {
        /* 画布被污染就退回默认亮度 */
      }
    }
    img.src = thumbUrl
    return () => {
      alive = false
    }
  }, [thumbUrl])

  /*
   * 起飞：把终点交给飞行层。
   *
   * 终点不量真实的 img —— 大图可能还没解码完，量出来是 0 宽。
   * 用 .viewer-frame 的框 + 照片宽高比按 contain 反推，和 CSS 那边
   * （max-width/max-height + flex 居中）算出来是同一个矩形。
   *
   * 只在挂载时跑一次：飞行途中翻到下一张不该重新起飞。
   */
  useLayoutEffect(() => {
    const el = frameRef.current
    if (!flew || !origin || !el || !photo) return
    const box = el.getBoundingClientRect()
    const ar = photo.aspect > 0 ? photo.aspect : photo.width / photo.height || 4 / 3
    let w = box.width
    let h = w / ar
    if (h > box.height) {
      h = box.height
      w = h * ar
    }
    const to: FrameRect = {
      x: box.x + (box.width - w) / 2,
      y: box.y + (box.height - h) / 2,
      w,
      h,
    }
    // 缩略图一定在缓存里（刚刚还在画布/内页上显示着），用它起飞不会空一帧
    const src = thumbUrl ?? fullUrl
    if (!src) {
      setLanded(true)
      return
    }
    setFlight({ from: origin, to, src })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
   * 把背景平均亮度拉到 0.32 附近：暗照片提亮、亮照片压暗。
   * 上限 1.55 是刻意的——再高，深色夜景会被抬得比照片本身还亮，
   * 照片就从「主体」变成了「一块暗补丁」。
   */
  const ambBrightness =
    ambLum == null ? 0.82 : Math.min(1.55, Math.max(0.3, 0.32 / Math.max(ambLum, 0.05)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          setEditing(false)
        } else {
          onClose()
        }
        return
      }
      if (editing) return
      if (e.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1))
      if (e.key === 'ArrowRight') onIndexChange(Math.min(photos.length - 1, index + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, index, photos.length, onClose, onIndexChange])

  if (!photo) return null

  const startEdit = () => {
    setDraft(photo.caption ?? '')
    setEditing(true)
  }

  /**
   * 保存简介。
   * 失败时**不退出编辑态**：草稿留在输入框里，用户再点一次保存就行，
   * 不用重新把那段话打一遍。成功才收起。
   *
   * savingRef 防的是「点保存」这两条路径叠加：textarea 失焦会先触发 onBlur，
   * 紧接着按钮的 click 又会调一次，同一个值会被提交两遍。
   */
  const savingRef = useRef(false)
  const commit = async () => {
    if (savingRef.current) return
    const next = draft.trim() ? draft.trim() : null
    if (next === (photo.caption ?? null)) {
      setEditing(false)
      return
    }
    savingRef.current = true
    const ok = await onSaveCaption(photo, next)
    savingRef.current = false
    if (ok) setEditing(false)
  }

  const go = (delta: number) => {
    const next = index + delta
    if (next >= 0 && next < photos.length) onIndexChange(next)
  }

  const pad = (n: number) => String(n).padStart(2, '0')

  /* 从缩略图长出来的这一张，入场时不播 img-in：飞行层已经在演了 */
  const isFirstShot = flew && photo.id === firstPhotoId.current

  return (
    <div className={`viewer${flew ? ' is-flight' : ''}`}>
      {/*
        底色层。
        飞行时画布还亮着，若直接让 .viewer 淡入，画布顶栏会和详情页标题
        叠成两层字；若硬切，又像「啪」一下关灯。
        折中：这一层从一开始就**完全不透明**（挡住画布，不会叠字），
        只让它的颜色从画布底色过渡到暗色 —— 读起来是「灯慢慢暗下来」。
        它独立成一个兄弟层，所以颜色变化不会连带把飞行中的照片一起淡掉。
      */}
      <div className="viewer-wash" aria-hidden="true" />

      {/*
        氛围层：拿当前照片自己做底。缩到很小再放大，靠插值得到柔焦，
        比直接对全屏元素做大半径 blur 便宜得多（小尺寸只光栅一次）。
        每换一张照片它就整体淡入一次，跟着照片的色调走。

        飞行期间**不渲染**：它是一块 2300×2300 的合成层，新分配图层要几十毫秒，
        正好和飞行层的首帧撞在一起，就是那下卡顿。等照片落地再挂上，
        它本来也是慢慢淡入的，看不出是后来的。
      */}
      {thumbUrl && landed && (
        <div
          key={photo.id}
          className="viewer-ambience"
          style={{
            backgroundImage: `url("${thumbUrl}")`,
            ['--amb-b' as string]: String(ambBrightness),
          }}
          aria-hidden="true"
        />
      )}
      <div className="viewer-veil" aria-hidden="true" />

      <div className="viewer-head">
        <div className="viewer-index">
          <b>{pad(index + 1)}</b> / {pad(photos.length)}
        </div>
        <div className="viewer-tools">
          <button
            type="button"
            className={`icon-btn${photo.featuredAt ? ' on' : ''}`}
            onClick={() => onToggleFeatured(photo)}
            title={photo.featuredAt ? '从相册里移出' : '收进中心相册'}
            aria-label={photo.featuredAt ? '从相册里移出' : '收进中心相册'}
          >
            <StarIcon size={17} filled={Boolean(photo.featuredAt)} />
          </button>
          <button
            type="button"
            className={`icon-btn${confirmDelete ? ' on' : ''}`}
            onClick={() => {
              if (confirmDelete) {
                onDelete(photo)
              } else {
                setConfirmDelete(true)
                window.setTimeout(() => setConfirmDelete(false), 3200)
              }
            }}
            title={confirmDelete ? '再点一次确认' : '删除这张'}
            aria-label="删除这张"
            style={confirmDelete ? { color: '#e0736c' } : undefined}
          >
            <TrashIcon size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            <CloseIcon size={18} />
          </button>
        </div>
      </div>

      <div className="viewer-body">
        <div className="viewer-main">
          <div
            ref={frameRef}
            className="viewer-frame"
            onTouchStart={(e) => {
              const t = e.touches[0]
              touchStart.current = { x: t.clientX, y: t.clientY }
            }}
            onTouchEnd={(e) => {
              const start = touchStart.current
              touchStart.current = null
              if (!start) return
              const t = e.changedTouches[0]
              const dx = t.clientX - start.x
              const dy = t.clientY - start.y
              if (Math.abs(dx) > 54 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                go(dx < 0 ? 1 : -1)
              }
            }}
          >
            <img
              key={photo.id}
              className={!isFirstShot && flip && turn !== 0 ? 'is-turn' : undefined}
              style={{
                ...(!isFirstShot && flip && turn !== 0
                  ? { ['--turn' as string]: String(turn) }
                  : {}),
                // 飞行层落地的同一帧换成真图，两者位置像素级对齐，看不出接缝
                ...(isFirstShot
                  ? { animation: 'none', opacity: landed ? 1 : 0 }
                  : {}),
              }}
              src={fullUrl ?? thumbUrl ?? undefined}
              alt={photo.caption ?? ''}
              draggable={false}
            />
            <button
              type="button"
              className="viewer-nav prev"
              onClick={() => go(-1)}
              disabled={index === 0}
              aria-label="上一张"
            >
              <ArrowLeftIcon />
            </button>
            <button
              type="button"
              className="viewer-nav next"
              onClick={() => go(1)}
              disabled={index === photos.length - 1}
              aria-label="下一张"
            >
              <ArrowRightIcon />
            </button>
          </div>

          <div className="viewer-caption">
            <div className="date">{formatDayCn(photo.takenAt)}</div>
            {editing ? (
              <>
                <textarea
                  ref={textRef}
                  value={draft}
                  rows={2}
                  maxLength={160}
                  placeholder="两句话就够，写下这一刻…"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void commit()}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      void commit()
                    }
                  }}
                />
                <div className="caption-hint">
                  <span>{draft.length} / 160 · 可选</span>
                  <button type="button" onClick={() => void commit()}>
                    保存
                  </button>
                </div>
              </>
            ) : (
              <div
                className={`text${photo.caption ? '' : ' placeholder'}`}
                onClick={startEdit}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') startEdit()
                }}
              >
                {photo.caption ?? '给这张照片写两句话'}
              </div>
            )}
          </div>
        </div>

        <MessageBoard
          photoId={photo.id}
          open={annotOpen}
          onClose={() => setAnnotOpen(false)}
          onCountChange={onMessageCountChange}
        />
      </div>

      <button
        type="button"
        className={`annot-toggle${annotOpen ? ' hidden' : ''}`}
        onClick={() => setAnnotOpen((v) => !v)}
      >
        <MessageIcon size={15} />
        {messageCount > 0 ? `留言 ${messageCount}` : '写留言'}
      </button>

      {flight && (
        <FlightPhoto
          from={flight.from}
          to={flight.to}
          src={flight.src}
          onDone={() => {
            setFlight(null)
            setLanded(true)
          }}
        />
      )}
    </div>
  )
}
