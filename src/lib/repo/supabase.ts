import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ImageVariant, Message, NewPhotoInput, Photo, Repo } from '../types'

const BUCKET = 'photos'

interface PhotoRow {
  id: string
  storage_key: string
  width: number
  height: number
  aspect: number
  taken_at: string
  caption: string | null
  featured_at: string | null
  created_at: string
  deleted_at: string | null
}

interface MessageRow {
  id: string
  photo_id: string
  content: string
  created_at: string
  deleted_at: string | null
}

const toPhoto = (row: PhotoRow): Photo => ({
  id: row.id,
  storageKey: row.storage_key,
  width: row.width,
  height: row.height,
  aspect: row.aspect,
  takenAt: row.taken_at,
  caption: row.caption,
  featuredAt: row.featured_at,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
})

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  photoId: row.photo_id,
  content: row.content,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
})

export class SupabaseRepo implements Repo {
  kind = 'supabase' as const
  private client: SupabaseClient
  private urlCache = new Map<string, string>()

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false },
    })
  }

  async listPhotos(): Promise<Photo[]> {
    const { data, error } = await this.client
      .from('photos')
      .select('*')
      .is('deleted_at', null)
      .order('taken_at', { ascending: true })
    if (error) throw error
    return (data as PhotoRow[]).map(toPhoto)
  }

  async createPhoto(input: NewPhotoInput): Promise<Photo> {
    const uploads = await Promise.all([
      this.client.storage
        .from(BUCKET)
        .upload(`${input.storageKey}/thumb.webp`, input.thumb, {
          contentType: input.thumb.type || 'image/webp',
          upsert: false,
        }),
      this.client.storage
        .from(BUCKET)
        .upload(`${input.storageKey}/full.webp`, input.full, {
          contentType: input.full.type || 'image/webp',
          upsert: false,
        }),
    ])
    const failed = uploads.find((r) => r.error)
    if (failed?.error) throw failed.error

    const { data, error } = await this.client
      .from('photos')
      .insert({
        storage_key: input.storageKey,
        width: input.width,
        height: input.height,
        aspect: input.width / input.height,
        taken_at: input.takenAt,
        caption: input.caption,
      })
      .select('*')
      .single()

    if (error) throw error
    return toPhoto(data as PhotoRow)
  }

  async patchPhoto(
    id: string,
    patch: Partial<Pick<Photo, 'caption' | 'featuredAt'>>
  ): Promise<void> {
    const row: Record<string, unknown> = {}
    if ('caption' in patch) row.caption = patch.caption
    if ('featuredAt' in patch) row.featured_at = patch.featuredAt
    if (!Object.keys(row).length) return
    const { error } = await this.client.from('photos').update(row).eq('id', id)
    if (error) throw error
  }

  async softDeletePhoto(id: string): Promise<void> {
    const { error } = await this.client
      .from('photos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  }

  async countMessages(): Promise<Record<string, number>> {
    const { data, error } = await this.client
      .from('messages')
      .select('photo_id')
      .is('deleted_at', null)
    if (error) throw error
    const out: Record<string, number> = {}
    for (const row of data as { photo_id: string }[]) {
      out[row.photo_id] = (out[row.photo_id] ?? 0) + 1
    }
    return out
  }

  async listMessages(photoId: string): Promise<Message[]> {
    const { data, error } = await this.client
      .from('messages')
      .select('*')
      .eq('photo_id', photoId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (error) throw error
    return (data as MessageRow[]).map(toMessage)
  }

  async createMessage(photoId: string, content: string): Promise<Message> {
    const { data, error } = await this.client
      .from('messages')
      .insert({ photo_id: photoId, content })
      .select('*')
      .single()
    if (error) throw error
    return toMessage(data as MessageRow)
  }

  peekUrl(storageKey: string, variant: ImageVariant): string | null {
    const cacheKey = `${storageKey}/${variant}`
    const hit = this.urlCache.get(cacheKey)
    if (hit) return hit

    const { data } = this.client.storage
      .from(BUCKET)
      .getPublicUrl(`${storageKey}/${variant}.webp`)
    const url = data.publicUrl
    this.urlCache.set(cacheKey, url)
    return url
  }

  async resolveUrl(storageKey: string, variant: ImageVariant): Promise<string> {
    return this.peekUrl(storageKey, variant) ?? ''
  }
}
