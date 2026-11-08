import { useCallback, useEffect, useRef, useState } from 'react'
import { processImage } from '../lib/image'
import { fromDateInputValue, toDateInputValue, uid } from '../lib/format'
import { usePresence } from '../lib/presence'
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
  /**
   * 这一轮上传结束时的汇总。
   *
   * failed 为 0 时一定会调用；有失败时只在**面板已经关掉**的情况下调用 ——
   * 面板开着的时候它自己会把失败项和提示摆出来，再弹一条 toast 是重复噪音。
   */
  onDone: (created: number, failed: number) => void
}

export function UploadSheet({ open, onClose, onSubmit, onDone }: Props) {
  const [items, setItems] = useState<PendingItem[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const urlsRef = useRef<string[]>([])
  /* 关闭时先淡出再卸载，所以「在不在 DOM 里」看 mounted，不看 open */
  const { mounted, closing } = usePresence(open)

  /*
   * 异步任务回来时得知道「现在面板还开着吗」「还在忙吗」。
   * 这两件事在 setTimeout / await 之后读 state 拿到的是旧值，所以各留一份 ref。
   */
  const openRef = useRef(open)
  openRef.current = open
  const busyRef = useRef(busy)
  busyRef.current = busy

  const resetPanel = useCallback(() => {
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    urlsRef.current = []
    setItems([])
    setError(null)
    setProgress(null)
    setBusy(false)
  }, [])

  /*
   * 清场要等真正卸载之后再做。
   * 挂在 open 上的话，按下关闭的那一帧缩略图就先没了，
   * 面板还要淡 240ms，中间那段是一个空壳 —— 比不做动画更难看。
   *
   * 但**上传还在跑的时候不能清**：清了之后 Promise 回来会往空列表里
   * 追加（再打开就看到几张凭空出现的待传项），失败提示也写进了一个
   * 已经空掉的面板。这里先放它一马，任务自己收尾时会清（成功）
   * 或者把失败项留着（失败，下次打开继续传）。
   */
  useEffect(() => {
    if (mounted) return
    if (busyRef.current) return
    resetPanel()
  }, [mounted, resetPanel])

  /* 面板只有「点遮罩 / 点 X / 点先不传」三条关闭路径，键盘用户被关在里面 */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

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
        /*
         * 全部成功。
         *
         * 面板还开着时**不能在这里清**：那会让待传列表在 260ms 的淡出
         * 途中先塌掉，看起来像闪了一下。交给淡出结束后那次清场去做
         * （那时 busy 已经是 false，不会被「还在忙」挡住）。
         * 面板已经关掉的（上传途中被关）必须现在清，否则下次打开是
         * 一排「已就绪」，像没传过一样。
         */
        if (!openRef.current) resetPanel()
        onDone(created.length, 0)
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
          ? `成功上传 ${created.length} 张，还有 ${failed.length} 张没上传。再点一次「收进来」接着传就好啦`
          : `这 ${failed.length} 张都没传上去，可能是网络断了，再点一次试试。`
      )
      /* 面板已经关了，上面那段话他看不见 —— 至少让 toast 说一声 */
      if (!openRef.current) onDone(created.length, failed.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，检查一下网络')
      if (!openRef.current) onDone(0, items.length)
    } finally {
      setBusy(false)
    }
  }

  const remaining = items.length

  return (
    <div
      className={`sheet-backdrop${closing ? ' closing' : ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label="上传照片">
        <div className="sheet-head">
          <div>
            <h2>加入相册</h2>
            <p>
              照片会在本地压成两档再上传，原图不上传，所以能存很久。
              <br />
              简介可以留空，之后在详情页可以再补哦
            </p>
          </div>
          <button
            type="button"
            className="icon-btn icon-btn--on-light"
            onClick={onClose}
            aria-label="关闭"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="sheet-body">
          {/* 这里原来是个 div：全站最重要的入口，键盘完全到不了 */}
          <button
            type="button"
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
            <span className="big">
              {busy
                ? `正在处理 ${progress?.done ?? 0} / ${progress?.total ?? 0}`
                : '点这里选照片'}
            </span>
            <span className="small">也可以直接把照片拖进来 · 支持多选 · JPG / PNG / WEBP</span>
          </button>

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
            <p className="sheet-error" role="alert">
              {error}
            </p>
          )}

          {items.length > 0 && (
            <div className="pending-list">
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
            {busy
              ? '正在处理 · 关掉也不会中断'
              : remaining > 0
                ? `已就绪 ${remaining} 张`
                : '一次可以放很多张'}
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
              {busy && remaining ? '正在上传' : `加入相册${remaining ? `（${remaining}）` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
