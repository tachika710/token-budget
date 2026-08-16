// 文件/目录递归 token 计数器
// 设计要点:
//   1. 默认跳过 node_modules / .git / dist / build / .next / .cache / __pycache__
//   2. 二进制文件扩展名直接跳过（图片/视频/压缩包等）
//   3. 单文件 > 5MB 默认跳过（避免内存炸）
//   4. 二进制检测: 文件含 \0 字节视为二进制
//   5. 同时支持传文本字符串（不需要文件系统）

import { readFile, stat, readdir } from 'node:fs/promises'
import { join, extname, relative, sep } from 'node:path'
import { countTokens } from './tokenizer.js'

/** 默认跳过的目录名 */
const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next',
  '.nuxt', '.cache', '__pycache__', '.venv', 'venv', '.tox',
  '.idea', '.vscode', 'target', 'out', 'bin', 'obj',
  '.turbo', '.parcel-cache', 'coverage', '.mypy_cache', '.pytest_cache',
])

/** 默认包含的文本类扩展名（空集合=不按扩展名过滤，按二进制检测） */
const DEFAULT_INCLUDED_EXT = null

/** 强制跳过的二进制/非文本扩展名 */
const BINARY_EXT = new Set([
  // 图片
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.ico', '.icns',
  '.heic', '.heif', '.raw', '.cr2', '.nef', '.psd', '.ai', '.sketch',
  // 视频
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.3gp',
  // 音频
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.opus', '.m4a',
  // 压缩包
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.tgz', '.tbz2',
  // 可执行 / 库
  '.exe', '.dll', '.so', '.dylib', '.bin', '.a', '.lib', '.o', '.obj',
  '.class', '.jar', '.war', '.pyc', '.pyd', '.wasm',
  // 数据库
  '.db', '.sqlite', '.sqlite3', '.mdb', '.accdb',
  // 文档(二进制)
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // 其他
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.lock', '.map',
])

/** 文件大小硬上限: 5MB（避免读巨大文件爆内存） */
const MAX_FILE_SIZE = 5 * 1024 * 1024

/** @typedef {{path:string, ext:string, size:number, tokens:number, method:string, skipped?:boolean, reason?:string}} FileStat */
/** @typedef {{files:FileStat[], totals:{tokens:number, files:number, skipped:number, bytes:number}, byExt:Record<string,{count:number, tokens:number}>, byMethod:Record<string, number>}} CountResult */

/**
 * 检测 buffer 是否为二进制（含 \0 字节）
 */
function looksBinary(buf) {
  // 检测前 8KB
  const sample = buf.length > 8192 ? buf.subarray(0, 8192) : buf
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true
  }
  return false
}

/**
 * 单文件计数
 * @param {string} absPath
 * @param {string} modelId
 * @param {{forceHeuristic?: boolean}} opts
 * @returns {Promise<FileStat>}
 */
export async function countFile(absPath, modelId, opts = {}) {
  const ext = extname(absPath).toLowerCase()
  let stats
  try {
    stats = await stat(absPath)
  } catch (e) {
    return { path: absPath, ext, size: 0, tokens: 0, method: 'skipped', skipped: true, reason: `stat failed: ${e.message}` }
  }

  if (!stats.isFile()) {
    return { path: absPath, ext, size: stats.size, tokens: 0, method: 'skipped', skipped: true, reason: 'not a regular file' }
  }

  if (BINARY_EXT.has(ext)) {
    return { path: absPath, ext, size: stats.size, tokens: 0, method: 'skipped', skipped: true, reason: 'binary extension' }
  }

  if (stats.size > MAX_FILE_SIZE) {
    return { path: absPath, ext, size: stats.size, tokens: 0, method: 'skipped', skipped: true, reason: `file too large (${(stats.size/1024/1024).toFixed(2)}MB > 5MB limit)` }
  }

  let buf
  try {
    buf = await readFile(absPath)
  } catch (e) {
    return { path: absPath, ext, size: stats.size, tokens: 0, method: 'skipped', skipped: true, reason: `read failed: ${e.message}` }
  }

  if (looksBinary(buf)) {
    return { path: absPath, ext, size: stats.size, tokens: 0, method: 'skipped', skipped: true, reason: 'binary content' }
  }

  // 以 utf-8 解码（即使部分文件含 BOM 等）
  const text = buf.toString('utf8')
  const r = await countTokens(text, modelId, opts)
  const out = { path: absPath, ext, size: stats.size, tokens: r.tokens, method: r.method }
  // 可选：扫描技术债标记（TODO/FIXME/HACK/XXX），用于 project-estimator 的 bug 惩罚
  if (opts.scanDebt) {
    const matches = text.match(/\b(TODO|FIXME|HACK|XXX|BUG|WORKAROUND)\b/g)
    out.debtMarkers = matches ? matches.length : 0
    // 粗略 LOC：按行数
    const approxLoc = text.split('\n').length
    out.approxLoc = approxLoc
    // 诊断日志：如果 opts.debug === true，打印每个文件的 TODO 密度
    if (opts.debug && out.debtMarkers > 0) {
      const density = (out.debtMarkers / (approxLoc / 100)).toFixed(2)
      opts.debugChannel?.('debt', absPath, {
        debtMarkers: out.debtMarkers,
        approxLoc,
        densityPer100Loc: density,
        threshold: 1,
        penalty: parseFloat(density) > 1 ? '触发惩罚' : '正常'
      })
    }
  }
  return out
}

