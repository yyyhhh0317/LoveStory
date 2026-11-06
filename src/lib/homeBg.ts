/**
 * 首页背景的「怎么摆」。
 *
 * 和「开不开」（`yyyhhh:home-bg`）分两个键存：
 * 关掉背景不该丢掉你调好的位置和浓淡，再打开要还是上次那个样子。
 *
 * 只存 `storageKey`，不存图片 URL —— 和数据库同一条规矩：
 * URL 由 repo 层现拼，换存储只改那一处。
 */
export interface HomeBgFit {
  /** builtin = 随包发的那张合照；album = 相册里挑的一张 */
  kind: 'builtin' | 'album'
  /** kind === 'album' 时是照片的 storage_key */
  key: string | null
  /** object-position，0–100。50/50 是居中，数字越小越靠左上 */
  x: number
  y: number
  /**
   * 缩放，1 = 刚好铺满（cover）。
   *
   * 不是锦上添花：cover 在竖屏上几乎总是「高度刚好、宽度溢出」，
   * 没有缩放时纵向一点余量都没有，上下拖是纹丝不动的。想把人脸从数字
   * 底下挪开，就靠这个把图放大，换来两个方向都能拖。
   */
  zoom: number
  /** 照片自身的浓淡，1 = 完全不透明 */
  alpha: number
}

export const BG_ON_KEY = 'yyyhhh:home-bg'
const FIT_KEY = 'yyyhhh:home-bg-fit'

/** 滑到底也留一点影子：全透明等于没有背景，那不如直接关掉 */
export const MIN_ALPHA = 0.3
/** 放大上限。2 倍已经足够把一张横图裁成竖构图，再大就开始糊了 */
export const MAX_ZOOM = 2

export const DEFAULT_FIT: HomeBgFit = {
  kind: 'builtin',
  key: null,
  x: 50,
  y: 50,
  zoom: 1,
  alpha: 1,
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * localStorage 里的东西一律当不可信：手改过、被降级写过、或者以后换了格式，
 * 任何一个字段烂掉都只回落那一项，不整条丢掉。
 */
export function readFit(): HomeBgFit {
  try {
    const raw = localStorage.getItem(FIT_KEY)
    if (!raw) return DEFAULT_FIT
    const v = JSON.parse(raw) as Partial<HomeBgFit>
    const kind = v.kind === 'album' && typeof v.key === 'string' && v.key ? 'album' : 'builtin'
    return {
      kind,
      key: kind === 'album' ? (v.key as string) : null,
      x: typeof v.x === 'number' && Number.isFinite(v.x) ? clamp(v.x, 0, 100) : 50,
      y: typeof v.y === 'number' && Number.isFinite(v.y) ? clamp(v.y, 0, 100) : 50,
      zoom:
        typeof v.zoom === 'number' && Number.isFinite(v.zoom)
          ? clamp(v.zoom, 1, MAX_ZOOM)
          : 1,
      alpha:
        typeof v.alpha === 'number' && Number.isFinite(v.alpha)
          ? clamp(v.alpha, MIN_ALPHA, 1)
          : 1,
    }
  } catch {
    return DEFAULT_FIT
  }
}

export function writeFit(fit: HomeBgFit): void {
  try {
    localStorage.setItem(FIT_KEY, JSON.stringify(fit))
  } catch {
    /* 无痕模式：这次会话有效就行 */
  }
}
