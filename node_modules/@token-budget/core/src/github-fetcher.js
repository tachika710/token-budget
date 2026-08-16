// github-fetcher.js — 从 GitHub 拉项目 → 自动算预算
//
// 依赖：fetch（Node 18+ 内置 globalThis.fetch）
// 设计原则：插件本身不持有 GitHub token，让 AI 宿主通过参数传入
//        （因为 AI 本来就有 tool_use / env vars 能力读 ~/.gitconfig 或 GITHUB_TOKEN）
//
// 工作流程：
//   owner/repo[@branch] → GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1
//                           ↓ 返回 1 文件树（最多 100K 个文件，够用）
//                         过滤 doc / code / material 目录（黑白名单）
//                           ↓ 按文件路径分类
//                         GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
//                           ↓ 每个要读的文件 base64 解码
//                         把 text 聚合 → 调 planProjectBudget(docText=README/docs, material=docs, codeFiles=[])
//
// 注意：我们实际上不把内容扫到代码里（没有本地文件），而是直接在内存里构造
//       codeFiles[] 结构（满足 extractSignals 的 needs: debt markers / approxLoc / path / tokens）

import { countTokens } from './tokenizer.js'
import { planProjectBudget } from './project-estimator.js'

const GITHUB_API = 'https://api.github.com'
const MAX_TREE_FILES = 20000  // 避免大仓库把 token 吃满
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024  // 5MB 上限（匿名 API 也很友好）

// 文档 / 资料候选路径（根目录或 docs/ 下的 .md/.txt/.rst/.pdf 等只读文本）
const DOC_DIR_HINTS = ['', 'docs', 'doc', 'documentation', 'wiki', 'design', 'specs', 'schemas', 'openapi', 'docs/zh-CN', 'docs/en']
const DOC_EXTS = new Set(['.md', '.markdown', '.txt', '.rst', '.adoc', '.html'])

// 源码候选目录
const CODE_DIR_HINTS = ['src', 'packages', 'lib', 'app', 'server', 'client', 'cmd', 'pkg', 'internal', 'modules']
const CODE_EXTS = new Set([
  '.js','.mjs','.cjs','.jsx','.ts','.tsx','.vue','.svelte','.astro',
  '.py','.rs','.go','.c','.h','.cpp','.cc','.cs','.java','.kt','.rb','.php','.swift',
  '.toml','.yaml','.yml','.json','.cfg','.ini','.conf','.ini','.prisma','.proto','.graphql','.sql'
])

// 我们忽略的目录（.gitignore 里常见的 build artifact）
const SKIP_GLOBS = [
  '/node_modules/', '/dist/', '/build/', '/out/', '/target/', '/vendor/', '/.venv/', '/venv/',
  '/.git/', '/.next/', '/.nuxt/', '/.cache/', '/coverage/', '/__pycache__/', '/.idea/', '/.vscode/'
]

function pickDefaultBranch(headers, repoRespJson) {
  // repoRespJson.default_branch 就够了
  return repoRespJson.default_branch || 'main'
}

