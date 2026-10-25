import { useLayoutEffect, useRef } from 'react'
import { FLIGHT_MS, type FrameRect } from '../lib/flight'

interface Props {
  from: FrameRect
  to: FrameRect
  src: string
  onDone: () => void
}

/**
 * 共享元素飞行层。
 *
 * 做法是标准 FLIP，但反着写：元素**一开始就摆在终点**，
 * 首帧用 transform 把它「倒推」回起点，再动画回 identity。
 * 这样结束那一帧的位置和尺寸是精确的、不靠浮点误差收敛，
 * 和真正的照片一像素都不差，替换时看不出接缝。
 *
 * 用 transform 而不是改 left/top/width/height：
 * 只有 transform 能走在合成层上，尺寸动画每帧都要重新布局，照片一多就是灾难。
 *
 * scaleX / scaleY 分开给，不强行等比 —— 起点（照片卡片或相册内页）
 * 和终点的宽高比可能有几个像素的差，等比会让终点对不齐；
 * 分开给最多把图拉 1~2%，肉眼不可见。
 */
export function FlightPhoto({ from, to, src, onDone }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const finished = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const finish = () => {
      if (finished.current) return
      finished.current = true
      onDone()
    }

    const sx = from.w / to.w
    const sy = from.h / to.h
    const dx = from.x + from.w / 2 - (to.x + to.w / 2)
    const dy = from.y + from.h / 2 - (to.y + to.h / 2)

    const anim = el.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          // 起点跟缩略图一样是直角，落点和详情页一样是 8px 圆角
          borderRadius: '2px',
        },
        { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: '8px' },
      ],
      { duration: FLIGHT_MS, easing: 'cubic-bezier(0.22, 0.62, 0.3, 1)', fill: 'forwards' }
    )

    anim.onfinish = finish
    // 切标签页、降低动效等情况动画可能不触发 finish，兜一层，别让飞行层永远盖着
    const guard = window.setTimeout(finish, FLIGHT_MS + 260)

    return () => {
      window.clearTimeout(guard)
      anim.cancel()
    }
    // 只在挂载时飞一次：飞行途中换照片不该重新起飞
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      className="photo-fly"
      style={{
        left: to.x,
        top: to.y,
        width: to.w,
        height: to.h,
        backgroundImage: `url("${src}")`,
      }}
      aria-hidden="true"
    />
  )
}
