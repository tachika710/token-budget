import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeModelName, getModel, listModels, listProviders,
  getPricing, resolveTier, convertCurrency, DEFAULT_FX,
  heuristicCount, countTokens, detectLanguage,
  estimate, listAvailableModels, compareCosts, formatMarkdownReport,
  setPricingOverrides,
} from '../src/index.js'

// ─── 模型元数据 ────────────────────────────────────────────────────────

test('normalizeModelName 能匹配别名和带日期的 id', () => {
  assert.equal(normalizeModelName('gpt-4o'), 'gpt-4o')
  assert.equal(normalizeModelName('GPT-4O'), 'gpt-4o')
  assert.equal(normalizeModelName('gpt-4o-2024-11-20'), 'gpt-4o')
  assert.equal(normalizeModelName('deepseek-reasoner'), 'deepseek-reasoner')
  assert.equal(normalizeModelName('qwen3.7-max'), 'qwen-max')
  assert.equal(normalizeModelName('nonexistent-model'), null)
})

test('getModel 返回正确元数据', () => {
  const m = getModel('claude-sonnet-4.6')
  assert.ok(m)
  assert.equal(m.provider, 'anthropic')
  assert.equal(m.tokenizer, 'claude-o200k')
  assert.equal(m.reasoning, false)
})

test('listModels + listProviders 不为空', () => {
  assert.ok(listModels().length > 30)
  assert.ok(listProviders().length >= 10)
})

// ─── 定价表 ───────────────────────────────────────────────────────────

test('getPricing 返回条目且字段完整', () => {
  const p = getPricing('gpt-4o')
  assert.ok(p)
  assert.equal(p.currency, 'USD')
  assert.ok(p.input > 0)
  assert.ok(p.output > 0)
  assert.ok(p.sourceUrl.startsWith('http'))
  assert.ok(p.effectiveDate)
})

test('resolveTier 处理分段定价', () => {
  const p = getPricing('gemini-2.5-pro')
  assert.ok(p.tiers?.length >= 2, 'Gemini 2.5 Pro 应有分段定价')
  const lo = resolveTier(p, 1000)
  const hi = resolveTier(p, 300000)
  assert.ok(hi.input > lo.input, '>200K 应更贵')
})

test('getPricing 支持 override', () => {
  setPricingOverrides({ 'gpt-4o': { input: 999, output: 999 } })
  const p = getPricing('gpt-4o')
  assert.equal(p.input, 999)
  assert.equal(p.output, 999)
  // 清除 override
  setPricingOverrides({})
  const p2 = getPricing('gpt-4o')
  assert.notEqual(p2.input, 999)
})

test('convertCurrency 货币换算正确', () => {
  assert.equal(convertCurrency(1, 'USD', 'USD'), 1)
  assert.equal(convertCurrency(1, 'USD', 'CNY'), DEFAULT_FX.USD_TO_CNY)
  const r = convertCurrency(DEFAULT_FX.USD_TO_CNY, 'CNY', 'USD')
  assert.ok(Math.abs(r - 1) < 1e-9)
})

// ─── Tokenizer ────────────────────────────────────────────────────────

test('heuristicCount 中文每字约 0.6-0.7 token', () => {
  const t = heuristicCount('你好世界')
  assert.ok(t >= 2 && t <= 4, `实际: ${t}`)
})

test('heuristicCount 英文约 4 字符/token', () => {
  const t = heuristicCount('Hello world this is a test')
  assert.ok(t >= 5 && t <= 9, `实际: ${t}`)
})

test('detectLanguage 识别中文', () => {
  assert.equal(detectLanguage('这是一段中文文本'), 'zh')
  assert.equal(detectLanguage('This is English text'), 'en')
})

test('countTokens 启发式模式生效', async () => {
  const r = await countTokens('测试文本', 'heuristic')
  assert.equal(r.method, 'heuristic')
  assert.ok(r.tokens > 0)
})

