import { useCallback } from 'react'
import { repo } from '../lib/repo'
import type { BoardMessage } from '../lib/types'
import { createListCache, useListResource } from './useListResource'

const cache = createListCache<BoardMessage>()

/** 模块级函数：引用稳定，useListResource 的 effect 才不会每轮重拉 */
const load = (signal?: AbortSignal) => repo.listBoardMessages(signal)

export function useBoard() {
  const { items, itemsRef, phase, error, refreshing, reload, commit } = useListResource({
    cache,
    load,
  })

  /**
   * 不做乐观插入：新建的行没有真实 id，假 id 会让便签的配色（hashString）
   * 先渲染成一个颜色、拿到真 id 后又跳成另一个。等一次往返更稳。
   */
  const add = useCallback(
    async (raw: string) => {
      const content = raw.trim()
      if (!content) return null
      const created = await repo.createBoardMessage(content)
      if (itemsRef.current.some((m) => m.id === created.id)) return created
      commit([created, ...itemsRef.current])
      return created
    },
    [commit, itemsRef]
  )

  return { messages: items, phase, error, refreshing, reload, add }
}
