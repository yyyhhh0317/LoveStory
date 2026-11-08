import { useEffect, useState } from 'react'
import { START_AT, elapsedSentence, elapsedSince } from '../lib/timer'
import { formatDay, pad } from '../lib/format'

/**
 * 对齐到整秒的自校准定时器。
 *
 * 不用 requestAnimationFrame：60fps 跑一个只关心整秒的逻辑是纯浪费，
 * 而且 rAF 在后台完全停摆，切回来那一帧落在秒中间，视觉上会错半拍。
 *
 * 不用固定 setInterval(1000)：它会累积漂移，秒数跳变和真实时钟越走越偏，
 * 旁边放着手机时钟的时候会很明显。每次把下一次唤醒对齐到 1000 - (t % 1000)，
 * 误差恒定在 10ms 以内。
 *
 * 每次 tick 都重读 Date.now() 而不是 prev + 1000 —— 标签页休眠、系统改时间
 * 之后，下一次 tick 会自己回到正轨。
 */
function useSecondTick(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let id = 0
    let alive = true

    const tick = () => {
      if (!alive) return
      const t = Date.now()
      setNow(t)
      // +8ms 余量：刚好卡在边界前一帧醒来时，不至于连跳两次
      id = window.setTimeout(tick, 1000 - (t % 1000) + 8)
    }

    tick()

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(id)
      tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      window.clearTimeout(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return now
}

/**
 * 首页唯一每秒重渲染的组件。
 *
 * now 这个 state 只存在这里 —— App、HomePage 完全不知道时钟在跑。
 * album 数据到达、切换主题都不会让计时器重渲染，反过来也一样。
 */
export function TogetherTimer() {
  const now = useSecondTick()
  const e = elapsedSince(START_AT, now)

  return (
    <section className="timer" role="timer" aria-live="off">
      <p className="timer-kicker">刘君阳和刘清菡together已经</p>

      <div className="timer-row">
        <div className="tt-cell tt-cell--major">
          <b className="tt-num">{e.days}</b>
          <i className="tt-unit">天</i>
        </div>
        <div className="tt-cell">
          <b className="tt-num">{pad(e.hours)}</b>
          <i className="tt-unit">时</i>
        </div>
        <div className="tt-cell">
          <b className="tt-num">{pad(e.minutes)}</b>
          <i className="tt-unit">分</i>
        </div>
        <div className="tt-cell">
          <b className="tt-num">{pad(e.seconds)}</b>
          <i className="tt-unit">秒</i>
        </div>
      </div>

      {/*
        * 脚注用数字日期而不是「2025 年 3 月 17 日」：
        * 上面四个数都是 sans + tnum，脚注也走数字才跟它们同族；
        * 汉字那版有 16 字宽，比主体天数还宽，脚注抢了版面的宽度。
        * 补零点分沿用 formatDay，与留言板里超过一周的日期同一种写法。
        */}
      <p className="timer-foot">
        {e.pending ? '这一天还没到' : `${formatDay(START_AT.toISOString())} 起`}
      </p>

      {/* 每秒播报是灾难，所以 aria-live 关着；这句只在读屏用户路过时才念 */}
      <p className="sr-only">{elapsedSentence(e)}</p>
    </section>
  )
}
