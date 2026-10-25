import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Photo } from '../lib/types'
import { albumCover, layoutTimeline } from '../lib/layout'
import { PhotoCard } from './PhotoCard'
import { AlbumBook } from './AlbumBook'
import { PlusIcon, TargetIcon } from './icons'

const MIN_SCALE = 0.16
const MAX_SCALE = 2.4
const DRAG_TOLERANCE = 6
/** 视口外多渲染一圈的余量（世界单位），越小越省，但快速平移时更容易看到空档 */
const VIEW_PADDING = 220
/** 放大到这个倍率换高清图，缩回要跌破 RETINA_OFF 才降级，避免在阈值上反复横跳 */
const RETINA_ON = 1.0
const RETINA_OFF = 0.82

interface View {
  x: number
  y: number
  scale: number
}

interface Props {
  photos: Photo[]
  counts: Record<string, number>
  localOnly: boolean
  onOpenPhoto: (photo: Photo) => void
  onOpenAlbum: () => void
  onRequestUpload: () => void
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function zoomAt(view: View, mx: number, my: number, factor: number): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
  const k = scale / view.scale
  return { x: mx - (mx - view.x) * k, y: my - (my - view.y) * k, scale }
}

const initialScale = () => (window.innerWidth < 720 ? 0.42 : 0.62)

