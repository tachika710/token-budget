# @token-budget/dsh-plugin

DeepSeek Harness 插件 — 通过读取企划书 / 半成品项目 / 资料，预估 LLM token 消耗量并按各家定价实时计费。

## 安装

```bash
dsh plugin --profile web add @token-budget/dsh-plugin@0.1.0
dsh web
```

或本地开发：

```bash
dsh web --patch ./cordis.patch.yml
```

## 注册给 Agent 的工具

| 工具名 | 用途 |
|---|---|
| `estimate-tokens` | 估算单模型 token 数 |
| `estimate-cost` | 多模型对比 + Markdown/JSON 成本报告 |
| `list-models` | 列出所有支持模型 |
| `list-pricing` | 列出定价（含分段定价） |

## 配置

`cordis.patch.yml`:

```yaml
- insert:
    - id: token-budget
      name: ${DSH_PLUGIN_DIR}/src/index.js
      config:
        displayCurrency: USD              # USD 或 CNY
        defaultCacheHitRatio: 0            # 0-1
        defaultOutputRatio: 0.3            # 输出/输入比
        forceHeuristic: false              # 强制启发式
        pricingOverrides:                  # 自定义定价
          gpt-4.1: { input: 2.00, output: 8.00, currency: USD }
```

## Agent 调用示例

用户对 Agent 说：
> 我的企划书在 `./企划书.md`，估算用 GPT-4o / Claude Sonnet 4.6 / DeepSeek-chat 各分析 100 次的成本，给我一份对比报告

Agent 会自动调用：
```
estimate-cost({
  path: "./企划书.md",
  models: ["gpt-4o", "claude-sonnet-4.6", "deepseek-chat"],
  calls: 100,
  displayCurrency: "CNY"
})
```

返回 Markdown 报告：

```
# Token 消耗 & 成本预估报告

- **目标货币**: CNY
- **输入 tokens**: 12,345
- **调用次数**: 100

## 按总成本排序（CNY）

| # | 模型 | 厂商 | 单次成本 | 总成本 | ... |
| 1 | DeepSeek V3.2 | DeepSeek | ¥0.0033 | ¥0.33 | ... |
| 2 | GPT-4o | OpenAI | ¥0.030 | ¥3.00 | ... |
| 3 | Claude Sonnet 4.6 | Anthropic | ¥0.041 | ¥4.10 | ... |

**最便宜**: DeepSeek V3.2 (chat) — ¥0.33
**价差倍数**: 12.4×
```

## 依赖

- `@token-budget/core` (workspace) — 核心逻辑
- `@deepseek-ai/dsh-tools` (peer, DSH 运行时提供) — `defineTool`
- `gpt-tokenizer` (optional) — 精确 tokenizer

## 卸载自动清理

通过 `ctx.effect()` 注册 disposer，插件卸载时 Cordis 自动撤销所有工具注册（支持 HMR 热替换）。

## 许可证

MIT
