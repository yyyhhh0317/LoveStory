import { useEffect, useRef, useState } from 'react'
import { useImgUrl } from '../hooks/useImgUrl'
import { formatDayCn } from '../lib/format'
import type { Photo } from '../lib/types'
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
  onSaveCaption: (photo: Photo, caption: string | null) => void
  onDelete: (photo: Photo) => void
  messageCount: number
  onMessageCountChange: (delta: number) => void
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
}: Props) {
  const photo = photos[index]
  const fullUrl = useImgUrl(photo?.storageKey ?? null, 'full')
  const thumbUrl = useImgUrl(photo?.storageKey ?? null, 'thumb')

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [annotOpen, setAnnotOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setEditing(false)
    setConfirmDelete(false)
    setAnnotOpen(false)
  }, [photo?.id])

  useEffect(() => {
    if (editing) textRef.current?.focus()
  }, [editing])

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
      if (e.key === 'ArrowLeft') onIndexChange(Math.max(0, index - 1))
      if (e.key === 'ArrowRight') onIndexChange(Math.min(photos.length - 1, index + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, index, photos.length, onClose, onIndexChange])

  if (!photo) return null

  const startEdit = () => {
    setDraft(photo.caption ?? '')
    setEditing(true)
  }

  const commit = () => {
    onSaveCaption(photo, draft.trim() ? draft.trim() : null)
    setEditing(false)
  }

  const go = (delta: number) => {
    const next = index + delta
    if (next >= 0 && next < photos.length) onIndexChange(next)
  }

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="viewer">
      {/*
        氛围层：拿当前照片自己做底。缩到很小再放大，靠插值得到柔焦，
        比直接对全屏元素做大半径 blur 便宜得多（小尺寸只光栅一次）。
        每换一张照片它就整体淡入一次，跟着照片的色调走。
      */}
      {thumbUrl && (
        <div
          key={photo.id}
          className="viewer-ambience"
          style={{ backgroundImage: `url("${thumbUrl}")` }}
          aria-hidden="true"
        />
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
            <img
              key={photo.id}
              src={fullUrl ?? thumbUrl ?? undefined}
              alt={photo.caption ?? ''}
              draggable={false}
            />
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
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      commit()
                    }
                  }}
                />
                <div className="caption-hint">
                  <span>{draft.length} / 160 · 可选</span>
                  <button type="button" onClick={commit}>
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
    </div>
  )
}
