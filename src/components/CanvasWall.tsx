import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Photo } from '../lib/types'
import { albumOrder, layoutTimeline, type Placed } from '../lib/layout'
import { PhotoCard } from './PhotoCard'
import { AlbumBook } from './AlbumBook'
import { CanvasDoodles } from './CanvasDoodles'
import { PlusIcon, TargetIcon } from './icons'

const MIN_SCALE = 0.16
const MAX_SCALE = 2.4
const DRAG_TOLERANCE = 6
/**
 * 视口外多渲染一圈的余量。单位是**屏幕像素**（换算成世界单位时除以 scale），
 * 原来写的是世界单位 220，缩到 0.16 倍时只剩 35px，快速平移时照片是「追进来」的。
 */
const VIEW_PADDING = 260
/**
 * 同屏卡片上限。缩到最小倍率时，螺旋半径几千世界单位内的照片全都「可见」，
 * 真按可见集渲染会一次挂上六七百个 <img> —— 那是必卡无疑。
 * 超量时只留离视口中心最近的一批。
 */
const MAX_CARDS = 240

/** 画布上单张卡片的最长边（含相纸白边），和 layout.ts 的 MAX_EDGE + FRAME 对齐 */
const CARD_EDGE = 262
/** 缩略图的最长边，和 lib/image.ts 的 THUMB_EDGE 对齐 */
const THUMB_EDGE = 560
/** 缩略图被放大到这个倍数以内还不换高清 —— 再往上就真的能看出糊了 */
const THUMB_TOLERANCE = 1.8

const DPR = Math.min(window.devicePixelRatio || 1, 3)
/**
 * 换高清的倍率阈值：直到「卡片实际需要的设备像素」超过缩略图能提供的像素，
 * 才值得去拉那张 1800px 的大图。
 *
 *   262(世界单位) × scale × DPR > 560 × 1.8
 *
 * 原来是写死 1.0 —— 意味着放大到 100% 就把同屏三十几张全部换成大图，
 * 30 × 1800² 解码后约 290MB，正是手机上「放大一下就卡住」的来源。
 * 按这个式子，2 倍屏要到 1.92 倍才换，3 倍屏 1.28 倍，桌面 1 倍屏干脆不换。
 */
const HI_ON = Math.max(
  1.15,
  Math.min(2.2, (THUMB_EDGE * THUMB_TOLERANCE) / (CARD_EDGE * DPR))
)
const HI_OFF = HI_ON * 0.86

const WORLD_EASE = 'transform 0.68s cubic-bezier(0.22, 1, 0.36, 1)'

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

const transformOf = (v: View) => `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.scale})`

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

