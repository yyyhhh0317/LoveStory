import { useMemo } from 'react'

/*
 * 画布背景涂鸦（多巴胺手绘风）。
 *
 * 决策记录（2026-10-25 拷问会议）：
 *   - 只放画布背景、跟 world 平移、全部静态、零运行时动效
 *   - 固定 seed 伪随机撒点：网格制，每个位置永远长同一株涂鸦，
 *     拖到哪都有；相册周围 350 单位内不长，不抢封面
 *   - 元素 13 变体：爱心×3 气球×3 波浪×2 彩虹×2 + 星星/雏菊/糖豆调剂
 *   - 质感 5 种：马克笔 / 果冻贴纸 / 蜡笔颗粒(feTurbulence，静态只光栅一次) /
 *     虚线绣线 / 闪粉点阵；彩色描边下都垫一道白，压到照片边上也读得清
 *   - 颜色：cream/blush 各自的主题衍生 6 色糖果盘（--doodle-1..6），
 *     不透明度 0.55–0.7，热闹但不刺眼
 *   - 密度：初始视野约 4–6 个；同屏不重复靠「变体 = 网格坐标的线性组合」——
 *     相邻格变体必然错开，走远了才可能重样
 */

interface View {
  x: number
  y: number
  scale: number
}

/** 网格尺寸（世界单位）：初始视野约 4–6 株 */
const CELL_W = 760
const CELL_H = 620
/** 相册在原点，这一圈不让涂鸦长进来 */
const ALBUM_CLEAR = 350
/** 变体总数 */
const VARIANT_N = 13
const COLOR_N = 6

/** 整数散列：同一个格子永远得到同一串随机数 */
function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return h >>> 0
}

const rand01 = (h: number) => h / 4294967296

const col = (slot: number) => `var(--doodle-${((slot % COLOR_N) + COLOR_N) % COLOR_N + 1})`

/* 经典心形轮廓，几个爱心变体共用 */
const HEART_D =
  'M50 84 C 22 64, 12 42, 23 29 C 32 19, 45 22, 50 33 C 55 22, 68 19, 77 29 C 88 42, 78 64, 50 84 Z'

interface ShapeProps {
  v: number
  c: number
}

