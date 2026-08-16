// pricing-tasks.js — 让 AI 自己搜价格的桥接模块
//
// 工作机制（MCP/Agent 标准模式）:
//   1. AI 工具调用 refresh-pricing → 拿到一份「搜索任务清单」（每家厂商一份）
//   2. AI 自己用它的 WebSearch/WebFetch 能力去访问官方定价页
//   3. AI 把搜到的价格按 schema 整理成 JSON 数组
//   4. AI 调用 apply-pricing-update 把 JSON 回传 → 本模块校验 + 合并到 setPricingOverrides
//   5. 后续 estimate-cost / plan-project-budget 自动用新价
//
// 设计动机: 插件本身保持无网络依赖（可在任何环境运行），
//          但凡是有联网能力的 AI 宿主（Claude Desktop / Cursor / Trae / DSH）
//          都能"自给自足"刷新价格，避免内置表过期。

import { normalizeModelName } from './models.js'
import { getPricing, setPricingOverrides } from './pricing.js'
import { listAvailableModels } from './calculator.js'

/**
 * 构建一份"让 AI 去搜价"的任务清单
 *
 * @param {{providers?: string[]}} opts - 可选指定厂商，默认全量
 * @returns {Array<{
 *   provider: string,
 *   providerName: string,
 *   currency: 'USD' | 'CNY',
 *   sourceUrl: string,
 *   hint: string,
 *   schema: object,
 *   models: Array<{modelId, display, knownInput, knownOutput, knownCacheHit, knownDate}>
 * }>}
 */
export function buildPricingRefreshTasks(opts = {}) {
  const models = listAvailableModels()
  const byProvider = new Map()
  for (const m of models) {
    if (opts.providers && !opts.providers.includes(m.provider)) continue
    if (!byProvider.has(m.provider)) byProvider.set(m.provider, [])
    byProvider.get(m.provider).push(m)
  }

  const tasks = []
  for (const [provider, modelList] of byProvider) {
    const firstPrice = getPricing(modelList[0]?.id)
    const currency = firstPrice?.currency || 'USD'
    const sourceUrl = firstPrice?.sourceUrl || '(未知，请先用 WebSearch 搜 "provider API pricing")'

    const knownPrices = modelList
      .map(m => {
        const p = getPricing(m.id)
        if (!p) return null
        return {
          modelId: m.id,
          display: m.display,
          knownInput: p.input,
          knownOutput: p.output,
          knownCacheHit: p.cacheHit,
          knownCacheWrite: p.cacheWrite ?? 0,
          knownDate: p.effectiveDate || '(未知)',
        }
      })
      .filter(Boolean)

    tasks.push({
      provider,
      providerName: modelList[0]?.providerName || provider,
      currency,
      sourceUrl,
      hint: [
        `请用 WebFetch 抓取 ${sourceUrl}`,
        `（若该页是 JS 渲染或被反爬，则改用 WebSearch 搜 "${provider} API pricing ${new Date().getFullYear()}" 取最新数据）`,
        `提取下列 ${knownPrices.length} 个模型的"每百万 tokens"官方价（货币：${currency}）。`,
        `按 schema 组装 JSON 数组，再调用 apply-pricing-update 工具回传。`,
      ].join(' '),
      schema: {
        type: 'array',
        description: '搜索结果数组，每个元素对应一个模型',
        items: {
          modelId: 'string (必填，与 knownPrices 中的 modelId 严格对齐)',
          input: 'number (每百万 tokens 标准输入价, 单位与本厂商 currency 一致)',
          output: 'number (每百万 tokens 标准输出价)',
          cacheHit: 'number (可选; 缓存命中价; 若厂商无此概念则填 input*0.5)',
          cacheWrite: 'number (可选; 缓存写入价; 默认 0)',
          effectiveDate: 'string YYYY-MMDD (必填, 取价日期)',
          sourceUrl: 'string (可选, 若与官方不同则填实际抓取的 URL)',
          notes: 'string (可选, 如分段定价说明)',
        },
      },
      models: knownPrices,
    })
  }
  return tasks
}

/**
 * 把 AI 搜回来的价格合并进 override 表
 *
 * @param {Array|Object} searchResults
 *   - 数组形式: [{ modelId, input, output, ... }]
 *   - 对象形式: { "gpt-4o": { input, output, ... } }
 * @returns {{appliedCount:number, skipped:Array, modelIds:string[]}}
 */
