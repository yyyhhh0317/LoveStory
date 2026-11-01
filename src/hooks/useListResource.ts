import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { describeError, LOAD_TIMEOUT_MS, type FriendlyError } from '../lib/errors'

export type ListPhase = 'loading' | 'ready' | 'error'

/**
 * 会话级缓存槽，容量 1。
 *
 * 放在模块作用域而不是 hook 里：组件随路由卸载，缓存要活过卸载 ——
 * 切到相册再切回来，不该重新闪一次加载页、也不该多打一次请求。
 * 每个列表一个槽，由各自的 hook 建好传进来。
 */
export interface ListCache<T> {
  current: T[] | null
}

export function createListCache<T>(): ListCache<T> {
  return { current: null }
}

interface Options<T> {
  cache: ListCache<T>
  /**
   * 必须是稳定引用（模块级函数），否则 reload 每轮都换、effect 会重复拉。
   */
  load: (signal?: AbortSignal) => Promise<T[]>
  /** 稳定的归一化（排序）；不传就原样使用 */
  normalize?: (list: T[]) => T[]
}

export interface ListResource<T> {
  items: T[]
  /** 与 items 同步的 ref，写操作里读当前值不必等下一轮渲染 */
  itemsRef: MutableRefObject<T[]>
  phase: ListPhase
  error: FriendlyError | null
  refreshing: boolean
  reload: () => Promise<void>
  /** 写穿：缓存 + ref + state 一次改齐，免得三处各写一遍漏掉一处 */
  commit: (next: T[]) => void
}

/**
 * 「一个远程列表」的完整状态机。
 *
 *   loading ──成功──▶ ready
 *      │                ▲
 *      └──失败/超时──▶ error ──重试成功──┘
 *
 * 留言板和计划清单只有排序、插入位置不同，其余（代次守卫、切页 abort、
 * 超时竞速、相位迁移、缓存写穿）逐行一样 —— 那份一样的东西在这里，
 * 各页面只保留自己那点业务。
 */
export function useListResource<T>({ cache, load, normalize }: Options<T>): ListResource<T> {
  const [items, setItems] = useState<T[]>(() => {
    const seed = cache.current
    if (!seed) return []
    return normalize ? normalize(seed) : seed
  })
  const [phase, setPhase] = useState<ListPhase>(() => (cache.current ? 'ready' : 'loading'))
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const itemsRef = useRef(items)
  itemsRef.current = items
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  /** 代次守卫：只有最后一次发起的那轮允许改状态 */
  const gen = useRef(0)
  const inflight = useRef<AbortController | null>(null)

  const commit = useCallback(
    (next: T[]) => {
      const normalized = normalize ? normalize(next) : next
      cache.current = normalized
      itemsRef.current = normalized
      setItems(normalized)
    },
    [cache, normalize]
  )

  const reload = useCallback(async () => {
    const my = ++gen.current
    setRefreshing(true)
    inflight.current?.abort()
    const ac = new AbortController()
    inflight.current = ac

    // 手上已有内容就不退回加载页，否则整个列表会闪一下白
    if (!cache.current && phaseRef.current !== 'error') setPhase('loading')

    let timer: number | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('TIMEOUT')), LOAD_TIMEOUT_MS)
    })

    try {
      const list = await Promise.race([load(ac.signal), timeout])
      if (my !== gen.current) return
      commit(list)
      setError(null)
      setPhase('ready')
    } catch (err) {
      if (my !== gen.current) return
      setError(describeError(err))
      // 有缓存就保住画面，只把「这次没读到」记在 error 上
      setPhase(cache.current ? 'ready' : 'error')
    } finally {
      window.clearTimeout(timer)
      if (my === gen.current) setRefreshing(false)
    }
  }, [cache, load, commit])

  useEffect(() => {
    void reload()
    return () => inflight.current?.abort()
  }, [reload])

  return { items, itemsRef, phase, error, refreshing, reload, commit }
}
