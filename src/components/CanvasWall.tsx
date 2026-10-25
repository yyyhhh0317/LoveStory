import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Photo } from '../lib/types'
import { albumOrder, layoutTimeline } from '../lib/layout'
import { PhotoCard } from './PhotoCard'
import { AlbumBook } from './AlbumBook'
import { CanvasDoodles } from './CanvasDoodles'
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
  onOpenPhoto: (photo: Photo, rect: DOMRect | null) => void
  onOpenAlbum: (photoId: string | null, rect: DOMRect | null) => void
  onRequestUpload: () => void
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function zoomAt(view: View, mx: number, my: number, factor: number): View {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE)
  const k = scale / view.scale
  return { x: mx - (mx - view.x) * k, y: my - (my - view.y) * k, scale }
}

const initialScale = () => (window.innerWidth < 720 ? 0.42 : 0.62)

interface Anchor {
  x: number
  y: number
  hw: number
  hh: number
}

/**
 * 平移软边界。
 *
 * 无限画布如果不设限，手机上一次大幅滑动就能把视口甩到内容之外的空地：
 * 那一刻虚拟化筛出 0 张照片、相册也在屏幕外，屏幕上只剩底色，看起来就是
 * 「清屏」。所以这里约束的不是「包围盒」，而是「最近的实体」——只要视口里
 * 还压着任意一张照片或相册的一部分，就允许继续平移。
 */
function constrainView(
  view: View,
  size: { w: number; h: number },
  anchors: Anchor[]
): View {
  if (!anchors.length || size.w < 1 || size.h < 1) return view
  const scale = view.scale
  if (!Number.isFinite(scale) || scale <= 0) return view

  const halfW = size.w / (2 * scale)
  const halfH = size.h / (2 * scale)
  const cx = (size.w / 2 - view.x) / scale
  const cy = (size.h / 2 - view.y) / scale
  // 收紧到「最近的实体至少有一大半落在视口里」，否则边界太松，
  // 停下来时只能看到照片的一个边角，观感上和清屏差别不大。
  const padX = halfW * 0.55
  const padY = halfH * 0.55

  let best: Anchor | null = null
  let bestDist = Infinity
  for (const a of anchors) {
    const mx = halfW + a.hw - padX
    const my = halfH + a.hh - padY
    const dx = Math.max(0, Math.abs(a.x - cx) - mx)
    const dy = Math.max(0, Math.abs(a.y - cy) - my)
    const d = dx * dx + dy * dy
    if (d === 0) return view // 画面上已经有内容，不用管
    if (d < bestDist) {
      bestDist = d
      best = a
    }
  }

  if (!best) return view
  const mx = halfW + best.hw - padX
  const my = halfH + best.hh - padY
  const nx = clamp(cx, best.x - mx, best.x + mx)
  const ny = clamp(cy, best.y - my, best.y + my)
  return { x: size.w / 2 - nx * scale, y: size.h / 2 - ny * scale, scale }
}

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
  const sizeRef = useRef(size)
  const anchorsRef = useRef<Anchor[]>([{ x: 0, y: 0, hw: 170, hh: 220 }])

  const applyView = useCallback((next: View) => {
    const safe = constrainView(next, sizeRef.current, anchorsRef.current)
    liveView.current = safe
    pendingView.current = safe
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
  const anchors = useMemo<Anchor[]>(() => {
    // 相册本体 318×424 居中于原点，它永远是一个可停留的落点
    const list: Anchor[] = [{ x: 0, y: 0, hw: 170, hh: 220 }]
    for (const p of placed) list.push({ x: p.x, y: p.y, hw: p.w / 2, hh: p.h / 2 })
    return list
  }, [placed])
  /*
   * 封面本身不放照片了，翻开后露出来的那一页放相册的**第一张** ——
   * 也正好是点开相册后看到的那一张，翻过去不会左右不是同一张。
   */
  const firstPage = useMemo(() => albumOrder(photos)[0] ?? null, [photos])
  const featuredCount = useMemo(() => photos.filter((p) => p.featuredAt).length, [photos])

  sizeRef.current = size
  anchorsRef.current = anchors

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      // 忽略瞬时 0 尺寸：否则可见区间塌缩，照片会被整批卸载
      if (w < 1 || h < 1) return
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
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
        {/* 背景涂鸦：world 第一个孩子，垫在相册和照片下面，跟画布一起平移 */}
        <CanvasDoodles view={view} size={size} />

        <div
          onClickCapture={(e) => {
            if (guard()) {
              e.stopPropagation()
              e.preventDefault()
            }
          }}
        >
          <AlbumBook page={firstPage} count={featuredCount} onOpen={onOpenAlbum} />
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
