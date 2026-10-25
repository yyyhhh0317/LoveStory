import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasWall } from './components/CanvasWall'
import { Viewer } from './components/Viewer'
import { UploadSheet } from './components/UploadSheet'
import { ConnectFail, LoadingScreen } from './components/ScreenStates'
import { PlusIcon } from './components/icons'
import { useAlbum } from './hooks/useAlbum'
import { albumOrder, timelineOrder } from './lib/layout'
import { formatDay } from './lib/format'
import { isRemote } from './lib/repo'
import type { NewPhotoInput, Photo } from './lib/types'

type Theme = 'cream' | 'blush'
type ViewMode = 'timeline' | 'album'

const THEME_KEY = 'yyyhhh:theme'

export default function App() {
  const album = useAlbum()
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'blush' ? 'blush' : 'cream'
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [viewer, setViewer] = useState<{ mode: ViewMode; photoId: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'blush' ? '#FDF1F2' : '#FBF5EE')
  }, [theme])

  const say = (text: string) => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }

  const timeline = useMemo(() => timelineOrder(album.photos), [album.photos])
  const featured = useMemo(() => albumOrder(album.photos), [album.photos])

  const sequence = viewer?.mode === 'album' ? featured : timeline
  const index = viewer ? Math.max(0, sequence.findIndex((p) => p.id === viewer.photoId)) : 0

  useEffect(() => {
    if (viewer && sequence.length === 0) setViewer(null)
  }, [viewer, sequence.length])

  const openPhoto = (photo: Photo) => setViewer({ mode: 'timeline', photoId: photo.id })

  const openAlbum = () => {
    if (!featured.length) {
      say('相册还空着，先在照片上点一下星标')
      return
    }
    setViewer({ mode: 'album', photoId: featured[0].id })
  }

  const changeIndex = (next: number) => {
    const target = sequence[next]
    if (target && viewer) setViewer({ ...viewer, photoId: target.id })
  }

  const toggleFeatured = async (photo: Photo) => {
    const wasFeatured = Boolean(photo.featuredAt)
    await album.toggleFeatured(photo.id)
    say(wasFeatured ? '已从相册里移出' : '已收进中心相册')
  }

  const deletePhoto = async (photo: Photo) => {
    const at = sequence.findIndex((p) => p.id === photo.id)
    const neighbour = sequence[at + 1] ?? sequence[at - 1] ?? null
    await album.removePhoto(photo.id)
    if (viewer) {
      if (neighbour) setViewer({ ...viewer, photoId: neighbour.id })
      else setViewer(null)
    }
    say('已移出画布')
  }

  const handleUpload = async (items: NewPhotoInput[]) => {
    await album.addPhotos(items)
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
        <CanvasWall
          photos={album.photos}
          counts={album.counts}
          localOnly={!isRemote}
          onOpenPhoto={openPhoto}
          onOpenAlbum={openAlbum}
          onRequestUpload={() => setUploadOpen(true)}
        />
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
              粉彩
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
        <Viewer
          photos={sequence}
          index={index}
          onIndexChange={changeIndex}
          onClose={() => setViewer(null)}
          onToggleFeatured={(p) => void toggleFeatured(p)}
          onSaveCaption={(p, caption) => void album.setCaption(p.id, caption)}
          onDelete={(p) => void deletePhoto(p)}
          messageCount={album.counts[sequence[index]?.id ?? ''] ?? 0}
          onMessageCountChange={(delta) => {
            const id = sequence[index]?.id
            if (id) album.bumpMessageCount(id, delta)
          }}
        />
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
