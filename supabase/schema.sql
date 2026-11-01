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


-- ============================================================
-- 2026-11 · 站级留言板 + 计划清单
--
-- 这一段是后加的，可以单独复制粘贴执行（幂等）。
-- 与上面两张表的关系：
--   · messages 是「某一张照片下面说的话」（photo_id 必填）
--   · board_messages 是「平时想说的话」，不挂在照片上
--   · plans 是「还想一起做的事」
-- 三张表都只读窗口 + 写入，一律没有 delete 策略（删不掉，只能软删）。
-- ============================================================

-- ---------- 站级留言板 ----------
create table if not exists public.board_messages (
  id          uuid primary key default gen_random_uuid(),
  content     text not null check (char_length(content) between 1 and 300),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- 列表是 created_at 倒序读，只读未删的
create index if not exists board_messages_created_idx
  on public.board_messages (created_at desc)
  where deleted_at is null;

-- ---------- 计划清单 ----------
create table if not exists public.plans (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  done_at     timestamptz,          -- 非空 = 已完成（和 photos.featured_at 同一套约定）
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists plans_open_idx
  on public.plans (created_at)
  where done_at is null and deleted_at is null;

create index if not exists plans_done_idx
  on public.plans (done_at desc)
  where done_at is not null and deleted_at is null;

-- ---------- 行级安全 ----------
alter table public.board_messages enable row level security;
alter table public.plans          enable row level security;

drop policy if exists "board readable"   on public.board_messages;
drop policy if exists "board insertable" on public.board_messages;

create policy "board readable"   on public.board_messages for select using (true);
create policy "board insertable" on public.board_messages for insert with check (true);
-- 刻意不加 update：留言写了就是写了，和 messages 表口径一致

drop policy if exists "plans readable"   on public.plans;
drop policy if exists "plans insertable" on public.plans;
drop policy if exists "plans updatable"  on public.plans;

create policy "plans readable"   on public.plans for select using (true);
create policy "plans insertable" on public.plans for insert with check (true);

/*
 * 这条是功能必需品，不是可选项。
 * 勾选 / 取消勾选都是 update —— 缺了它，PostgREST 会返回 204 且不报错，
 * 界面以为勾上了，刷新才发现没存。仓储层的 setPlanDone 用 .select('id')
 * 反查行数来把这种情况变成显式报错。
 */
create policy "plans updatable"  on public.plans for update using (true) with check (true);

-- 可选：塞几条起始事项。不想要就整行注释掉
-- insert into public.plans (title) values
--   ('去英国旅行'), ('一起看一次极光'), ('养一只猫');

