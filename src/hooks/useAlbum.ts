import { useCallback, useEffect, useState } from 'react'
import { repo } from '../lib/repo'
import type { NewPhotoInput, Photo } from '../lib/types'

export function useAlbum() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [list, map] = await Promise.all([repo.listPhotos(), repo.countMessages()])
      setPhotos(list)
      setCounts(map)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取相册失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const addPhotos = useCallback(
    async (items: NewPhotoInput[]) => {
      const created: Photo[] = []
      for (const item of items) {
        created.push(await repo.createPhoto(item))
      }
      setPhotos((prev) => [...prev, ...created])
      return created
    },
    []
  )

  const setCaption = useCallback(async (id: string, caption: string | null) => {
    const trimmed = caption && caption.trim() ? caption.trim() : null
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, caption: trimmed } : p)))
    await repo.patchPhoto(id, { caption: trimmed })
  }, [])

  const toggleFeatured = useCallback(
    async (id: string) => {
      let next: string | null = null
      setPhotos((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p
          next = p.featuredAt ? null : new Date().toISOString()
          return { ...p, featuredAt: next }
        })
      )
      await repo.patchPhoto(id, { featuredAt: next })
    },
    []
  )

  const removePhoto = useCallback(async (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id))
    await repo.softDeletePhoto(id)
  }, [])

  const bumpMessageCount = useCallback((photoId: string, delta: number) => {
    setCounts((prev) => {
      const next = { ...prev, [photoId]: Math.max(0, (prev[photoId] ?? 0) + delta) }
      if (next[photoId] === 0) delete next[photoId]
      return next
    })
  }, [])

  return {
    photos,
    counts,
    loading,
    error,
    reload,
    addPhotos,
    setCaption,
    toggleFeatured,
    removePhoto,
    bumpMessageCount,
  }
}
