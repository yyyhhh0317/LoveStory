import { useCallback } from 'react'
import { repo } from '../lib/repo'
import type { Plan } from '../lib/types'
import { createListCache, useListResource } from './useListResource'

const cache = createListCache<Plan>()

/** 模块级函数：引用稳定，useListResource 的 effect 才不会每轮重拉 */
const load = (signal?: AbortSignal) => repo.listPlans(signal)

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
  const { items, itemsRef, phase, error, refreshing, reload, commit } = useListResource({
    cache,
    load,
    normalize: sortPlans,
  })

  const add = useCallback(
    async (raw: string) => {
      const title = raw.trim()
      if (!title) return null
      const created = await repo.createPlan(title)
      if (itemsRef.current.some((p) => p.id === created.id)) return created
      commit([...itemsRef.current, created])
      return created
    },
    [commit, itemsRef]
  )

  /**
   * 勾选是乐观更新：这是一个要立刻给反馈的动作，等一个来回会明显发木。
   * 失败必须回滚 —— 不回滚的话界面显示勾上了、库里没改，刷新之后才发现。
   * 回滚带条件：只有当 doneAt 还是这次写进去的那个值才回滚，
   * 免得把用户紧接着的第二次点击一起抹掉。
   */
  const toggle = useCallback(
    async (plan: Plan) => {
      const current = itemsRef.current.find((p) => p.id === plan.id)
      if (!current) return
      const nextDoneAt = current.doneAt ? null : new Date().toISOString()

      commit(itemsRef.current.map((p) => (p.id === plan.id ? { ...p, doneAt: nextDoneAt } : p)))
      try {
        await repo.setPlanDone(plan.id, nextDoneAt !== null)
      } catch (err) {
        commit(
          itemsRef.current.map((p) =>
            p.id === plan.id && p.doneAt === nextDoneAt ? { ...p, doneAt: current.doneAt } : p
          )
        )
        throw err
      }
    },
    [commit, itemsRef]
  )

  return { plans: items, phase, error, refreshing, reload, add, toggle }
}
