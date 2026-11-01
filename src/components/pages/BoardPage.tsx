import { useBoard } from '../../hooks/useBoard'
import { hashString, relativeTime } from '../../lib/format'
import { LoadingScreen } from '../ScreenStates'
import { Composer, MAX_MESSAGE_LEN } from '../Composer'

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

  /** 草稿、发送中、失败提示都在 Composer 里，这里只管写库和那声提示 */
  const submit = async (content: string) => {
    await board.add(content.slice(0, MAX_MESSAGE_LEN))
    say('贴上去了')
  }

  return (
    <div className="page-scroll">
      <div className="board">
        <div className="board-composer">
          <Composer
            variant="board"
            maxLength={MAX_MESSAGE_LEN}
            placeholder="说点什么…"
            ariaLabel="留言内容"
            onSubmit={submit}
          />
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
