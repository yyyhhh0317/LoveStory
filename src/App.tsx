import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasWall } from './components/CanvasWall'
import { Viewer } from './components/Viewer'
import { UploadSheet } from './components/UploadSheet'
import { ConnectFail, LoadingScreen } from './components/ScreenStates'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BookIcon, CloseIcon, PlusIcon } from './components/icons'
import { useAlbum } from './hooks/useAlbum'
import { albumOrder, timelineOrder } from './lib/layout'
import { formatDay } from './lib/format'
import { findThrowback, todayKey } from './lib/throwback'
import { isRemote } from './lib/repo'
import type { NewPhotoInput, Photo } from './lib/types'

type Theme = 'cream' | 'blush'
type ViewMode = 'timeline' | 'album' | 'throwback'

const THEME_KEY = 'yyyhhh:theme'
/** 记住最近一次关掉「那年今日」的日期，同一天不再打扰 */
const THROWBACK_KEY = 'yyyhhh:throwback'

export default function App() {
  const album = useAlbum()
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'blush' ? 'blush' : 'cream'
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [viewer, setViewer] = useState<{ mode: ViewMode; photoId: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const dayKey = useMemo(() => todayKey(), [])
  const [throwbackClosed, setThrowbackClosed] = useState(
    () => localStorage.getItem(THROWBACK_KEY) === todayKey()
  )
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'blush' ? '#FDF1F2' : '#FBF5EE')
  }, [theme])

  /** 失败提示比成功提示多留一会儿，因为要看清的是「需要再做什么」 */
  const say = (text: string, ms = 2600) => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), ms)
  }

  const timeline = useMemo(() => timelineOrder(album.photos), [album.photos])
  const featured = useMemo(() => albumOrder(album.photos), [album.photos])
  const throwback = useMemo(() => findThrowback(album.photos), [album.photos])

  const sequence =
    viewer?.mode === 'album'
      ? featured
      : viewer?.mode === 'throwback'
        ? (throwback?.photos ?? [])
        : timeline
  const index = viewer ? Math.max(0, sequence.findIndex((p) => p.id === viewer.photoId)) : 0

  useEffect(() => {
    if (viewer && sequence.length === 0) setViewer(null)
  }, [viewer, sequence.length])

  const openPhoto = (photo: Photo) => setViewer({ mode: 'timeline', photoId: photo.id })

  const openAlbum = () => {
    if (!featured.length) {
      // 星标只在详情页右上角，画布上没有。提示得指对地方，否则人会去画布上找
      say('相册还空着 · 点开照片，右上角星标收进来')
      return
    }
    setViewer({ mode: 'album', photoId: featured[0].id })
  }

  const openThrowback = () => {
    if (!throwback) return
    setViewer({ mode: 'throwback', photoId: throwback.photos[0].id })
  }

  const dismissThrowback = () => {
    setThrowbackClosed(true)
    localStorage.setItem(THROWBACK_KEY, dayKey)
  }

  const changeIndex = (next: number) => {
    const target = sequence[next]
    if (target && viewer) setViewer({ ...viewer, photoId: target.id })
  }

  const toggleFeatured = async (photo: Photo) => {
    const wasFeatured = Boolean(photo.featuredAt)
    try {
      await album.toggleFeatured(photo.id)
      say(wasFeatured ? '已从相册里移出' : '已收进中心相册')
    } catch {
      // 界面已经回滚了，这里只需要说清「没成」
      say('星标没存上，再点一次试试', 3800)
    }
  }

  const deletePhoto = async (photo: Photo) => {
    const at = sequence.findIndex((p) => p.id === photo.id)
    const neighbour = sequence[at + 1] ?? sequence[at - 1] ?? null
    try {
      await album.removePhoto(photo.id)
    } catch {
      // 照片已经被 useAlbum 放回原位了，页面别动，只报告
      say('没删掉，那张还在画布上', 3800)
      return
    }
    // 只有真的删成功才切下一张，否则会一边报错一边把人带到别的照片去
    if (viewer) {
      if (neighbour) setViewer({ ...viewer, photoId: neighbour.id })
      else setViewer(null)
    }
    say('已移出画布')
  }

  const handleUpload = (items: NewPhotoInput[]) => album.addPhotos(items)

  const saveCaption = async (photo: Photo, caption: string | null) => {
    try {
      await album.setCaption(photo.id, caption)
      return true
    } catch {
      say('简介没存上，字还在，再点一次保存', 3800)
      return false
    }
  }

  const subtitle = useMemo(() => {
    if (album.phase === 'loading') return '正在翻开…'
    if (album.phase === 'error') return '暂时连不上'
    if (!album.photos.length) return '还没有照片'
    const first = timeline[0]
    return `${album.photos.length} 张 · 从 ${formatDay(first.takenAt)} 起`
  }, [album.phase, album.photos.length, timeline])

  return (
    <>
      <div className="grain" />

      {album.phase === 'loading' && <LoadingScreen />}

      {album.phase === 'error' && (
        <ConnectFail
          error={album.error}
          retrying={album.refreshing}
          onRetry={() => void album.reload()}
        />
      )}

      {/*
        只有 ready 才挂画布：加载中或连不上时若把画布挂上，
        它会先渲染出自己的空态「还什么都没有」，正是要消灭的错觉。
      */}
      {album.phase === 'ready' && (
        /*
         * 画布单独兜一层：照片数据在 App 里，就算画布排崩了，
         * 顶栏、主题、上传入口都还在，人还能继续做事。
         */
        <ErrorBoundary scope="canvas">
          <CanvasWall
            photos={album.photos}
            counts={album.counts}
            localOnly={!isRemote}
            onOpenPhoto={openPhoto}
            onOpenAlbum={openAlbum}
            onRequestUpload={() => setUploadOpen(true)}
          />
        </ErrorBoundary>
      )}

      <header className="topbar">
        <div className="brand">
          <h1>yyyhhh</h1>
          <p>{subtitle}</p>
        </div>
        <div className="top-actions">
          {!isRemote && (
            <span
              className="ghost-btn"
              style={{ cursor: 'default', fontSize: 11, letterSpacing: '0.12em' }}
              title="尚未配置 Supabase，数据只存在这台设备上"
            >
              本地模式
            </span>
          )}
          <div className="theme-switch" role="group" aria-label="切换主题">
            <button
              type="button"
              className={theme === 'cream' ? 'on' : ''}
              onClick={() => setTheme('cream')}
            >
              奶油
            </button>
            <button
              type="button"
              className={theme === 'blush' ? 'on' : ''}
              onClick={() => setTheme('blush')}
            >
              莓奶
            </button>
          </div>
          <button
            type="button"
            className="solid-btn"
            onClick={() => setUploadOpen(true)}
            disabled={album.phase !== 'ready'}
          >
            <PlusIcon size={15} />
            放照片
          </button>
        </div>
      </header>

      {viewer && sequence.length > 0 && (
        /*
         * 详情页也兜一层，并且把当前这张的 id 当 resetKey：
         * 打不开这一张就退回来，换一张时错误自动清掉，不会一直被卡住。
         */
        <ErrorBoundary
          scope="viewer"
          resetKey={viewer.photoId}
          onReset={() => setViewer(null)}
        >
          <Viewer
            photos={sequence}
            index={index}
            onIndexChange={changeIndex}
            onClose={() => setViewer(null)}
            onToggleFeatured={(p) => void toggleFeatured(p)}
            onSaveCaption={saveCaption}
            onDelete={(p) => void deletePhoto(p)}
            flip={viewer.mode === 'album'}
            messageCount={album.counts[sequence[index]?.id ?? ''] ?? 0}
            onMessageCountChange={(delta) => {
              const id = sequence[index]?.id
              if (id) album.bumpMessageCount(id, delta)
            }}
          />
        </ErrorBoundary>
      )}

      {album.phase === 'ready' && throwback && !throwbackClosed && (
        <div className="throwback">
          <button type="button" className="throwback-main" onClick={openThrowback}>
            <BookIcon size={14} />
            <span className="throwback-kicker">那年今日</span>
            <span className="throwback-desc">
              {throwback.label} · {throwback.photos.length} 张
            </span>
          </button>
          <button
            type="button"
            className="throwback-close"
            onClick={dismissThrowback}
            aria-label="今天不再提示"
            title="今天不再提示"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      )}

      <UploadSheet
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSubmit={handleUpload}
        onDone={(count) => say(`收进来 ${count} 张`)}
      />

      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
