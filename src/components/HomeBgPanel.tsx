import { useImgUrl } from '../hooks/useImgUrl'
import { MAX_ZOOM, MAX_TSCALE, MIN_TSCALE, type HomeBgFit } from '../lib/homeBg'
import type { Photo } from '../lib/types'
import builtinBg from '../assets/home-bg.jpg'

interface Props {
  fit: HomeBgFit
  photos: Photo[]
  onChange: (next: HomeBgFit) => void
  onDone: () => void
}

/**
 * 相册里的一格。
 *
 * 单独成组件是因为 useImgUrl 是钩子 —— 每张照片各要一份地址，
 * 在列表里内联一个 map + callback 是违例的（钩子不能写在循环里）。
 */
function AlbumTile({
  photo,
  active,
  onPick,
}: {
  photo: Photo
  active: boolean
  onPick: () => void
}) {
  const url = useImgUrl(photo.storageKey, 'thumb')
  return (
    <button
      type="button"
      className={`bg-tile${active ? ' is-on' : ''}`}
      aria-pressed={active}
      aria-label={photo.caption ?? '用这张照片'}
      onClick={onPick}
    >
      {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span className="bg-tile-blank" />}
    </button>
  )
}

/**
 * 背景调整条。
 *
 * 不是弹窗、不铺遮罩：它只占屏幕下方一条，上面整页仍然是真正的首页背景。
 * 手指在背景上拖，动的是同一张真实图层（见 HomePage 的 .home-bg-drag），
 * 所以不存在「预览里是这样、退出去不一样」。
 */
export function HomeBgPanel({ fit, photos, onChange, onDone }: Props) {
  const clarityPct = Math.round(fit.clarity * 100)
  const zoomPct = Math.round(fit.zoom * 100)
  const tscalePct = Math.round(fit.tscale * 100)

  /* 换照片时位置和缩放都回默认：上一张的构图对下一张没有意义，清晰度留着 */
  const pick = (next: Pick<HomeBgFit, 'kind' | 'key'>) =>
    onChange({ ...fit, ...next, x: 50, y: 50, zoom: 1 })

  const recenter = () => onChange({ ...fit, x: 50, y: 50 })

  return (
    <div className="bg-panel" role="group" aria-label="背景调整">
      <div className="bg-panel-top">
        <p className="bg-panel-title">按住画面拖动，换个位置</p>
        <div className="bg-panel-actions">
          <button type="button" className="text-btn" onClick={recenter}>
            居中
          </button>
          <button type="button" className="text-btn" onClick={onDone}>
            完成
          </button>
        </div>
      </div>

      <div className="bg-strip" role="group" aria-label="选择背景照片">
        <button
          type="button"
          className={`bg-tile${fit.kind === 'builtin' ? ' is-on' : ''}`}
          aria-pressed={fit.kind === 'builtin'}
          aria-label="用默认那张合照"
          onClick={() => pick({ kind: 'builtin', key: null })}
        >
          <img src={builtinBg} alt="" />
        </button>

        {photos.map((p) => (
          <AlbumTile
            key={p.id}
            photo={p}
            active={fit.kind === 'album' && fit.key === p.storageKey}
            onPick={() => pick({ kind: 'album', key: p.storageKey })}
          />
        ))}

        {!photos.length && <span className="bg-strip-empty">相册里还没有别的照片</span>}
      </div>

      <label className="bg-slider">
        <span>缩放</span>
        <input
          type="range"
          min={100}
          max={MAX_ZOOM * 100}
          step={5}
          value={zoomPct}
          onChange={(e) => onChange({ ...fit, zoom: Number(e.target.value) / 100 })}
        />
        <b>{zoomPct}%</b>
      </label>

      <label className="bg-slider">
        <span>清晰度</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={clarityPct}
          onChange={(e) => onChange({ ...fit, clarity: Number(e.target.value) / 100 })}
        />
        <b>{clarityPct}%</b>
      </label>

      {/*
       * 计时器自己的大小，和上面背景的「缩放」是两回事：
       * 那个放大的是照片（可拖余量随之变多），这个只变文字块。
       * 走 transform：不触发重排，拖动时才跟得上；
       * 拖动钳制用的是 getBoundingClientRect，已含缩放，无需额外处理。
       */}
      <label className="bg-slider">
        <span>计时器大小</span>
        <input
          type="range"
          min={Math.round(MIN_TSCALE * 100)}
          max={Math.round(MAX_TSCALE * 100)}
          step={5}
          value={tscalePct}
          onChange={(e) => onChange({ ...fit, tscale: Number(e.target.value) / 100 })}
        />
        <b>{tscalePct}%</b>
      </label>
    </div>
  )
}
