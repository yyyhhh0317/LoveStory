/**
 * 把 public/sw.js 这份模板变成 dist/sw.js：
 * 注入版本号 + 扫出 dist 里所有该预缓存的文件。
 *
 * 模板永远从 public/ 读（那里始终带占位符），写进 dist/。
 * 所以重复执行是安全的，也不会因为读到自己改过的产物而炸掉。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const DIST = 'dist'
const TEMPLATE = 'public/sw.js'

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out
}

const files = (await walk(DIST))
  .map((f) => relative(DIST, f).split(sep).join('/'))
  .filter((f) => !f.split('/').some((seg) => seg.startsWith('.')))
  .filter((f) => f !== 'sw.js')
  .sort()

if (!files.includes('index.html')) {
  throw new Error('dist/index.html 不见了，先跑 vite build')
}

const html = await readFile(join(DIST, 'index.html'))
// 用 index.html 的哈希当版本：它变了，才意味着引用了一批新的 chunk
const version = createHash('sha256').update(html).digest('hex').slice(0, 8)

const template = await readFile(TEMPLATE, 'utf8')
if (!template.includes('%PRECACHE%') || !template.includes("'%VERSION%'")) {
  throw new Error('public/sw.js 里的占位符不见了，构建脚本拒绝写入')
}

const out = template
  .replace("'%VERSION%'", JSON.stringify(version))
  .replace('%PRECACHE%', JSON.stringify(files, null, 2))

await writeFile(join(DIST, 'sw.js'), out, 'utf8')
console.log(`[sw] 版本 ${version} · 预缓存 ${files.length} 个文件`)
