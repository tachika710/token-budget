#!/usr/bin/env node
// 命令行入口 - 独立可用，不依赖 dsh / MCP
// 用法:
//   node packages/core/src/cli.js <path-or-text> [--models gpt-4o,claude-sonnet-4.6] [--calls 100] [--currency CNY] [--json]
//   node packages/core/src/cli.js --text "你好世界" --models gpt-4o,deepseek-chat
//   node packages/core/src/cli.js --path ./my-project --output-tokens 5000 --calls 50

import { estimate } from './index.js'
import { listAvailableModels, listProviders } from './index.js'

function parseArgs(argv) {
  const out = { positional: [] }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        out[key] = true
      } else {
        out[key] = next
        i++
      }
    } else {
      out.positional.push(a)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv)

  if (args.help || args.h) {
    console.log(`token-budget — 估算 LLM 调用 token 与成本

用法:
  node cli.js <path>                         扫描文件/目录并估算
  node cli.js --text "..."                    直接估算文本
  node cli.js --input-tokens 10000            用已有 token 数估算

选项:
  --models <list>        逗号分隔的模型 id，默认对比全部
  --output-tokens <n>   估算的输出 token 数（不传则按模型类型自动估算）
  --calls <n>           调用次数（默认 1）
  --cache-ratio <0..1>  缓存命中比例（默认 0）
  --currency <USD|CNY>   输出货币（默认 USD）
  --json                 输出 JSON 报告
  --list-models          列出所有可用模型
  --list-providers       列出所有厂商
`)
    process.exit(0)
  }

  if (args['list-models']) {
    for (const m of listAvailableModels()) {
      console.log(`${m.id.padEnd(28)}  ${m.display.padEnd(28)}  [${m.provider}] ${m.currency}  ctx=${m.contextWindow}  reasoning=${m.reasoning}`)
    }
    process.exit(0)
  }

  if (args['list-providers']) {
    for (const p of listProviders()) {
      console.log(`${p.key.padEnd(14)} ${p.name.padEnd(28)}  ${p.currency}`)
    }
    process.exit(0)
  }

  // 解析输入
  let text, path, inputTokens
  if (args.text) {
    text = args.text
  } else if (args.path) {
    path = args.path
  } else if (args.positional?.length) {
    // 单参数: 看是路径还是文本
    const p = args.positional[0]
    if (p.length < 256 && !p.includes('\n') && (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('.'))) {
      path = p
    } else {
      text = p
    }
  } else if (args['input-tokens']) {
    inputTokens = parseInt(args['input-tokens'], 10)
  } else {
    console.error('Error: 需要输入. 使用 --help 查看用法.')
    process.exit(1)
  }

  const models = args.models
    ? args.models.split(',').map(s => s.trim()).filter(Boolean)
    : undefined

  const result = await estimate({
    text,
    path,
    inputTokens,
    models,
    outputTokens: args['output-tokens'] ? parseInt(args['output-tokens'], 10) : undefined,
    calls: args.calls ? parseInt(args.calls, 10) : 1,
    cacheHitRatio: args['cache-ratio'] ? parseFloat(args['cache-ratio']) : 0,
    displayCurrency: args.currency || 'USD',
  })

  if (args.json) {
    console.log(result.reportJson)
  } else {
    console.log(result.reportMd)
    console.log('')
    console.log('---')
    console.log('（加 --json 输出机器可读格式；加 --list-models 列出所有模型）')
  }
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
