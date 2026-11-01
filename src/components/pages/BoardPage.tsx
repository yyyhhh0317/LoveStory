import { useRef, useState } from 'react'
import { useBoard } from '../../hooks/useBoard'
import { hashString, relativeTime } from '../../lib/format'
import { LoadingScreen } from '../ScreenStates'

const MAX_LEN = 300

interface Props {
  say: (text: string, ms?: number) => void
}

/**
 * 站级留言板：平时想说的话，不挂在任何一张照片下面。
 *
 * 输入框吸在顶部而不是沉在底部：手机弹键盘时底部输入框会被遮住，
 * 要么监听 visualViewport 手动顶上去，要么就放上面。放上面这件事本身就不存在。
 */
export function BoardPage({ say }: Props) {
  const board = useBoard()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const submit = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setFailed(false)
    try {
      await board.add(content.slice(0, MAX_LEN))
      setDraft('')
      if (areaRef.current) areaRef.current.style.height = 'auto'
      say('贴上去了')
    } catch {
      // 草稿不清空：没发出去的时候，最先要保住的是那几行字
      setFailed(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="page-scroll">
      <div className="board">
        <div className="board-composer">
          <textarea
            ref={areaRef}
            value={draft}
            maxLength={MAX_LEN}
            placeholder="说点什么…"
            aria-label="留言内容"
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className="board-row">
            <span className="board-hint">
              {draft.length > 0 ? `${draft.length} / ${MAX_LEN}` : '匿名 · Ctrl + Enter 发送'}
            </span>
            <button
              type="button"
              className="solid-btn"
              disabled={!draft.trim() || sending}
              onClick={() => void submit()}
            >
              {sending ? '贴着…' : '贴上'}
            </button>
          </div>
          {failed && (
            <p className="board-error" role="alert">
              没贴上去 —— 文字还在框里，再点一次「贴上」
            </p>
          )}
        </div>

        {board.phase === 'loading' && <LoadingScreen variant="page" label="正在读留言" />}

        {board.phase === 'error' && (
          <div className="board-empty" role="alert">
            留言没读出来
            <br />
            <button
              type="button"
              className="ghost-btn board-retry"
              onClick={() => void board.reload()}
              disabled={board.refreshing}
            >
              {board.refreshing ? '正在连…' : '再试一次'}
            </button>
          </div>
        )}

        {board.phase === 'ready' && (
          <div className="board-list">
            {board.messages.length === 0 ? (
              <div className="board-empty">
                还没有人说话
                <br />
                上面那个框是空的，随便写。
              </div>
            ) : (
              <>
                {board.messages.map((m) => {
                  const h = hashString(m.id)
                  return (
                    <div
                      key={m.id}
                      className="note board-note"
                      style={{
                        background: `var(--note-${(h % 4) + 1})`,
                        ['--rot' as string]: `${((h % 100) / 100 - 0.5) * 1.4}deg`,
                      }}
                    >
                      {m.content}
                      <div className="meta">{relativeTime(m.createdAt)}</div>
                    </div>
                  )
                })}
                <p className="board-tail">到头了 · 一共 {board.messages.length} 条</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
