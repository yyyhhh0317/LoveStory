import { useEffect, useRef, useState } from 'react'
import { processImage } from '../lib/image'
import { fromDateInputValue, toDateInputValue, uid } from '../lib/format'
import type { NewPhotoInput, Photo } from '../lib/types'
import { CloseIcon } from './icons'

interface PendingItem {
  key: string
  previewUrl: string
  thumb: Blob
  full: Blob
  width: number
  height: number
  takenAt: string
  caption: string
  fileName: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (items: NewPhotoInput[]) => Promise<{ created: Photo[]; failed: NewPhotoInput[] }>
  onDone: (count: number) => void
}

export function UploadSheet({ open, onClose, onSubmit, onDone }: Props) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const urlsRef = useRef<string[]>([])

  useEffect(() => {
    if (!open) {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      urlsRef.current = []
      setItems([])
      setError(null)
      setProgress(null)
      setBusy(false)
    }
  }, [open])

  if (!open) return null

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (!list.length) {
      setError('这些文件不是图片')
      return
    }
    setBusy(true)
    setError(null)
    setProgress({ done: 0, total: list.length })

    for (let i = 0; i < list.length; i++) {
      const file = list[i]
      try {
        const processed = await processImage(file)
        const url = URL.createObjectURL(processed.thumb)
        urlsRef.current.push(url)
        setItems((prev) => [
          ...prev,
          {
            key: uid(),
            previewUrl: url,
            thumb: processed.thumb,
            full: processed.full,
            width: processed.width,
            height: processed.height,
            takenAt: processed.takenAt,
            caption: '',
            fileName: file.name,
          },
        ])
      } catch (err) {
        setError(err instanceof Error ? err.message : '有一张处理失败了')
      }
      setProgress({ done: i + 1, total: list.length })
    }

    setBusy(false)
    setProgress(null)
  }

  const submit = async () => {
    if (!items.length || busy) return
    setBusy(true)
    try {
      const payload: NewPhotoInput[] = items.map((it) => ({
        storageKey: it.key,
        width: it.width,
        height: it.height,
        takenAt: it.takenAt,
        caption: it.caption.trim() ? it.caption.trim() : null,
        thumb: it.thumb,
        full: it.full,
      }))
      const { created, failed } = await onSubmit(payload)

      if (!failed.length) {
        onDone(created.length)
        onClose()
        return
      }

      /*
       * 部分失败：面板留着，只保留没上去的那几张。
       * 关键是 **保留它们原来的 key**——重试时 storageKey 不变，
       * 仓储层才能把已经传好的那一档认领回来，而不是撞「已存在」。
       */
      const failedKeys = new Set(failed.map((f) => f.storageKey))
      setItems((prev) => prev.filter((it) => failedKeys.has(it.key)))
      setError(
        created.length
          ? `收进来 ${created.length} 张，还有 ${failed.length} 张没上去。再点一次「收进来」接着传就好。`
          : `这 ${failed.length} 张都没传上去，可能是网络断了，再点一次试试。`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，检查一下网络')
    } finally {
      setBusy(false)
    }
  }

  const remaining = items.length

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="上传照片">
        <div className="sheet-head">
          <div>
            <h2>收进相册</h2>
            <p>
              照片会在本地压成两档再上传，原图不上传，所以能存很久。
              <br />
              简介可以留空，之后在详情页随时补。
            </p>
          </div>
          <button type="button" className="icon-btn" style={{ color: 'var(--ink-faint)' }} onClick={onClose} aria-label="关闭">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="sheet-body">
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              void addFiles(e.dataTransfer.files)
            }}
          >
            <div className="big">{busy ? `正在处理 ${progress?.done ?? 0} / ${progress?.total ?? 0}` : '点这里选照片'}</div>
            <div className="small">也可以直接把照片拖进来 · 支持多选 · JPG / PNG / WEBP</div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />

          {error && (
            <p style={{ margin: '12px 2px 0', fontSize: 12, color: '#b4574f', lineHeight: 1.7 }}>
              {error}
            </p>
          )}

          {items.length > 0 && (
            <div className="pending-list" style={{ marginTop: 16 }}>
              {items.map((it) => (
                <div className="pending-item" key={it.key}>
                  <div className="thumb">
                    <img src={it.previewUrl} alt="" />
                  </div>
                  <div className="fields">
                    <input
                      type="date"
                      value={toDateInputValue(it.takenAt)}
                      onChange={(e) => {
                        const next = fromDateInputValue(e.target.value, it.takenAt)
                        setItems((prev) =>
                          prev.map((p) => (p.key === it.key ? { ...p, takenAt: next } : p))
                        )
                      }}
                    />
                    <textarea
                      value={it.caption}
                      maxLength={160}
                      placeholder="两句话，可选"
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((p) =>
                            p.key === it.key ? { ...p, caption: e.target.value } : p
                          )
                        )
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="remove"
                    onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))}
                    aria-label="移除这张"
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sheet-foot">
          <span className="tip">
            {remaining > 0 ? `已就绪 ${remaining} 张` : '一次可以放很多张，慢慢来'}
          </span>
          <div className="actions">
            <button type="button" className="text-btn" onClick={onClose}>
              先不传
            </button>
            <button
              type="button"
              className="solid-btn"
              disabled={!remaining || busy}
              onClick={() => void submit()}
            >
              {busy && remaining ? '正在上传' : `收进来${remaining ? `（${remaining}）` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
