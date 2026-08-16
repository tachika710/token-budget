// 成本计算器 — 把 token 数 + 模型定价 → 美元/人民币成本
// 同时支持单模型明细 + 多模型对比 + Markdown 报告

import { MODELS, PROVIDERS, normalizeModelName, getModel, REASONING_OUTPUT_MULTIPLIER } from './models.js'
import { getPricing, resolveTier, convertCurrency, DEFAULT_FX, listPricing } from './pricing.js'

/** @typedef {'USD'|'CNY'} Currency */

/**
 * @typedef {Object} CostBreakdown
 * @property {string}  modelId
 * @property {string}  display
 * @property {string}  provider
 * @property {number}  inputTokens
 * @property {number}  outputTokens
 * @property {number}  cacheHitTokens
 * @property {number}  cacheWriteTokens
 * @property {number}  calls
 * @property {{input:number, output:number, cacheHit:number, cacheWrite:number, total:number}}   costPerCall   - 本币
 * @property {{input:number, output:number, cacheHit:number, cacheWrite:number, total:number}}   costTotal      - 本币 × calls
 * @property {Currency} currency      - 厂商本币
 * @property {Currency} displayCurrency
 * @property {{total:number}} costDisplay   - 折算到目标货币
 */

/**
 * @typedef {Object} EstimateInput
 * @property {number} inputTokens         - 输入 token 数
 * @property {number} [outputTokens]      - 输出 token 数；推理模型未传时按 input*ratio 估
 * @property {number} [cacheHitTokens]    - 缓存命中输入 tokens（默认 0）
 * @property {number} [cacheWriteTokens]  - 缓存写入 tokens（默认 0）
 * @property {number} [calls]             - 调用次数（默认 1）
 * @property {number} [cacheHitRatio]     - 缓存命中比例（0~1），优先于 cacheHitTokens
 */

/**
 * 计算单模型成本
 * @param {string} modelName
 * @param {EstimateInput} input
 * @param {{displayCurrency?: Currency, fx?: typeof DEFAULT_FX}} [opts]
 * @returns {CostBreakdown|null}
 */
export function estimateCost(modelName, input, opts = {}) {
  const id = normalizeModelName(modelName)
  if (!id) return null
  const meta = getModel(id)
  if (!meta) return null
  const price = getPricing(id)
  if (!price) return null

  const displayCurrency = opts.displayCurrency || 'USD'
  const fx = opts.fx || DEFAULT_FX

  const calls = Math.max(1, Math.floor(input.calls ?? 1))
  const inputTokens = Math.max(0, Math.floor(input.inputTokens ?? 0))

  // 输出 tokens：未传时按推理特性估算
  let outputTokens = Math.max(0, Math.floor(input.outputTokens ?? 0))
  if (!outputTokens) {
    // 默认按输入的 30% 估输出（普通对话场景）
    let ratio = 0.3
    if (meta.reasoning) {
      // 推理模型思维链放大
      const mult = isHeavyReasoner(id) ? REASONING_OUTPUT_MULTIPLIER.high : REASONING_OUTPUT_MULTIPLIER.default
      ratio = 0.3 * mult / (mult > 4 ? mult / 4 : 1) // 简化: heavy 思维链 ~ 输入 * 1.2
      // 直观规则: heavy 推理模型 output ≈ input * 0.3 * 1.2 = input * 0.36（再乘思维链外显 ~高）
      // 实际采用更直接的方式:
      ratio = isHeavyReasoner(id) ? 0.6 : 0.4 // 思维链输出膨胀
    }
    outputTokens = Math.floor(inputTokens * ratio)
  }

  // 缓存命中
  let cacheHitTokens = input.cacheHitTokens ?? 0
  if (input.cacheHitRatio != null) {
    cacheHitTokens = Math.floor(inputTokens * Math.min(1, Math.max(0, input.cacheHitRatio)))
  }
  cacheHitTokens = Math.min(cacheHitTokens, inputTokens)
  const nonCacheInputTokens = Math.max(0, inputTokens - cacheHitTokens)
  const cacheWriteTokens = Math.max(0, Math.floor(input.cacheWriteTokens ?? 0))

  const tier = resolveTier(price, inputTokens)

  // 单次调用成本（本币）
  const costPerCall = {
    input:      nonCacheInputTokens / 1_000_000 * tier.input,
    output:     outputTokens        / 1_000_000 * tier.output,
    cacheHit:   cacheHitTokens      / 1_000_000 * (tier.cacheHit ?? tier.input),
    cacheWrite: cacheWriteTokens    / 1_000_000 * (price.cacheWrite ?? 0),
  }
  costPerCall.total = costPerCall.input + costPerCall.output + costPerCall.cacheHit + costPerCall.cacheWrite

  const costTotal = {
    input:      costPerCall.input      * calls,
    output:     costPerCall.output     * calls,
    cacheHit:   costPerCall.cacheHit   * calls,
    cacheWrite: costPerCall.cacheWrite * calls,
  }
  costTotal.total = costPerCall.total * calls

  // 折算到目标货币
  const toDisplay = (amt) => convertCurrency(amt, price.currency, displayCurrency, fx)
  const costDisplay = {
    total: toDisplay(costTotal.total),
  }

  return {
    modelId: id,
    display: meta.display,
    provider: meta.provider,
    inputTokens,
    outputTokens,
    cacheHitTokens,
    cacheWriteTokens,
    calls,
    costPerCall,
    costTotal,
    currency: price.currency,
    displayCurrency,
    costDisplay,
  }
}

