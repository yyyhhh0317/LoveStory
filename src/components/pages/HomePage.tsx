import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { TogetherTimer } from '../TogetherTimer'
import { HomeBgPanel } from '../HomeBgPanel'
import { PhotoIcon } from '../icons'
import { useImgUrl } from '../../hooks/useImgUrl'
import { isRemote } from '../../lib/repo'
import { BG_ON_KEY, DEFAULT_FIT, blurOf, plateOf, readFit, veilOf, writeFit, type HomeBgFit } from '../../lib/homeBg'
import type { Photo } from '../../lib/types'
import builtinBg from '../../assets/home-bg.jpg'

/** 长按多久算「长按」。480ms 是按住不放的直觉，又不至于点一下就被误判 */
const LONG_PRESS_MS = 480

/**
 * 必须同步读，不能等 effect。
 *
 * 和 albumCache 的取舍一样：偏好放在 useState 的初始化器里定，
 * 否则选了照片背景的人每次进来都先看见一眼粉色，再闪成照片。
 * localStorage 在无痕模式下会抛，所以裹一层 try。
 */
function readOn(): boolean {
  try {
    return localStorage.getItem(BG_ON_KEY) !== 'pink'
  } catch {
    return true
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

interface Props {
  /** 相册里的照片，只喂给背景调整条挑图。首页本身不依赖它 —— 计时器照常先出来 */
  photos: Photo[]
}

/**
 * 首页只有计时器。
 *
 * 刻意不依赖 album 数据 —— 这决定了「Supabase 挂了 / 慢十秒」的时候，
 * 进来第一眼看到的仍然是那个在跳动的数字，而不是一张加载页。
 * photos 传进来只给调整条用，空数组时那里少一排缩略图，别的什么都不受影响。
 *
 * 背景用 background-size / background-position 而不是 <img> + object-fit：
 * object-fit 的 cover 永远把「紧的那一轴」顶满，object-position 在那一轴没有余量，
 * 竖屏上就是「放大了也拖不动上下」。换成两段像素之后，富余量是自己算的，
 * 缩放多少就多出多少可拖的距离，两个方向一致。
 */
export function HomePage({ photos }: Props) {
  const [on, setOn] = useState(readOn)
  const [fit, setFit] = useState<HomeBgFit>(readFit)
  const [editing, setEditing] = useState(false)

  const albumKey = fit.kind === 'album' ? fit.key : null
  const albumUrl = useImgUrl(albumKey, 'full')
  /* 挑的那张还没解出地址时先顶着默认那张，避免背景闪空 */
  const src = albumKey ? (albumUrl ?? builtinBg) : builtinBg

  /* 写盘的地方不止一处（定时器、松手、退出），一律读这份最新的值 */
  const fitRef = useRef(fit)
  fitRef.current = fit

  /* ---------- 持久化 ---------- */

  useEffect(() => {
    try {
      localStorage.setItem(BG_ON_KEY, on ? 'photo' : 'pink')
    } catch {
      /* 无痕模式：这次会话有效就行 */
    }
  }, [on])

  /*
   * 拖动时 fit 每帧都在变，不能每帧写一次 localStorage —— 同步落盘会顶掉手感。
   * 停手 250ms 后写一次，内容仍是最后那个值。
   */
  useEffect(() => {
    const t = window.setTimeout(() => writeFit(fit), 250)
    return () => window.clearTimeout(t)
  }, [fit])

  /* ---------- 量尺寸 ---------- */

  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [nat, setNat] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setBox((b) =>
        Math.abs(b.w - r.width) < 1 && Math.abs(b.h - r.height) < 1 ? b : { w: r.width, h: r.height }
      )
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /*
   * 原图尺寸只能从一次真实加载里拿，所以这里单开一个 Image 探一下
   * （URL 和下面 background-image 用的是同一个，第二次直接命中缓存）。
   * onerror 是相册那张被删了的兜底：别让整块背景变成空白，退回默认那张。
   */
  useEffect(() => {
    setNat({ w: 0, h: 0 })
    const im = new Image()
    im.decoding = 'async'
    im.onload = () => setNat({ w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = () => {
      if (fitRef.current.kind !== 'album') return
      const cur = fitRef.current
      setFit({ ...DEFAULT_FIT, clarity: cur.clarity, zoom: cur.zoom })
    }
    im.src = src
    return () => {
      im.onload = null
      im.onerror = null
    }
  }, [src])

  /* 缩放之后两个方向各多出多少可拖的像素（cover 本身也会多出一点） */
  const slack = useMemo(() => {
    if (!nat.w || !nat.h || !box.w || !box.h) return { ex: 0, ey: 0 }
    const s = Math.max(box.w / nat.w, box.h / nat.h) * fit.zoom
    return { ex: Math.max(0, nat.w * s - box.w), ey: Math.max(0, nat.h * s - box.h) }
  }, [nat, box, fit.zoom])

  const bgStyle = useMemo<CSSProperties>(() => {
    /* 还没量到：先铺满居中，量到的那一帧再换成精确值 */
    if (!nat.w || !nat.h || !box.w || !box.h) {
      return { backgroundSize: 'cover', backgroundPosition: 'center' }
    }    const s = Math.max(box.w / nat.w, box.h / nat.h) * fit.zoom
    const w = nat.w * s
    const h = nat.h * s
    /*
     * position 取负：x=0 贴左边（露出图的左侧），x=100 贴右边。
     * 和 object-position 的读数一致，面板里那个「居中」按到 50/50 就是正中。
     */
    return {
      backgroundSize: `${w.toFixed(2)}px ${h.toFixed(2)}px`,
      backgroundPosition: `${((-slack.ex * fit.x) / 100).toFixed(2)}px ${(
        (-slack.ey * fit.y) /
        100
      ).toFixed(2)}px`,
    }
  }, [nat, box, fit.zoom, fit.x, fit.y, slack])

  /* ---------- 长按开调整条 ---------- */

  const pressTimer = useRef<number | null>(null)
  /* 长按已经开了面板：松手时浏览器还会补一发 click，得把它吃掉，否则又切回粉底 */
  const longFired = useRef(false)

  const cancelPress = useCallback(() => {
    if (pressTimer.current) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }, [])

  useEffect(() => cancelPress, [cancelPress])

  const startPress = () => {
    longFired.current = false
    cancelPress()
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      longFired.current = true
      /* 进来就是调背景的：粉底状态下拖等于对着空气拖，先打开 */
      setOn(true)
      setEditing(true)
    }, LONG_PRESS_MS)
  }

  const onClick = () => {
    if (longFired.current) {
      longFired.current = false
      return
    }
    setOn((v) => !v)
  }

  const closeEditor = useCallback(() => {
    writeFit(fitRef.current)
    setEditing(false)
  }, [])

  /* 键盘用户：Esc 退出调整，和所有弹层一个手势 */
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEditor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, closeEditor])

  /* ---------- 拖动换位置 ---------- */

  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (slack.ex < 1 && slack.ey < 1) return
    dragRef.current = { px: e.clientX, py: e.clientY, x: fit.x, y: fit.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    /*
     * 手指往右拖 = 画面往右走 = 图贴得更靠左 = x 变小，所以是减号。
     * 某一轴确实没有富余时那一轴不动（比如没放大时的上下）——
     * 那是真的没得挪，不是没响应，所以下面的提示会跟着变。
     */
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    const x = slack.ex > 1 ? clamp(d.x - (dx / slack.ex) * 100, 0, 100) : d.x
    const y = slack.ey > 1 ? clamp(d.y - (dy / slack.ey) * 100, 0, 100) : d.y
    setFit((cur) => ({ ...cur, x, y }))
  }

  const endDrag = () => {
    if (!dragRef.current) return
    dragRef.current = null
    /* 松手立刻落盘，别指望那个 250ms 定时器（可能还没到就切页了） */
    writeFit(fitRef.current)
  }

  /*
   * 清晰度驱动三件事：照片的模糊半径、粉纱浓度、计时器底衬的不透明度。
   * 前两件管整屏氛围，第三件只管文字脚下那块 —— 一起算好写成 CSS
   * 变量，样式表里就只剩「怎么用」，不用再记公式。
   *
   * 底衬只在照片态出现：粉底上文字本来就有设计好的对比度，垫一层
   * 只会凭空多一块色斑。开关切换时它跟着 .home-bg 一起过渡，不闪。
   */
  const bgVars = {
    '--home-bg-blur': `${blurOf(fit.clarity).toFixed(1)}px`,
    '--home-veil': `${veilOf(fit.clarity).toFixed(1)}%`,
    '--home-plate': `${(on ? plateOf(fit.clarity) : 0).toFixed(1)}%`,
  } as CSSProperties

  return (
    <div
      className={`page page--home${editing ? ' is-editing' : ''}`}
      data-bg={on ? 'photo' : 'pink'}
      style={bgVars}
    >
      {/* 装饰层：纯视觉，读屏不需要知道背景是什么 */}
      <div className="home-bg" ref={boxRef} aria-hidden="true">
        <div className="home-bg-photo" style={{ backgroundImage: `url(${src})`, ...bgStyle }} />
      </div>

      <button
        type="button"
        className="home-bg-toggle"
        aria-pressed={on}
        aria-label="照片背景（长按调整）"
        title={on ? '点一下换回粉色 · 长按调整背景' : '点一下换成照片 · 长按调整背景'}
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
        onClick={onClick}
      >
        <PhotoIcon size={20} />
      </button>

      {editing && (
        <div
          className="home-bg-drag"
          role="group"
          aria-label="背景位置：拖动，或用方向键微调"
          tabIndex={0}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            /* 拖拽对键盘用户是死路，给方向键一份等价的能力（Shift 加大步长） */
            const step = e.shiftKey ? 10 : 2
            const dx = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0
            const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
            if (!dx && !dy) return
            e.preventDefault()
            setFit((cur) => ({
              ...cur,
              x: clamp(cur.x + dx, 0, 100),
              y: clamp(cur.y + dy, 0, 100),
            }))
          }}
        >
          <span className="home-bg-drag-hint">
            {slack.ey > 1 ? '按住拖动' : '按住左右拖动'}
          </span>
        </div>
      )}

      <TogetherTimer />

      {!isRemote && (
        <p className="home-note" title="尚未配置 Supabase，数据只存在这台设备上">
          本地模式 · 数据只在这台设备上
        </p>
      )}

      {editing && (
        <HomeBgPanel fit={fit} photos={photos} onChange={setFit} onDone={closeEditor} />
      )}
    </div>
  )
}