/** 解析 `owner/repo` 或 `owner/repo@branch` 或完整 GitHub URL */
export function parseGitHubRef(ref) {
  if (!ref) throw new Error('parseGitHubRef: empty input')
  // 处理完整 URL: https://github.com/owner/repo / tree/branch
  let s = ref.trim()
  const urlMatch = s.match(/^https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s#?]+)(?:\/tree\/([^\s#?]+))?/)
  if (urlMatch) {
    const [_, owner, repo, branch] = urlMatch
    return { owner, repo: repo.replace(/\.git$/, ''), branch: branch || null }
  }
  // owner/repo[@branch]
  const atMatch = s.split('@')
  const slash = atMatch[0].split('/')
  if (slash.length < 2) throw new Error(`parseGitHubRef: expected owner/repo, got "${ref}"`)
  return { owner: slash[0], repo: slash.slice(1).join('/'), branch: atMatch[1] || null }
}

/**
 * 拉 GitHub 项目 → 算预算
 *
 * @param {{
 *   repo: string,
 *   token?: string,                 // 可选 GITHUB_TOKEN（匿名也能跑，60/小时）
 *   maxFiles?: number,              // 默认 2000
 *   maxBytes?: number,              // 默认 5MB
 *   planOptions?: object,           // 传给 planProjectBudget 的参数（displayCurrency / workflow / debug 等）
 *   onProgress?: (phase:string, detail:any) => void,
 * }} input
 */
export async function fetchAndPlanGitHub(input) {
  const { repo, token, maxFiles = 2000, maxBytes = MAX_DOWNLOAD_BYTES, planOptions = {} } = input
  const parsed = parseGitHubRef(repo)
  const hdrs = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'token-budget-core' }
  if (token) hdrs.Authorization = `Bearer ${token}`
  const fetchOpts = { headers: hdrs }

  input.onProgress?.('repo-info', parsed)

  // 1) 拿仓库元信息，确定 default branch
  const metaResp = await fetch(`${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}`, fetchOpts)
  if (!metaResp.ok) throw new Error(`GitHub API /repos/${parsed.owner}/${parsed.repo} 返回 ${metaResp.status}: ${await metaResp.text().catch(() => '')}`)
  const meta = await metaResp.json()
  const branch = parsed.branch || meta.default_branch || 'main'

  input.onProgress?.('repo-meta', {
    fullName: meta.full_name,
    description: meta.description,
    stars: meta.stargazers_count,
    language: meta.language,
    defaultBranch: meta.default_branch,
    usedBranch: branch,
    updatedAt: meta.updated_at,
  })

  // 2) 拿递归 tree（所有文件路径 + 大小）
  const treeResp = await fetch(`${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, fetchOpts)
  if (!treeResp.ok) throw new Error(`GitHub API /git/trees 返回 ${treeResp.status}: ${await treeResp.text().catch(() => '')}`)
  const treeJson = await treeResp.json()
  if (treeJson.truncated) {
    input.onProgress?.('tree-truncated', { note: 'GitHub 截断了 tree，只返回 100K 条目，不影响小/中型项目' })
  }
  const treeEntries = (treeJson.tree || []).filter(e => e.type === 'blob')

  input.onProgress?.('tree-entries', { count: treeEntries.length })

  // 3) 分类：doc(文档/企划书) / material(参考资料) / code(源码)
  const docs = []      // {path, size, sha}
  const materials = [] // {path, size, sha}
  const codes = []     // {path, size, sha}
  let skippedByGlob = 0
  for (const entry of treeEntries) {
    const p = '/' + entry.path  // 加 / 前缀方便 glob 匹配
    if (SKIP_GLOBS.some(g => p.includes(g))) { skippedByGlob++; continue }
    const ext = (/\.[^.\/]+$/.exec(entry.path) || [])[0]?.toLowerCase() || ''
    const lower = entry.path.toLowerCase()

    // README / docs/ / 根目录 .md → docs
    const isTopMd = !entry.path.includes('/') && DOC_EXTS.has(ext)
    const inDocDir = DOC_DIR_HINTS.some(d => lower.startsWith(d ? (d + '/') : ''))
    if (isTopMd || (inDocDir && DOC_EXTS.has(ext))) {
      if (lower.includes('api') || lower.includes('spec') || lower.includes('schema') || lower.includes('readme') === false && inDocDir) {
        materials.push(entry)
      } else {
        docs.push(entry)
      }
      continue
    }

    // 源码：在 code 目录或有源码扩展名的不在 docs/ 里
    const inCodeDir = CODE_DIR_HINTS.some(d => lower.startsWith(d + '/'))
    const isCodeExt = CODE_EXTS.has(ext)
    if ((inCodeDir || isCodeExt) && isCodeExt) {
      codes.push(entry)
      continue
    }
  }

  // 按文件数限制：最多只下前 N 个
  const totalDownloadable = docs.length + materials.length + codes.length
  if (totalDownloadable > maxFiles) {
    input.onProgress?.('trim-files', { before: totalDownloadable, after: maxFiles, note: '超过 maxFiles，只下前 N 个' })
    docs.splice(maxFiles)
    materials.splice(Math.max(0, maxFiles - docs.length))
    codes.splice(Math.max(0, maxFiles - docs.length - materials.length))
  }

  input.onProgress?.('classified', {
    docs: docs.length,
    materials: materials.length,
    codes: codes.length,
    skippedByGlob,
    totalDownloadable,
  })

  // 4) 批量下载内容（串行 + 字节上限 + 可选 token 提权）
  const download = async (entries) => {
    const out = []
    let sizeTotal = 0
    for (const e of entries) {
      if (sizeTotal > maxBytes) { out.push({ ...e, skipped: true, reason: 'maxBytes 上限' }); continue }
      if ((e.size || 0) > 512 * 1024) { out.push({ ...e, skipped: true, reason: '单文件 > 512KB' }); continue }
      try {
        const r = await fetch(`${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURIComponent(e.path)}?ref=${encodeURIComponent(branch)}`, fetchOpts)
        if (!r.ok) { out.push({ ...e, skipped: true, reason: `HTTP ${r.status}` }); continue }
        const j = await r.json()
        if (j.encoding !== 'base64') { out.push({ ...e, skipped: true, reason: '非 base64 encoding' }); continue }
        const text = Buffer.from(j.content, 'base64').toString('utf8')
        sizeTotal += e.size || text.length
        out.push({ ...e, text, size: e.size || text.length })
      } catch (err) {
        out.push({ ...e, skipped: true, reason: err.message })
      }
    }
    return out
  }

  input.onProgress?.('download-start', { docs: docs.length, materials: materials.length, codes: codes.length })
  const [docFiles, matFiles, codeFiles] = await Promise.all([
    download(docs), download(materials), download(codes),
  ])
  input.onProgress?.('download-done', {
    docBytes: docFiles.reduce((a, f) => a + (f.size || 0), 0),
    matBytes: matFiles.reduce((a, f) => a + (f.size || 0), 0),
    codeBytes: codeFiles.reduce((a, f) => a + (f.size || 0), 0),
    skipped: [...docFiles, ...matFiles, ...codeFiles].filter(f => f.skipped).length,
  })

  // 5) 文本聚合 → 给 planProjectBudget
  const docTextParts = []
  for (const f of docFiles) if (f.text) docTextParts.push(`# FILE: ${f.path}\n\n${f.text}\n\n`)
  const matTextParts = []
  for (const f of matFiles) if (f.text) matTextParts.push(`# FILE: ${f.path}\n\n${f.text}\n\n`)

  // codeFiles 转换成 extractSignals 能消费的结构：{path, tokens, debtMarkers, approxLoc}
  const convertedCodeFiles = []
  let totalCodeTokens = 0
  for (const f of codeFiles) {
    if (!f.text) continue
    const tokens = (await countTokens(f.text, 'gpt-4o', { forceHeuristic: true })).tokens
    totalCodeTokens += tokens
    const approxLoc = f.text.split('\n').length
    const markers = (f.text.match(/\b(TODO|FIXME|HACK|XXX|BUG|WORKAROUND)\b/g) || []).length
    convertedCodeFiles.push({
      path: f.path,
      tokens,
      method: 'heuristic',
      debtMarkers: markers,
      approxLoc,
      ext: (/\.[^.\/]+$/.exec(f.path) || [])[0]?.toLowerCase() || '',
    })
  }
  const codeLOC = convertedCodeFiles.reduce((a, f) => a + (f.approxLoc || 0), 0)

  input.onProgress?.('aggregated', {
    docChars: docTextParts.join('').length,
    matChars: matTextParts.join('').length,
    codeFiles: convertedCodeFiles.length,
    codeLOC,
    codeTokens: totalCodeTokens,
  })

  // 6) 调 planProjectBudget
  const plan = await planProjectBudget({
    docText: docTextParts.join('\n\n=== DOC FILE SPLIT ===\n\n'),
    materialText: matTextParts.join('\n\n=== MATERIAL FILE SPLIT ===\n\n'),
    codeFiles: convertedCodeFiles,
    codeTokens: totalCodeTokens,
    codeLOC,
    ...planOptions,
  })

  // 加上元数据，方便报告显示
  plan.github = {
    fullName: meta.full_name,
    description: meta.description,
    stars: meta.stargazers_count,
    language: meta.language,
    branch,
    updatedAt: meta.updated_at,
    files: {
      docs: docFiles.length,
      materials: matFiles.length,
      codes: codeFiles.length,
    },
  }
  return plan
}