/** 各变体的形状。坐标系统一 0 0 100 100，白色垫底描边负责「贴纸感」 */
function Shape({ v, c }: ShapeProps) {
  switch (v) {
    /* ---------- 爱心 ×3 ---------- */
    case 0: // 果冻爱心
      return (
        <g>
          <path d={HEART_D} fill={col(c)} stroke="#fffdf6" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round" />
          <ellipse cx={37} cy={34} rx={6} ry={3.6} fill="#fffdf6" opacity={0.85} transform="rotate(-24 37 34)" />
        </g>
      )
    case 1: // 马克笔空心爱心（歪一点的轮廓）
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M50 84 C 24 66, 10 44, 22 30 C 31 20, 45 24, 50 34 C 56 23, 69 20, 78 30 C 89 43, 76 66, 50 84"
            stroke="#fffdf6"
            strokeWidth={12}
            opacity={0.9}
          />
          <path
            d="M50 84 C 24 66, 10 44, 22 30 C 31 20, 45 24, 50 34 C 56 23, 69 20, 78 30 C 89 43, 76 66, 50 84"
            stroke={col(c)}
            strokeWidth={5.5}
          />
        </g>
      )
    case 2: // 蜡笔双线爱心
      return (
        <g fill="none" stroke={col(c)} strokeLinecap="round" filter="url(#doodle-crayon)">
          <path d={HEART_D} strokeWidth={3.6} />
          <path d={HEART_D} strokeWidth={2.6} transform="translate(50 57) scale(0.72) translate(-50 -57)" />
        </g>
      )

    /* ---------- 气球 ×3 ---------- */
    case 3: // 单只气球 + 飘绳
      return (
        <g>
          <ellipse cx={50} cy={36} rx={17} ry={21} fill={col(c)} stroke="#fffdf6" strokeWidth={3.5} paintOrder="stroke" />
          <ellipse cx={44} cy={29} rx={4.5} ry={6} fill="#fffdf6" opacity={0.8} transform="rotate(-18 44 29)" />
          <path d="M47 57 L50 61 L53 57 Z" fill={col(c)} />
          <path
            d="M50 61 q 7 9 -1 16 q -7 7 1 14"
            fill="none"
            stroke="#fffdf6"
            strokeWidth={6}
            opacity={0.9}
            strokeLinecap="round"
          />
          <path d="M50 61 q 7 9 -1 16 q -7 7 1 14" fill="none" stroke={col(c + 1)} strokeWidth={3} strokeLinecap="round" />
        </g>
      )
    case 4: // 三只一束
      return (
        <g>
          {(
            [
              [30, 36, 13, 0],
              [53, 27, 14, 2],
              [74, 40, 11, 4],
            ] as const
          ).map(([bx, by, r, k]) => (
            <g key={k}>
              <ellipse cx={bx} cy={by} rx={r} ry={r * 1.22} fill={col(c + k)} stroke="#fffdf6" strokeWidth={3} paintOrder="stroke" />
              <ellipse cx={bx - r * 0.32} cy={by - r * 0.42} rx={r * 0.26} ry={r * 0.38} fill="#fffdf6" opacity={0.8} />
              <path
                d={`M${bx} ${by + r * 1.22 + 3} Q ${bx + (50 - bx) * 0.4} ${by + 30} 51 88`}
                fill="none"
                stroke={col(c + k)}
                strokeWidth={2.2}
                strokeLinecap="round"
                opacity={0.85}
              />
            </g>
          ))}
          <circle cx={51} cy={89} r={3.2} fill={col(c + 1)} />
        </g>
      )
    case 5: // 心形气球
      return (
        <g>
          <path
            d={HEART_D}
            fill={col(c)}
            stroke="#fffdf6"
            strokeWidth={3.5}
            paintOrder="stroke"
            transform="translate(50 44) scale(0.62) translate(-50 -50)"
          />
          <ellipse cx={39} cy={27} rx={3.6} ry={2.2} fill="#fffdf6" opacity={0.85} transform="rotate(-22 39 27)" />
          <path
            d="M50 62 q 8 10 0 18 q -8 8 1 14"
            fill="none"
            stroke="#fffdf6"
            strokeWidth={6}
            opacity={0.9}
            strokeLinecap="round"
          />
          <path d="M50 62 q 8 10 0 18 q -8 8 1 14" fill="none" stroke={col(c + 2)} strokeWidth={3} strokeLinecap="round" />
        </g>
      )

    /* ---------- 波浪 ×2 ---------- */
    case 6: // 三层叠波（马克笔）
      return (
        <g fill="none" strokeLinecap="round">
          {[30, 50, 70].map((y, k) => (
            <g key={y}>
              <path
                d={`M14 ${y} q 9 -11 18 0 t 18 0 t 18 0 t 18 0`}
                stroke="#fffdf6"
                strokeWidth={10}
                opacity={0.9}
              />
              <path d={`M14 ${y} q 9 -11 18 0 t 18 0 t 18 0 t 18 0`} stroke={col(c + k)} strokeWidth={5} />
            </g>
          ))}
        </g>
      )
    case 7: // 回勾波浪（绣线点阵）
      return (
        <path
          d="M12 56 q 10 -15 20 0 t 20 0 t 20 0 q 9 0 7 -9 q -2 -9 -11 -5"
          fill="none"
          stroke={col(c)}
          strokeWidth={5.5}
          strokeLinecap="round"
          strokeDasharray="0.1 10"
        />
      )

    /* ---------- 彩虹 ×2 ---------- */
    case 8: // 经典三色弧（马克笔）
      return (
        <g fill="none" strokeLinecap="round">
          {(
            [
              ['M14 64 A 36 36 0 0 1 86 64', 0],
              ['M22 64 A 28 28 0 0 1 78 64', 2],
              ['M30 64 A 20 20 0 0 1 70 64', 4],
            ] as const
          ).map(([d, k]) => (
            <g key={d}>
              <path d={d} stroke="#fffdf6" strokeWidth={12} opacity={0.9} />
              <path d={d} stroke={col(c + k)} strokeWidth={6} />
            </g>
          ))}
        </g>
      )
    case 9: // 双色弧 + 云朵端（果冻）
      return (
        <g fill="none" strokeLinecap="round">
          <path d="M22 60 A 29 29 0 0 1 78 60" stroke="#fffdf6" strokeWidth={13} opacity={0.9} />
          <path d="M22 60 A 29 29 0 0 1 78 60" stroke={col(c)} strokeWidth={7} />
          <path d="M32 60 A 19 19 0 0 1 68 60" stroke={col(c + 3)} strokeWidth={7} />
          {(
            [
              [18, 62, 7, 5.5, -5],
              [82, 62, 7, 5.5, 5],
            ] as const
          ).map(([cx, cy, r1, r2, dx], k) => (
            <g key={k} fill="#fffdf6" stroke={col(c + 2)} strokeWidth={2.4}>
              <circle cx={cx} cy={cy} r={r1} />
              <circle cx={cx + dx} cy={cy + 2.5} r={r2} />
              <circle cx={cx - dx} cy={cy + 3.5} r={r2 * 0.8} />
            </g>
          ))}
        </g>
      )

    /* ---------- 调剂 ×3 ---------- */
    case 10: // 闪粉星星
      return (
        <g>
          <path
            d="M50 14 C 54 38, 62 46, 86 50 C 62 54, 54 62, 50 86 C 46 62, 38 54, 14 50 C 38 46, 46 38, 50 14 Z"
            fill={col(c)}
            stroke="#fffdf6"
            strokeWidth={3.5}
            paintOrder="stroke"
            strokeLinejoin="round"
          />
          <circle cx={22} cy={24} r={3.6} fill={col(c + 2)} />
          <circle cx={80} cy={22} r={2.8} fill={col(c + 4)} />
          <circle cx={84} cy={72} r={2.4} fill={col(c + 1)} />
        </g>
      )
    case 11: // 小雏菊（蜡笔）
      return (
        <g filter="url(#doodle-crayon)">
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <ellipse
              key={a}
              cx={50 + 19 * Math.sin((a * Math.PI) / 180)}
              cy={50 - 19 * Math.cos((a * Math.PI) / 180)}
              rx={7.5}
              ry={12}
              transform={`rotate(${a} ${50 + 19 * Math.sin((a * Math.PI) / 180)} ${50 - 19 * Math.cos((a * Math.PI) / 180)})`}
              fill="#fffdf6"
              stroke={col(c)}
              strokeWidth={2.6}
            />
          ))}
          <circle cx={50} cy={50} r={9} fill={col(c + 1)} stroke="#fffdf6" strokeWidth={2.5} />
        </g>
      )
    default: {
      // 12: 糖豆圆点串（闪粉）
      const dots = [
        [16, 56],
        [27, 47],
        [38, 43],
        [50, 42],
        [62, 45],
        [73, 50],
        [84, 57],
      ] as const
      return (
        <g>
          {dots.map(([dx, dy], k) => (
            <circle
              key={k}
              cx={dx}
              cy={dy}
              r={6.4 - (k % 2) * 1.2}
              fill={col(c + k)}
              stroke="#fffdf6"
              strokeWidth={2.8}
              paintOrder="stroke"
            />
          ))}
        </g>
      )
    }
  }
}

