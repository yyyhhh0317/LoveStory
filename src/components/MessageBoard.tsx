import { useEffect, useRef, useState } from 'react'
import { repo } from '../lib/repo'
import { hashString, relativeTime } from '../lib/format'
import { type Message } from '../lib/types'
import { CloseIcon } from './icons'

interface Props {
  photoId: string
  open: boolean
  onClose: () => void
  onCountChange: (delta: number) => void
}

const MAX_LEN = 300

export function MessageBoard({ photoId, open, onClose, onCountChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setDraft('')
    repo
      .listMessages(photoId)
      .then((list) => {
        if (alive) setMessages(list)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [photoId])

  const submit = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const created = await repo.createMessage(photoId, content.slice(0, MAX_LEN))
      setMessages((prev) => [...prev, created])
      setDraft('')
      onCountChange(1)
      if (areaRef.current) areaRef.current.style.height = 'auto'
      requestAnimationFrame(() => {
        const el = listRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    } catch {
      /* 留言失败时保留草稿，用户可重试 */
    } finally {
      setSending(false)
    }
  }

  return (
    <aside className={`annot${open ? ' open' : ''}`} aria-label="留言板">
      <div className="annot-head">
        <h3>留言</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{messages.length > 0 ? `${messages.length} 条` : '还没有人说话'}</span>
          <button
            type="button"
            className="icon-btn"
            style={{ display: 'none' }}
            data-mobile-close
            onClick={onClose}
            aria-label="收起留言"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      <div className="annot-list" ref={listRef}>
        {loading && <div className="annot-empty">正在翻这一页…</div>}

        {!loading && messages.length === 0 && (
          <div className="annot-empty">
            这一张还没有留言
            <br />
            说点什么吧，谁都看不见你是谁
          </div>
        )}

        {messages.map((m) => {
          const h = hashString(m.id)
          const noteIndex = (h % 4) + 1
          const rot = ((h % 100) / 100 - 0.5) * 1.8
          return (
            <div
              key={m.id}
              className="note"
              style={{
                background: `var(--note-${noteIndex})`,
                ['--rot' as string]: `${rot}deg`,
              }}
            >
              {m.content}
              <div className="meta">{relativeTime(m.createdAt)}</div>
            </div>
          )
        })}
      </div>

      <div className="annot-form">
        <textarea
          ref={areaRef}
          value={draft}
          maxLength={MAX_LEN}
          placeholder="留一句给这张照片…"
          onChange={(e) => {
            setDraft(e.target.value)
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 140)}px`
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="row">
          <span className="hint">
            {draft.length > 0 ? `${draft.length} / ${MAX_LEN}` : '匿名 · ⌘↵ 发送'}
          </span>
          <button
            type="button"
            className="note-submit"
            disabled={!draft.trim() || sending}
            onClick={() => void submit()}
          >
            {sending ? '贴着…' : '贴上'}
          </button>
        </div>
      </div>
    </aside>
  )
}
