import { useCallback, useEffect, useRef, useState } from 'react'
import { repo } from '../lib/repo'
import { describeError, type FriendlyError } from '../lib/errors'
import type { BoardMessage } from '../lib/types'

const LOAD_TIMEOUT_MS = 15000

export type ListPhase = 'loading' | 'ready' | 'error'

/**
 * 会话级缓存：切到相册再切回来，不该重新闪一次加载页、也不该多打一次请求。
 * 容量 1 —— 这个页面只有一份数据。
 */
let cache: BoardMessage[] | null = null

export function useBoard() {
  const [messages, setMessages] = useState<BoardMessage[]>(() => cache ?? [])
  const [phase, setPhase] = useState<ListPhase>(() => (cache ? 'ready' : 'loading'))
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const msgsRef = useRef(messages)
  msgsRef.current = messages
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  /** 代次守卫：只有最后一次发起的那轮允许改状态 */
  const gen = useRef(0)
  const inflight = useRef<AbortController | null>(null)

  const reload = useCallback(async () => {
    const my = ++gen.current
    setRefreshing(true)
    inflight.current?.abort()
    const ac = new AbortController()
    inflight.current = ac

    // 手上已有内容就不退回加载页，否则整个列表会闪一下白
    if (!cache && phaseRef.current !== 'error') setPhase('loading')

    let timer: number | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('TIMEOUT')), LOAD_TIMEOUT_MS)
    })

    try {
      const list = await Promise.race([repo.listBoardMessages(ac.signal), timeout])
      if (my !== gen.current) return
      cache = list
      setMessages(list)
      setError(null)
      setPhase('ready')
    } catch (err) {
      if (my !== gen.current) return
      setError(describeError(err))
      // 有缓存就保住画面，只把「这次没读到」记在 error 上
      setPhase(cache ? 'ready' : 'error')
    } finally {
      window.clearTimeout(timer)
      if (my === gen.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return () => inflight.current?.abort()
  }, [reload])

  /**
   * 不做乐观插入：新建的行没有真实 id，假 id 会让便签的配色（hashString）
   * 先渲染成一个颜色、拿到真 id 后又跳成另一个。等一次往返更稳。
   */
  const add = useCallback(async (raw: string) => {
    const content = raw.trim()
    if (!content) return null
    const created = await repo.createBoardMessage(content)
    if (msgsRef.current.some((m) => m.id === created.id)) return created
    const next = [created, ...msgsRef.current]
    cache = next
    msgsRef.current = next
    setMessages(next)
    return created
  }, [])

  return { messages, phase, error, refreshing, reload, add }
}
