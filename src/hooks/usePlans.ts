import { useCallback, useEffect, useRef, useState } from 'react'
import { repo } from '../lib/repo'
import { describeError, type FriendlyError } from '../lib/errors'
import type { Plan } from '../lib/types'

const LOAD_TIMEOUT_MS = 15000

export type ListPhase = 'loading' | 'ready' | 'error'

let cache: Plan[] | null = null

/** 未完成：先加的在前。已完成：刚勾下去的在前 */
function sortPlans(list: Plan[]): Plan[] {
  return [...list].sort((a, b) => {
    if (!a.doneAt && !b.doneAt) {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    }
    if (!a.doneAt) return -1
    if (!b.doneAt) return 1
    return new Date(b.doneAt).getTime() - new Date(a.doneAt).getTime()
  })
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>(() => sortPlans(cache ?? []))
  const [phase, setPhase] = useState<ListPhase>(() => (cache ? 'ready' : 'loading'))
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const plansRef = useRef(plans)
  plansRef.current = plans
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const gen = useRef(0)
  const inflight = useRef<AbortController | null>(null)

  const commit = useCallback((next: Plan[]) => {
    const sorted = sortPlans(next)
    cache = sorted
    plansRef.current = sorted
    setPlans(sorted)
  }, [])

  const reload = useCallback(async () => {
    const my = ++gen.current
    setRefreshing(true)
    inflight.current?.abort()
    const ac = new AbortController()
    inflight.current = ac

    if (!cache && phaseRef.current !== 'error') setPhase('loading')

    let timer: number | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('TIMEOUT')), LOAD_TIMEOUT_MS)
    })

    try {
      const list = await Promise.race([repo.listPlans(ac.signal), timeout])
      if (my !== gen.current) return
      commit(list)
      setError(null)
      setPhase('ready')
    } catch (err) {
      if (my !== gen.current) return
      setError(describeError(err))
      setPhase(cache ? 'ready' : 'error')
    } finally {
      window.clearTimeout(timer)
      if (my === gen.current) setRefreshing(false)
    }
  }, [commit])

  useEffect(() => {
    void reload()
    return () => inflight.current?.abort()
  }, [reload])

  const add = useCallback(
    async (raw: string) => {
      const title = raw.trim()
      if (!title) return null
      const created = await repo.createPlan(title)
      if (plansRef.current.some((p) => p.id === created.id)) return created
      commit([...plansRef.current, created])
      return created
    },
    [commit]
  )

  /**
   * 勾选是乐观更新：这是一个要立刻给反馈的动作，等一个来回会明显发木。
   * 失败必须回滚 —— 不回滚的话界面显示勾上了、库里没改，刷新之后才发现。
   * 回滚带条件：只有当 doneAt 还是这次写进去的那个值才回滚，
   * 免得把用户紧接着的第二次点击一起抹掉。
   */
  const toggle = useCallback(
    async (plan: Plan) => {
      const current = plansRef.current.find((p) => p.id === plan.id)
      if (!current) return
      const nextDoneAt = current.doneAt ? null : new Date().toISOString()

      commit(plansRef.current.map((p) => (p.id === plan.id ? { ...p, doneAt: nextDoneAt } : p)))
      try {
        await repo.setPlanDone(plan.id, nextDoneAt !== null)
      } catch (err) {
        commit(
          plansRef.current.map((p) =>
            p.id === plan.id && p.doneAt === nextDoneAt ? { ...p, doneAt: current.doneAt } : p
          )
        )
        throw err
      }
    },
    [commit]
  )

  return { plans, phase, error, refreshing, reload, add, toggle }
}
