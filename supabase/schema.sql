-- ============================================================
-- yyyhhh · Supabase 初始化脚本
-- 在 Supabase 控制台 → SQL Editor 里整段执行一次即可。
--
-- 设计前提（已与需求确认）：
--   · 匿名开放写入：任何人打开网页都能上传、改简介、留言
--   · 但删除一律是软删除（deleted_at），数据永远可恢复
--   · 照片本体存 Storage，数据库只存 storage_key，方便日后换存储
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 照片 ----------
create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  storage_key  text not null unique,          -- 存储层里的目录名，不存完整 URL
  width        int  not null,
  height       int  not null,
  aspect       double precision not null default 1,
  taken_at     timestamptz not null default now(),  -- EXIF 拍摄时间优先
  caption      text,                          -- 约两句话，可为空
  featured_at  timestamptz,                   -- 非空 = 已收进中心相册
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz                    -- 软删除，前台不可见但数据还在
);

create index if not exists photos_taken_at_idx
  on public.photos (taken_at)
  where deleted_at is null;

create index if not exists photos_featured_idx
  on public.photos (featured_at)
  where featured_at is not null and deleted_at is null;

-- ---------- 留言 ----------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  photo_id    uuid not null references public.photos(id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 300),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists messages_photo_idx
  on public.messages (photo_id, created_at);

-- ---------- 行级安全 ----------
alter table public.photos   enable row level security;
alter table public.messages enable row level security;

drop policy if exists "photos readable"   on public.photos;
drop policy if exists "photos insertable" on public.photos;
drop policy if exists "photos updatable"  on public.photos;

create policy "photos readable"   on public.photos for select using (true);
create policy "photos insertable" on public.photos for insert with check (true);
create policy "photos updatable"  on public.photos for update using (true) with check (true);

drop policy if exists "messages readable"   on public.messages;
drop policy if exists "messages insertable" on public.messages;

create policy "messages readable"   on public.messages for select using (true);
create policy "messages insertable" on public.messages for insert with check (true);

-- ---------- 图片存储桶 ----------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

drop policy if exists "photo objects readable"   on storage.objects;
drop policy if exists "photo objects insertable" on storage.objects;
drop policy if exists "photo objects updatable"  on storage.objects;

create policy "photo objects readable"
  on storage.objects for select
  using (bucket_id = 'photos');

create policy "photo objects insertable"
  on storage.objects for insert
  with check (bucket_id = 'photos');

/*
 * 覆盖写（x-upsert: true）走的是 update，只有 insert 策略会被 RLS 拒成
 * 403 new row violates row-level security policy。
 *
 * 平时上传仍然是 upsert:false —— storage_key 是 UUID、同名必同内容，
 * 所以 app 跑不到这条策略。它只为一次性维护脚本存在：
 * scripts/recompress-photos.mjs 要把存量的 720/2048 两档压成 560/1800。
 *
 * 安全上和「insert 对所有人开放」是同一档次：这个站本来就不做鉴权，
 * 匿名可上传、可改简介、可留言。多这一条不多开一个口子。
 */
create policy "photo objects updatable"
  on storage.objects for update
  using (bucket_id = 'photos')
  with check (bucket_id = 'photos');
