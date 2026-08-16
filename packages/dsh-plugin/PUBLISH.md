# @token-budget/dsh-plugin 发布（DSH 专属）

> 通用发布流程见仓库根目录 [PUBLISH.md](../../PUBLISH.md)。本文件只覆盖 DSH 插件商店的额外要求。

## DSH 插件商店收录清单

提交 PR 到 [DeepSeek Harness 社区插件列表](https://github.com/deepseek-ai/deepseek-harness) 前检查：

- [ ] `packages/dsh-plugin/package.json` 含 `name` / `version` / `description` / `keywords` / `license`
- [ ] `package.json.dsh.bundle.patch` 指向 `cordis.patch.yml`
- [ ] `package.json.dsh.displayName` 友好可读（建议：`词元预算`）
- [ ] README 含安装命令、用法示例、前置依赖、已知限制
- [ ] **不依赖外部网络服务**（除非显式声明；`estimate-github-project` 需要 `token` 可选参数，符合）
- [ ] **不修改 DSH 源码**（仅通过 `ctx.tools.register` / `ctx.command.register` 注册）
- [ ] 配置 schema 用 `Schema.object` 声明并校验
- [ ] 测试覆盖核心路径（`apply` → `register` → `execute` → `dispose`）
- [ ] **8 个工具全部能正常调用**（`estimate-tokens` / `estimate-cost` / `list-models` / `list-pricing` / `plan-project-budget` / `refresh-pricing` / `apply-pricing-update` / `estimate-github-project`）

## DSH 商店配置示例

`packages/dsh-plugin/package.json`：

```json
{
  "name": "@token-budget/dsh-plugin",
  "version": "0.1.0",
  "description": "企划书 → 成品 AI 预算估算（8 阶段 / 多模型对比 / GitHub 拉取 / 实时价格刷新）",
  "main": "src/index.js",
  "type": "module",
  "keywords": ["dsh", "dsh-plugin", "token", "budget", "cost", "pricing", "llm", "mcp"],
  "license": "MIT",
  "dsh": {
    "displayName": "词元预算",
    "bundle": {
      "patch": "cordis.patch.yml"
    }
  }
}
```

DSH 官方 `plugins/registry.yml`：

```yaml
- id: token-budget
  name: 词元预算
  description: 企划书 → 成品 AI 预算估算（8 阶段 / 多模型对比 / GitHub 拉取 / 实时价格刷新）
  npm: @token-budget/dsh-plugin
  homepage: https://github.com/<your-username>/token-budget
  tags: [cost, budget, tokens, pricing, mcp, github]
```

## 提交 PR 时附上

1. **1 张截图**：Agent 调用 `plan-project-budget` 后输出的完整预算报告（8 阶段表 + 多模型对比）
2. **1 段 GIF**（30s 内）：从 `dsh plugin --profile web add @token-budget/dsh-plugin@0.1.0` 到 Agent 调用 `estimate-github-project` 全流程
3. **100 字简述**：解决什么问题、跟 dsh-custom-tool 等纯"称重"工具的差异、3 个关键论文依据（Lost in the Middle / SWE-bench / Kernighan's Law）

## 版本同步

`packages/dsh-plugin/package.json` 的版本号必须与 `packages/core/package.json` 同步发布，因为前者依赖后者（`"@token-budget/core": "*"`）。如果改了 core 的接口，必须同时 bump dsh-plugin 的版本并更新依赖。
