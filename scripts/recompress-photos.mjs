#!/usr/bin/env node
/*
 * 存量照片重压（一次性维护脚本，不进构建）
 *
 * 背景：图片两档在 2026-10-26 从 720 / 2048 改成 560 / 1800，但那只对新上传
 * 的照片生效。这之前进库的照片仍在用旧尺寸 —— 画布卡片最宽才 155 CSS px、
 * 详情页在 1280 视口下只显示 490×653，却在下载 2048px 的图。
 *
 * 它做什么：逐张读 full.webp → 重编码成 1800 / q0.8，再从同一张位图缩出
 * 560 的缩略图。**不碰 photos.width/height** —— 那里记的是原图尺寸（画布位置
 * 由 taken_at 序号决定、比例用于布局），重压不该改。
 *
 * 两种落地方式，取决于 storage.objects 上有没有 update 策略：
 *
 *   --mode overwrite（默认）  覆盖同名对象。干净、不留垃圾，但需要
 *                             supabase/schema.sql 里那条 "photo objects updatable"，
 *                             否则被 RLS 拒成 403。
 *
 *   --mode newkey             换一个新的 storage_key：新图传进新目录，再 PATCH
 *                             photos.storage_key 指过去。**只需要现存权限**
 *                             （insert 对象 + update 表），但旧对象会永久留在桶里 ——
 *                             没有 delete 策略，删不掉。
 *
 * 两种方式跑完都必须让 public/sw.js 的 IMG_FULL / IMG_THUMB 版本号跟着升，
 * 否则 CacheFirst 会继续吐旧字节。本次已经升到 v2。
 *
 * 用法：
 *   npm i --no-save puppeteer-core          # 只装这一次，不动 package.json
 *   node scripts/recompress-photos.mjs                 # 试算，不写任何东西
 *   node scripts/recompress-photos.mjs --write         # 真写（默认 overwrite）
 *   node scripts/recompress-photos.mjs --write --mode newkey
 *   node scripts/recompress-photos.mjs --write --limit 3
 *
 * 可选参数：
 *   --mode M       overwrite | newkey，默认 overwrite
 *   --limit N      只处理前 N 张
 *   --quality Q    大图质量，默认 0.8
 *   --full N       大图最长边，默认 1800
 *   --thumb N      缩略图最长边，默认 560
 *   --only KEY     只处理某个 storage_key 前缀（排查用）
 */

import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

/* ---------------- 参数 ---------------- */

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const WRITE = has('--write')
const MODE = val('--mode', 'overwrite')
const LIMIT = Number(val('--limit', '0')) || 0
const QUALITY = Number(val('--quality', '0.8'))
const FULL_EDGE = Number(val('--full', '1800'))
const THUMB_EDGE = Number(val('--thumb', '560'))
const ONLY = val('--only', '')

if (!['overwrite', 'newkey'].includes(MODE)) {
  throw new Error('--mode 只能是 overwrite 或 newkey')
}

/* ---------------- 环境 ---------------- */

