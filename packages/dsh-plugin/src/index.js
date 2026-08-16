// DeepSeek Harness 插件入口 — dsh-token-budget
// 通过 ctx.tools.register(defineTool(...)) 注册四个工具给 Agent 使用:
//   1. estimate-tokens   - 估算文本/路径的 token 数（单模型精确）
//   2. estimate-cost     - 多模型成本对比（核心工具，输出 Markdown 报告）
//   3. list-models       - 列出所有支持模型（可按厂商过滤）
//   4. list-pricing      - 列出模型定价（可按厂商过滤）

import {
  estimate, listAvailableModels, listProviders,
  normalizeModelName, getModel, getPricing, resolveTier,
  compareCosts, formatMarkdownReport, formatJsonReport,
  setPricingOverrides, DEFAULT_FX,
  planProjectBudget, countText, countDirectory,
  buildPricingRefreshTasks, applySearchedPricing, renderPricingTasksMarkdown,
  fetchAndPlanGitHub, parseGitHubRef,
} from '@token-budget/core'

// DSH 工具定义器（peer dep，DSH 运行时提供）
let defineTool = null
try {
  // 用动态 import 避免在 DSH 之外的环境 import 失败
  const m = await import('@deepseek-ai/dsh-tools')
  defineTool = m.defineTool || m.default?.defineTool
} catch (_) {
  defineTool = null
}

export const name = 'dsh-token-budget'
export const inject = ['tools']

/** 默认配置（可被 dsh 配置覆盖） */
const DEFAULT_CONFIG = {
  displayCurrency: 'USD',
  defaultCacheHitRatio: 0,
  defaultOutputRatio: 0.3,
  forceHeuristic: false,
  pricingOverrides: {},
}

/**
 * 把扁平的 dsh-tool 参数 schema 转成 JSON Schema（让模型直接看懂）
 * defineTool 自带 schema 处理，但显式给一份便于审查
 */
function makeParamSchema(props) {
  return props
}

