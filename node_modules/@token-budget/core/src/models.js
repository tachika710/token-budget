// 模型元数据表 — 用于把任意模型 ID 映射到厂商、tokenizer、上下文长度等属性
// 数据更新日期: 2026-08-16。定价以厂商官方为准；本表仅做能力描述。

/**
 * @typedef {Object} ModelMeta
 * @property {string} id                 - 规范化模型 ID（小写，作为定价表主键）
 * @property {string} provider           - 厂商 key（见 PROVIDERS）
 * @property {string} display            - 人类可读名
 * @property {string} tokenizer          - 推荐使用的 tokenizer 编码
 *   可选值: 'o200k_base' | 'cl100k_base' | 'p50k_base' | 'gemini' | 'claude-o200k' | 'qwen-tiktoken' | 'heuristic'
 * @property {number} contextWindow      - 上下文长度（tokens）
 * @property {number} maxOutput          - 最大输出长度（tokens）
 * @property {boolean} reasoning         - 是否会产出思维链（thinking tokens，按输出计费）
 * @property {string[]} aliases          - 常见别名（含厂商原命名）
 * @property {string} [notes]            - 备注
 */

/** 厂商清单 */
export const PROVIDERS = {
  openai:    { name: 'OpenAI',             currency: 'USD', region: 'US' },
  anthropic: { name: 'Anthropic',          currency: 'USD', region: 'US' },
  google:    { name: 'Google',             currency: 'USD', region: 'US' },
  deepseek:  { name: 'DeepSeek',           currency: 'USD', region: 'CN' },
  qwen:      { name: 'Alibaba Qwen',       currency: 'CNY', region: 'CN' },
  zhipu:     { name: 'Zhipu GLM',          currency: 'CNY', region: 'CN' },
  moonshot:  { name: 'Moonshot Kimi',      currency: 'CNY', region: 'CN' },
  doubao:    { name: 'ByteDance Doubao',   currency: 'CNY', region: 'CN' },
  minimax:   { name: 'MiniMax',            currency: 'CNY', region: 'CN' },
  baidu:     { name: 'Baidu ERNIE',        currency: 'CNY', region: 'CN' },
  xai:       { name: 'xAI Grok',           currency: 'USD', region: 'US' },
  mistral:   { name: 'Mistral',            currency: 'USD', region: 'EU' },
  together:  { name: 'Together AI',        currency: 'USD', region: 'US' },
  groq:      { name: 'Groq',               currency: 'USD', region: 'US' },
  cohere:    { name: 'Cohere',             currency: 'USD', region: 'CA' },
  openrouter:{ name: 'OpenRouter (Aggregator)', currency: 'USD', region: 'GLOBAL' },
}

/** 推理模型默认思维链放大系数（输出 token 真实倍率，用于成本预估） */
export const REASONING_OUTPUT_MULTIPLIER = {
  // 推理类模型平均思维链长度经验值（用于"输入->估算输出"的粗算）
  // 用户传入 outputTokens 时优先用用户的值；未传时按 input * ratio 估
  default: 4,    // 普通推理模型: ~4x 可见输出
  high:    8,    // o1 / o3-pro / deepseek-reasoner 等"重推理"
}