function loadEnv() {
  const file = join(ROOT, '.env.local')
  if (!existsSync(file)) throw new Error('找不到 .env.local')
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('.env.local 里缺 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  return { origin: url.replace(/\/$/, ''), key }
}

function loadPuppeteer() {
  const pin = process.env.PUPPETEER_CORE
  try {
    return pin ? require(pin) : require('puppeteer-core')
  } catch {
    throw new Error('缺 puppeteer-core：先跑 npm i --no-save puppeteer-core')
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) throw new Error('找不到 Chrome，用 CHROME_PATH 指定')
  return hit
}

/* ---------------- 页内逻辑 ---------------- */

/**
 * 在页面里处理一张照片。
 *
 * 整段跑在 Supabase 自己的源上（见下面 goto），所以：
 *   · fetch 不触发 CORS，也不用预检；
 *   · 拿到的 blob 是同源数据，createImageBitmap 和 canvas 都不会被污染。
 */
async function processOne(args) {
  const { origin, anon, key, write, mode, fullEdge, thumbEdge, quality } = args
  const pub = `${origin}/storage/v1/object/public/photos/${key}`

  const get = async (v) => {
    // no-store：要读当前字节，不能拿 HTTP 缓存里的旧副本当源
    const r = await fetch(`${pub}/${v}.webp`, { cache: 'no-store' })
    if (!r.ok) throw new Error(`读 ${v}.webp 失败 HTTP ${r.status}`)
    return r.blob()
  }

  const out = { key }
  const fullOld = await get('full')
  const thumbOld = await get('thumb')
  out.fullOld = fullOld.size
  out.thumbOld = thumbOld.size

  const fbmp = await createImageBitmap(fullOld)
  const tbmp = await createImageBitmap(thumbOld)
  const edge = (b) => Math.max(b.width, b.height)
  out.fullDims = [fbmp.width, fbmp.height]
  out.thumbDims = [tbmp.width, tbmp.height]

  /*
   * 两档各自判断，互不牵连。
   *
   * 早期上传的缩略图是 480px，比今天的目标 560 还小 —— 对它们重编码
   * 只会变大（实测 14KB → 17KB）。判据是「最长边超过目标」，所以 480 的原样留着。
   * 也正因为按档判断，脚本可以放心重复跑。
   */
  const fullNeeded = edge(fbmp) > fullEdge + 1
  const thumbNeeded = edge(tbmp) > thumbEdge + 1
  if (!fullNeeded && !thumbNeeded) {
    fbmp.close?.()
    tbmp.close?.()
    out.skipped = 'already'
    return out
  }

  const encode = async (bmp, maxEdge, q) => {
    const s = Math.min(1, maxEdge / edge(bmp))
    const w = Math.max(1, Math.round(bmp.width * s))
    const h = Math.max(1, Math.round(bmp.height * s))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, w, h)
    const blob = await new Promise((res) => c.toBlob(res, 'image/webp', q))
    // 画布后备位图要等 GC 才释放，连续处理二十张会叠出几百 MB
    c.width = 0
    c.height = 0
    if (!blob) throw new Error('WebP 编码失败')
    return blob
  }

  let fullNew = null
  let thumbNew = null
  if (fullNeeded) {
    fullNew = await encode(fbmp, fullEdge, quality)
    out.fullNew = fullNew.size
  } else {
    out.keptFull = true
    out.fullNew = fullOld.size
  }
  if (thumbNeeded) {
    // 缩略图从大图缩，而不是拿旧的再缩一次 —— 少一代损失
    thumbNew = await encode(fbmp, thumbEdge, quality)
    out.thumbNew = thumbNew.size
  } else {
    out.keptThumb = true
    out.thumbNew = thumbOld.size
  }
  fbmp.close?.()
  tbmp.close?.()

  if (!write) return out

  const put = async (targetKey, v, blob) => {
    if (!blob.type.includes('webp')) throw new Error(`${v} 编码结果不是 webp：${blob.type}`)
    const headers = {
      apikey: anon,
      authorization: `Bearer ${anon}`,
      'content-type': 'image/webp',
    }
    // 只有覆盖才需要 upsert；newkey 是往空目录写，用 upsert:false 更安全
    if (targetKey === key) headers['x-upsert'] = 'true'
    const r = await fetch(`${origin}/storage/v1/object/photos/${targetKey}/${v}.webp`, {
      method: 'POST',
      headers,
      body: blob,
    })
    if (!r.ok) {
      const text = (await r.text()).slice(0, 160)
      if (r.status === 403 || text.includes('row-level security')) {
        throw new Error(
          '覆盖被拒：storage.objects 缺 update 策略。改用 --mode newkey，或先执行 schema.sql 里那条 photo objects updatable'
        )
      }
      throw new Error(`写 ${v}.webp 失败 HTTP ${r.status} ${text}`)
    }
  }

  /* ---------- 方式一：覆盖同名对象 ---------- */
  if (mode === 'overwrite') {
    // 重压反而更大就保留原图（高压缩率的老图会这样），两档各自判断
    if (fullNew) {
      if (fullNew.size < fullOld.size) await put(key, 'full', fullNew)
      else {
        out.keptFull = true
        out.fullNew = fullOld.size
      }
    }
    if (thumbNew) {
      if (thumbNew.size < thumbOld.size) await put(key, 'thumb', thumbNew)
      else {
        out.keptThumb = true
        out.thumbNew = thumbOld.size
      }
    }
    return out
  }

  /* ---------- 方式二：换一个新目录，再把指针挪过去 ---------- */
  /*
   * 顺序不能反：先把两个文件都写进新目录、确认读得回来，最后一步才改
   * photos.storage_key。中途任何一步失败，数据库指的还是旧目录，
   * 页面照常显示 —— 代价只是新目录里留了个没人引用的孤儿。
   */
  const newKey = crypto.randomUUID()
  const fullPayload = fullNew && fullNew.size < fullOld.size ? fullNew : fullOld
  const thumbPayload = thumbNew && thumbNew.size < thumbOld.size ? thumbNew : thumbOld
  if (fullPayload === fullOld) {
    out.keptFull = true
    out.fullNew = fullOld.size
  }
  if (thumbPayload === thumbOld) {
    out.keptThumb = true
    out.thumbNew = thumbOld.size
  }

  await put(newKey, 'full', fullPayload)
  await put(newKey, 'thumb', thumbPayload)

  // 两个文件都在了才动指针。Range 只取 1 字节，别为了确认又下一遍
  for (const v of ['full', 'thumb']) {
    const r = await fetch(`${origin}/storage/v1/object/public/photos/${newKey}/${v}.webp`, {
      headers: { range: 'bytes=0-0' },
      cache: 'no-store',
    })
    if (!r.ok) throw new Error(`新目录的 ${v}.webp 读不回来（HTTP ${r.status}），数据库未改动`)
  }

  const patch = await fetch(
    `${origin}/rest/v1/photos?storage_key=eq.${encodeURIComponent(key)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: anon,
        authorization: `Bearer ${anon}`,
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify({ storage_key: newKey }),
    }
  )
  if (!patch.ok) {
    throw new Error(`改 storage_key 失败 HTTP ${patch.status} ${(await patch.text()).slice(0, 160)}（新目录已写入但没被引用）`)
  }
  const rows = await patch.json()
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`改 storage_key 影响的行数是 ${Array.isArray(rows) ? rows.length : '?'}，请人工核对`)
  }

  out.newKey = newKey
  return out
}

/* ---------------- 主流程 ---------------- */

const kb = (n) => (n / 1024).toFixed(0)
/** 相对原值的百分比变化，负数表示变小 */
const delta = (from, to) => (from > 0 ? Math.round(((to - from) / from) * 100) : 0)
const show = (from, to) => `${from}→${to}KB ${delta(from, to) < 0 ? '省' : '增'}${Math.abs(delta(from, to))}%`

async function main() {
  const { origin, key } = loadEnv()
  console.log(
    WRITE
      ? MODE === 'newkey'
        ? '模式：写入 · newkey（新目录 + 改指针，旧对象原地留着）'
        : '模式：写入 · overwrite（覆盖 Storage 里的同名对象）'
      : '模式：试算（不写任何东西）'
  )
  console.log(`目标：full ${FULL_EDGE}px / q${QUALITY}，thumb ${THUMB_EDGE}px / q${QUALITY}`)

  const puppeteer = loadPuppeteer()
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 820 },
  })

  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('页面错误:', e.message))
    // 站在 Supabase 自己的源上，所有 fetch 都变同源
    await page.goto(`${origin}/rest/v1/`, { waitUntil: 'domcontentloaded', timeout: 60000 })

    const rows = await page.evaluate(async (args) => {
      const r = await fetch(`${args.origin}/rest/v1/photos?select=storage_key&deleted_at=is.null&order=taken_at.asc`, {
        headers: { apikey: args.anon, authorization: `Bearer ${args.anon}` },
      })
      if (!r.ok) throw new Error('读照片清单失败 HTTP ' + r.status)
      return r.json()
    }, { origin, anon: key })

    let keys = rows.map((r) => r.storage_key)
    if (ONLY) keys = keys.filter((k) => k.startsWith(ONLY))
    if (LIMIT) keys = keys.slice(0, LIMIT)
    console.log(`共 ${keys.length} 张\n`)

    const sum = { fullOld: 0, thumbOld: 0, fullNew: 0, thumbNew: 0 }
    let done = 0
    let failed = 0
    const t0 = Date.now()

    for (const k of keys) {
      process.stdout.write(`[${++done}/${keys.length}] ${k.slice(0, 8)} `)
      try {
        const r = await page.evaluate(processOne, {
          origin,
          anon: key,
          key: k,
          write: WRITE,
          mode: MODE,
          fullEdge: FULL_EDGE,
          thumbEdge: THUMB_EDGE,
          quality: QUALITY,
        })

        if (r.skipped) {
          console.log('已是新尺寸，跳过')
          continue
        }

        sum.fullOld += r.fullOld
        sum.thumbOld += r.thumbOld
        sum.fullNew += r.fullNew
        sum.thumbNew += r.thumbNew

        console.log(
          `${r.fullDims.join('×')} ${show(kb(r.fullOld), kb(r.fullNew))}` +
            ` ｜ thumb ${r.thumbDims.join('×')} ${r.keptThumb ? '原样' : show(kb(r.thumbOld), kb(r.thumbNew))}` +
            (r.newKey ? ` ｜ 新目录 ${r.newKey.slice(0, 8)}` : '')
        )
      } catch (err) {
        failed++
        console.log('失败：' + err.message)
        if (/update 策略/.test(err.message)) break
      }
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    console.log('\n' + '-'.repeat(56))
    console.log(`大图    ${show(kb(sum.fullOld), kb(sum.fullNew))}`)
    console.log(`缩略图  ${show(kb(sum.thumbOld), kb(sum.thumbNew))}`)
    console.log(`合计    ${kb(sum.fullOld + sum.thumbOld)} KB → ${kb(sum.fullNew + sum.thumbNew)} KB`)
    console.log(`耗时 ${secs}s${failed ? `，失败 ${failed} 张` : ''}${WRITE ? '' : '（试算未写入）'}`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('\n' + e.message)
  process.exit(1)
})