/** 当前视口里该渲染哪些照片（纯函数，rAF 和渲染两处共用同一套口径） */
function computeVisible(
  placed: Placed[],
  view: View,
  size: { w: number; h: number },
  cap = MAX_CARDS,
  padPx = VIEW_PADDING
): Placed[] {
  const padWorld = padPx / view.scale
  const halfW = size.w / (2 * view.scale) + padWorld
  const halfH = size.h / (2 * view.scale) + padWorld
  const cx = (size.w / 2 - view.x) / view.scale
  const cy = (size.h / 2 - view.y) / view.scale

  const hits: Placed[] = []
  for (const p of placed) {
    if (Math.abs(p.x - cx) < halfW + p.w / 2 && Math.abs(p.y - cy) < halfH + p.h / 2) {
      hits.push(p)
    }
  }
  if (hits.length <= cap) return hits

  // 极端缩小时同屏可能上千张：只留离视口中心最近的 cap 张
  const scored = hits.map((p) => ({ p, d: (p.x - cx) ** 2 + (p.y - cy) ** 2 }))
  scored.sort((a, b) => a.d - b.d)
  return scored.slice(0, cap).map((s) => s.p)
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
  const worldRef = useRef<HTMLDivElement>(null)
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

  /*
   * 权威视图：每次输入立即更新，React 状态只在「需要重渲染的东西变了」时才同步。
   *
   * 这是这一版最重要的改动。原来每次 pointermove / wheel 都 setView，
   * 于是每一帧都要重跑 CanvasWall 的整棵子树：
   *   可见集 filter（O(n)）+ 十几株涂鸦 SVG 的重新生成与 diff。
   * 手机上这一套大约 8–20ms，平移必然掉帧。
   * 现在平移只是往 DOM 上写一个 transform（合成层），React 一次都不跑。
   */
  const liveView = useRef<View>(view)
  const rafRef = useRef<number | null>(null)
  const pendingView = useRef<View | null>(null)
  const visibleIdsRef = useRef<string[]>([])
  const bucketRef = useRef('')
  const hiResRef = useRef(false)
  const animatingRef = useRef(false)

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
  const placedRef = useRef<Placed[]>([])
  const anchorsRef = useRef<Anchor[]>([{ x: 0, y: 0, hw: 170, hh: 220 }])

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
  placedRef.current = placed

  /**
   * 一帧只做一次：把权威视图落到 DOM 上，然后判断「结构性渲染」需不需要跟上。
   */
  const flushView = useCallback(() => {
    rafRef.current = null
    const v = pendingView.current
    pendingView.current = null
    if (!v) return

    const el = worldRef.current
    if (el) el.style.transform = transformOf(v)

    // 高清档：只在跨过阈值时 setState，缩放过程中不产生额外渲染
    if (!hiResRef.current && v.scale >= HI_ON) {
      hiResRef.current = true
      setHiRes(true)
    } else if (hiResRef.current && v.scale <= HI_OFF) {
      hiResRef.current = false
      setHiRes(false)
    }

    /*
     * 只有这两件事变了才值得让 React 跑一遍：
     *   1. 可见集变了（要挂载/卸载卡片）
     *   2. 涂鸦的分桶变了（要换一批背景涂鸦）
     * 涂鸦按 160 世界单位分桶 —— 它们本身钉在世界坐标上不移动，
     * 换一批的时机晚半拍，肉眼只会在视口边缘之外发生。
     */
    const vis = computeVisible(placedRef.current, v, sizeRef.current)
    const prevIds = visibleIdsRef.current
    let same = prevIds.length === vis.length
    if (same) {
      for (let i = 0; i < vis.length; i++) {
        if (prevIds[i] !== vis[i].photo.id) {
          same = false
          break
        }
      }
    }
    const bucket = `${Math.round(v.x / 160)}|${Math.round(v.y / 160)}|${Math.round(v.scale * 20)}`
    const bucketChanged = bucket !== bucketRef.current

    if (!same || bucketChanged) {
      visibleIdsRef.current = vis.map((p) => p.photo.id)
      bucketRef.current = bucket
      setView(v)
    }
  }, [])

  const applyView = useCallback(
    (next: View) => {
      const safe = constrainView(next, sizeRef.current, anchorsRef.current)
      liveView.current = safe
      pendingView.current = safe
      if (rafRef.current === null) rafRef.current = window.requestAnimationFrame(flushView)
    },
    [flushView]
  )

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    },
    []
  )

  /** 手动拖拽会打断 recenter 的过渡，否则 transform 会被 transition 拖着走 */
  const stopTransition = useCallback(() => {
    const el = worldRef.current
    if (!el || !animatingRef.current) return
    /*
     * 打断过渡时不能直接把它按回去 —— 那样画布会「啪」地跳到终点。
     * 先读当前生效的矩阵，把权威视图对齐到「眼睛看到的位置」，再接着拖。
     */
    try {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
      if (Number.isFinite(m.a) && m.a > 0) {
        liveView.current = { x: m.m41, y: m.m42, scale: m.a }
      }
    } catch {
      /* 老内核没有 DOMMatrixReadOnly：退回「按终点继续」 */
    }
    animatingRef.current = false
    setAnimating(false)
    el.style.transition = 'none'
  }, [])

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

  /* 首帧之后把 transform / 可见集基线落到 DOM，后续只做增量比较 */
  useEffect(() => {
    if (worldRef.current) worldRef.current.style.transform = transformOf(liveView.current)
    const seed = computeVisible(placedRef.current, liveView.current, sizeRef.current)
    visibleIdsRef.current = seed.map((p) => p.photo.id)
    bucketRef.current = `${Math.round(liveView.current.x / 160)}|${Math.round(
      liveView.current.y / 160
    )}|${Math.round(liveView.current.scale * 20)}`
  }, [])

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setSettled(true)
      stopTransition()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      applyView(zoomAt(liveView.current, mx, my, Math.exp(-e.deltaY * 0.0016)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyView, stopTransition])

  const handlePointerDown = (e: React.PointerEvent) => {
    const el = shellRef.current
    if (!el) return
    setSettled(true)
    stopTransition()
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
    const box = sizeRef.current
    animatingRef.current = true
    setAnimating(true)
    applyView({
      x: box.w / 2,
      y: box.h / 2,
      scale: box.w < 720 ? 0.42 : 0.62,
    })
    window.setTimeout(() => {
      animatingRef.current = false
      setAnimating(false)
    }, 680)
  }, [applyView])

  const guard = useCallback(() => dragMoved.current > DRAG_TOLERANCE, [])

  const visible = useMemo(() => computeVisible(placed, view, size), [placed, view, size])
  /*
   * 真正落在视口里的那批（不带留边）。
   * 它们先占带宽，留边上的那圈降级成 low —— 否则 40 张缩略图平分 6 条连接，
   * 正中间那张要等到很后面才开始下载，看起来就是「半天不出图」。
   */
  const inViewIds = useMemo(
    () => new Set(computeVisible(placed, view, size, MAX_CARDS, 0).map((p) => p.photo.id)),
    [placed, view, size]
  )

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
        ref={worldRef}
        className="world"
        style={{
          // 读 liveView：即使 React 因为别的原因重渲染，写回的也是「最新」那帧的位置，
          // 不会把正在拖的画布弹回上一次 setState 时的位置。
          transform: transformOf(liveView.current),
          transition: animating ? WORLD_EASE : 'none',
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
            priority={inViewIds.has(p.photo.id) ? 'high' : 'low'}
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
