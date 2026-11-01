import { useState } from 'react'
import { usePlans } from '../../hooks/usePlans'
import { LoadingScreen } from '../ScreenStates'
import { PlusIcon } from '../icons'
import type { Plan } from '../../lib/types'

const MAX_LEN = 120

interface Props {
  say: (text: string, ms?: number) => void
}

/**
 * 计划清单：还想一起做的事。
 *
 * 只有标题和一个勾 —— 目标日期、分类、备注都刻意为空。
 * 这是一张写着期待的纸，不是任务管理系统。
 */
export function PlansPage({ say }: Props) {
  const plans = usePlans()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  const open = plans.plans.filter((p) => !p.doneAt)
  const done = plans.plans.filter((p) => p.doneAt)

  const add = async () => {
    const title = draft.trim()
    if (!title || adding) return
    setAdding(true)
    try {
      await plans.add(title.slice(0, MAX_LEN))
      setDraft('')
    } catch {
      // 不清空输入框：没存上时，那行字比任何提示都重要
      say('没加上 —— 字还在框里，再点一次', 3800)
    } finally {
      setAdding(false)
    }
  }

  const toggle = async (plan: Plan) => {
    try {
      await plans.toggle(plan)
    } catch {
      say('没存上，稍后再点一次', 3800)
    }
  }

  return (
    <div className="page-scroll">
      <div className="plans">
        <div className="plans-composer">
          <input
            type="text"
            value={draft}
            maxLength={MAX_LEN}
            placeholder="还想一起去做什么？"
            aria-label="新的计划"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
            }}
          />
          <button
            type="button"
            className="solid-btn"
            disabled={!draft.trim() || adding}
            onClick={() => void add()}
          >
            <PlusIcon size={15} />
            {adding ? '加着…' : '加上'}
          </button>
        </div>

        {plans.phase === 'loading' && <LoadingScreen variant="page" label="正在读清单" />}

        {plans.phase === 'error' && (
          <div className="board-empty" role="alert">
            清单没读出来
            <br />
            <button
              type="button"
              className="ghost-btn board-retry"
              onClick={() => void plans.reload()}
              disabled={plans.refreshing}
            >
              {plans.refreshing ? '正在连…' : '再试一次'}
            </button>
          </div>
        )}

        {plans.phase === 'ready' && (
          <>
            <section className="plan-group">
              <h2 className="plan-head">
                还想一起做
                <span>{open.length}</span>
              </h2>
              {open.length === 0 ? (
                <p className="plan-empty">
                  {done.length > 0 ? '全做完了。想点新的吧。' : '还空着，写一件想做的事。'}
                </p>
              ) : (
                open.map((plan) => (
                  <label key={plan.id} className="plan-item">
                    <input
                      type="checkbox"
                      className="plan-box"
                      checked={false}
                      onChange={() => void toggle(plan)}
                    />
                    <span className="plan-title">{plan.title}</span>
                  </label>
                ))
              )}
            </section>

            {done.length > 0 && (
              <section className="plan-group plan-group--done">
                <h2 className="plan-head">
                  已经做过了
                  <span>{done.length}</span>
                </h2>
                {done.map((plan) => (
                  <label key={plan.id} className="plan-item is-done">
                    <input
                      type="checkbox"
                      className="plan-box"
                      checked
                      onChange={() => void toggle(plan)}
                    />
                    <span className="plan-title">{plan.title}</span>
                  </label>
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
