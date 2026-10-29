import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { useImgUrl } from '../hooks/useImgUrl'
import { repo } from '../lib/repo'
import { prefetchAllowance, preloadImage, whenIdle } from '../lib/preload'
import { formatDayCn } from '../lib/format'
import type { Photo, ImageVariant } from '../lib/types'
import { FLIP_MS, prefersReducedMotion, type FrameRect } from '../lib/flight'
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
  /** 点开相册模式才翻书：照片贴在统一纸页上、一页一页绕书脊翻；时间线浏览仍用原来的淡入 */
  flip?: boolean
  /** 点开时那张缩略图在屏幕上的位置：有就从这里放大过来，没有就直接淡入 */
  origin?: FrameRect | null
}

/** 珍藏册纸页：统一 3:4 竖页，和封面（318×424）同比例 */
const PAGE_AR = 3 / 4
/** 照片离纸边的留白比例：左右 6%、上下 5% —— CSS 的 .book-hole 必须与之同步 */
const HOLE_X = 0.06
const HOLE_Y = 0.05

/**
 * 平均亮度的记忆表。
 * 取像素要发一次 CORS 请求，它和 <img> 那次**不进同一个缓存**（响应头带 Vary: Origin），
 * 所以来回翻同一张会重复下载。按地址记住结果，翻回去就不用再算。
 */
const lumCache = new Map<string, number>()

