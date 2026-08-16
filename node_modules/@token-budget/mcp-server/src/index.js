#!/usr/bin/env node
// @token-budget/mcp-server
//
// 通过 stdio 实现 MCP 协议，向所有支持 MCP 的客户端暴露 4 个工具:
//   estimate-tokens / estimate-cost / list-models / list-pricing
//
// 配置示例（Claude Desktop / Cursor / Trae / Cline）:
//
//   Claude Desktop (claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "token-budget": {
//         "command": "node",
//         "args": ["E:/词元预算/packages/mcp-server/src/index.js"]
//       }
//     }
//   }
//
//   Cursor (设置 → MCP):
//   {
//     "mcpServers": {
//       "token-budget": {
//         "command": "node",
//         "args": ["E:/词元预算/packages/mcp-server/src/index.js"]
//       }
//     }
//   }
//
// 环境变量:
//   TB_DISPLAY_CURRENCY   - 默认输出货币（USD 或 CNY）
//   TB_FORCE_HEURISTIC     - "1" 强制启发式估算
//   TB_FX_USD_TO_CNY       - USD→CNY 汇率覆盖

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import {
  estimate, listAvailableModels, listProviders,
  normalizeModelName, getModel, getPricing, resolveTier,
  setPricingOverrides, DEFAULT_FX,
  planProjectBudget, countDirectory,
  buildPricingRefreshTasks, applySearchedPricing, renderPricingTasksMarkdown,
  fetchAndPlanGitHub, parseGitHubRef,
} from '@token-budget/core'

const DISPLAY_CURRENCY = process.env.TB_DISPLAY_CURRENCY === 'CNY' ? 'CNY' : 'USD'
const FORCE_HEURISTIC = process.env.TB_FORCE_HEURISTIC === '1' || process.env.TB_FORCE_HEURISTIC === 'true'

if (process.env.TB_FX_USD_TO_CNY) {
  const v = parseFloat(process.env.TB_FX_USD_TO_CNY)
  if (!Number.isNaN(v) && v > 0) {
    DEFAULT_FX.USD_TO_CNY = v
    DEFAULT_FX.CNY_TO_USD = 1 / v
  }
}

