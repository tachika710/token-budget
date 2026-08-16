// 定价表 — 单位：每百万 tokens 价格
// 数据更新日期: 2026-08-16
// 厂商官方为准：openai.com/api/pricing · platform.claude.com/docs/en/about-claude/pricing
//   ai.google.dev/pricing · api-docs.deepseek.com · help.aliyun.com/zh/model-studio
//   bigmodel.cn · platform.moonshot.cn · volcengine.com · x.ai · mistral.ai
//
// 货币: 每个厂商的"标准货币"。计算时统一折算到目标货币（USD/CNY）。
// USD->CNY 默认按 7.20 换算（2026-08 银行中间价附近，可在配置里覆盖）。

export const DEFAULT_FX = { USD_TO_CNY: 7.20, CNY_TO_USD: 1 / 7.20 }

/**
 * @typedef {Object} PriceEntry
 * @property {string}  modelId              - 与 models.js 中的 id 对齐
 * @property {number}  input                - 标准输入 /1M tokens（本币）
 * @property {number}  output              - 标准输出 /1M tokens（本币）
 * @property {number}  cacheHit            - 缓存命中输入 /1M（本币，无则等于 input）
 * @property {number}  cacheWrite          - 5min 缓存写入 /1M（无则 0，OpenAI 自动缓存=0）
 * @property {string}  currency            - 'USD' | 'CNY'
 * @property {string}  effectiveDate        - 数据生效日期 YYYY-MM-DD
 * @property {string}  sourceUrl            - 厂商官方定价页
 * @property {TierPricing[]|null} tiers    - 分段定价（按上下文长度等）；命中则覆盖上面的统一价
 */

/**
 * @typedef {Object} TierPricing
 * @property {number} minTokens   - 该档下限（含）
 * @property {number} maxTokens   - 上限（不含），Infinity 表示无上限
 * @property {{input:number, output:number, cacheHit?:number}} price
 */