export function applySearchedPricing(searchResults) {
  if (!searchResults || typeof searchResults !== 'object') {
    return { appliedCount: 0, skipped: [], modelIds: [] }
  }

  const arr = Array.isArray(searchResults)
    ? searchResults
    : Object.entries(searchResults).map(([k, v]) => ({ modelId: k, ...v }))

  const overrides = {}
  const skipped = []
  for (const entry of arr) {
    if (!entry || !entry.modelId) {
      skipped.push({ reason: 'missing modelId', entry })
      continue
    }
    const id = normalizeModelName(entry.modelId) || entry.modelId
    if (!getPricing(id)) {
      skipped.push({ reason: `unknown model: ${entry.modelId}`, entry })
      continue
    }
    // 基础校验：input/output 必须是正数
    const inputNum = Number(entry.input)
    const outputNum = Number(entry.output)
    if (!Number.isFinite(inputNum) || inputNum < 0 || !Number.isFinite(outputNum) || outputNum < 0) {
      skipped.push({ reason: `invalid input/output for ${id}`, entry })
      continue
    }
    overrides[id] = {
      input: inputNum,
      output: outputNum,
      cacheHit: Number.isFinite(Number(entry.cacheHit)) ? Number(entry.cacheHit) : inputNum * 0.5,
      cacheWrite: Number.isFinite(Number(entry.cacheWrite)) ? Number(entry.cacheWrite) : 0,
      currency: entry.currency || getPricing(id).currency,
      effectiveDate: entry.effectiveDate || new Date().toISOString().slice(0, 10),
      sourceUrl: entry.sourceUrl || getPricing(id).sourceUrl,
      notes: entry.notes,
    }
  }

  setPricingOverrides(overrides)
  return {
    appliedCount: Object.keys(overrides).length,
    skipped,
    modelIds: Object.keys(overrides),
  }
}

/**
 * 把搜索任务清单渲染成给 AI 看的 markdown（用于 DSH/MCP 工具的 markdown 输出）
 */
export function renderPricingTasksMarkdown(tasks) {
  const L = []
  L.push('# 🔍 价格刷新任务清单')
  L.push('')
  L.push(`> 共 ${tasks.length} 家厂商需要刷新。请按下列步骤执行：`)
  L.push('>')
  L.push('> 1. 对每家厂商：调用你的 **WebFetch / WebSearch** 工具去抓 `sourceUrl`')
  L.push('> 2. 按 schema 提取每个模型的当前官方价')
  L.push('> 3. 收集完所有厂商后，把所有模型放进**一个 JSON 数组**')
  L.push('> 4. 调用 **apply-pricing-update** 工具回传，自动合并')
  L.push('> 5. 后续 estimate-cost / plan-project-budget 会用新价计算')
  L.push('')

  for (const t of tasks) {
    L.push(`## 🏢 ${t.providerName} (\`${t.provider}\`)`)
    L.push('')
    L.push(`- **货币**: ${t.currency}`)
    L.push(`- **官方定价页**: ${t.sourceUrl}`)
    L.push(`- **提示**: ${t.hint}`)
    L.push('')
    L.push('### 当前已知价格（请核对差异，若一致则不必回传该模型）')
    L.push('')
    L.push('| modelId | display | input/M | output/M | cacheHit/M | 数据日期 |')
    L.push('|---------|---------|--------|-----------|------------|----------|')
    for (const m of t.models) {
      L.push(`| \`${m.modelId}\` | ${m.display} | ${m.knownInput} | ${m.knownOutput} | ${m.knownCacheHit} | ${m.knownDate} |`)
    }
    L.push('')
  }

  L.push('## 📋 回传 schema（apply-pricing-update 的 prices 参数）')
  L.push('')
  L.push('```json')
  L.push(JSON.stringify([
    {
      modelId: 'gpt-4o',
      input: 2.5,
      output: 10.0,
      cacheHit: 1.25,
      cacheWrite: 0,
      effectiveDate: '2026-08-16',
      sourceUrl: 'https://openai.com/api/pricing',
      notes: '可选',
    }
  ], null, 2))
  L.push('```')
  return L.join('\n')
}