// ── 工具定义 ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'estimate-tokens',
    description: '估算给定文本或文件的 token 数。支持单模型精确 tokenizer（gpt-tokenizer）或启发式估算。当只关心 token 量不关心成本时用这个。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要估算的文本内容（与 path 二选一）' },
        path: { type: 'string', description: '要扫描的文件或目录绝对路径' },
        model: { type: 'string', description: '用于选择 tokenizer 的模型 id，默认 gpt-4o', default: 'gpt-4o' },
        forceHeuristic: { type: 'boolean', description: '强制用启发式估算，跳过 gpt-tokenizer', default: false },
      },
    },
  },
  {
    name: 'estimate-cost',
    description: '核心工具：估算特定模型在处理给定输入时的 token 消耗量与成本，多模型对比。可传入企划书文本、半成品项目路径、或已有 token 数；自动按各家厂商官方定价计费。返回按总成本排序的对比表 + Markdown 报告。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '直接估算的文本（如企划书全文）' },
        path: { type: 'string', description: '要扫描的文件/目录绝对路径（半成品项目源码等）' },
        inputTokens: { type: 'number', description: '已知输入 token 数（直接估算用）' },
        outputTokens: { type: 'number', description: '预估输出 token 数；不传则按模型类型自动估算（推理模型会乘思维链系数）' },
        models: {
          type: 'array',
          items: { type: 'string' },
          description: '要对比的模型 id 列表（如 ["gpt-4o","claude-sonnet-4.6","deepseek-chat"]）。不传则对比全部',
        },
        calls: { type: 'number', description: '调用次数（用于批量任务成本预估）。默认 1', default: 1 },
        cacheHitRatio: { type: 'number', description: '缓存命中比例（0-1）。默认 0', default: 0 },
        displayCurrency: { type: 'string', enum: ['USD', 'CNY'], description: '输出货币', default: DISPLAY_CURRENCY },
        forceHeuristic: { type: 'boolean', description: '强制启发式估算', default: FORCE_HEURISTIC },
        format: { type: 'string', enum: ['markdown', 'json'], description: '输出格式', default: 'markdown' },
      },
    },
  },
  {
    name: 'list-models',
    description: '列出所有支持的 LLM 模型（含厂商、上下文窗口、是否推理模型、tokenizer）',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: '按厂商过滤（openai / anthropic / google / deepseek / qwen / zhipu / moonshot / doubao / minimax / baidu / xai / mistral / together / groq / cohere）' },
      },
    },
  },
  {
    name: 'list-pricing',
    description: '列出模型定价（每百万 tokens，本币）。支持按厂商过滤或查询单个模型详细定价（含分段定价）',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: '查询单个模型的详细定价（含分段定价）' },
        provider: { type: 'string', description: '按厂商过滤' },
      },
    },
  },
  {
    name: 'plan-project-budget',
    description: [
      '核心工具：从企划书/PRD + 半成品源码 + 资料 → 生成完整 AI 开发预算清单（非单纯"上传文件称重"）。',
      '按 需求/架构/建模/编码/UI/测试/文档/发布 8 个阶段分解，基于 SWE-bench / Aider / AgentPub 实测数据估算 tokens 与成本。',
      '输出 8 阶段 token 分解 + 多模型成本对比（P10/P50/P90 置信区间） + 阶段×模型矩阵。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        docText: { type: 'string', description: '企划书/PRD/需求文档原文（与 docPath 二选一）' },
        docPath: { type: 'string', description: '企划书/需求文档所在的文件或目录绝对路径' },
        materialText: { type: 'string', description: '参考资料/API 文档/竞品分析等文本' },
        materialPath: { type: 'string', description: '参考资料所在路径' },
        codePath: { type: 'string', description: '半成品项目源码绝对路径（用于估算完成度并自动打折）' },
        workflow: {
          type: 'string',
          enum: ['chat', 'aider_loop', 'ide_assist', 'autonomous'],
          description: '工作模式：chat / aider_loop(推荐) / ide_assist / autonomous',
          default: 'aider_loop',
        },
        displayCurrency: {
          type: 'string', enum: ['USD', 'CNY'], default: DISPLAY_CURRENCY,
          description: '输出货币',
        },
        projectType: {
          type: 'string', enum: ['auto', 'game', 'webapp', 'mobile_app', 'embedded'], default: 'auto',
          description: '项目类型（影响阶段权重）',
        },
        models: {
          type: 'array', items: { type: 'string' },
          description: '指定要对比的模型 id 列表，不传则对比全部',
        },
        customPhases: {
          type: 'object',
          description: '自定义阶段系数：{ "phase-id": { calls: 5, disable: false } }',
        },
        format: {
          type: 'string', enum: ['markdown', 'json'], default: 'markdown',
          description: '输出格式',
        },
      },
    },
  },
  {
    name: 'refresh-pricing',
    description: [
      '生成"价格刷新任务清单"——把每家厂商的官方定价页 URL + 当前已知价格 + 提取 schema 列出来，',
      '由 AI 用 WebFetch / WebSearch 自己去抓最新价格，再用 apply-pricing-update 回传合并。',
      '适用于内置定价表过期、或想用最新价计算 estimate-cost / plan-project-budget 的场景。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        providers: {
          type: 'array', items: { type: 'string' },
          description: '只刷新指定厂商（如 ["openai","deepseek"]）。不传则刷新全部',
        },
        format: {
          type: 'string', enum: ['markdown', 'json'], default: 'markdown',
          description: '输出格式',
        },
      },
    },
  },
  {
    name: 'apply-pricing-update',
    description: [
      '接收 refresh-pricing 任务清单搜回来的价格数据，校验后合并到定价表。',
      '后续 estimate-cost / plan-project-budget / list-pricing 会自动用新价。',
      '注意: 价格在进程内有效；进程重启会回到内置表。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['prices'],
      properties: {
        prices: {
          type: 'array',
          description: 'AI 搜回来的价格数组，每项: { modelId, input, output, cacheHit?, cacheWrite?, effectiveDate, sourceUrl?, notes? }',
          items: { type: 'object' },
        },
      },
    },
  },
  {
    name: 'estimate-github-project',
    description: [
      '自动从 GitHub 拉取开源项目（README + docs/ + 源码）→ 直接输出完整 AI 预算清单。',
      '用 GitHub REST API（匿名 60 请求/小时也够跑单仓库；可选传 token 提权到 5000 请求/小时）。',
      '输出同 plan-project-budget：8 阶段分解 + 多模型对比 P10/P50/P90 + 资料质量/技术债扫描。',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['repo'],
      properties: {
        repo: {
          type: 'string',
          description: 'GitHub 引用，格式："owner/repo" / "owner/repo@branch" / "https://github.com/owner/repo/tree/branch"',
        },
        token: {
          type: 'string',
          description: '可选 GitHub Personal Access Token（匿名 60 次/小时限额；有 token 提权至 5000 次/小时）。从 GITHUB_TOKEN 环境变量或密钥管理里取。',
        },
        displayCurrency: {
          type: 'string', enum: ['USD', 'CNY'], default: DISPLAY_CURRENCY,
        },
        workflow: {
          type: 'string',
          enum: ['chat', 'aider_loop', 'ide_assist', 'autonomous'],
          default: 'aider_loop',
        },
        models: {
          type: 'array', items: { type: 'string' },
          description: '指定对比模型列表，不传则用默认 15 个模型',
        },
        debug: {
          type: 'boolean',
          description: 'true 时附加详细调试日志：每个文件 TODO 密度 + 资料质量系数逐步展开',
        },
        format: {
          type: 'string', enum: ['markdown', 'json'], default: 'markdown',
        },
      },
    },
  },
]

