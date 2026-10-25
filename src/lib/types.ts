export interface Photo {
  id: string
  /** 存储层的文件名主干，不存完整 URL —— 换存储只改拼装逻辑 */
  storageKey: string
  width: number
  height: number
  aspect: number
  /** 拍摄时间（EXIF 优先，缺失则用上传时间） */
  takenAt: string
  caption: string | null
  /** 非空表示已被收进中心相册 */
  featuredAt: string | null
  createdAt: string
  deletedAt: string | null
}

export interface Message {
  id: string
  photoId: string
  content: string
  createdAt: string
  deletedAt: string | null
}

export interface NewPhotoInput {
  storageKey: string
  width: number
  height: number
  takenAt: string
  caption: string | null
  thumb: Blob
  full: Blob
}

export interface Repo {
  kind: 'local' | 'supabase'
  listPhotos(): Promise<Photo[]>
  createPhoto(input: NewPhotoInput): Promise<Photo>
  patchPhoto(id: string, patch: Partial<Pick<Photo, 'caption' | 'featuredAt'>>): Promise<void>
  softDeletePhoto(id: string): Promise<void>
  countMessages(): Promise<Record<string, number>>
  listMessages(photoId: string): Promise<Message[]>
  createMessage(photoId: string, content: string): Promise<Message>
  /** 同步取已就绪的地址，未就绪返回 null（避免首帧闪烁） */
  peekUrl(storageKey: string, variant: ImageVariant): string | null
  /** 取地址，需要时异步加载 */
  resolveUrl(storageKey: string, variant: ImageVariant): Promise<string>
}

export type ImageVariant = 'thumb' | 'full'