interface Doodle {
  key: string
  x: number
  y: number
  size: number
  variant: number
  color: number
  rot: number
  scale: number
  flip: boolean
  opacity: number
}

/** 由视口算出可见格子里长哪些涂鸦——纯函数，同一位置永远同一株 */
function computeDoodles(view: View, size: { w: number; h: number }): Doodle[] {
  const pad = 320
  const halfW = size.w / (2 * view.scale) + pad
  const halfH = size.h / (2 * view.scale) + pad
  const cx = (size.w / 2 - view.x) / view.scale
  const cy = (size.h / 2 - view.y) / view.scale

  const i0 = Math.floor((cx - halfW) / CELL_W)
  const i1 = Math.floor((cx + halfW) / CELL_W)
  const j0 = Math.floor((cy - halfH) / CELL_H)
  const j1 = Math.floor((cy + halfH) / CELL_H)

  const out: Doodle[] = []
  for (let ix = i0; ix <= i1; ix++) {
    for (let iy = j0; iy <= j1; iy++) {
      const r = rand01(hash2(ix, iy, 3))
      const count = r < 0.25 ? 0 : r < 0.75 ? 1 : 2
      for (let k = 0; k < count; k++) {
        const h = hash2(ix, iy, 17 + k * 131)
        const x = ix * CELL_W + CELL_W * (0.18 + rand01(h >>> 3) * 0.64)
        const y = iy * CELL_H + CELL_H * (0.18 + rand01(h >>> 7) * 0.64)
        if (Math.hypot(x, y) < ALBUM_CLEAR) continue

        /* 相邻格变体必然错开：变体是网格坐标的线性组合 */
        const base = (((ix * 3 + iy * 5) % VARIANT_N) + VARIANT_N) % VARIANT_N
        const variant = k === 0 ? base : (base + 4 + (h % 7)) % VARIANT_N

        /* 同格第二株和第一株保持距离，别叠在一起 */
        let fx = x
        let fy = y
        if (k === 1 && out.length > 0) {
          const prev = out[out.length - 1]
          if (Math.hypot(prev.x - x, prev.y - y) < 150) {
            fx = x + 170
            fy = y + 120
            if (Math.hypot(fx, fy) < ALBUM_CLEAR) continue
          }
        }

        out.push({
          key: `${ix}_${iy}_${k}`,
          x: fx,
          y: fy,
          size: 62 + rand01(h >>> 11) * 36,
          variant,
          color: (h >>> 8) % COLOR_N,
          rot: (rand01(h >>> 5) - 0.5) * 26,
          scale: 0.8 + rand01(h >>> 9) * 0.35,
          flip: (h & 64) !== 0,
          opacity: 0.55 + rand01(h >>> 13) * 0.15,
        })
      }
    }
  }
  return out
}

