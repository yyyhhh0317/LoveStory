import { useEffect, useRef, useState } from 'react'
import { repo } from '../lib/repo'
import { hashString, relativeTime } from '../lib/format'
import { type Message } from '../lib/types'
import { CloseIcon } from './icons'
import { Composer, MAX_MESSAGE_LEN } from './Composer'

interface Props {
  photoId: string
  open: boolean
  onClose: () => void
  onCountChange: (delta: number) => void
}

/**
 * 宽屏（≥901px）时这块面板是常驻的一列，窄屏才靠 .open 当抽屉拉出来。
 * 判断「用户看不看得见」必须把两种形态都算上，只看 open 会让桌面端永远读不到留言。
 */
const WIDE = '(min-width: 901px)'

/**
 * 会话内的留言缓存。
 *
 * 详情页这条查询实测 2.7 秒，而同一张照片的留言在几秒内几乎不会变。
 * 翻回看过的照片就重下一遍是纯浪费，而且换图时它还在抢带宽。
 * 只留最近 24 张 —— 再往前翻已经离得太远，留着只是占内存。
 */
const CACHE_MAX = 24
const cache = new Map<string, Message[]>()

function remember(photoId: string, list: Message[]) {
  cache.delete(photoId) // 先删再插：让它排到队尾，成为「最近用过」的那个
  cache.set(photoId, list)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function MessageBoard({ photoId, open, onClose, onCountChange }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  /* 留言读不出来和「真的没有留言」也是两件事，不能都显示成「还没有留言」 */
  const [loadFailed, setLoadFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(WIDE).matches
  )
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mq = window.matchMedia(WIDE)
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const visible = wide || open

  useEffect(() => {
    /*
     * 只在用户看得见的时候读。
     *
     * 这块面板原来跟着 photoId 走 —— 在详情页每翻一张就安静地发一次请求，
     * 远端的每一条往返都在抢换图那几百毫秒的带宽。
     * 窄屏收起时它压根不显示，没有理由去读。
     */
    if (!visible) return
    let alive = true
    /*
     * 换页时把上一条请求掐掉。
     * 宽屏下这块面板常驻，翻一页发一次 —— 连翻八张就是八条并发，
     * 在 Supabase 那头排队，反过来把当前这张挤得更慢。
     */
    const ac = new AbortController()

    const hit = cache.get(photoId)
    if (hit) {
      // 有缓存就先摆出来，界面上不该再闪一次「正在翻这一页…」
      setMessages(hit)
      setLoading(false)
    } else {
      /*
       * 必须清空：列表是一直渲染的（loading 只是叠在它上面一层提示），
       * 不清就会把上一张的留言留在下面，看起来像是这张的。
       */
      setMessages([])
      setLoading(true)
    }
    setLoadFailed(false)

    repo
      .listMessages(photoId, ac.signal)
      .then((list) => {
        if (!alive) return
        remember(photoId, list)
        setMessages(list)
      })
      .catch(() => {
        if (!alive || ac.signal.aborted) return
        /*
         * 手上有旧内容时不把整块换成「没读出来」——
         * 那会把已经看到的留言一起抹掉，比显示一份稍旧的内容更糟。
         */
        if (!hit) setLoadFailed(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    return () => {
      alive = false
      ac.abort()
    }
  }, [photoId, retryKey, visible])

  /**
   * 提交一条留言。草稿、发送中、失败提示都在 Composer 里，
   * 这里只做「这一张照片的留言」该做的事：写库、并进列表与缓存、报数、滚到底。
   * 抛错会被 Composer 接住 —— 那边负责保住草稿并给提示。
   */
  const submit = async (content: string) => {
    const created = await repo.createMessage(photoId, content.slice(0, MAX_MESSAGE_LEN))
    const next = [...messages, created]
    setMessages(next)
    // 顺手把缓存也更新掉，否则翻走再翻回来会看到「少一条」
    remember(photoId, next)
    onCountChange(1)
    requestAnimationFrame(() => {
      const el = listRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  return (
    <aside id="annot-panel" className={`annot${open ? ' open' : ''}`} aria-label="留言板">
      <div className="annot-head">
        <h3>留言</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>
            {loading
              ? '正在加载…'
              : loadFailed
                ? '加载失败'
                : messages.length > 0
                  ? `${messages.length} 条`
                  : '还没有留言'}
          </span>
          <button
            type="button"
            className="icon-btn icon-btn--on-dark"
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
        {loading && <div className="annot-empty">正在加载这一页…</div>}

        {!loading && loadFailed && (
          <div className="annot-empty">
            这一页的留言加载失败
            <br />
            <button
              type="button"
              className="annot-retry"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              再试一次
            </button>
          </div>
        )}

        {!loading && !loadFailed && messages.length === 0 && (
          <div className="annot-empty">
            这一张还没有人留言
            <br />
            说点什么吧~
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
        {/* key 用 photoId：换一张照片就是另一块留言区，草稿不该跟过去 */}
        <Composer
          key={photoId}
          variant="note"
          placeholder="给这张照片留句话吧~"
          onSubmit={submit}
        />
      </div>
    </aside>
  )
}
