import type { Repo } from '../types'
import { LocalRepo } from './local'
import { SupabaseRepo } from './supabase'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '')
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/**
 * 有 Supabase 配置就走远端，没有就退回本地模式。
 * 本地模式下一切功能（上传、简介、相册、留言）都能跑，只是数据只在这台设备上。
 */
export const repo: Repo =
  url && anonKey ? new SupabaseRepo(url, anonKey) : new LocalRepo()

export const isRemote = repo.kind === 'supabase'