/** 重推理模型判定（用于思维链放大） */
function isHeavyReasoner(id) {
  return ['o1', 'o3-pro', 'o1-pro', 'claude-opus-4.1', 'claude-opus-4', 'deepseek-reasoner', 'gemini-2.5-pro', 'grok-4'].includes(id)
}

/** 智能格式化金额：大金额用 4 位小数，小金额用科学计数或更多位 */
function fmtMoney(n) {
  if (!Number.isFinite(n)) return '0'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 100) return n.toFixed(2)
  if (abs >= 1) return n.toFixed(4)
  if (abs >= 0.01) return n.toFixed(6)
  if (abs >= 0.0001) return n.toFixed(8)
  // 极小值用科学计数
  return n.toExponential(2)
}

/**
 * 多模型对比
 * @param {string[]} models
 * @param {EstimateInput} input
 * @param {{displayCurrency?: Currency, fx?: typeof DEFAULT_FX, sort?: 'asc'|'desc'}} [opts]
 */
export function compareCosts(models, input, opts = {}) {
  const sort = opts.sort || 'asc'
  const results = []
  for (const name of models) {
    const r = estimateCost(name, input, opts)
    if (r) results.push(r)
  }
  results.sort((a, b) => (sort === 'asc' ? a.costDisplay.total - b.costDisplay.total : b.costDisplay.total - a.costDisplay.total))
  return {
    cheapest: results[0] || null,
    mostExpensive: results[results.length - 1] || null,
    results,
    input,
    displayCurrency: opts.displayCurrency || 'USD',
  }
}

/**
 * 全模型默认对比（按 provider 分组）
 */
export function compareAllProviders(input, opts = {}) {
  const byProvider = {}
  for (const m of MODELS) {
    if (!byProvider[m.provider]) byProvider[m.provider] = []
    byProvider[m.provider].push(m.id)
  }
  const out = {}
  for (const [provider, ids] of Object.entries(byProvider)) {
    out[provider] = compareCosts(ids, input, opts)
  }
  return out
}

/**
 * 取所有厂商列表（给前端/工具用）
 */
export function listAvailableModels() {
  return MODELS.map(m => ({
    id: m.id,
    display: m.display,
    provider: m.provider,
    providerName: PROVIDERS[m.provider].name,
    currency: PROVIDERS[m.provider].currency,
    reasoning: m.reasoning,
    contextWindow: m.contextWindow,
    maxOutput: m.maxOutput,
    tokenizer: m.tokenizer,
  }))
}