export function CanvasDoodles({ view, size }: { view: View; size: { w: number; h: number } }) {
  const doodles = useMemo(
    () => computeDoodles(view, size),
    [view.x, view.y, view.scale, size.w, size.h]
  )

  return (
    <div className="doodles" aria-hidden="true">
      {/* 蜡笔质感共用一枚粗糙边缘滤镜，静态图形只光栅一次 */}
      <svg width={0} height={0} style={{ position: 'absolute' }}>
        <defs>
          <filter id="doodle-crayon" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.12" numOctaves="2" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" />
          </filter>
        </defs>
      </svg>
      {doodles.map((d) => (
        <div
          key={d.key}
          className="doodle"
          style={{
            left: d.x,
            top: d.y,
            width: d.size,
            height: d.size,
            opacity: d.opacity,
            transform: `translate(-50%, -50%) rotate(${d.rot}deg) scale(${d.flip ? -d.scale : d.scale}, ${d.scale})`,
          }}
        >
          <DoodleShapeInner v={d.variant} c={d.color} />
        </div>
      ))}
    </div>
  )
}

function DoodleShapeInner(props: ShapeProps) {
  return (
    <svg viewBox="0 0 100 100" overflow="visible">
      <Shape v={props.v} c={props.c} />
    </svg>
  )
}
