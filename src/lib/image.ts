/*
 * 两档尺寸的取舍（2026-10-26 按实测显示尺寸重定）：
 *
 * 缩略图：画布上最宽也只有 250 世界单位 × 0.62 初始缩放 ≈ 155 CSS px，
 *   放大到 1.0 也就 250px。原来存 720px 边，等于多传 2~4 倍的像素 ——
 *   首屏三十几张同时下载，慢网下就是「要等一会儿才长出来」。
 *   560px 在 2.5 倍放大内都看不出糊，字节数只剩原来的 60%。
 *
 * 大图：详情页最长边按视口算，1280×820 的窗口最多 820 CSS px，
 *   2 倍屏 1640px 已经够，2048 是白给。1800 + q82 比 2048 + q86 小 ~45%。
 */
const THUMB_EDGE = 560
const THUMB_QUALITY = 0.8
const FULL_EDGE = 1800
const FULL_QUALITY = 0.82

export interface ProcessedImage {
  thumb: Blob
  full: Blob
  width: number
  height: number
  takenAt: string
}

function getString(view: DataView, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i)
    if (code === 0) break
    out += String.fromCharCode(code)
  }
  return out
}

function parseTiff(view: DataView, base: number): string | null {
  const order = view.getUint16(base, false)
  const little = order === 0x4949
  if (!little && order !== 0x4d4d) return null
  if (base + 8 > view.byteLength) return null

  const ifd0 = view.getUint32(base + 4, little)
  if (base + ifd0 + 2 > view.byteLength) return null
  const count = view.getUint16(base + ifd0, little)

  let exifIfd = 0
  for (let i = 0; i < count; i++) {
    const entry = base + ifd0 + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    if (view.getUint16(entry, little) === 0x8769) {
      exifIfd = view.getUint32(entry + 8, little)
    }
  }
  if (!exifIfd || base + exifIfd + 2 > view.byteLength) return null

  const exifCount = view.getUint16(base + exifIfd, little)
  for (let i = 0; i < exifCount; i++) {
    const entry = base + exifIfd + 2 + i * 12
    if (entry + 12 > view.byteLength) break
    if (view.getUint16(entry, little) !== 0x9003) continue

    const len = view.getUint32(entry + 4, little)
    const valueOffset = base + view.getUint32(entry + 8, little)
    if (valueOffset + len > view.byteLength) return null
    const raw = getString(view, valueOffset, Math.min(len, 24))
    const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (!m) return null
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

/** 只读 JPEG 的 EXIF DateTimeOriginal，不引第三方库 */
async function readExifDate(file: File): Promise<string | null> {
  try {
    const head = await file.slice(0, 384 * 1024).arrayBuffer()
    const view = new DataView(head)
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null

    let offset = 2
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset, false)
      if ((marker & 0xff00) !== 0xff00) break
      const size = view.getUint16(offset + 2, false)
      if (size < 2) break
      if (marker === 0xffe1 && getString(view, offset + 4, 4) === 'Exif') {
        return parseTiff(view, offset + 10)
      }
      if (marker === 0xffda) break
      offset += 2 + size
    }
  } catch {
    /* 忽略：读不到就用文件时间兜底 */
  }
  return null
}

type Drawable = ImageBitmap | HTMLImageElement

async function decode(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* 某些浏览器对 HEIC/异常文件不支持，走 img 兜底 */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('这个格式浏览器打不开，换一张 JPEG 试试'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }
}

function sizeOf(source: Drawable): { w: number; h: number } {
  if ('naturalWidth' in source) return { w: source.naturalWidth, h: source.naturalHeight }
  return { w: source.width, h: source.height }
}

async function toBlob(source: Drawable, maxEdge: number, quality: number): Promise<Blob> {
  const { w, h } = sizeOf(source)
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持图片处理')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source as CanvasImageSource, 0, 0, tw, th)

  const webp = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  )
  /*
   * 画完立刻把画布退回 0×0：canvas 的后备位图要等 GC 才释放，
   * 连续处理十几张时峰值内存会叠到几百 MB，上传面板直接卡死。
   */
  canvas.width = 0
  canvas.height = 0

  if (webp && webp.size > 0) return webp

  // WebP 编码失败才退 JPEG，此时要重画一遍（画布已经释放了）
  const fallback = document.createElement('canvas')
  fallback.width = tw
  fallback.height = th
  const fctx = fallback.getContext('2d')
  if (!fctx) throw new Error('图片压缩失败')
  fctx.imageSmoothingQuality = 'high'
  fctx.drawImage(source as CanvasImageSource, 0, 0, tw, th)
  const jpeg = await new Promise<Blob | null>((resolve) =>
    fallback.toBlob(resolve, 'image/jpeg', quality)
  )
  fallback.width = 0
  fallback.height = 0
  if (!jpeg) throw new Error('图片压缩失败')
  return jpeg
}

/** 让出一帧，进度数字才来得及画出来（解码/编码都是主线程大块任务） */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else window.setTimeout(resolve, 0)
  })

/**
 * 上传前的处理：压两档（画布用缩略图、详情页用大图），并读出拍摄时间。
 * 原图不入库——为的是让 1GB 的空间能装下好几年的照片。
 *
 * 两档串行而不是 Promise.all：并行会让两块画布同时存在，
 * 一张 12MP 的照片要多占 ~40MB，手机上传十来张就有概率被系统杀掉标签页。
 * 串行多花的时间是编码，反正也是主线程在等，不差这一点。
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  const [drawable, exifDate] = await Promise.all([decode(file), readExifDate(file)])
  const { w, h } = sizeOf(drawable)
  if (!w || !h) throw new Error('图片尺寸异常')

  const full = await toBlob(drawable, FULL_EDGE, FULL_QUALITY)
  await nextFrame()
  const thumb = await toBlob(drawable, THUMB_EDGE, THUMB_QUALITY)

  if ('close' in drawable && typeof drawable.close === 'function') drawable.close()

  const fallback = file.lastModified ? new Date(file.lastModified) : new Date()

  return {
    thumb,
    full,
    width: w,
    height: h,
    takenAt: exifDate ?? fallback.toISOString(),
  }
}

export async function blobToObjectUrl(blob: Blob): Promise<string> {
  return URL.createObjectURL(blob)
}
