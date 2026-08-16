// Tokenizer 模块 — 优先用精确 tokenizer（gpt-tokenizer），失败回退到启发式
// 支持的编码:
//   o200k_base   - GPT-4o / GPT-4.1 / GPT-5 / o 系列 / xAI Grok
//   cl100k_base  - GPT-4 / GPT-3.5 / Llama 3 (近似)
//   claude-o200k - Claude 4.7+ 用新 tokenizer，未开源，按 o200k * 1.3 估算
//   gemini       - 未开源，启发式估算
//   heuristic    - 默认启发式

import { getModel } from './models.js'

/** gpt-tokenizer 懒加载缓存（按编码） */
const _tokenizerCache = new Map()

/**
 * 懒加载 gpt-tokenizer 的指定编码
 * @param {string} encoding  - 'o200k_base' | 'cl100k_base' | 'p50k_base' ...
 * @returns {Promise<{encode: (text:string)=>number[]}|null>}
 */
async function loadGptTokenizer(encoding) {
  if (_tokenizerCache.has(encoding)) return _tokenizerCache.get(encoding)
  try {
    // gpt-tokenizer 包导出多个子路径
    const mod = await import(`gpt-tokenizer/${encoding}`)
    const t = mod.default || mod
    _tokenizerCache.set(encoding, t)
    return t
  } catch (err) {
    // 回退：尝试主包
    try {
      const mod = await import('gpt-tokenizer')
      if (mod[encoding]) {
        _tokenizerCache.set(encoding, mod[encoding])
        return mod[encoding]
      }
      if (mod.encode && typeof mod.encode === 'function') {
        _tokenizerCache.set(encoding, mod)
        return mod
      }
    } catch (_) { /* fallthrough */ }
    _tokenizerCache.set(encoding, null)
    return null
  }
}

/**
 * 启发式 token 估算
 * 经验值（参考 OpenAI Cookbook、Anthropic 文档）:
 *   - 英文: ~4 字符 / token（含空格）
 *   - 中文: ~1.5 字符 / token（一字约 0.6-0.7 token）
 *   - 日文: ~1.5 字符 / token
 *   - 代码: ~3.5 字符 / token
 *   - 标点: 单独计 1 token
 *
 * @param {string} text
 * @param {{lang?: 'auto'|'en'|'zh'|'ja'|'code'|'mixed'}} opts
 */
export function heuristicCount(text, opts = {}) {
  if (!text) return 0
  const str = typeof text === 'string' ? text : String(text)
  const lang = opts.lang || detectLanguage(str)

  // 拆分各语言字符
  let asciiChars = 0      // ASCII 范围（英文+数字+半角符号）
  let cjkChars = 0        // CJK 中日韩
  let emojiChars = 0      // emoji / 其他多字节
  let otherChars = 0

  for (const ch of str) {
    const cp = ch.codePointAt(0)
    if (cp <= 0x7F) asciiChars++
    else if (cp >= 0x4E00 && cp <= 0x9FFF) cjkChars++
    else if (cp >= 0x3040 && cp <= 0x30FF) cjkChars++      // 平假名/片假名
    else if (cp >= 0xAC00 && cp <= 0xD7AF) cjkChars++      // 韩文音节
    else if (cp >= 0x1F000) emojiChars++
    else otherChars++
  }

  // 不同语言分项系数（tokens / 字符）
  const asciiPerTok = lang === 'code' ? 1 / 3.5 : 1 / 4
  const cjkPerTok = 1 / 1.5
  const emojiPerTok = 1.0
  const otherPerTok = 1 / 2

  const tokens =
    asciiChars * asciiPerTok +
    cjkChars * cjkPerTok +
    emojiChars * emojiPerTok +
    otherChars * otherPerTok

  // 小修正：空字符串 / 极短文本
  return Math.max(1, Math.round(tokens))
}

/**
 * 简易语言检测
 */