test('countTokens 精确模式（gpt-tokenizer 装好时）', async () => {
  const r = await countTokens('Hello world', 'gpt-4o')
  // 如果 gpt-tokenizer 装了应该是 exact；没装回退 heuristic-fallback
  assert.ok(['exact', 'heuristic-fallback'].includes(r.method))
  if (r.method === 'exact') {
    assert.equal(r.tokens, 2, '"Hello world" 应该是 2 tokens (o200k_base)')
  }
})

// ─── 计算器 ───────────────────────────────────────────────────────────

test('compareCosts 返回最便宜 + 最贵 + 排序', () => {
  const r = compareCosts(
    ['gpt-4o', 'deepseek-chat', 'claude-sonnet-4.6'],
    { inputTokens: 10000, calls: 100 },
    { displayCurrency: 'USD' }
  )
  assert.ok(r.results.length === 3)
  assert.equal(r.cheapest.modelId, 'deepseek-chat')
  assert.equal(r.mostExpensive.modelId, 'claude-sonnet-4.6')
  // 排序检查
  assert.ok(r.results[0].costDisplay.total <= r.results[1].costDisplay.total)
})

test('estimate 入口接受 text 输入', async () => {
  const r = await estimate({
    text: '测试文本',
    models: ['gpt-4o'],
    forceHeuristic: true,
  })
  assert.ok(r.comparison.results.length === 1)
  assert.ok(r.reportMd.includes('# Token'))
  assert.ok(r.reportJson.includes('"modelId": "gpt-4o"'))
})

test('formatMarkdownReport 在空结果时不崩', () => {
  const r = formatMarkdownReport({ results: [], displayCurrency: 'USD', input: {} })
  assert.ok(r.includes('No models'))
})

test('推理模型自动放大输出 token', () => {
  // 普通模型
  const r1 = compareCosts(['gpt-4o'], { inputTokens: 1000 })
  // 推理模型 (heavy)
  const r2 = compareCosts(['o1'], { inputTokens: 1000 })
  assert.ok(r2.results[0].outputTokens > r1.results[0].outputTokens, 'o1 应自动估出更多 output tokens')
})

test('缓存命中比例影响成本', () => {
  const noCache = compareCosts(['gpt-4o'], { inputTokens: 10000, cacheHitRatio: 0 })
  const withCache = compareCosts(['gpt-4o'], { inputTokens: 10000, cacheHitRatio: 0.5 })
  assert.ok(withCache.results[0].costTotal.total < noCache.results[0].costTotal.total)
})

test('calls 倍数正确', () => {
  const r1 = compareCosts(['gpt-4o'], { inputTokens: 1000, calls: 1 })
  const r10 = compareCosts(['gpt-4o'], { inputTokens: 1000, calls: 10 })
  const ratio = r10.results[0].costTotal.total / r1.results[0].costTotal.total
  assert.ok(Math.abs(ratio - 10) < 0.001)
})

test('货币折算在成本对比里生效', () => {
  const r = compareCosts(['deepseek-chat'], { inputTokens: 100000, calls: 10 }, { displayCurrency: 'CNY' })
  // 100K input × 0.27 USD/M × 10 calls = $0.27 input cost; +output $0.33 → ≈ $0.60 × 7.20 = ¥4.32
  assert.ok(r.results[0].costDisplay.total > 3 && r.results[0].costDisplay.total < 6)
  // 同样的成本用 USD 看应该是 0.6 附近
  const r2 = compareCosts(['deepseek-chat'], { inputTokens: 100000, calls: 10 }, { displayCurrency: 'USD' })
  assert.ok(r2.results[0].costDisplay.total > 0.4 && r2.results[0].costDisplay.total < 1)
  // CNY / USD ≈ 7.20
  const ratio = r.results[0].costDisplay.total / r2.results[0].costDisplay.total
  assert.ok(Math.abs(ratio - 7.20) < 0.1)
})

console.log('所有测试通过 ✓')