// ── 工具实现 ─────────────────────────────────────────────────────────────

async function handleToolCall(name, args) {
  switch (name) {
    case 'estimate-tokens': {
      if (!args.text && !args.path) {
        return textContent('错误: 必须提供 text 或 path 之一')
      }
      const model = args.model || 'gpt-4o'
      const result = await estimate({
        text: args.text,
        path: args.path,
        models: [model],
        forceHeuristic: args.forceHeuristic ?? FORCE_HEURISTIC,
        displayCurrency: DISPLAY_CURRENCY,
      })
      const r = result.comparison.results[0]
      if (!r) return textContent(`未找到模型: ${model}`)
      return textContent([
        `# Token 估算结果`,
        '',
        `- **模型**: ${r.display} (\`${r.modelId}\`)`,
        `- **Token 数**: ${r.inputTokens.toLocaleString()}`,
        `- **字符数**: ${args.text?.length ?? '(file scan)'}`,
        `- **估算方式**: ${r.currency}（精确/启发式由 tokenizer 决定）`,
        '',
        `> 提示: 如需多模型成本对比，请使用 estimate-cost 工具。`,
      ].join('\n'))
    }
    case 'estimate-cost': {
      if (!args.text && !args.path && args.inputTokens == null) {
        return textContent('错误: 必须提供 text / path / inputTokens 之一')
      }
      const result = await estimate({
        text: args.text,
        path: args.path,
        inputTokens: args.inputTokens,
        models: args.models,
        outputTokens: args.outputTokens,
        cacheHitRatio: args.cacheHitRatio ?? 0,
        calls: args.calls ?? 1,
        displayCurrency: args.displayCurrency || DISPLAY_CURRENCY,
        forceHeuristic: args.forceHeuristic ?? FORCE_HEURISTIC,
      })
      return textContent(args.format === 'json' ? result.reportJson : result.reportMd)
    }
    case 'list-models': {
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
      return textContent(lines.join('\n'))
    }
    case 'list-pricing': {
      if (args.model) {
        const id = normalizeModelName(args.model)
        if (!id) return textContent(`未找到模型: ${args.model}`)
        const p = getPricing(id)
        if (!p) return textContent(`模型 ${id} 没有定价条目`)
        const tier = resolveTier(p, 0)
        const meta = getModel(id)
        const lines = [
          `# ${id} 定价`,
          '',
          `- 厂商: ${meta?.provider}`,
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
        return textContent(lines.join('\n'))
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
      return textContent(lines.join('\n'))
    }
    case 'plan-project-budget': {
      const payload = {
        displayCurrency: args.displayCurrency || DISPLAY_CURRENCY,
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
        return textContent(`读取路径失败: ${err.message}`)
      }
      const r = await planProjectBudget(payload)
      if (args.format === 'json') {
        return textContent(JSON.stringify({
          signals: r.signals,
          totalTokens: r.totals.tokens,
          perModelBudget: r.perModelBudget,
        }, null, 2))
      }
      return textContent(r.reportMd)
    }
    case 'refresh-pricing': {
      const tasks = buildPricingRefreshTasks({ providers: args.providers })
      if (args.format === 'json') return textContent(JSON.stringify(tasks, null, 2))
      return textContent(renderPricingTasksMarkdown(tasks))
    }
    case 'apply-pricing-update': {
      if (!args.prices) return textContent('错误: 必须提供 prices 数组')
      const result = applySearchedPricing(args.prices)
      const lines = [
        '# ✅ 价格更新完成',
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
      lines.push('', '## 已更新的 modelId', ...result.modelIds.map(id => `- \`${id}\``))
      lines.push('', '> 后续 estimate-cost / plan-project-budget 会使用新价格')
      return textContent(lines.join('\n'))
    }
    case 'estimate-github-project': {
      const progressLines = []
      const report = (phase, detail) => {
        progressLines.push(`[${new Date().toISOString()}] ${phase}: ${JSON.stringify(detail).slice(0, 200)}`)
      }
      try {
        parseGitHubRef(args.repo)
      } catch (e) {
        return textContent(`错误: repo 参数格式不对 —— ${e.message}\n正确示例: "vercel/next.js" 或 "https://github.com/Aider-AI/aider"`)
      }
      const r = await fetchAndPlanGitHub({
        repo: args.repo,
        token: args.token || undefined,
        planOptions: {
          displayCurrency: args.displayCurrency || DISPLAY_CURRENCY,
          workflow: args.workflow || 'aider_loop',
          models: args.models,
          debug: !!args.debug,
          debugChannel: (t, s, d) => report(`debug:${t}`, { subject: s, detail: d }),
        },
        onProgress: report,
      })
      if (args.format === 'json') {
        return textContent(JSON.stringify({
          github: r.github,
          signals: r.signals,
          totalTokens: r.totals.tokens,
          perModelBudget: r.perModelBudget,
          debugLogs: args.debug ? r.debugLogs : undefined,
          progress: progressLines,
        }, null, 2))
      }
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
        gh.stars ? '' : '> 未传 token 可能触发速率限制（匿名 60 请求/小时）。遇到 403 时传 `token` 参数。',
      ].filter(Boolean).join('\n')
      const tail = args.debug && r.debugLogs
        ? `\n\n---\n\n## 🕵️ 详细调试日志 (debug=true)\n\n\`\`\`json\n${JSON.stringify(r.debugLogs, null, 2).slice(0, 50000)}\n\`\`\`\n`
        : ''
      const progressTail = progressLines.length
        ? `\n\n## ⏱️ 执行进度\n\n${progressLines.map(l => `- ${l}`).join('\n')}`
        : ''
      return textContent(`${header}\n\n---\n\n${r.reportMd}${tail}${progressTail}`)
    }
    default:
      return textContent(`未知工具: ${name}`)
  }
}

function textContent(text) {
  return { content: [{ type: 'text', text }] }
}

// ── MCP 服务器启动 ────────────────────────────────────────────────────────

async function main() {
  const server = new Server(
    {
      name: 'token-budget',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    try {
      return await handleToolCall(name, args || {})
    } catch (err) {
      return textContent(`工具调用失败: ${err.message}\n\n${err.stack || ''}`)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[token-budget] MCP server running on stdio')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
