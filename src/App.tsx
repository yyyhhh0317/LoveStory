import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Viewer } from './components/Viewer'
import { UploadSheet } from './components/UploadSheet'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BottomNav } from './components/BottomNav'
import { PageHeader, ThemeSwitch, type Theme } from './components/PageHeader'
import { HomePage } from './components/pages/HomePage'
import { AlbumPage } from './components/pages/AlbumPage'
import { BoardPage } from './components/pages/BoardPage'
import { PlansPage } from './components/pages/PlansPage'
import { PlusIcon } from './components/icons'
import { useAlbum } from './hooks/useAlbum'
import { useRoute } from './hooks/useRoute'
import { flattenGroups, groupByDay } from './lib/days'
import { findThrowback, todayKey } from './lib/throwback'
import { toFrameRect, type FrameRect } from './lib/flight'
import { usePresence } from './lib/presence'
import { useScrollLock } from './lib/scrollLock'
import type { NewPhotoInput, Photo } from './lib/types'

/**
 * key 带 v2：默认主题从奶油换成莓奶那一刻，旧偏好必须作废。
 * 不改 key 的话，自己这台设备会一直按旧记录停在奶油上 ——
 * 改了默认值却「看起来没生效」，是最容易浪费半小时的那种坑。
 */
const THEME_KEY = 'yyyhhh:theme:v2'
/** 记住最近一次关掉「那年今日」的日期，同一天不再打扰 */
const THROWBACK_KEY = 'yyyhhh:throwback'

type ViewerMode = 'timeline' | 'throwback'

