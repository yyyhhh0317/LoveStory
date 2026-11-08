import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  BoardMessage,
  ImageVariant,
  Message,
  NewPhotoInput,
  Photo,
  Plan,
  Repo,
} from '../types'

const BUCKET = 'photos'

interface PhotoRow {
  id: string
  storage_key: string
  width: number
  height: number
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
  takenAt: row.taken_at,
  caption: row.caption,
  featuredAt: row.featured_at,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
})

/**
 * Storage 在对象已存在时返回 409。
 * 对我们只有一个含义：这一档文件上一次已经传成功了。
 * storage_key 是 UUID，不可能撞到别人的对象，所以可以安全地当成功处理。
 */
function isAlreadyExists(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: string; message?: string } | null
  if (!e) return false
  const code = String(e.statusCode ?? e.status ?? '')
  return code === '409' || /duplicate|already exists/i.test(e.message ?? '')
}

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  photoId: row.photo_id,
  content: row.content,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
})

interface BoardRow {
  id: string
  content: string
  created_at: string
  deleted_at: string | null
}

interface PlanRow {
  id: string
  title: string
  done_at: string | null
  created_at: string
  deleted_at: string | null
}

const toBoard = (row: BoardRow): BoardMessage => ({
  id: row.id,
  content: row.content,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
})

const toPlan = (row: PlanRow): Plan => ({
  id: row.id,
  title: row.title,
  doneAt: row.done_at,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
})

/** 两个人的板子，一年也就几千条。300 条封顶，不让 payload 无界 */
const BOARD_LIMIT = 300

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
    /*
     * 显式列而不是 *：以后给表加列（比如隐藏字段、审计列）时，
     * 不会悄悄把 payload 撑大，也不用担心列顺序变化影响 toPhoto 的映射。
     */
    const { data, error } = await this.client
      .from('photos')
      .select('id,storage_key,width,height,taken_at,caption,featured_at,created_at,deleted_at')
      .is('deleted_at', null)
      .order('taken_at', { ascending: true })
      /*
       * 时间戳撞车必须要有第二排序键：同一秒连拍、EXIF 读不到退回文件
       * 修改时间，都会产生相同的 taken_at。没有 tiebreak 时数据库不保证
       * 两次查询给出同样的顺序，而 useAlbum 的 photoSig 是**按顺序**拼的
       * —— 顺序一抖就判定「数据变了」，整条时间轴白重排一次。
       */
      .order('created_at', { ascending: true })
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
    // 上一次「缩略图传上去了、大图没传」留下的那一档，这次会返回 409。
    // 那不是失败，是「已经在了」——忽略它，整条链路才可重试。
    const failed = uploads.find((r) => r.error && !isAlreadyExists(r.error))
    if (failed?.error) throw failed.error

    const { data, error } = await this.client
      .from('photos')
      .insert({
        storage_key: input.storageKey,
        width: input.width,
        height: input.height,
        taken_at: input.takenAt,
        caption: input.caption,
      })
      .select('*')
      .single()

    if (!error) return toPhoto(data as PhotoRow)

    /*
     * 23505 = storage_key 唯一键冲突，说明上一次「文件传完了但插库没成」，
     * 这次重试撞上了自己。把那一行认领回来，用户看到的就是「传成功了」。
     */
    if (error.code === '23505') {
      const { data: existing, error: readError } = await this.client
        .from('photos')
        .select('*')
        .eq('storage_key', input.storageKey)
        .single()
      if (!readError && existing) {
        const photo = toPhoto(existing as PhotoRow)
        // 极小概率：那一行被软删过。用户正在重传它，说明他要的就是它，顺手放回来。
        if (photo.deletedAt) {
          const { error: restoreError } = await this.client
            .from('photos')
            .update({ deleted_at: null })
            .eq('id', photo.id)
          if (!restoreError) return { ...photo, deletedAt: null }
        }
        return photo
      }
    }

    throw error
  }

  async patchPhoto(
    id: string,
    patch: Partial<Pick<Photo, 'caption' | 'featuredAt'>>
  ): Promise<void> {
    const row: Record<string, unknown> = {}
    if ('caption' in patch) row.caption = patch.caption
    if ('featuredAt' in patch) row.featured_at = patch.featuredAt
    if (!Object.keys(row).length) return
    /*
     * 必须 .select('id') 拿回被改的行：RLS 没有 update 策略时 PostgREST
     * 会返回 204 且不带错误，界面就会以为改好了、刷新才发现是原样。
     * 和 setPlanDone 同一个道理 —— README 里那条应急操作（外泄时删掉
     * photos 的 update 策略）会让这里静默失败，所以这道校验是必需品。
     */
    const { data, error } = await this.client
      .from('photos')
      .update(row)
      .eq('id', id)
      .select('id')
    if (error) throw error
    if (!data?.length) throw new Error('照片没写进去（photos 缺少 update 策略？）')
  }

  async softDeletePhoto(id: string): Promise<void> {
    // 同上：0 行意味着「没删掉」，不能当成成功
    const { data, error } = await this.client
      .from('photos')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select('id')
    if (error) throw error
    if (!data?.length) throw new Error('照片没能移出相册（photos 缺少 update 策略？）')
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

  async listMessages(photoId: string, signal?: AbortSignal): Promise<Message[]> {
    const query = this.client
      .from('messages')
      .select('*')
      .eq('photo_id', photoId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    // 详情页快速翻页时，上一张的请求已经没有意义了，别让它继续占着连接
    const { data, error } = await (signal ? query.abortSignal(signal) : query)
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

  async listBoardMessages(signal?: AbortSignal): Promise<BoardMessage[]> {
    const query = this.client
      .from('board_messages')
      .select('id,content,created_at,deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(BOARD_LIMIT)
    const { data, error } = await (signal ? query.abortSignal(signal) : query)
    if (error) throw error
    return (data as BoardRow[]).map(toBoard)
  }

  async createBoardMessage(content: string): Promise<BoardMessage> {
    const { data, error } = await this.client
      .from('board_messages')
      .insert({ content })
      .select('id,content,created_at,deleted_at')
      .single()
    if (error) throw error
    return toBoard(data as BoardRow)
  }

  async listPlans(signal?: AbortSignal): Promise<Plan[]> {
    // 未完成和已完成一次拿全，分组在客户端做 —— 两张列表加起来才几十行
    const query = this.client
      .from('plans')
      .select('id,title,done_at,created_at,deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
    const { data, error } = await (signal ? query.abortSignal(signal) : query)
    if (error) throw error
    return (data as PlanRow[]).map(toPlan)
  }

  async createPlan(title: string): Promise<Plan> {
    const { data, error } = await this.client
      .from('plans')
      .insert({ title })
      .select('id,title,done_at,created_at,deleted_at')
      .single()
    if (error) throw error
    return toPlan(data as PlanRow)
  }

  async setPlanDone(id: string, done: boolean): Promise<void> {
    /*
     * 必须 .select('id')：RLS 没配 update 策略时，PostgREST 的 update 会返回
     * 204 且不带任何错误，界面就会以为勾上了、刷新才发现没存。
     * 拿回被改的行数，才是「真的写进去了」的唯一证据。
     */
    const { data, error } = await this.client
      .from('plans')
      .update({ done_at: done ? new Date().toISOString() : null })
      .eq('id', id)
      .select('id')
    if (error) throw error
    if (!data?.length) throw new Error('计划状态没写进去（plans 表缺少 update 策略？）')
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
