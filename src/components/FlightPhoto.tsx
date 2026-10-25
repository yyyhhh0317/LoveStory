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

    /*
     * 只动 transform，不动 border-radius。
     *
     * border-radius 不是合成属性 —— 把它放进同一组关键帧，浏览器每一帧
     * 都要重绘整张 868×651 的图（连阴影一起重画），飞行立刻变得一顿一顿。
     * 圆角固定 8px：起点那张缩略图本来也接近这个值，中间过渡看不出来。
     */
    const anim = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
      {
        duration: FLIGHT_MS,
        /*
         * 曲线要「匀」，不能「弹」。
         * 原来那条 (0.2, 0.74, 0.14, 1) 在 38% 时间点已经走完 89% 的距离：
         * 照片几乎瞬移到终点，剩下大半时间杵着不动 —— 手感就是「冲过去、停住」，
         * 这才是「不连贯」的真正来源。Material 的标准曲线在 38% 时约 52%，
         * 全程接近匀速、尾巴收得干净。
         */
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards',
      }
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