export function apply(ctx, userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig }
  if (config.pricingOverrides && Object.keys(config.pricingOverrides).length) {
    setPricingOverrides(config.pricingOverrides)
  }

  if (!defineTool) {
    console.warn('[dsh-token-budget] @deepseek-ai/dsh-tools 未安装，工具未注册。请确认 DSH 环境。')
    return
  }
  if (!ctx?.tools?.register) {
    console.warn('[dsh-token-budget] ctx.tools 不可用，工具未注册。检查 inject 声明。')
    return
  }

  console.log('[dsh-token-budget] apply() ran, registering 8 tools: estimate-tokens, estimate-cost, list-models, list-pricing, plan-project-budget, refresh-pricing, apply-pricing-update, estimate-github-project')

  // ── 工具 1: estimate-tokens ─────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'estimate-tokens',
    description: [
      '估算给定文本或文件的 token 数。支持单模型精确 tokenizer（gpt-tokenizer）或启发式估算。',
      '当只关心 token 量不关心成本时用这个；关心成本用 estimate-cost。',
    ].join(' '),
    parameters: makeParamSchema({
      text: { type: 'string', required: false, description: '要估算的文本内容（与 path 二选一）' },
      path: { type: 'string', required: false, description: '要扫描的文件或目录路径（相对于 workspace 或绝对）' },
      model: { type: 'string', required: false, description: '用于选择 tokenizer 的模型 id，默认 gpt-4o' },
      forceHeuristic: { type: 'boolean', required: false, description: '强制用启发式估算，跳过 gpt-tokenizer' },
    }),
    output: {
      schema: { type: 'object' },
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      const model = args.model || 'gpt-4o'
      if (!args.text && !args.path) {
        return { error: '必须提供 text 或 path 之一' }
      }
      const result = await estimate({
        text: args.text,
        path: args.path,
        models: [model],
        forceHeuristic: args.forceHeuristic ?? config.forceHeuristic,
        displayCurrency: config.displayCurrency,
      })
      const r = result.comparison.results[0]
      return {
        model: r.display,
        modelId: r.modelId,
        tokens: r.inputTokens,
        method: 'exact-or-heuristic',
        chars: args.text?.length ?? 0,
      }
    },
  }))

  // ── 工具 2: estimate-cost ──────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'estimate-cost',
    description: [
      '核心工具：估算特定模型在处理给定输入时的 token 消耗量与成本，多模型对比。',
      '可传入企划书文本、半成品项目路径、或已有 token 数；自动按各家厂商官方定价计费。',
      '返回按总成本排序的对比表 + Markdown 报告。',
    ].join(' '),
    parameters: makeParamSchema({
      text: { type: 'string', required: false, description: '直接估算的文本（如企划书全文）' },
      path: { type: 'string', required: false, description: '要扫描的文件/目录路径（半成品项目源码等）' },
      inputTokens: { type: 'number', required: false, description: '已知输入 token 数（直接估算用）' },
      outputTokens: { type: 'number', required: false, description: '预估输出 token 数；不传则按模型类型自动估算' },
      models: {
        type: 'array',
        required: false,
        description: '要对比的模型 id 列表（如 ["gpt-4o","claude-sonnet-4.6","deepseek-chat"]）。不传则对比全部',
        items: { type: 'string' },
      },
      calls: { type: 'number', required: false, description: '调用次数（用于批量任务成本预估）。默认 1' },
      cacheHitRatio: { type: 'number', required: false, description: '缓存命中比例（0-1）。默认 0' },
      displayCurrency: { type: 'string', required: false, description: '输出货币 USD 或 CNY，默认沿用插件配置' },
      forceHeuristic: { type: 'boolean', required: false, description: '强制启发式估算' },
      format: { type: 'string', required: false, description: '输出格式: markdown (默认) 或 json' },
    }),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      const result = await estimate({
        text: args.text,
        path: args.path,
        inputTokens: args.inputTokens,
        models: args.models,
        outputTokens: args.outputTokens,
        cacheHitRatio: args.cacheHitRatio ?? config.defaultCacheHitRatio,
        calls: args.calls,
        displayCurrency: args.displayCurrency || config.displayCurrency,
        forceHeuristic: args.forceHeuristic ?? config.forceHeuristic,
      })
      if (args.format === 'json') {
        return result.reportJson
      }
      return result.reportMd
    },
  }))

  // ── 工具 3: list-models ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'list-models',
    description: '列出所有支持的 LLM 模型（含厂商、上下文窗口、是否推理模型）',
    parameters: makeParamSchema({
      provider: { type: 'string', required: false, description: '按厂商过滤，如 openai / anthropic / deepseek / qwen / zhipu' },
    }),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      const all = listAvailableModels()
      const filtered = args.provider
        ? all.filter(m => m.provider === args.provider)
        : all
      const lines = [`# 支持的模型 (${filtered.length})`, '']
      lines.push('| 模型 ID | 显示名 | 厂商 | 货币 | 上下文 | 推理 | tokenizer |')
      lines.push('|---------|--------|------|------|--------|------|-----------|')
      for (const m of filtered) {
        lines.push(`| ${m.id} | ${m.display} | ${m.providerName} | ${m.currency} | ${m.contextWindow.toLocaleString()} | ${m.reasoning ? '是' : '否'} | ${m.tokenizer} |`)
      }
      return lines.join('\n')
    },
  }))

  // ── 工具 4: list-pricing ───────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'list-pricing',
    description: '列出模型定价（每百万 tokens，本币）。支持按厂商过滤或查询单个模型',
    parameters: makeParamSchema({
      model: { type: 'string', required: false, description: '查询单个模型的详细定价（含分段定价）' },
      provider: { type: 'string', required: false, description: '按厂商过滤' },
    }),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      if (args.model) {
        const id = normalizeModelName(args.model)
        if (!id) return `未找到模型: ${args.model}`
        const p = getPricing(id)
        if (!p) return `模型 ${id} 没有定价条目`
        const tier = resolveTier(p, 0)
        const lines = [
          `# ${id} 定价`,
          '',
          `- 厂商: ${getModel(id)?.provider}`,
          `- 货币: ${p.currency}`,
          `- 数据日期: ${p.effectiveDate}`,
          `- 来源: ${p.sourceUrl}`,
          '',
          '## 标准价（每百万 tokens）',
          `- 输入: ${tier.input} ${p.currency}`,
          `- 输出: ${tier.output} ${p.currency}`,
          `- 缓存命中: ${tier.cacheHit} ${p.currency}`,
          `- 缓存写入: ${p.cacheWrite ?? 0} ${p.currency}`,
        ]
        if (p.tiers?.length) {
          lines.push('', '## 分段定价（按上下文长度）')
          for (const t of p.tiers) {
            const max = t.maxTokens === Infinity ? '∞' : t.maxTokens.toLocaleString()
            lines.push(`- ${t.minTokens.toLocaleString()}-${max}: 输入 ${t.price.input} / 输出 ${t.price.output}`)
          }
        }
        if (p.notes) lines.push('', `> 备注: ${p.notes}`)
        return lines.join('\n')
      }

      const all = listAvailableModels()
      const filtered = args.provider
        ? all.filter(m => m.provider === args.provider)
        : all
      const lines = [`# 模型定价表（${filtered.length} 个模型）`, '']
      lines.push('| 模型 | 厂商 | 货币 | 输入/M | 输出/M | 缓存命中 |')
      lines.push('|------|------|------|--------|--------|----------|')
      for (const m of filtered) {
        const p = getPricing(m.id)
        if (!p) continue
        const tier = resolveTier(p, 0)
        lines.push(`| ${m.display} | ${m.providerName} | ${p.currency} | ${tier.input} | ${tier.output} | ${tier.cacheHit} |`)
      }
      lines.push('', `> 数据更新日期: 2026-08-16`)
      return lines.join('\n')
    },
  }))

  // ── 工具 5: plan-project-budget（项目级预算：企划书→成品） ────────────
  ctx.tools.register(defineTool({
    name: 'plan-project-budget',
    description: [
      '核心工具：从企划书 + 半成品代码 + 资料 → 生成完整 AI 开发预算清单（非单纯"上传文件称重"）。',
      '按需求/架构/建模/编码/UI/测试/文档/发布 8 个阶段分解，结合 SWE-bench / Aider 实测数据估算 tokens 与成本。',
      '输出 8 阶段 token 分解 + 15+ 模型成本对比（P10/P50/P90 置信区间） + 阶段×模型矩阵。',
    ].join(' '),
    parameters: makeParamSchema({
      docText: { type: 'string', required: false, description: '企划书/PRD/需求文档 原文（与 docPath 二选一）' },
      docPath: { type: 'string', required: false, description: '企划书/需求文档所在的文件或目录路径' },
      materialText: { type: 'string', required: false, description: '参考资料/API 文档/竞品分析等 文本' },
      materialPath: { type: 'string', required: false, description: '参考资料所在路径' },
      codePath: { type: 'string', required: false, description: '半成品项目源码路径（用于估算完成度并打折）' },
      workflow: {
        type: 'string', required: false,
        description: '工作模式：chat (聊天对话, 省思考但重写多) | aider_loop (Aider/Codex CLI, 推荐) | ide_assist (Cursor/Windsurf) | autonomous (SWE-Agent/AutoCoder)。默认 aider_loop',
      },
      displayCurrency: { type: 'string', required: false, description: '输出货币 USD 或 CNY。默认 USD' },
      projectType: { type: 'string', required: false, description: '项目类型：game / webapp / mobile_app / embedded / auto。默认 auto' },
      models: {
        type: 'array', items: { type: 'string' },
        required: false,
        description: '指定要对比的模型 id 列表（如 ["gpt-4o","claude-sonnet-4.6"]），不传则对比全部',
      },
      customPhases: {
        type: 'object', required: false,
        description: '自定义阶段：{ "phase-id": { calls: 5, disable: false } }',
      },
      format: { type: 'string', required: false, description: '输出格式: markdown (默认) 或 json' },
    }),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      const payload = {
        displayCurrency: args.displayCurrency || config.displayCurrency,
        workflow: args.workflow || 'aider_loop',
        projectType: args.projectType || 'auto',
        models: args.models,
        customPhases: args.customPhases,
      }
      if (args.docText) payload.docText = args.docText
      if (args.materialText) payload.materialText = args.materialText
      try {
        if (args.docPath) {
          const r = await countDirectory(args.docPath)
          payload.docText = (payload.docText || '') + '\n\n' + r.texts.join('\n\n=== 文件分割 ===\n\n')
          payload.docTokens = r.tokens
        }
        if (args.materialPath) {
          const r = await countDirectory(args.materialPath)
          payload.materialText = (payload.materialText || '') + '\n\n' + r.texts.join('\n\n=== 资料分割 ===\n\n')
          payload.materialTokens = r.tokens
        }
        // codePath 直接传给 planProjectBudget，让它自己扫（这样能拿到 file.path/ext 判断文件类型）
        if (args.codePath) payload.path = args.codePath
      } catch (err) {
        return `读取路径失败: ${err.message}`
      }
      const r = await planProjectBudget(payload)
      if (args.format === 'json') {
        return JSON.stringify({
          signals: r.signals,
          totalTokens: r.totals.tokens,
          perModelBudget: r.perModelBudget,
        }, null, 2)
      }
      return r.reportMd
    },
  }))

  // ── 工具 6: refresh-pricing（让 AI 自己去搜价） ─────────────────────
  ctx.tools.register(defineTool({
    name: 'refresh-pricing',
    description: [
      '生成"价格刷新任务清单"——把每家厂商的官方定价页 URL + 当前已知价格 + 提取 schema 列出来，',
      '由你（AI）用 WebFetch / WebSearch 自己去抓最新价格，再用 apply-pricing-update 回传合并。',
      '适用于内置定价表过期、或想用最新价计算 estimate-cost / plan-project-budget 的场景。',
    ].join(' '),
    parameters: makeParamSchema({
      providers: {
        type: 'array', items: { type: 'string' }, required: false,
        description: '只刷新指定厂商（如 ["openai","deepseek"]）。不传则刷新全部',
      },
      format: { type: 'string', required: false, description: '输出格式 markdown (默认) 或 json', default: 'markdown' },
    }),
    output: { schema: { type: 'string' }, render: (_args, value) => renderValue(value) },
    async execute(args) {
      const tasks = buildPricingRefreshTasks({ providers: args.providers })
      if (args.format === 'json') return JSON.stringify(tasks, null, 2)
      return renderPricingTasksMarkdown(tasks)
    },
  }))

  // ── 工具 7: apply-pricing-update（接收 AI 搜回的价格） ───────────────
  ctx.tools.register(defineTool({
    name: 'apply-pricing-update',
    description: [
      '接收 refresh-pricing 任务清单搜回来的价格数据，校验后合并到定价表。',
      '后续 estimate-cost / plan-project-budget / list-pricing 会自动用新价。',
      '注意: 价格在进程内有效；进程重启会回到内置表（如需持久化请改 config.pricingOverrides）。',
    ].join(' '),
    parameters: makeParamSchema({
      prices: {
        type: 'array', required: true,
        description: 'AI 搜回来的价格数组，每项: { modelId, input, output, cacheHit?, cacheWrite?, effectiveDate, sourceUrl?, notes? }',
        items: { type: 'object' },
      },
    }),
    output: { schema: { type: 'string' }, render: (_args, value) => renderValue(value) },
    async execute(args) {
      if (!args.prices) return '错误: 必须提供 prices 数组'
      const result = applySearchedPricing(args.prices)
      const lines = [
        `# ✅ 价格更新完成`,
        '',
        `- 成功合并: ${result.appliedCount} 个模型`,
        `- 跳过: ${result.skipped.length} 个`,
      ]
      if (result.skipped.length) {
        lines.push('', '## 跳过的条目')
        for (const s of result.skipped) {
          lines.push(`- ${s.reason}: ${JSON.stringify(s.entry).slice(0, 200)}`)
        }
      }
      lines.push('', `## 已更新的 modelId`, ...result.modelIds.map(id => `- \`${id}\``))
      lines.push('', '> 后续 estimate-cost / plan-project-budget 会使用新价格')
      return lines.join('\n')
    },
  }))

  // ── 工具 8: estimate-github-project（自动拉 GitHub 仓库算预算） ─────
  ctx.tools.register(defineTool({
    name: 'estimate-github-project',
    description: [
      '自动从 GitHub 拉取开源项目（README + docs/ + 源码）→ 直接输出完整 AI 预算清单。',
      '使用 GitHub REST API（匿名 60 请求/小时也够跑单仓库；可选传 token 提权至 5000 请求/小时）。',
      '输出同 plan-project-budget：8 阶段分解 + 多模型对比 P10/P50/P90 + 资料质量/技术债扫描报告。',
    ].join(' '),
    parameters: makeParamSchema({
      repo: {
        type: 'string', required: true,
        description: 'GitHub 引用，支持格式："owner/repo" / "owner/repo@branch" / "https://github.com/owner/repo/tree/branch"',
      },
      token: {
        type: 'string', required: false,
        description: '可选 GitHub Personal Access Token（匿名也能用，但 60 次/小时限额）。从 GITHUB_TOKEN 环境变量或你的密钥管理里取。',
      },
      displayCurrency: { type: 'string', required: false, description: '输出货币 USD/CNY。默认 USD' },
      workflow: {
        type: 'string', required: false,
        description: '工作模式：chat / aider_loop(推荐) / ide_assist / autonomous',
      },
      models: {
        type: 'array', items: { type: 'string' }, required: false,
        description: '指定要对比的模型 id 列表',
      },
      debug: {
        type: 'boolean', required: false,
        description: 'true 时返回 debugLogs：每个文件的 TODO 密度 + 资料质量系数逐步展开（用于排查数据不对）',
      },
      format: { type: 'string', required: false, description: '输出格式 markdown(默认) 或 json' },
    }),
    output: {
      schema: { type: 'string' },
      render: (_args, value) => renderValue(value),
    },
    async execute(args) {
      const progressLines = []
      const progressReporter = (phase, detail) => {
        progressLines.push(`[${new Date().toISOString()}] ${phase}: ${JSON.stringify(detail).slice(0, 200)}`)
      }
      try {
        // 先验证 repo 格式
        parseGitHubRef(args.repo)
      } catch (e) {
        return `错误: repo 参数格式不对 —— ${e.message}\n正确示例: "vercel/next.js" 或 "https://github.com/Aider-AI/aider"`
      }
      const r = await fetchAndPlanGitHub({
        repo: args.repo,
        token: args.token || undefined,
        planOptions: {
          displayCurrency: args.displayCurrency || config.displayCurrency,
          workflow: args.workflow || 'aider_loop',
          models: args.models,
          debug: !!args.debug,
          debugChannel: (t, s, d) => progressReporter(`debug:${t}`, { subject: s, detail: d }),
        },
        onProgress: progressReporter,
      })
      if (args.format === 'json') {
        return JSON.stringify({
          github: r.github,
          signals: r.signals,
          totalTokens: r.totals.tokens,
          perModelBudget: r.perModelBudget,
          debugLogs: args.debug ? r.debugLogs : undefined,
        }, null, 2)
      }
      // Markdown 报告顶部加 GitHub 元信息
      const gh = r.github || {}
      const header = [
        `# 📦 GitHub 项目 AI 预算估算`,
        '',
        `- **仓库**: [${gh.fullName}](https://github.com/${gh.fullName})`,
        `- **分支**: \`${gh.branch}\``,
        `- **语言 / stars**: ${gh.language || '—'} / ⭐ ${gh.stars ?? 0}`,
        `- **描述**: ${gh.description || '—'}`,
        `- **最后更新**: ${gh.updatedAt || '—'}`,
        `- **抓取文件**: docs ${gh.files?.docs || 0} · 资料 ${gh.files?.materials || 0} · 代码 ${gh.files?.codes || 0}`,
        gh.stars ? '' : '> 未传 token 可能会触发速率限制；遇到 403 时请传 `token` 参数（GITHUB_TOKEN）',
      ].filter(Boolean).join('\n')
      const tail = args.debug && r.debugLogs
        ? `\n\n---\n\n## 🕵️ 详细调试日志 (debug=true)\n\n\`\`\`json\n${JSON.stringify(r.debugLogs, null, 2).slice(0, 50000)}\n\`\`\`\n`
        : ''
      const progressTail = progressLines.length
        ? `\n\n## ⏱️ 执行进度\n\n${progressLines.map(l => `- ${l}`).join('\n')}`
        : ''
      return `${header}\n\n---\n\n${r.reportMd}${tail}${progressTail}`
    },
  }))

  // 卸载时自动清理（Cordis 由 ctx.tools.register 返回的 disposer 处理，这里只打 log）
  ctx.effect(() => {
    return () => {
      console.log('[dsh-token-budget] unloading, tools unregistered')
    }
  })
}

/** 把任意值渲染成模型可见的文本块 */
function renderValue(value) {
  if (value == null) return [{ type: 'text', text: '(no output)' }]
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}