/**
 * 生成 Markdown 成本对比报告
 * @param {ReturnType<typeof compareCosts>} comparison
 */
export function formatMarkdownReport(comparison) {
  if (!comparison?.results?.length) return '_No models to compare._'
  const cur = comparison.displayCurrency
  const lines = []
  lines.push(`# Token 消耗 & 成本预估报告`)
  lines.push('')
  lines.push(`- **目标货币**: ${cur}`)
  lines.push(`- **输入 tokens**: ${comparison.input.inputTokens?.toLocaleString()}`)
  lines.push(`- **输出 tokens**: ${comparison.input.outputTokens ?? '(auto-estimated)'}`)
  lines.push(`- **缓存命中比例**: ${(comparison.input.cacheHitRatio ?? 0) * 100}%`)
  lines.push(`- **缓存写入 tokens**: ${comparison.input.cacheWriteTokens ?? 0}`)
  lines.push(`- **调用次数**: ${comparison.input.calls ?? 1}`)
  lines.push('')
  lines.push(`## 按总成本排序（${cur}）`)
  lines.push('')
  lines.push(`| # | 模型 | 厂商 | 单次成本 | 总成本 | 输入(本币) | 输出(本币) | 缓存(本币) |`)
  lines.push(`|---|------|------|---------|--------|-----------|-----------|-----------|`)
  comparison.results.forEach((r, i) => {
    const perCall = r.costDisplay.total / Math.max(1, r.calls)
    lines.push(`| ${i + 1} | ${r.display} | ${PROVIDERS[r.provider].name} | ${fmtMoney(perCall)} ${cur} | ${fmtMoney(r.costDisplay.total)} ${cur} | ${fmtMoney(r.costTotal.input)} ${r.currency} | ${fmtMoney(r.costTotal.output)} ${r.currency} | ${fmtMoney(r.costTotal.cacheHit + r.costTotal.cacheWrite)} ${r.currency} |`)
  })
  if (comparison.cheapest) {
    lines.push('')
    lines.push(`**最便宜**: ${comparison.cheapest.display} — ${fmtMoney(comparison.cheapest.costDisplay.total)} ${cur}`)
  }
  if (comparison.mostExpensive && comparison.cheapest && comparison.mostExpensive.modelId !== comparison.cheapest.modelId) {
    lines.push(`**最贵**: ${comparison.mostExpensive.display} — ${fmtMoney(comparison.mostExpensive.costDisplay.total)} ${cur}`)
    const ratio = comparison.mostExpensive.costDisplay.total / comparison.cheapest.costDisplay.total
    lines.push(`**价差倍数**: ${ratio.toFixed(1)}×`)
  }
  lines.push('')
  lines.push(`> 数据更新日期: 2026-08-16。定价以厂商官方为准。`)
  return lines.join('\n')
}

/**
 * 生成 JSON 报告（机器可读）
 */
export function formatJsonReport(comparison) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    pricingDataDate: '2026-08-16',
    input: comparison.input,
    displayCurrency: comparison.displayCurrency,
    cheapest: comparison.cheapest ? {
      modelId: comparison.cheapest.modelId,
      display: comparison.cheapest.display,
      total: comparison.cheapest.costDisplay.total,
    } : null,
    results: comparison.results.map(r => ({
      modelId: r.modelId,
      display: r.display,
      provider: r.provider,
      providerName: PROVIDERS[r.provider].name,
      currency: r.currency,
      tokens: {
        input: r.inputTokens,
        output: r.outputTokens,
        cacheHit: r.cacheHitTokens,
        cacheWrite: r.cacheWriteTokens,
        calls: r.calls,
      },
      costInNativeCurrency: r.costTotal,
      costInDisplayCurrency: { total: r.costDisplay.total },
    })),
  }, null, 2)
}