export function CanvasWall({
  photos,
  counts,
  localOnly,
  onOpenPhoto,
  onOpenAlbum,
  onRequestUpload,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [view, setView] = useState<View>(() => ({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    scale: initialScale(),
  }))
  const [animating, setAnimating] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hinted, setHinted] = useState(false)
  const [settled, setSettled] = useState(false)
  const [hiRes, setHiRes] = useState(false)

  /* 权威视图：每次输入立即更新，React 状态每帧最多同步一次 */
  const liveView = useRef<View>(view)
  const rafRef = useRef<number | null>(null)
  const pendingView = useRef<View | null>(null)

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const panStart = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null)
  const pinchStart = useRef<{
    dist: number
    scale: number
    cx: number
    cy: number
    vx: number
    vy: number
  } | null>(null)
  const dragMoved = useRef(0)
  const capturedIds = useRef(new Set<number>())

  const applyView = useCallback((next: View) => {
    liveView.current = next
    pendingView.current = next
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      const v = pendingView.current
      pendingView.current = null
      if (v) setView(v)
    })
  }, [])

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    },
    []
  )

  const placed = useMemo(() => layoutTimeline(photos), [photos])
  const cover = useMemo(() => albumCover(photos), [photos])
  const featuredCount = useMemo(() => photos.filter((p) => p.featuredAt).length, [photos])

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* 放大时换高清图 —— 这是「照片不清楚」的解 */
  useEffect(() => {
    if (!hiRes && view.scale >= RETINA_ON) setHiRes(true)
    else if (hiRes && view.scale <= RETINA_OFF) setHiRes(false)
  }, [view.scale, hiRes])

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setSettled(true)
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      applyView(zoomAt(liveView.current, mx, my, Math.exp(-e.deltaY * 0.0016)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyView])

  const handlePointerDown = (e: React.PointerEvent) => {
    const el = shellRef.current
    if (!el) return
    setSettled(true)
    /*
     * 这里故意不 capture：setPointerCapture 会把后续的 pointerup / click
     * 都重定向到画布容器，卡片自己的 onClick 就再也收不到事件了。
     * 捕获推迟到「判定为拖动」之后再做。
     */
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    dragMoved.current = 0

    if (pointers.current.size === 1) {
      panStart.current = {
        px: e.clientX,
        py: e.clientY,
        vx: liveView.current.x,
        vy: liveView.current.y,
      }
      setDragging(true)
    } else if (pointers.current.size === 2) {
      // 双指只可能是捏合缩放，不会产生点击，可以立刻捕获
      pointers.current.forEach((_, id) => {
        try {
          el.setPointerCapture(id)
          capturedIds.current.add(id)
        } catch {
          /* 手指已经抬起 */
        }
      })
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: liveView.current.scale,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        vx: liveView.current.x,
        vy: liveView.current.y,
      }
      panStart.current = null
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const ps = pinchStart.current
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const nextScale = clamp(ps.scale * (dist / (ps.dist || 1)), MIN_SCALE, MAX_SCALE)
      const worldX = (ps.cx - ps.vx) / ps.scale
      const worldY = (ps.cy - ps.vy) / ps.scale
      dragMoved.current = 999
      applyView({
        x: ps.cx - worldX * nextScale,
        y: ps.cy - worldY * nextScale,
        scale: nextScale,
      })
      return
    }

    if (pointers.current.size === 1 && panStart.current) {
      const ps = panStart.current
      const dx = e.clientX - ps.px
      const dy = e.clientY - ps.py
      dragMoved.current = Math.max(dragMoved.current, Math.hypot(dx, dy))

      // 越过容差才认定是拖动，此时才捕获指针，保证拖出窗口也不丢事件
      if (dragMoved.current > DRAG_TOLERANCE && !capturedIds.current.has(e.pointerId)) {
        try {
          shellRef.current?.setPointerCapture(e.pointerId)
          capturedIds.current.add(e.pointerId)
        } catch {
          /* 忽略 */
        }
      }

      applyView({ x: ps.vx + dx, y: ps.vy + dy, scale: liveView.current.scale })
    }
  }

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    capturedIds.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      panStart.current = null
      pinchStart.current = null
      setDragging(false)
    } else if (pointers.current.size === 1) {
      pinchStart.current = null
      const [only] = [...pointers.current.values()]
      panStart.current = {
        px: only.x,
        py: only.y,
        vx: liveView.current.x,
        vy: liveView.current.y,
      }
    }
  }

  const recenter = useCallback(() => {
    setAnimating(true)
    applyView({
      x: size.w / 2,
      y: size.h / 2,
      scale: size.w < 720 ? 0.42 : 0.62,
    })
    window.setTimeout(() => setAnimating(false), 680)
  }, [size, applyView])

  const guard = useCallback(() => dragMoved.current > DRAG_TOLERANCE, [])

  const visible = useMemo(() => {
    const halfW = size.w / (2 * view.scale) + VIEW_PADDING
    const halfH = size.h / (2 * view.scale) + VIEW_PADDING
    const cx = (size.w / 2 - view.x) / view.scale
    const cy = (size.h / 2 - view.y) / view.scale
    return placed.filter((p) => Math.abs(p.x - cx) < halfW && Math.abs(p.y - cy) < halfH)
  }, [placed, view, size])

  useEffect(() => {
    const t = window.setTimeout(() => setHinted(true), 1400)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div
      ref={shellRef}
      className={`canvas-shell${dragging ? ' is-dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={(e) => {
        const rect = shellRef.current!.getBoundingClientRect()
        applyView(zoomAt(liveView.current, e.clientX - rect.left, e.clientY - rect.top, 1.55))
      }}
    >
      <div
        className="world"
        style={{
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
          transition: animating ? 'transform 0.68s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
        }}
      >
        <div
          onClickCapture={(e) => {
            if (guard()) {
              e.stopPropagation()
              e.preventDefault()
            }
          }}
        >
          <AlbumBook cover={cover} count={featuredCount} onOpen={onOpenAlbum} />
        </div>

        {visible.map((p) => (
          <PhotoCard
            key={p.photo.id}
            placed={p}
            messageCount={counts[p.photo.id] ?? 0}
            animate={!settled}
            hiRes={hiRes}
            onOpen={onOpenPhoto}
            onDragGuard={guard}
          />
        ))}
      </div>

      {photos.length === 0 && (
        <div className="empty-hint">
          <p>还什么都没有</p>
          <span>把第一张照片放进来，画布会自己长出第一圈</span>
          <button type="button" className="ghost-btn" onClick={onRequestUpload}>
            <PlusIcon size={14} />
            放第一张
          </button>
        </div>
      )}

      <div className="hud">
        <span>{Math.round(view.scale * 100)}%</span>
        <span className="dot" />
        <span>{placed.length} 张</span>
        {localOnly && (
          <>
            <span className="dot only-sm" />
            <span className="only-sm">本地</span>
          </>
        )}
        {hinted && (
          <span className="hud-tip hide-sm">
            <span className="dot" />
            拖动平移 · 滚轮或双指缩放 · 点击看大图
          </span>
        )}
      </div>

      <button type="button" className="recenter" onClick={recenter} aria-label="回到相册">
        <TargetIcon size={17} />
      </button>
    </div>
  )
}
