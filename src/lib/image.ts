const THUMB_EDGE = 480
const FULL_EDGE = 2048

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
  if (webp && webp.size > 0) return webp

  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality)
  )
  if (!jpeg) throw new Error('图片压缩失败')
  return jpeg
}

/**
 * 上传前的处理：压两档（画布用缩略图、详情页用大图），并读出拍摄时间。
 * 原图不入库——为的是让 1GB 的空间能装下好几年的照片。
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  const [drawable, exifDate] = await Promise.all([decode(file), readExifDate(file)])
  const { w, h } = sizeOf(drawable)
  if (!w || !h) throw new Error('图片尺寸异常')

  const [thumb, full] = await Promise.all([
    toBlob(drawable, THUMB_EDGE, 0.82),
    toBlob(drawable, FULL_EDGE, 0.86),
  ])

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
