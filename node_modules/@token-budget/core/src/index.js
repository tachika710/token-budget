// @token-budget/core - 统一入口
// 一个文件搞定：模型表 / 定价表 / tokenizer / 文件计数 / 成本计算

export * from './models.js'
export * from './pricing.js'
export * from './tokenizer.js'
export * from './counter.js'
export * from './calculator.js'
export * from './project-estimator.js'
export * from './pricing-tasks.js'
export * from './github-fetcher.js'

export const VERSION = '0.1.0'
export const PRICING_DATA_DATE = '2026-08-16'

/**
 * 顶层便利方法：传入文本或路径，直接估算成本（对比全部模型）
 * @param {{
 *   text?: string,
 *   path?: string,
 *   outputTokens?: number,
 *   outputRatio?: number,        // 输出/输入 比例（仅当 outputTokens 未传时用）
 *   cacheHitRatio?: number,
 *   calls?: number,
 *   models?: string[],           // 限定模型集
 *   displayCurrency?: 'USD'|'CNY',
 *   forceHeuristic?: boolean,
 * }} input
 * @returns {Promise<{comparison: import('./calculator.js').ComparisonResult, reportMd: string, reportJson: string}>}
 */
export async function estimate(input) {
  const { countText, countDirectory } = await import('./counter.js')
  const { compareCosts, formatMarkdownReport, formatJsonReport } = await import('./calculator.js')
  const { listAvailableModels } = await import('./calculator.js')
  const { getModel } = await import('./models.js')

  let inputTokens = 0
  if (input.text != null) {
    const r = await countText(input.text, 'gpt-4o', { forceHeuristic: input.forceHeuristic })
    inputTokens = r.tokens
  } else if (input.path) {
    const r = await countDirectory(input.path, 'gpt-4o', { forceHeuristic: input.forceHeuristic })
    inputTokens = r.totals.tokens
  } else {
    inputTokens = input.inputTokens ?? 0
  }

  const models = input.models && input.models.length
    ? input.models
    : listAvailableModels().map(m => m.id)

  const comp = compareCosts(models, {
    inputTokens,
    outputTokens: input.outputTokens,
    cacheHitRatio: input.cacheHitRatio ?? 0,
    calls: input.calls ?? 1,
  }, { displayCurrency: input.displayCurrency || 'USD' })

  return {
    comparison: comp,
    reportMd: formatMarkdownReport(comp),
    reportJson: formatJsonReport(comp),
  }
}