/** 在一个框里放下整页纸（contain 居中），坐标相对框 */
function pageFit(box: { width: number; height: number }): FrameRect {
  let w = box.width
  let h = w / PAGE_AR
  if (h > box.height) {
    h = box.height
    w = h * PAGE_AR
  }
  return { x: (box.width - w) / 2, y: (box.height - h) / 2, w, h }
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
  /* 飞行动画已走完（FlightPhoto 的 onDone），等真图就绪后一起原子落地 */
  const [flightDone, setFlightDone] = useState(false)
  /*
   * 真图已经解码完的是**哪一张**。
   *
   * 原来是一个 boolean，只在第一张被设成 true —— 之后就再也回不到 false，
   * 于是「等真图就绪再落地」这条逻辑从第二张起完全失效：动画一结束就落地，
   * 慢网下直接露出中间那块空白。现在按 photoId 记，每张各自算。
   */
  const [readyId, setReadyId] = useState<string | null>(null)
  const imgReady = Boolean(photo && readyId === photo.id)
  /* 氛围层挂载开关：刻意错开落地那一帧（见下方 effect） */
  const [ambienceOn, setAmbienceOn] = useState(!flew)
  /*
   * 氛围层用两个常驻槽位轮流承接，靠透明度交叉淡入淡出。
   *
   * 原来是 key={photo.id} 重挂：每换一张就新建一块 1800×1800 的模糊合成层，
   * 新分配图层要几十毫秒 —— 正好撞在翻页那一帧上，这就是「切一张卡一下」。
   * 两个槽位常驻之后，图层只分配一次，换图只是改背景 + 一次便宜的淡入。
   */
  const [amb, setAmb] = useState<{ slots: [string | null, string | null]; front: number }>({
    slots: [null, null],
    front: 0,
  })
  const imgRef = useRef<HTMLImageElement>(null)
  /**
   * 翻页状态（相册模式的真·翻书）。
   *
   * 一页 = 一张统一 3:4 的纸页（照片贴在页面上），所以翻起的「叶子」
   * 和垫底的页子矩形完全重合，翻页几何才不会错位。
   * 绕左侧书脊转 180°：前半段看到叶子正面的照片、后半段露出纸背，
   * 和真书一样。翻页期间锁定导航，翻完才放行下一页。
   */
  interface BookTurn {
    dir: 1 | -1
    /** 所有翻页元素共用的纸页矩形（相对 viewer-frame） */
    page: FrameRect
    /** 叶子正面显示的照片地址（往后翻 = 旧照片，往前翻 = 新照片） */
    leafSrc: string | null
    leafKey: string | null
    /** 缓存未命中时叶子按哪一档补解析 */
    leafVariant: ImageVariant
    /** 往回翻时垫在底下的旧照片地址 */
    underSrc: string | null
    underKey: string | null
    underVariant: ImageVariant
  }
  const [turn, setTurn] = useState<BookTurn | null>(null)
  const turning = useRef(false)
  const turnTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (turnTimer.current != null) window.clearTimeout(turnTimer.current)
    }
  }, [])

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
   *
   * 算过的记在 lumCache 里：这张请求带 crossOrigin，和 <img> 那次不是同一个缓存条目，
   * 不记的话来回翻同一张会反复下载。
   */
  useEffect(() => {
    if (!thumbUrl) {
      setAmbLum(null)
      return
    }
    const known = lumCache.get(thumbUrl)
    if (known !== undefined) {
      setAmbLum(known)
      return
    }
    setAmbLum(null)
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
        if (count > 0) {
          const lum = sum / count
          lumCache.set(thumbUrl, lum)
          if (alive) setAmbLum(lum)
        }
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
   * 预取前后各两张。
   *
   * 换照片卡的不是「请求慢」，而是**解码**：一张 1800px 的 WebP 在主线程解要
   * 60–180ms，而它偏偏发生在翻页动画的第一帧。提前 decode() 掉，翻过去就只剩合成。
   * 顺序上先紧后松：下一张马上要，再远的两张等浏览器空闲，别抢当前这张的带宽。
   */
  /*
   * 预取的在途控制表，key 是 storageKey。
   *
   * 换页时要撤掉「已经不需要的」预取，但**绝不能撤掉马上就轮到的那些** ——
   * 那张上一轮刚开始下，撤掉等于让它从头再下一遍，比不预取还慢。
   * 所以按 key 记账，新的邻居集合里还留着的就不动它。
   */
  const prefetchCtl = useRef(new Map<string, AbortController>())
  useEffect(() => {
    const map = prefetchCtl.current
    return () => {
      for (const ac of map.values()) ac.abort()
      map.clear()
    }
  }, [])

  useEffect(() => {
    if (!photos.length) return
    /*
     * 预取几张，取决于这条链路有多宽。
     * 原来固定铺三张，在慢网下等于让三张邻图去抢当前那张的带宽 ——
     * 实测 30 KB/s 时，三张 1800px 加一起要 20 秒，用户看到的就是
     * 「点开一张照片要等七八秒」。宁可少铺，也不要抢。
     */
    const budget = prefetchAllowance()
    // 顺序有意义：先下一张，再上一张，再下一张 —— 额度只有 1 时就是「只铺下一张」
    const wanted: string[] = []
    if (budget > 0) {
      for (const d of [1, -1, 2]) {
        if (wanted.length >= budget) break
        const key = photos[index + d]?.storageKey
        if (key && !wanted.includes(key)) wanted.push(key)
      }
    }

    const map = prefetchCtl.current
    const keep = new Set(wanted)
    for (const [key, ac] of map) {
      if (!keep.has(key)) {
        ac.abort()
        map.delete(key)
      }
    }
    if (!wanted.length) return

    let alive = true
    const run = async () => {
      for (let i = 0; i < wanted.length; i++) {
        if (!alive) return
        const key = wanted[i]
        // 上一轮已经在下了，别重复发
        if (map.has(key)) continue
        /*
         * 只等「让一步」，不等「下载完」。
         * 原来写的是 await preloadImage(...)：一张 1800px 的大图在慢网下要好几秒，
         * 于是第二、第三张的请求要等第一张解码完才发出去 —— 队列被自己堵死，
         * 真正翻到第三张时它才刚起步。
         */
        if (i > 0) await whenIdle()
        if (!alive) return
        // Supabase 是同步拼 URL；本地模式要等 IndexedDB 读出来
        const url = repo.peekUrl(key, 'full') ?? (await repo.resolveUrl(key, 'full'))
        if (!alive || !url || map.has(key)) continue
        const ac = new AbortController()
        map.set(key, ac)
        void preloadImage(url, 'low', ac.signal).then(() => {
          if (map.get(key) === ac) map.delete(key)
        })
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [index, photos])

  /* 换到新的一张：把它放进空闲的那个槽位，旧的留着淡出 */
  useEffect(() => {
    if (!thumbUrl || !ambienceOn) return
    setAmb((prev) => {
      if (prev.slots[prev.front] === thumbUrl) return prev
      const back = prev.front === 0 ? 1 : 0
      const slots: [string | null, string | null] = [prev.slots[0], prev.slots[1]]
      slots[back] = thumbUrl
      return { slots, front: back }
    })
  }, [thumbUrl, ambienceOn])

  /*
   * 纸页矩形：相册模式里照片贴在一张统一 3:4 的纸页上，
   * 页子跟随窗口尺寸变化。flight 的终点矩形和翻页叶子都出自同一套数学，
   * 所以这里量准了，后面全都对得上。
   */
  const [pageRect, setPageRect] = useState<FrameRect | null>(null)
  useLayoutEffect(() => {
    if (!flip) {
      setPageRect(null)
      return
    }
    const el = frameRef.current
    if (!el) return
    const measure = () => setPageRect(pageFit(el.getBoundingClientRect()))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [flip])

  /*
   * 起飞：把终点交给飞行层。
   *
   * 终点不量真实的 img —— 大图可能还没解码完，量出来是 0 宽。
   * 用 .viewer-frame 的框按 contain 反推：普通模式就是照片自身的矩形；
   * 相册模式照片贴在纸页上，要再算一层「页内留白」，落点才是照片真正的位置。
   *
   * 只在挂载时跑一次：飞行途中翻到下一张不该重新起飞。
   */
  useLayoutEffect(() => {
    const el = frameRef.current
    if (!flew || !origin || !el || !photo) return
    const box = el.getBoundingClientRect()
    const ar = photo.aspect > 0 ? photo.aspect : photo.width / photo.height || 4 / 3
    let to: FrameRect
    if (flip) {
      const page = pageFit(box)
      const hx = page.w * HOLE_X
      const hy = page.h * HOLE_Y
      const cw = page.w - hx * 2
      const ch = page.h - hy * 2
      let w = cw
      let h = w / ar
      if (h > ch) {
        h = ch
        w = h * ar
      }
      to = {
        x: box.x + page.x + hx + (cw - w) / 2,
        y: box.y + page.y + hy + (ch - h) / 2,
        w,
        h,
      }
    } else {
      let w = box.width
      let h = w / ar
      if (h > box.height) {
        h = box.height
        w = h * ar
      }
      to = {
        x: box.x + (box.width - w) / 2,
        y: box.y + (box.height - h) / 2,
        w,
        h,
      }
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
   * 落地必须「原子」：飞行层卸载和真图显形要发生在同一帧。
   * 原来是动画一结束就删飞行层，真图再花 180ms 从透明淡进来 ——
   * 中间那段时间照片半透明、暗底透出来，这就是「放大完闪一下」。
   * 现在等两件事都齐了才落地：动画走完 + 真图解码完。
   * 慢网兜底：最多再多等 1s，期间飞行层冻结在终点
   * （fill: forwards），看起来就是照片已经放好了，不会露底。
   */
  useEffect(() => {
    if (!flightDone || landed) return
    const land = () => {
      setFlight(null)
      setLanded(true)
    }
    if (imgReady) {
      land()
      return
    }
    const t = window.setTimeout(land, 1000)
    return () => window.clearTimeout(t)
  }, [flightDone, imgReady, landed])

  /*
   * 氛围层是一块 2300×2300 的合成层，新分配图层要几十毫秒。
   * 原来正好挂在落地那一帧，和换图撞在一起，就是卡那一下。
   * 推迟一拍再挂：它本来就慢慢淡入，看不出是后来的。
   */
  useEffect(() => {
    if (!landed || ambienceOn) return
    const t = window.setTimeout(() => setAmbienceOn(true), 140)
    return () => window.clearTimeout(t)
  }, [landed, ambienceOn])

  /* 缓存图可能赶在 onLoad 挂上之前就解码完，兜一层 complete 检查 */
  const currentId = photo?.id ?? null
  useEffect(() => {
    if (!currentId) return
    const el = imgRef.current
    if (el && el.complete && el.naturalWidth > 0) setReadyId(currentId)
  }, [currentId, fullUrl, thumbUrl])

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
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // go 在下方才声明，不能进依赖数组（TDZ）；闭包在 effect 执行时已就绪
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /**
   * 翻一页。
   *
   * 相册模式走真翻书：照片都贴在统一 3:4 的纸页上，翻页前量一次
   * viewer-frame 得到页矩形，然后：
   *   - 往后翻：新一页垫底（就是当前渲染的 img），旧一页作为叶子绕左脊翻走；
   *   - 往前翻：新一页先藏住（它的叶子从 -180° 翻回来），旧一页垫底。
   * 时间线模式保持原来的直接换图。
   */
  const go = (delta: number) => {
    const next = index + delta
    if (next < 0 || next >= photos.length) return

    const out = photos[index]
    const inc = photos[next]
    const el = frameRef.current
    const canFlip = flip && !prefersReducedMotion() && out && inc && el && !turning.current

    if (canFlip) {
      const page = pageFit(el!.getBoundingClientRect())
      const dir: 1 | -1 = delta > 0 ? 1 : -1
      turning.current = true

      /*
       * 叶子上用哪一档图有讲究：刚显示过的那页 full 一定在缓存里
       * （底下的 img 正放着呢），直接用 full 就不会有「翻起瞬间变糊」；
       * 还没看过的那页只能先上 thumb，真图在底下那张 img 里同时加载。
       */
      const peek = (p: Photo, v: ImageVariant) =>
        p.storageKey ? repo.peekUrl(p.storageKey, v) : null

      if (dir === 1) {
        setTurn({
          dir,
          page,
          leafSrc: peek(out, 'full') ?? peek(out, 'thumb'),
          leafKey: out.storageKey ?? null,
          leafVariant: 'full',
          underSrc: null,
          underKey: null,
          underVariant: 'thumb',
        })
      } else {
        setTurn({
          dir,
          page,
          leafSrc: peek(inc, 'thumb'),
          leafKey: inc.storageKey ?? null,
          leafVariant: 'thumb',
          underSrc: peek(out, 'full') ?? peek(out, 'thumb'),
          underKey: out.storageKey ?? null,
          underVariant: 'full',
        })
      }

      turnTimer.current = window.setTimeout(() => {
        turning.current = false
        turnTimer.current = null
        setTurn(null)
      }, FLIP_MS)
    }

    onIndexChange(next)
  }

  /* 叶子/垫底页上的缩略图没进缓存时补一发解析；真图在底下那张 img 里已经在加载了 */
  useEffect(() => {
    if (!turn) return
    const missing: Array<'leaf' | 'under'> = []
    if (!turn.leafSrc && turn.leafKey) missing.push('leaf')
    if (!turn.underSrc && turn.underKey) missing.push('under')
    if (missing.length === 0) return
    let alive = true
    void Promise.all(
      missing.map(async (m) => {
        const key = (m === 'leaf' ? turn.leafKey : turn.underKey) as string
        const variant = m === 'leaf' ? turn.leafVariant : turn.underVariant
        const url = await repo.resolveUrl(key, variant).catch(() => null)
        return [m, url] as const
      })
    ).then((pairs) => {
      if (!alive) return
      setTurn((t) => {
        if (!t) return t
        const nt = { ...t }
        for (const [m, url] of pairs) {
          if (!url) continue
          if (m === 'leaf' && !nt.leafSrc) nt.leafSrc = url
          if (m === 'under' && !nt.underSrc) nt.underSrc = url
        }
        return nt
      })
    })
    return () => {
      alive = false
    }
  }, [turn])

  const pad = (n: number) => String(n).padStart(2, '0')

  /* 从缩略图长出来的这一张，入场时不播 img-in：飞行层已经在演了 */
  const isFirstShot = flew && photo.id === firstPhotoId.current

  /*
   * 相册模式：照片贴在纸页的「洞」里（统一留白）。
   * 页矩形来自 ResizeObserver，照片就是洞里 contain 的那张 img。
   */
  const holeStyle =
    flip && pageRect
      ? {
          position: 'absolute' as const,
          left: pageRect.x + pageRect.w * HOLE_X,
          top: pageRect.y + pageRect.h * HOLE_Y,
          width: pageRect.w * (1 - HOLE_X * 2),
          height: pageRect.h * (1 - HOLE_Y * 2),
        }
      : undefined
  const pageStyle = (r: FrameRect) => ({ left: r.x, top: r.y, width: r.w, height: r.h })

  return (
    <div
      className={`viewer${flew ? ' is-flight' : ''}`}
      style={{ ['--amb-b' as string]: String(ambBrightness) }}
    >
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
        每换一张照片，新的一张从背面槽位淡入，旧的淡出 —— 交叉溶解，
        既不闪白也不重建合成层。

        飞行期间**不渲染**：它是一块 1800×1800 的合成层，新分配图层要几十毫秒，
        正好和飞行层的首帧撞在一起，就是那下卡顿。等照片落地再挂上，
        它本来也是慢慢淡入的，看不出是后来的。
      */}
      {ambienceOn &&
        amb.slots.map((src, i) =>
          src ? (
            <div
              key={i}
              className={`viewer-ambience${amb.front === i ? ' is-front' : ''}`}
              style={{ backgroundImage: `url("${src}")` }}
              aria-hidden="true"
            />
          ) : null
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
            {/*
              相册模式：一张统一的纸页垫底，照片贴在页面的留白区里。
              页子和翻页叶子用的是同一个矩形（pageFit），翻起来才严丝合缝。
            */}
            {flip && pageRect && (
              <div className="book-paper" style={pageStyle(pageRect)} aria-hidden="true" />
            )}

            {/*
              缩略图垫底。
              主图的 src 是 1800px 大图，慢网下要好几秒 —— 这段时间 <img> 里
              一个像素都没有，中间就是一块空白，氛围层在四周模糊地亮着，
              反而更显得中间缺了一块。缩略图（560px，约 40KB）几乎一定已经
              在缓存里（画布和内页显示的就是它），先把它铺上去，
              大图解码完再让它退场。

              class 与主图保持同一套，翻页时的隐藏规则才不会错位。
            */}
            {thumbUrl && !imgReady && (
              <img
                key={`ph-${photo.id}`}
                src={thumbUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                decoding="async"
                className={
                  flip && !isFirstShot
                    ? turn?.dir === -1
                      ? 'book-still book-hidden viewer-ph'
                      : 'book-still viewer-ph'
                    : 'viewer-ph'
                }
                style={holeStyle}
              />
            )}

            {/*
              这张 img：相册模式下绝对定位在纸页的留白区里，且永远不播
              img-in 淡入 —— 它要么是被翻页露出来的底图，要么正被叶子
              盖着，淡入会在叶子掀开时露馅。往回翻的整个过程中它还要
              藏住（叶子的正面就是它自己）。
            */}
            <img
              ref={imgRef}
              key={photo.id}
              onLoad={() => setReadyId(photo.id)}
              decoding="async"
              fetchPriority="high"
              className={
                flip && !isFirstShot
                  ? turn?.dir === -1
                    ? 'book-still book-hidden'
                    : 'book-still'
                  : undefined
              }
              style={{
                ...holeStyle,
                // 飞行层落地的同一帧换成真图，两者位置像素级对齐，看不出接缝。
                // transition 必须关掉：淡入会让交换那几帧半透明，就是「闪一下」
                ...(isFirstShot
                  ? { animation: 'none', opacity: landed ? 1 : 0, transition: 'none' }
                  : {}),
              }}
              src={fullUrl ?? thumbUrl ?? undefined}
              alt={photo.caption ?? ''}
              draggable={false}
            />

            {/*
              真·翻书的三层：垫底的旧页（只往回翻有）→ 书脊阴影 → 翻动的叶子。
              叶子绕左侧书脊转 180°，前半段是照片正面、后半段是纸背，
              和封面掀开用的是同一种「有厚度的纸」语言。
            */}
            {turn && (
              <div className="book-turn">
                {turn.underSrc && (
                  <div className="book-paper book-page-under" style={pageStyle(turn.page)}>
                    <div className="book-hole">
                      <img src={turn.underSrc} alt="" draggable={false} />
                    </div>
                  </div>
                )}
                <div className="book-gutter" style={pageStyle(turn.page)} aria-hidden="true" />
                <div className="book-leaf" data-dir={turn.dir} style={pageStyle(turn.page)}>
                  <div className="book-leaf-flip">
                    <div className="book-paper book-leaf-face book-leaf-front">
                      <div className="book-hole">
                        {turn.leafSrc && <img src={turn.leafSrc} alt="" draggable={false} />}
                      </div>
                    </div>
                    <div className="book-paper book-leaf-face book-leaf-back" aria-hidden="true" />
                  </div>
                </div>
              </div>
            )}
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
          /* 只标记「动画完了」，落地由上面等真图就绪的 effect 统一做 */
          onDone={() => setFlightDone(true)}
        />
      )}
    </div>
  )
}
