import type { ImageVariant, Message, NewPhotoInput, Photo, Repo } from '../types'
import { uid } from '../format'

const PHOTOS_KEY = 'yyyhhh:photos:v1'
const MESSAGES_KEY = 'yyyhhh:messages:v1'
const DB_NAME = 'yyyhhh-files'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('本地存储不可用'))
  })
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await openDb()
  const out = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as Blob | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return out
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

const urlCache = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

/**
 * 本地模式：照片元数据在 localStorage，图片本体在 IndexedDB。
 * 用途是让你在配置 Supabase 之前就能完整跑通与试看。
 */
export class LocalRepo implements Repo {
  kind = 'local' as const

  async listPhotos(): Promise<Photo[]> {
    return readJson<Photo[]>(PHOTOS_KEY, []).filter((p) => !p.deletedAt)
  }

  async createPhoto(input: NewPhotoInput): Promise<Photo> {
    /*
     * 本地模式同样要幂等：重试时 storageKey 不变，
     * 已经入过库的那一张直接认领，不要再 push 出一行重复的。
     */
    const existing = readJson<Photo[]>(PHOTOS_KEY, []).find(
      (p) => p.storageKey === input.storageKey
    )
    if (existing) {
      if (existing.deletedAt) {
        const all = readJson<Photo[]>(PHOTOS_KEY, [])
        writeJson(
          PHOTOS_KEY,
          all.map((p) => (p.id === existing.id ? { ...p, deletedAt: null } : p))
        )
        return { ...existing, deletedAt: null }
      }
      return existing
    }

    const photo: Photo = {
      id: uid(),
      storageKey: input.storageKey,
      width: input.width,
      height: input.height,
      aspect: input.width / input.height,
      takenAt: input.takenAt,
      caption: input.caption,
      featuredAt: null,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    }

    await Promise.all([
      idbPut(`${input.storageKey}/thumb`, input.thumb),
      idbPut(`${input.storageKey}/full`, input.full),
    ])

    const all = readJson<Photo[]>(PHOTOS_KEY, [])
    all.push(photo)
    writeJson(PHOTOS_KEY, all)
    return photo
  }

  async patchPhoto(
    id: string,
    patch: Partial<Pick<Photo, 'caption' | 'featuredAt'>>
  ): Promise<void> {
    const all = readJson<Photo[]>(PHOTOS_KEY, [])
    const next = all.map((p) => (p.id === id ? { ...p, ...patch } : p))
    writeJson(PHOTOS_KEY, next)
  }

  async softDeletePhoto(id: string): Promise<void> {
    const all = readJson<Photo[]>(PHOTOS_KEY, [])
    const next = all.map((p) =>
      p.id === id ? { ...p, deletedAt: new Date().toISOString() } : p
    )
    writeJson(PHOTOS_KEY, next)
  }

  async countMessages(): Promise<Record<string, number>> {
    const all = readJson<Message[]>(MESSAGES_KEY, [])
    const out: Record<string, number> = {}
    for (const m of all) {
      if (m.deletedAt) continue
      out[m.photoId] = (out[m.photoId] ?? 0) + 1
    }
    return out
  }

  // 本地读是同步的，没有往返可取消，signal 收下不用
  async listMessages(photoId: string, _signal?: AbortSignal): Promise<Message[]> {
    const all = readJson<Message[]>(MESSAGES_KEY, [])
    return all
      .filter((m) => m.photoId === photoId && !m.deletedAt)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }

  async createMessage(photoId: string, content: string): Promise<Message> {
    const message: Message = {
      id: uid(),
      photoId,
      content,
      createdAt: new Date().toISOString(),
      deletedAt: null,
    }
    const all = readJson<Message[]>(MESSAGES_KEY, [])
    all.push(message)
    writeJson(MESSAGES_KEY, all)
    return message
  }

  peekUrl(storageKey: string, variant: ImageVariant): string | null {
    return urlCache.get(`${storageKey}/${variant}`) ?? null
  }

  async resolveUrl(storageKey: string, variant: ImageVariant): Promise<string> {
    const cacheKey = `${storageKey}/${variant}`
    const hit = urlCache.get(cacheKey)
    if (hit) return hit

    const inflight = pending.get(cacheKey)
    if (inflight) return inflight

    const task = (async () => {
      const blob = await idbGet(cacheKey)
      if (!blob) return ''
      const url = URL.createObjectURL(blob)
      urlCache.set(cacheKey, url)
      return url
    })()

    pending.set(cacheKey, task)
    try {
      return await task
    } finally {
      pending.delete(cacheKey)
    }
  }
}