export default function App() {
  const album = useAlbum()
  const [route, navigate] = useRoute()
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    return saved === 'cream' ? 'cream' : 'blush'
  })
  const [uploadOpen, setUploadOpen] = useState(false)
  const [viewer, setViewer] = useState<{ mode: ViewerMode; photoId: string } | null>(null)
  /* 点开时那张缩略图在屏幕上的位置，交给沉浸视图做放大动画 */
  const [origin, setOrigin] = useState<FrameRect | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const dayKey = useMemo(() => todayKey(), [])
  const [throwbackClosed, setThrowbackClosed] = useState(
    () => localStorage.getItem(THROWBACK_KEY) === todayKey()
  )

  const toastTimer = useRef<number | null>(null)
  /*
   * 提示条要淡出，就得在 setToast(null) 之后再活一小会儿。
   * 但那会儿 toast 已经是 null 了，正文得单独留一份，否则淡出去的是个空壳。
   */
  const lastToast = useRef('')
  const toastVisible = usePresence(Boolean(toast))

  /*
   * 打开详情页前把焦点记下来。
   * 页面是无障碍的弹层，关掉之后焦点不回原位，键盘用户就得从文档开头重新 Tab 一遍。
   * 记的是 DOM 节点，时间轴上那张卡不会因为开详情页而卸载，所以这个引用一直有效。
   */
  const returnFocus = useRef<HTMLElement | null>(null)
  const rememberFocus = useCallback(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])

  useEffect(() => {
    /* index.html 里的内联脚本已经在首帧前设过一遍；这里重设一次是防御性的，
       万一 localStorage 被禁用、脚本没跑成，也不至于停在默认的奶油上 */
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', theme === 'blush' ? '#fdf1f2' : '#f9f2e8')
  }, [theme])

  /** 失败提示比成功提示多留一会儿，因为要看清的是「需要再做什么」 */
  const say = useCallback((text: string, ms = 2600) => {
    lastToast.current = text
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), ms)
  }, [])

  const groups = useMemo(() => groupByDay(album.photos, 'desc'), [album.photos])
  /** 展平 = 屏幕从上到下的顺序，沉浸视图的左右翻页直接用它 */
  const timeline = useMemo(() => flattenGroups(groups), [groups])
  const throwback = useMemo(() => findThrowback(album.photos), [album.photos])

  const sequence =
    viewer?.mode === 'throwback' ? (throwback?.photos ?? []) : timeline
  const index = viewer ? Math.max(0, sequence.findIndex((p) => p.id === viewer.photoId)) : 0

  /* 弹层打开时锁住页面滚动。用计数器的版本，两个弹层叠加也不会提前解锁 */
  useScrollLock(Boolean(viewer) || uploadOpen)

  useEffect(() => {
    if (viewer && sequence.length === 0) setViewer(null)
  }, [viewer, sequence.length])

  /*
   * 这个回调必须引用稳定。
   * 它直接进 TimelineItem 的 props，而 TimelineItem 靠 memo 免于重渲染 ——
   * 每次 App 重渲染（弹一条 toast、切主题）都换一个新函数的话，
   * 整条时间轴会全部重渲染一遍。
   */
  const openPhoto = useCallback(
    (photo: Photo, rect: DOMRect | null = null) => {
      rememberFocus()
      setOrigin(toFrameRect(rect))
      setViewer({ mode: 'timeline', photoId: photo.id })
    },
    [rememberFocus]
  )

  const openThrowback = useCallback(() => {
    if (!throwback) return
    rememberFocus()
    setOrigin(null)
    setViewer({ mode: 'throwback', photoId: throwback.photos[0].id })
  }, [throwback, rememberFocus])

  /**
   * 关详情页只有一条路：先让 Viewer 自己淡出，淡完再走这里。
   * 焦点趁这时候还给原来那张卡 —— 人是从那儿进来的，就该回到那儿。
   */
  const closeViewer = useCallback(() => {
    setViewer(null)
    setOrigin(null)
    const back = returnFocus.current
    returnFocus.current = null
    if (back && document.contains(back)) back.focus({ preventScroll: true })
  }, [])

  const dismissThrowback = useCallback(() => {
    setThrowbackClosed(true)
    localStorage.setItem(THROWBACK_KEY, dayKey)
  }, [dayKey])

  const changeIndex = useCallback(
    (next: number) => {
      const target = sequence[next]
      if (target) setViewer((cur) => (cur ? { ...cur, photoId: target.id } : cur))
    },
    [sequence]
  )

  const toggleFeatured = async (photo: Photo) => {
    const wasFeatured = Boolean(photo.featuredAt)
    try {
      await album.toggleFeatured(photo.id)
      say(wasFeatured ? '已从精选中移出' : '已收进精选')
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
      say('没删掉，那张还在相册里', 3800)
      return
    }
    // 只有真的删成功才切下一张，否则会一边报错一边把人带到别的照片去
    if (viewer) {
      if (neighbour) setViewer({ ...viewer, photoId: neighbour.id })
      else setViewer(null)
    }
    say('已从相册里移出')
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

  const heading = useMemo(() => {
    if (route === 'board') return { title: '留言板', sub: '想说的话都放这儿' }
    if (route === 'plans') return { title: '计划清单', sub: '还想一起做的事' }
    if (album.phase === 'loading') return { title: '相册', sub: '正在翻开…' }
    if (album.phase === 'error') return { title: '相册', sub: '暂时连不上' }
    if (!album.photos.length) return { title: '相册', sub: '还没有照片' }
    return { title: '相册', sub: `${album.photos.length} 张` }
  }, [route, album.phase, album.photos.length])

  return (
    <>
      <div className="grain" />

      <div className="app-shell">
        {route === 'home' ? (
          <HomePage theme={theme} onTheme={setTheme} />
        ) : (
          <div className="page">
            <PageHeader
              title={heading.title}
              sub={heading.sub}
              onHome={() => navigate('home')}
              action={
                <>
                  <ThemeSwitch theme={theme} onTheme={setTheme} />
                  {route === 'album' && (
                    <button
                      type="button"
                      className="solid-btn"
                      onClick={() => setUploadOpen(true)}
                      disabled={album.phase !== 'ready'}
                    >
                      <PlusIcon size={15} />
                      放照片
                    </button>
                  )}
                </>
              }
            />

            {/*
             * 每页各兜一层：这一页排崩了，页头和底部导航还在，另外两页还能去。
             * resetKey 用 route —— 切走的瞬间就把错误清掉，回来时是干净的。
             */}
            <ErrorBoundary scope="section" resetKey={route}>
              {route === 'album' && (
                <AlbumPage
                  photos={album.photos}
                  counts={album.counts}
                  phase={album.phase}
                  error={album.error}
                  refreshing={album.refreshing}
                  onRetry={() => void album.reload()}
                  onOpenPhoto={openPhoto}
                  onRequestUpload={() => setUploadOpen(true)}
                  throwback={throwbackClosed ? null : throwback}
                  onOpenThrowback={openThrowback}
                  onDismissThrowback={dismissThrowback}
                />
              )}
              {route === 'board' && <BoardPage say={say} />}
              {route === 'plans' && <PlansPage say={say} />}
            </ErrorBoundary>
          </div>
        )}

        <BottomNav active={route} onNavigate={navigate} />
      </div>

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
            onClose={closeViewer}
            onToggleFeatured={(p) => void toggleFeatured(p)}
            onSaveCaption={saveCaption}
            onDelete={(p) => void deletePhoto(p)}
            origin={origin}
            messageCount={album.counts[sequence[index]?.id ?? ''] ?? 0}
            onMessageCountChange={(delta) => {
              const id = sequence[index]?.id
              if (id) album.bumpMessageCount(id, delta)
            }}
          />
        </ErrorBoundary>
      )}

      <UploadSheet
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSubmit={handleUpload}
        onDone={(count) => say(`收进来 ${count} 张`)}
      />

      {toastVisible.mounted && (
        /* 读屏用户在星标失败、上传完成这些时刻听不到任何东西，除非有这个 */
        <div
          className={`toast${toastVisible.closing ? ' out' : ''}`}
          role="status"
          aria-live="polite"
        >
          {toast ?? lastToast.current}
        </div>
      )}
    </>
  )
}