export const PRICING = [
  // ─── OpenAI (USD) ───────────────────────────────────────────────────────
  { modelId: 'gpt-4.1',       input: 2.00,  output: 8.00,  cacheHit: 0.50,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-4.1-mini',  input: 0.40,  output: 1.60,  cacheHit: 0.10,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-4.1-nano',  input: 0.10,  output: 0.40,  cacheHit: 0.025, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-4o',        input: 2.50,  output: 10.00, cacheHit: 1.25,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-4o-mini',   input: 0.15,  output: 0.60,  cacheHit: 0.075, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5',         input: 1.25,  output: 10.00, cacheHit: 0.125, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5-mini',    input: 0.25,  output: 2.00,  cacheHit: 0.025, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5-nano',    input: 0.05,  output: 0.40,  cacheHit: 0.005, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.1',       input: 1.25,  output: 10.00, cacheHit: 0.125, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.2',       input: 1.75,  output: 14.00, cacheHit: 0.175, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.3',       input: 1.75,  output: 14.00, cacheHit: 0.175, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.4',       input: 2.50,  output: 15.00, cacheHit: 0.250, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.4-mini',  input: 0.75,  output: 4.50,  cacheHit: 0.075, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.4-nano',  input: 0.20,  output: 1.25,  cacheHit: 0.020, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.4-pro',   input: 30.00, output: 180.00, cacheHit: 3.00,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.5',       input: 5.00,  output: 30.00, cacheHit: 0.50,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.5-pro',   input: 30.00, output: 180.00, cacheHit: 3.00,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.6-sol',   input: 5.00,  output: 30.00, cacheHit: 0.50,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.6-terra',  input: 2.00,  output: 12.00, cacheHit: 0.20,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'gpt-5.6-luna',  input: 0.20,  output: 1.20,  cacheHit: 0.020, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  // o 系列推理模型
  { modelId: 'o1',            input: 15.00, output: 60.00, cacheHit: 7.50,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'o1-mini',       input: 1.10,  output: 4.40,  cacheHit: 0.55,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'o3',            input: 2.00,  output: 8.00,  cacheHit: 1.00,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'o3-mini',       input: 1.10,  output: 4.40,  cacheHit: 0.55,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'o3-pro',        input: 20.00, output: 80.00, cacheHit: 10.00, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },
  { modelId: 'o4-mini',       input: 1.10,  output: 4.40,  cacheHit: 0.55,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://openai.com/api/pricing' },

  // ─── Anthropic (USD) ────────────────────────────────────────────────────
  // 5min cache write = 1.25x input · 1h cache write = 2x input · cache read = 0.1x input
  { modelId: 'claude-haiku-4.5',  input: 1.00,  output: 5.00,   cacheHit: 0.10,  cacheWrite: 1.25, currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-sonnet-4.5', input: 3.00,  output: 15.00,  cacheHit: 0.30,  cacheWrite: 3.75, currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-sonnet-4.6', input: 3.00,  output: 15.00,  cacheHit: 0.30,  cacheWrite: 3.75, currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-sonnet-5',   input: 3.00,  output: 15.00,  cacheHit: 0.30,  cacheWrite: 3.75, currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-opus-4',     input: 15.00, output: 75.00,  cacheHit: 1.50,  cacheWrite: 18.75, currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-opus-4.1',   input: 15.00, output: 75.00,  cacheHit: 1.50,  cacheWrite: 18.75, currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-opus-4.5',   input: 5.00,  output: 25.00,  cacheHit: 0.50,  cacheWrite: 6.25,  currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-opus-4.6',   input: 5.00,  output: 25.00,  cacheHit: 0.50,  cacheWrite: 6.25,  currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-opus-4.7',   input: 5.00,  output: 25.00,  cacheHit: 0.50,  cacheWrite: 6.25,  currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-opus-4.8',   input: 5.00,  output: 25.00,  cacheHit: 0.50,  cacheWrite: 6.25,  currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-opus-5',     input: 5.00,  output: 25.00,  cacheHit: 0.50,  cacheWrite: 6.25,  currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },
  { modelId: 'claude-fable-5',    input: 10.00, output: 50.00,  cacheHit: 1.00,  cacheWrite: 12.50, currency: 'USD', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing' },

  // ─── Google Gemini (USD) ───────────────────────────────────────────────
  // Gemini 2.5 Pro 按上下文分段: ≤200K / >200K
  { modelId: 'gemini-1.5-pro',      input: 1.25,  output: 5.00,   cacheHit: 0.3125, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://ai.google.dev/pricing' },
  { modelId: 'gemini-1.5-flash',    input: 0.0375, output: 0.15,   cacheHit: 0.01,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://ai.google.dev/pricing' },
  { modelId: 'gemini-2.0-flash',    input: 0.10,  output: 0.40,   cacheHit: 0.025, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://ai.google.dev/pricing' },
  { modelId: 'gemini-2.5-pro',     input: 1.25,  output: 10.00,  cacheHit: 0.3125, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://ai.google.dev/pricing',
    tiers: [
      { minTokens: 0,       maxTokens: 200001,  price: { input: 1.25,  output: 10.00, cacheHit: 0.3125 } },
      { minTokens: 200001,  maxTokens: Infinity, price: { input: 2.50,  output: 15.00, cacheHit: 0.625 } },
    ] },
  { modelId: 'gemini-2.5-flash',    input: 0.30,  output: 2.50,   cacheHit: 0.075, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://ai.google.dev/pricing' },
  { modelId: 'gemini-3-pro',        input: 2.00,  output: 12.00,  cacheHit: 0.50,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://ai.google.dev/pricing' },
  { modelId: 'gemini-3-flash',     input: 0.50,  output: 3.00,   cacheHit: 0.125, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://ai.google.dev/pricing' },
  { modelId: 'gemini-3.1-pro',      input: 2.00,  output: 12.00,  cacheHit: 0.50,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://ai.google.dev/pricing' },

  // ─── DeepSeek (USD) ─────────────────────────────────────────────────────
  // V3.2 缓存命中 0.07 USD/M；V4 Flash 缓存命中 0.0028 USD/M（约 1/50 标准）
  { modelId: 'deepseek-chat',       input: 0.27, output: 1.10, cacheHit: 0.07,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing' },
  { modelId: 'deepseek-reasoner',   input: 0.55, output: 2.19, cacheHit: 0.14,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing' },
  { modelId: 'deepseek-v4-flash',   input: 0.14, output: 0.28, cacheHit: 0.0028, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing' },
  { modelId: 'deepseek-v4-pro',     input: 1.74, output: 3.48, cacheHit: 0.0145, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    notes: '当前促销价 $0.435/$0.87，启用 usePromoPricing 取促销价' },

  // ─── Qwen (CNY) ──────────────────────────────────────────────────────────
  // 数据源: help.aliyun.com/zh/model-studio · 限时折扣另注
  { modelId: 'qwen-turbo',         input: 0.30,  output: 0.60, cacheHit: 0.15,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing' },
  { modelId: 'qwen-plus',          input: 2.00,  output: 8.00, cacheHit: 0.60,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
    notes: '主 ID qwen3.7-plus 限时 8 折 ¥1.6/¥6.4' },
  { modelId: 'qwen-max',           input: 20.00, output: 60.00, cacheHit: 6.00,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing',
    notes: '现 qwen3.7-max 限时 5 折 ¥6/¥18' },
  { modelId: 'qwen-long',          input: 0.50,  output: 0.50, cacheHit: 0.25,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing' },
  { modelId: 'qwen-coder-plus',    input: 2.00,  output: 8.00, cacheHit: 0.60,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://help.aliyun.com/zh/model-studio/model-pricing' },

  // ─── Zhipu GLM (CNY) ─────────────────────────────────────────────────────
  // GLM-4.5: ¥0.5/M in, ¥0.8/M out（仅官方 bigmodel.cn）
  // GLM-4.6: ≤32K ¥3/¥14；32K-200K ¥4/¥16
  { modelId: 'glm-4.5',           input: 0.50,  output: 0.80, cacheHit: 0.10,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://www.bigmodel.cn/pricing' },
  { modelId: 'glm-4.6',           input: 3.00,  output: 14.00, cacheHit: 0.60,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://help.aliyun.com/zh/model-studio/glm-4-6',
    tiers: [
      { minTokens: 0,      maxTokens: 32769,    price: { input: 3.00, output: 14.00, cacheHit: 0.60 } },
      { minTokens: 32769,  maxTokens: Infinity, price: { input: 4.00, output: 16.00, cacheHit: 0.80 } },
    ] },
  { modelId: 'glm-5',             input: 4.00,  output: 18.00, cacheHit: 0.80,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://www.bigmodel.cn/pricing' },

  // ─── Moonshot Kimi (CNY) ────────────────────────────────────────────────
  { modelId: 'moonshot-v1-8k',   input: 12.00, output: 12.00, cacheHit: 6.00,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://platform.moonshot.cn/pricing' },
  { modelId: 'moonshot-v1-32k',  input: 24.00, output: 24.00, cacheHit: 12.00, cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://platform.moonshot.cn/pricing' },
  { modelId: 'moonshot-v1-128k', input: 60.00, output: 60.00, cacheHit: 30.00, cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://platform.moonshot.cn/pricing' },
  { modelId: 'kimi-k2',          input: 4.00,  output: 16.00, cacheHit: 1.00,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://platform.moonshot.cn/pricing' },

  // ─── Doubao (CNY) ────────────────────────────────────────────────────────
  { modelId: 'doubao-pro-32k',   input: 0.80,  output: 2.00,  cacheHit: 0.20,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://www.volcengine.com/product/doubao' },
  { modelId: 'doubao-pro-128k',  input: 5.00,  output: 9.00,  cacheHit: 1.25,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://www.volcengine.com/product/doubao' },
  { modelId: 'doubao-flash',     input: 0.20,  output: 0.50,  cacheHit: 0.05,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://www.volcengine.com/product/doubao' },

  // ─── MiniMax (CNY) ────────────────────────────────────────────────────────
  { modelId: 'minimax-abab6.5',  input: 30.00, output: 30.00, cacheHit: 15.00, cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://www.minimaxi.com/platform' },
  { modelId: 'minimax-abab7',    input: 10.00, output: 10.00, cacheHit: 5.00,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://www.minimaxi.com/platform' },

  // ─── Baidu ERNIE (CNY) ────────────────────────────────────────────────────
  { modelId: 'ernie-4.0-turbo',   input: 120.00, output: 120.00, cacheHit: 30.00, cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://cloud.baidu.com/product/wenxinworkshop' },
  { modelId: 'ernie-speed',      input: 4.00,  output: 8.00,  cacheHit: 1.00,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://cloud.baidu.com/product/wenxinworkshop' },
  { modelId: 'ernie-lite',       input: 0.00,  output: 0.00,  cacheHit: 0.00,  cacheWrite: 0, currency: 'CNY', sourceUrl: 'https://cloud.baidu.com/product/wenxinworkshop', notes: '已免费' },

  // ─── xAI Grok (USD) ────────────────────────────────────────────────────────
  { modelId: 'grok-3',           input: 3.00,  output: 15.00, cacheHit: 0.75,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://docs.x.ai/docs/models' },
  { modelId: 'grok-4',           input: 5.00,  output: 15.00, cacheHit: 1.25,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://docs.x.ai/docs/models' },
  { modelId: 'grok-4.1',         input: 0.20,  output: 0.50,  cacheHit: 0.05,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://docs.x.ai/docs/models' },

  // ─── Mistral (USD) ────────────────────────────────────────────────────────
  { modelId: 'mistral-large',    input: 2.00,  output: 6.00,  cacheHit: 0.50,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://mistral.ai/products/la-plateforme#pricing' },
  { modelId: 'mistral-medium',   input: 0.40,  output: 0.80,  cacheHit: 0.10,  cacheWrite: 0, currency: 'USD', sourceUrl: 'https://mistral.ai/products/la-plateforme#pricing' },
  { modelId: 'mistral-small',    input: 0.06,  output: 0.12,  cacheHit: 0.015, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://mistral.ai/products/la-plateforme#pricing' },

  // ─── Together / Groq / Cohere (USD) ───────────────────────────────────────
  { modelId: 'llama-3.3-70b',       input: 0.88, output: 0.88,  cacheHit: 0.22, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://www.together.ai/pricing' },
  { modelId: 'llama-3.1-405b',      input: 5.00, output: 5.00,  cacheHit: 1.25, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://www.together.ai/pricing' },
  { modelId: 'llama-3.1-70b-groq',  input: 0.59, output: 0.79,  cacheHit: 0.05, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://groq.com/pricing' },
  { modelId: 'command-r-plus',      input: 2.50, output: 10.00, cacheHit: 0.625, cacheWrite: 0, currency: 'USD', sourceUrl: 'https://cohere.com/pricing' },
].map(p => ({ ...p, effectiveDate: '2026-08-16' }))

/** 用户自定义定价覆盖层（运行时注入） */
let _overrides = {}

/**
 * 注入用户自定义定价（合并到主表之上）
 * @param {Record<string, Partial<PriceEntry>>} overrides - key 为 modelId
 */
export function setPricingOverrides(overrides) {
  _overrides = { ...overrides }
}

/** 索引: modelId -> PriceEntry（合并 override 后） */
const _index = new Map()
for (const p of PRICING) {
  _index.set(p.modelId, p)
}

/**
 * 取某模型的定价条目（含 override 合并）
 * @param {string} modelId   - 已规范化的 id（来自 models.normalizeModelName）
 * @returns {PriceEntry|null}
 */
export function getPricing(modelId) {
  if (!modelId) return null
  const base = _index.get(modelId)
  if (!base) return null
  const ov = _overrides[modelId]
  return ov ? { ...base, ...ov } : base
}

/**
 * 列出所有定价条目
 */
export function listPricing() {
  return PRICING.map(p => ({ ...p, ...(_overrides[p.modelId] || {}) }))
}

/**
 * 当输入长度落在分段定价区间时返回对应价格
 * @param {PriceEntry} entry
 * @param {number} inputTokens
 * @returns {{input:number, output:number, cacheHit:number}}
 */
export function resolveTier(entry, inputTokens = 0) {
  if (!entry?.tiers?.length) {
    return {
      input: entry.input,
      output: entry.output,
      cacheHit: entry.cacheHit ?? entry.input,
    }
  }
  for (const t of entry.tiers) {
    if (inputTokens >= t.minTokens && inputTokens < t.maxTokens) {
      return { input: t.price.input, output: t.price.output, cacheHit: t.price.cacheHit ?? t.price.input }
    }
  }
  // 兜底：取最后一档
  const last = entry.tiers[entry.tiers.length - 1]
  return { input: last.price.input, output: last.price.output, cacheHit: last.price.cacheHit ?? last.price.input }
}

/**
 * 把本币价格换算到目标货币
 * @param {number} amount
 * @param {'USD'|'CNY'} fromCurrency
 * @param {'USD'|'CNY'} toCurrency
 * @param {{USD_TO_CNY?:number}} fx
 */
export function convertCurrency(amount, fromCurrency, toCurrency, fx = DEFAULT_FX) {
  if (fromCurrency === toCurrency) return amount
  if (fromCurrency === 'USD' && toCurrency === 'CNY') return amount * (fx.USD_TO_CNY ?? DEFAULT_FX.USD_TO_CNY)
  if (fromCurrency === 'CNY' && toCurrency === 'USD') return amount * (fx.CNY_TO_USD ?? DEFAULT_FX.CNY_TO_USD)
  return amount
}