/**
 * 递归目录计数
 * @param {string} rootPath              - 要扫描的根目录
 * @param {string} modelId               - 用于选择 tokenizer 的模型 id
 * @param {{
 *   ignoredDirs?: string[],
 *   includeExt?: string[],
 *   excludeExt?: string[],
 *   includeGlob?: (path:string)=>boolean,
 *   maxDepth?: number,
 *   forceHeuristic?: boolean,
 *   onProgress?: (done:number, total?:number) => void,
 *   scanDebt?: boolean,
 *   debug?: boolean,
 *   debugChannel?: (type:string, subject:string, detail:any) => void,
 * }} [opts]
 * @returns {Promise<CountResult>}
 */
export async function countDirectory(rootPath, modelId, opts = {}) {
  const ignoredDirs = new Set([...(opts.ignoredDirs || []), ...DEFAULT_IGNORED_DIRS])
  const includeExt = opts.includeExt ? new Set(opts.includeExt.map(e => e.toLowerCase())) : null
  const excludeExt = opts.excludeExt ? new Set(opts.excludeExt.map(e => e.toLowerCase())) : null
  const maxDepth = opts.maxDepth ?? 50

  /** @type {FileStat[]} */
  const files = []
  const totals = { tokens: 0, files: 0, skipped: 0, bytes: 0 }
  const debugSummary = { debtFiles: 0, debtTotal: 0, totalLoc: 0 }

  // 给 statFile 透传 debug + debugChannel + 汇总
  const innerOpts = {
    ...opts,
    debugChannel: opts.debug ? (type, subj, detail) => {
      if (type === 'debt') {
        debugSummary.debtFiles++
        debugSummary.debtTotal += detail.debtMarkers
        debugSummary.totalLoc += detail.approxLoc || 0
      }
      opts.debugChannel?.(type, subj, detail)
    } : null,
  }
  const byExt = {}
  const byMethod = {}
  let visited = 0

  async function walk(dir, depth) {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (e) {
      return // 没权限或不存在，跳过
    }
    for (const ent of entries) {
      // 跳过忽略目录
      if (ent.isDirectory()) {
        if (ignoredDirs.has(ent.name)) continue
        await walk(join(dir, ent.name), depth + 1)
        continue
      }
      if (!ent.isFile()) continue // 跳过软链、设备文件等

      const abs = join(dir, ent.name)
      const ext = extname(ent.name).toLowerCase()

      if (excludeExt && excludeExt.has(ext)) continue
      if (includeExt && !includeExt.has(ext)) continue
      if (opts.includeGlob && !opts.includeGlob(abs)) continue

      const stat = await countFile(abs, modelId, innerOpts)
      files.push(stat)
      visited++
      opts.onProgress?.(visited)

      if (stat.skipped) {
        totals.skipped++
        continue
      }
      totals.files++
      totals.tokens += stat.tokens
      totals.bytes += stat.size
      const extKey = ext || '(no ext)'
      if (!byExt[extKey]) byExt[extKey] = { count: 0, tokens: 0 }
      byExt[extKey].count++
      byExt[extKey].tokens += stat.tokens
      byMethod[stat.method] = (byMethod[stat.method] || 0) + 1
    }
  }

  // 验证 rootPath
  try {
    const st = await stat(rootPath)
    if (st.isFile()) {
      // 单文件，直接 count
      const s = await countFile(rootPath, modelId, innerOpts)
      files.push(s)
      if (!s.skipped) {
        totals.files = 1
        totals.tokens = s.tokens
        totals.bytes = s.size
        const extKey = s.ext || '(no ext)'
        byExt[extKey] = { count: 1, tokens: s.tokens }
        byMethod[s.method] = 1
      } else {
        totals.skipped = 1
      }
    } else {
      await walk(rootPath, 0)
    }
  } catch (e) {
    throw new Error(`Cannot stat path ${rootPath}: ${e.message}`)
  }

  const result = { files, totals, byExt, byMethod }
  // 返回 debug 汇总（如果开了 debug）
  if (opts.debug) {
    result.debugSummary = debugSummary
  }
  return result
}

/**
 * 直接计数文本字符串（无需文件系统）
 * @param {string} text
 * @param {string} modelId
 * @param {{forceHeuristic?: boolean, lang?: string}} opts
 */
export async function countText(text, modelId, opts = {}) {
  const r = await countTokens(text, modelId, opts)
  return {
    tokens: r.tokens,
    method: r.method,
    tokenizer: r.tokenizer,
    chars: (text || '').length,
  }
}

/**
 * 计数多个文本块（例如对话历史）
 * @param {{role:string, content:string}[]} messages
 * @param {string} modelId
 */
export async function countMessages(messages, modelId, opts = {}) {
  // 简化的对话模板：每条消息加 4 tokens 包装开销（OpenAI 风格）
  let totalTokens = 0
  /** @type {{role, content, tokens}[]} */
  const detail = []
  for (const m of messages) {
    const r = await countTokens(m.content || '', modelId, opts)
    detail.push({ role: m.role, content: m.content, tokens: r.tokens + 4 })
    totalTokens += r.tokens + 4
  }
  // 末尾的助手回复 priming: 3 tokens
  totalTokens += 3
  return { totalTokens, detail }
}