export function detectLanguage(text) {
  if (!text) return 'mixed'
  let cjk = 0, ascii = 0, other = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp <= 0x7F) ascii++
    else if (cp >= 0x4E00 && cp <= 0x9FFF) cjk++
    else if (cp >= 0x3040 && cp <= 0x30FF) cjk++
    else if (cp >= 0xAC00 && cp <= 0xD7AF) cjk++
    else other++
  }
  const total = cjk + ascii + other
  if (!total) return 'mixed'
  // 代码启发：含大括号、分号、缩进
  if (/[{};=>]/.test(text) && /\n\s+/.test(text) && ascii / total > 0.5) return 'code'
  if (cjk / total > 0.3) return 'zh'
  if (ascii / total > 0.7) return 'en'
  return 'mixed'
}

/**
 * Claude 4.7+ 的新 tokenizer 未开源，按 o200k 结果 * 1.3 估算
 * 来源: Anthropic 2025-09 公告 "up to 35% more tokens compared to earlier models"
 */
const CLAUDE_TOKENIZER_FACTOR = 1.3

/**
 * 主入口：按模型计算 token 数
 * @param {string} text
 * @param {string|{tokenizer?: string, id?: string}} modelOrTokenizer - 模型 id 或显式 tokenizer 名
 * @param {{forceHeuristic?: boolean, lang?: string}} [opts]
 * @returns {Promise<{tokens:number, method:string, tokenizer:string}>}
 */
export async function countTokens(text, modelOrTokenizer, opts = {}) {
  const text0 = typeof text === 'string' ? text : String(text ?? '')

  let tokenizerName
  if (typeof modelOrTokenizer === 'string') {
    // 优先当作 model id 处理（解析出 tokenizer）；否则当 tokenizer 名
    const meta = getModel(modelOrTokenizer)
    tokenizerName = meta ? meta.tokenizer : modelOrTokenizer
  } else if (modelOrTokenizer?.tokenizer) {
    tokenizerName = modelOrTokenizer.tokenizer
  } else {
    tokenizerName = 'heuristic'
  }

  if (opts.forceHeuristic) {
    return {
      tokens: heuristicCount(text0, { lang: opts.lang }),
      method: 'heuristic',
      tokenizer: tokenizerName,
    }
  }

  // 没有精确 tokenizer 的直接走启发式
  if (tokenizerName === 'heuristic' || tokenizerName === 'gemini') {
    return {
      tokens: heuristicCount(text0, { lang: opts.lang }),
      method: 'heuristic',
      tokenizer: tokenizerName,
    }
  }

  // OpenAI 系编码: o200k_base / cl100k_base / p50k_base
  if (['o200k_base', 'cl100k_base', 'p50k_base', 'r50k_base'].includes(tokenizerName)) {
    const t = await loadGptTokenizer(tokenizerName)
    if (t && typeof t.encode === 'function') {
      try {
        const ids = t.encode(text0)
        return { tokens: ids.length, method: 'exact', tokenizer: tokenizerName }
      } catch (err) {
        // 回退启发式
      }
    }
  }

  // Claude 新 tokenizer: 用 o200k 估 * 1.3
  if (tokenizerName === 'claude-o200k') {
    const t = await loadGptTokenizer('o200k_base')
    if (t && typeof t.encode === 'function') {
      try {
        const ids = t.encode(text0)
        return {
          tokens: Math.ceil(ids.length * CLAUDE_TOKENIZER_FACTOR),
          method: 'estimated-claude',
          tokenizer: tokenizerName,
        }
      } catch (_) { /* fallthrough */ }
    }
  }

  // 兜底
  return {
    tokens: heuristicCount(text0, { lang: opts.lang }),
    method: 'heuristic-fallback',
    tokenizer: tokenizerName,
  }
}

/**
 * 同步版（仅启发式，等价于不传 model 或传 heuristic）
 */
export function countTokensSync(text, opts = {}) {
  return heuristicCount(text, { lang: opts.lang })
}

/**
 * 检测 gpt-tokenizer 是否已成功加载（用于诊断 / 启发式回退判断）
 */
export async function isExactTokenizerAvailable(encoding = 'o200k_base') {
  const t = await loadGptTokenizer(encoding)
  return !!t && typeof t.encode === 'function'
}