/** 模型元数据主表 */
export const MODELS = [
  // ─── OpenAI ───────────────────────────────────────────────────────────────
  // GPT-4.1 系列（仍在 API 提供，o200k_base tokenizer）
  { id: 'gpt-4.1',       provider: 'openai', display: 'GPT-4.1',                 tokenizer: 'o200k_base', contextWindow: 1047576, maxOutput: 32768,  reasoning: false, aliases: ['gpt-4.1-2025-04-14'] },
  { id: 'gpt-4.1-mini',  provider: 'openai', display: 'GPT-4.1 mini',            tokenizer: 'o200k_base', contextWindow: 1047576, maxOutput: 32768,  reasoning: false, aliases: ['gpt-4.1-mini-2025-04-14'] },
  { id: 'gpt-4.1-nano',  provider: 'openai', display: 'GPT-4.1 nano',             tokenizer: 'o200k_base', contextWindow: 1047576, maxOutput: 32768,  reasoning: false, aliases: ['gpt-4.1-nano-2025-04-14'] },
  // GPT-4o 系列（o200k_base）
  { id: 'gpt-4o',        provider: 'openai', display: 'GPT-4o',                  tokenizer: 'o200k_base', contextWindow: 128000,  maxOutput: 16384,  reasoning: false, aliases: ['gpt-4o-2024-11-20'] },
  { id: 'gpt-4o-mini',   provider: 'openai', display: 'GPT-4o mini',             tokenizer: 'o200k_base', contextWindow: 128000,  maxOutput: 16384,  reasoning: false },
  // GPT-5 系列（o200k_base）
  { id: 'gpt-5',         provider: 'openai', display: 'GPT-5',                   tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5-mini',    provider: 'openai', display: 'GPT-5 mini',              tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5-nano',    provider: 'openai', display: 'GPT-5 nano',              tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.1',       provider: 'openai', display: 'GPT-5.1',                 tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.2',       provider: 'openai', display: 'GPT-5.2',                 tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.3',       provider: 'openai', display: 'GPT-5.3',                 tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.4',       provider: 'openai', display: 'GPT-5.4',                 tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.4-mini',  provider: 'openai', display: 'GPT-5.4 mini',            tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.4-nano',  provider: 'openai', display: 'GPT-5.4 nano',            tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.4-pro',   provider: 'openai', display: 'GPT-5.4 Pro',              tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: true },
  { id: 'gpt-5.5',       provider: 'openai', display: 'GPT-5.5',                 tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.5-pro',   provider: 'openai', display: 'GPT-5.5 Pro',              tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: true },
  { id: 'gpt-5.6-sol',   provider: 'openai', display: 'GPT-5.6 Sol',              tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.6-terra',  provider: 'openai', display: 'GPT-5.6 Terra',             tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  { id: 'gpt-5.6-luna',  provider: 'openai', display: 'GPT-5.6 Luna',              tokenizer: 'o200k_base', contextWindow: 400000,  maxOutput: 16384,  reasoning: false },
  // o 系列推理模型
  { id: 'o1',            provider: 'openai', display: 'o1',                       tokenizer: 'o200k_base', contextWindow: 200000,  maxOutput: 100000, reasoning: true,  aliases: ['o1-2024-12-17'] },
  { id: 'o1-mini',       provider: 'openai', display: 'o1-mini',                 tokenizer: 'o200k_base', contextWindow: 128000,  maxOutput: 65536,  reasoning: true },
  { id: 'o3',            provider: 'openai', display: 'o3',                       tokenizer: 'o200k_base', contextWindow: 200000,  maxOutput: 100000, reasoning: true },
  { id: 'o3-mini',       provider: 'openai', display: 'o3-mini',                 tokenizer: 'o200k_base', contextWindow: 200000,  maxOutput: 100000, reasoning: true },
  { id: 'o3-pro',        provider: 'openai', display: 'o3-pro',                  tokenizer: 'o200k_base', contextWindow: 200000,  maxOutput: 100000, reasoning: true },
  { id: 'o4-mini',       provider: 'openai', display: 'o4-mini',                 tokenizer: 'o200k_base', contextWindow: 200000,  maxOutput: 100000, reasoning: true },

  // ─── Anthropic ─────────────────────────────────────────────────────────────
  // Claude 4.7+ 引入新 tokenizer，预估比 o200k 多 ~30% tokens（同文本）
  { id: 'claude-haiku-4.5',  provider: 'anthropic', display: 'Claude Haiku 4.5',   tokenizer: 'claude-o200k', contextWindow: 200000,  maxOutput: 8192,   reasoning: false, aliases: ['claude-3-5-haiku-20241022'] },
  { id: 'claude-sonnet-4.5', provider: 'anthropic', display: 'Claude Sonnet 4.5',  tokenizer: 'claude-o200k', contextWindow: 200000,  maxOutput: 16384,  reasoning: false },
  { id: 'claude-sonnet-4.6', provider: 'anthropic', display: 'Claude Sonnet 4.6',  tokenizer: 'claude-o200k', contextWindow: 1000000, maxOutput: 16384,  reasoning: false },
  { id: 'claude-sonnet-5',   provider: 'anthropic', display: 'Claude Sonnet 5',    tokenizer: 'claude-o200k', contextWindow: 1000000, maxOutput: 16384,  reasoning: false },
  { id: 'claude-opus-4',     provider: 'anthropic', display: 'Claude Opus 4',       tokenizer: 'claude-o200k', contextWindow: 200000,  maxOutput: 32768,  reasoning: true },
  { id: 'claude-opus-4.1',   provider: 'anthropic', display: 'Claude Opus 4.1',    tokenizer: 'claude-o200k', contextWindow: 1000000, maxOutput: 32768,  reasoning: true },
  { id: 'claude-opus-4.5',   provider: 'anthropic', display: 'Claude Opus 4.5',    tokenizer: 'claude-o200k', contextWindow: 200000,  maxOutput: 32768,  reasoning: true },
  { id: 'claude-opus-4.6',   provider: 'anthropic', display: 'Claude Opus 4.6',    tokenizer: 'claude-o200k', contextWindow: 1000000, maxOutput: 32768,  reasoning: true },
  { id: 'claude-opus-4.7',   provider: 'anthropic', display: 'Claude Opus 4.7',    tokenizer: 'claude-o200k', contextWindow: 1000000, maxOutput: 32768,  reasoning: true },
  { id: 'claude-opus-4.8',   provider: 'anthropic', display: 'Claude Opus 4.8',    tokenizer: 'claude-o200k', contextWindow: 1000000, maxOutput: 32768,  reasoning: true },
  { id: 'claude-opus-5',     provider: 'anthropic', display: 'Claude Opus 5',       tokenizer: 'claude-o200k', contextWindow: 1000000, maxOutput: 32768,  reasoning: true },
  { id: 'claude-fable-5',    provider: 'anthropic', display: 'Claude Fable 5',      tokenizer: 'claude-o200k', contextWindow: 1000000, maxOutput: 32768,  reasoning: true },

  // ─── Google Gemini ─────────────────────────────────────────────────────────
  { id: 'gemini-1.5-pro',       provider: 'google', display: 'Gemini 1.5 Pro',       tokenizer: 'gemini', contextWindow: 2000000, maxOutput: 8192,   reasoning: false },
  { id: 'gemini-1.5-flash',     provider: 'google', display: 'Gemini 1.5 Flash',     tokenizer: 'gemini', contextWindow: 1000000, maxOutput: 8192,   reasoning: false },
  { id: 'gemini-2.0-flash',     provider: 'google', display: 'Gemini 2.0 Flash',     tokenizer: 'gemini', contextWindow: 1000000, maxOutput: 8192,   reasoning: false },
  { id: 'gemini-2.5-pro',       provider: 'google', display: 'Gemini 2.5 Pro',       tokenizer: 'gemini', contextWindow: 2000000, maxOutput: 8192,   reasoning: true },
  { id: 'gemini-2.5-flash',     provider: 'google', display: 'Gemini 2.5 Flash',    tokenizer: 'gemini', contextWindow: 1000000, maxOutput: 8192,   reasoning: false },
  { id: 'gemini-3-pro',          provider: 'google', display: 'Gemini 3 Pro',         tokenizer: 'gemini', contextWindow: 2000000, maxOutput: 8192,   reasoning: false },
  { id: 'gemini-3-flash',       provider: 'google', display: 'Gemini 3 Flash',      tokenizer: 'gemini', contextWindow: 1000000, maxOutput: 8192,   reasoning: false },
  { id: 'gemini-3.1-pro',        provider: 'google', display: 'Gemini 3.1 Pro',      tokenizer: 'gemini', contextWindow: 2000000, maxOutput: 8192,   reasoning: false },

  // ─── DeepSeek ──────────────────────────────────────────────────────────────
  { id: 'deepseek-chat',       provider: 'deepseek', display: 'DeepSeek V3.2 (chat)',      tokenizer: 'heuristic', contextWindow: 128000,  maxOutput: 8192,  reasoning: false, aliases: ['deepseek-v3', 'deepseek-v3.2'] },
  { id: 'deepseek-reasoner',   provider: 'deepseek', display: 'DeepSeek R1 (reasoner)',     tokenizer: 'heuristic', contextWindow: 128000,  maxOutput: 65536, reasoning: true,  aliases: ['deepseek-r1'] },
  { id: 'deepseek-v4-flash',   provider: 'deepseek', display: 'DeepSeek V4 Flash',          tokenizer: 'heuristic', contextWindow: 1000000, maxOutput: 384000, reasoning: false },
  { id: 'deepseek-v4-pro',     provider: 'deepseek', display: 'DeepSeek V4 Pro',           tokenizer: 'heuristic', contextWindow: 1000000, maxOutput: 384000, reasoning: true },

  // ─── Qwen (Alibaba) ────────────────────────────────────────────────────────
  { id: 'qwen-turbo',       provider: 'qwen', display: 'Qwen Turbo',         tokenizer: 'heuristic', contextWindow: 1000000, maxOutput: 8192,  reasoning: false, aliases: ['qwen3-turbo'] },
  { id: 'qwen-plus',        provider: 'qwen', display: 'Qwen Plus',          tokenizer: 'heuristic', contextWindow: 128000,  maxOutput: 8192,  reasoning: false, aliases: ['qwen3-plus', 'qwen3.7-plus', 'qwen3.5-plus'] },
  { id: 'qwen-max',         provider: 'qwen', display: 'Qwen Max',           tokenizer: 'heuristic', contextWindow: 32768,   maxOutput: 8192,  reasoning: false, aliases: ['qwen3-max', 'qwen3.7-max', 'qwen3.8-max'] },
  { id: 'qwen-long',        provider: 'qwen', display: 'Qwen Long',         tokenizer: 'heuristic', contextWindow: 10000000, maxOutput: 8192, reasoning: false },
  { id: 'qwen-coder-plus',  provider: 'qwen', display: 'Qwen Coder Plus',   tokenizer: 'heuristic', contextWindow: 128000,  maxOutput: 8192,  reasoning: false, aliases: ['qwen3-coder-plus'] },

  // ─── Zhipu GLM ───────────────────────────────────────────────────────────
  { id: 'glm-4.5',          provider: 'zhipu', display: 'GLM-4.5',          tokenizer: 'heuristic', contextWindow: 128000,  maxOutput: 98304, reasoning: true },
  { id: 'glm-4.6',          provider: 'zhipu', display: 'GLM-4.6',          tokenizer: 'heuristic', contextWindow: 202752,  maxOutput: 16384, reasoning: true },
  { id: 'glm-5',            provider: 'zhipu', display: 'GLM-5',            tokenizer: 'heuristic', contextWindow: 128000,  maxOutput: 16384, reasoning: true },

  // ─── Moonshot Kimi ────────────────────────────────────────────────────────
  { id: 'moonshot-v1-8k',   provider: 'moonshot', display: 'Moonshot V1 8K',  tokenizer: 'heuristic', contextWindow: 8192,   maxOutput: 8192,  reasoning: false },
  { id: 'moonshot-v1-32k',  provider: 'moonshot', display: 'Moonshot V1 32K', tokenizer: 'heuristic', contextWindow: 32768,  maxOutput: 8192,  reasoning: false },
  { id: 'moonshot-v1-128k', provider: 'moonshot', display: 'Moonshot V1 128K',tokenizer: 'heuristic', contextWindow: 131072, maxOutput: 8192,  reasoning: false },
  { id: 'kimi-k2',          provider: 'moonshot', display: 'Kimi K2',         tokenizer: 'heuristic', contextWindow: 131072, maxOutput: 8192,  reasoning: true },

  // ─── Doubao (ByteDance) ───────────────────────────────────────────────────
  { id: 'doubao-pro-32k',   provider: 'doubao', display: 'Doubao Pro 32K',   tokenizer: 'heuristic', contextWindow: 32768,   maxOutput: 8192,  reasoning: false, aliases: ['doubao-1.5-pro-32k'] },
  { id: 'doubao-pro-128k',  provider: 'doubao', display: 'Doubao Pro 128K',  tokenizer: 'heuristic', contextWindow: 131072, maxOutput: 8192,  reasoning: false, aliases: ['doubao-1.5-pro-128k'] },
  { id: 'doubao-flash',     provider: 'doubao', display: 'Doubao Flash',     tokenizer: 'heuristic', contextWindow: 32768,   maxOutput: 8192,  reasoning: false },

  // ─── MiniMax ──────────────────────────────────────────────────────────────
  { id: 'minimax-abab6.5',  provider: 'minimax', display: 'MiniMax abab6.5',  tokenizer: 'heuristic', contextWindow: 245760, maxOutput: 8192,  reasoning: false },
  { id: 'minimax-abab7',    provider: 'minimax', display: 'MiniMax abab7',    tokenizer: 'heuristic', contextWindow: 245760, maxOutput: 8192,  reasoning: false },

  // ─── Baidu ERNIE ──────────────────────────────────────────────────────────
  { id: 'ernie-4.0-turbo',  provider: 'baidu', display: 'ERNIE 4.0 Turbo',   tokenizer: 'heuristic', contextWindow: 8192,    maxOutput: 4096,  reasoning: false },
  { id: 'ernie-speed',      provider: 'baidu', display: 'ERNIE Speed',      tokenizer: 'heuristic', contextWindow: 128000,  maxOutput: 8192,  reasoning: false },
  { id: 'ernie-lite',       provider: 'baidu', display: 'ERNIE Lite',       tokenizer: 'heuristic', contextWindow: 128000,  maxOutput: 8192,  reasoning: false },

  // ─── xAI Grok ──────────────────────────────────────────────────────────────
  { id: 'grok-3',           provider: 'xai', display: 'Grok 3',             tokenizer: 'o200k_base', contextWindow: 131072, maxOutput: 8192,  reasoning: false },
  { id: 'grok-4',           provider: 'xai', display: 'Grok 4',             tokenizer: 'o200k_base', contextWindow: 256000, maxOutput: 8192,  reasoning: true },
  { id: 'grok-4.1',         provider: 'xai', display: 'Grok 4.1',           tokenizer: 'o200k_base', contextWindow: 256000, maxOutput: 8192,  reasoning: false },

  // ─── Mistral ──────────────────────────────────────────────────────────────
  { id: 'mistral-large',    provider: 'mistral', display: 'Mistral Large',   tokenizer: 'heuristic', contextWindow: 128000, maxOutput: 8192,  reasoning: false },
  { id: 'mistral-medium',   provider: 'mistral', display: 'Mistral Medium',  tokenizer: 'heuristic', contextWindow: 32000,  maxOutput: 8192,  reasoning: false },
  { id: 'mistral-small',    provider: 'mistral', display: 'Mistral Small',   tokenizer: 'heuristic', contextWindow: 32000,  maxOutput: 8192,  reasoning: false },

  // ─── Together AI / Groq / Cohere ──────────────────────────────────────────
  { id: 'llama-3.3-70b',    provider: 'together', display: 'Llama 3.3 70B (Together)', tokenizer: 'cl100k_base', contextWindow: 128000, maxOutput: 8192, reasoning: false },
  { id: 'llama-3.1-405b',   provider: 'together', display: 'Llama 3.1 405B (Together)', tokenizer: 'cl100k_base', contextWindow: 128000, maxOutput: 8192, reasoning: false },
  { id: 'llama-3.1-70b-groq', provider: 'groq', display: 'Llama 3.1 70B (Groq)', tokenizer: 'cl100k_base', contextWindow: 128000, maxOutput: 8192, reasoning: false },
  { id: 'command-r-plus',  provider: 'cohere', display: 'Cohere Command R+',  tokenizer: 'heuristic', contextWindow: 128000, maxOutput: 8192,  reasoning: false },
]

/** 索引：alias/alias-lower -> 规范 id */
const _aliasIndex = new Map()
for (const m of MODELS) {
  _aliasIndex.set(m.id.toLowerCase(), m.id)
  for (const a of m.aliases || []) _aliasIndex.set(a.toLowerCase(), m.id)
}

/**
 * 规范化任意输入的模型名到主键 id
 * @param {string} name
 * @returns {string|null}
 */
export function normalizeModelName(name) {
  if (!name) return null
  const k = String(name).trim().toLowerCase()
  if (_aliasIndex.has(k)) return _aliasIndex.get(k)
  // 模糊匹配：去掉 -latest / -YYYY-MM-DD 后缀
  const stripped = k.replace(/-(latest|\d{4}-\d{2}-\d{2})$/, '')
  if (_aliasIndex.has(stripped)) return _aliasIndex.get(stripped)
  // 去掉版本号
  const core = k.replace(/-v?\d+(\.\d+)*$/, '')
  if (_aliasIndex.has(core)) return _aliasIndex.get(core)
  return null
}

/**
 * 取模型元数据
 * @param {string} name
 * @returns {ModelMeta|null}
 */
export function getModel(name) {
  const id = normalizeModelName(name)
  if (!id) return null
  return MODELS.find(m => m.id === id) || null
}

/**
 * 列出所有模型，可按 provider 过滤
 */
export function listModels(provider) {
  if (!provider) return MODELS.slice()
  return MODELS.filter(m => m.provider === provider)
}

/**
 * 列出所有厂商
 */
export function listProviders() {
  return Object.entries(PROVIDERS).map(([key, v]) => ({ key, ...v }))
}
