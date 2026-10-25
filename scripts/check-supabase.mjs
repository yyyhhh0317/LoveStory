/**
 * Supabase 连通性自检
 * 用法：npm run check
 *
 * 它只读不写：查一下两张表、一个存储桶、以及公开读权限是否正常。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const ok = (s) => `\x1b[32m✔\x1b[0m ${s}`
const bad = (s) => `\x1b[31m✘\x1b[0m ${s}`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

let failed = false
const fail = (s, hint) => {
  failed = true
  console.log(bad(s))
  if (hint) console.log(dim(`   ↳ ${hint}`))
}

function loadEnv() {
  const env = {}
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let v = m[2]
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1)
      }
      env[m[1]] = v
    }
  }
  return env
}

const env = loadEnv()
const url = env.VITE_SUPABASE_URL?.trim()
const key = env.VITE_SUPABASE_ANON_KEY?.trim()

console.log('\n  检查 .env.local\n')

if (!url || !key) {
  fail('没有找到 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  console.log(dim('   ↳ 复制 .env.example 为 .env.local，填入 Project URL 和 anon public key'))
  process.exit(1)
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  fail(`Project URL 格式不太对：${url}`)
  console.log(dim('   ↳ 应该是 https://你的项目ref.supabase.co，不要带 /rest/v1 之类的后缀'))
} else {
  console.log(ok('Project URL 格式正确'))
}

if (key.startsWith('eyJ')) {
  console.log(ok('用的是 JWT 形式的 anon key'))
} else if (key.startsWith('sb_secret')) {
  fail('这是 secret key，绝对不能放前端')
  console.log(dim('   ↳ 换成 anon public 或 publishable key'))
  process.exit(1)
} else {
  console.log(ok('用的是新版 publishable key'))
}

const supabase = createClient(url.replace(/\/$/, ''), key, {
  auth: { persistSession: false },
})

console.log('\n  检查数据库\n')

for (const table of ['photos', 'messages']) {
  const { error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) {
    if (error.code === '42P01') {
      fail(`表 ${table} 不存在`, '到 SQL Editor 里执行 supabase/schema.sql')
    } else if (error.code === '42501' || /permission denied|row-level security/i.test(error.message)) {
      fail(`表 ${table} 存在但读不了`, 'RLS 策略没有建好，重新执行 schema.sql 里的 policy 部分')
    } else {
      fail(`表 ${table} 查询失败：${error.message}`)
    }
  } else {
    console.log(ok(`表 ${table} 可读`))
  }
}

console.log('\n  检查存储\n')

/*
 * 不用 storage.getBucket()：那个接口需要 service_role 权限，
 * 用 anon key 调会一律返回 “Bucket not found”，是个假警报。
 * 改成走对象列表接口（受 RLS 策略管辖，才是真实的可用性）。
 */
const { error: listError } = await supabase.storage.from('photos').list('', { limit: 1 })
if (listError) {
  if (/bucket not found|NoSuchBucket/i.test(listError.message)) {
    fail('存储桶 photos 不存在', '到 SQL Editor 重新执行 schema.sql 里的 storage 部分')
  } else {
    fail(`存储桶 photos 访问失败：${listError.message}`, '检查 storage.objects 的 select 策略')
  }
} else {
  console.log(ok('存储桶 photos 存在且可访问'))

  const probeUrl = `${url.replace(/\/$/, '')}/storage/v1/object/public/photos/__probe__/thumb.webp`
  try {
    const res = await fetch(probeUrl)
    const body = await res.text()
    if (/NoSuchKey|Object not found/i.test(body)) {
      console.log(ok('公开读取路径正常（桶是 Public）'))
      console.log(dim(`   图片地址形如 ${probeUrl.replace('__probe__/thumb.webp', '照片id/thumb.webp')}`))
    } else if (/NoSuchBucket|Bucket not found/i.test(body)) {
      fail('公开读取路径不可用，桶可能不是 Public', 'Storage 页面把 photos 桶改成 Public')
    } else {
      fail(`无法确认桶是否公开（HTTP ${res.status}）`, body.slice(0, 120))
    }
  } catch (err) {
    fail(`探测公开读取失败：${err.message}`)
  }
}

console.log('')
if (failed) {
  console.log('\x1b[31m还没有配好。\x1b[0m 按上面的提示修完再跑一次 npm run check。\n')
  process.exit(1)
}
console.log('\x1b[32m一切正常。\x1b[0m 重启 npm run dev，右上角的「本地模式」会消失。\n')
