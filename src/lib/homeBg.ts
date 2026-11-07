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
  /**
   * 清晰度，1 = 原图（一点不糊），0 = 完全虚化。
   *
   * 这里量的是「照片多清楚」，不是它多透明：照片始终是它自己那个样子，
   * 糊与不糊全靠模糊半径，不再拿半透明去跟粉底混（混出来是一层灰雾，
   * 既不是原图也不好看）。
   */
  clarity: number
}

export const BG_ON_KEY = 'yyyhhh:home-bg'
const FIT_KEY = 'yyyhhh:home-bg-fit'

/** 放大上限。2 倍已经足够把一张横图裁成竖构图，再大就开始糊了 */
export const MAX_ZOOM = 2

/** 清晰度 0 时的模糊半径。再大（40px）就只剩几块颜色，照片等于没了 */
export const MAX_BLUR = 32

/**
 * 清晰度 → 模糊半径，线性。
 *
 * 不用平方之类的手感曲线：滑块上写着百分比，人就会按百分比理解它，
 * 拖到一半就该是「差不多一半糊」。
 */
export const blurOf = (clarity: number) => MAX_BLUR * (1 - clarity)

/**
 * 清晰度 → 粉纱浓度。
 *
 * 照片越清楚，纱越该让开 —— 「拉满就是原图」得真的看得见原片；
 * 糊到只剩色块时纱又得压回来，一头是托住深色文字，一头是让「完全虚化」
 * 这一档仍看得出是这个站的粉，而不是一团灰绿的噪点。
 */
export const veilOf = (clarity: number) => 64 - 48 * clarity

/**
 * 清晰度 → 计时器底衬的不透明度（%）。
 *
 * 底衬是唯一能在「任意照片」下保证文字对比度的手段：深色字压在深色照片上
 * 没有数值可调，只能垫一层和照片无关的亮度。这条曲线是按最坏情况
 * （近黑照片 Y≈0.02）在每一档清晰度下验算 WCAG 4.5:1 反解出来的：
 *
 *   clarity  0    0.25  0.5   0.75  1.0
 *   纱浓度   64%  52%   40%   28%   16%   ← 纱先垫一层
 *   所需底衬 20%  38%   48%   56%   62%
 *   本曲线   26%  40%   54%   68%   82%   ← 全部过线，留了余量
 *
 * 0% 那档不归零：背景虽已是粉色雾，暗照片下调到 0 仍会掉到 2.9:1。
 * 26% 在雾面上视觉上等于没有，但把最坏情况从 2.9 拉回 4.5。
 */
export const plateOf = (clarity: number) => 26 + 56 * clarity

export const DEFAULT_FIT: HomeBgFit = {
  kind: 'builtin',
  key: null,
  x: 50,
  y: 50,
  zoom: 1,
  /* 0.75 → 8px，和从前的定值一致：进来第一眼不该跟以前差太多 */
  clarity: 0.75,
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
          : DEFAULT_FIT.zoom,
      /*
       * 老数据里这个位置叫 alpha（照片浓淡）。两边都是 0–1、都是越大越清楚，
       * 直接拿来当清晰度用就行 —— 用户调过的值不会因为改名被打回默认。
       */
      clarity:
        typeof v.clarity === 'number' && Number.isFinite(v.clarity)
          ? clamp(v.clarity, 0, 1)
          : typeof (v as { alpha?: unknown }).alpha === 'number' &&
              Number.isFinite((v as { alpha: number }).alpha)
            ? clamp((v as { alpha: number }).alpha, 0, 1)
            : DEFAULT_FIT.clarity,
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
