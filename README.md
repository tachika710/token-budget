# 词元预算 (Token Budget)

通过读取**软件/游戏企划书**、**半成品项目**或**资料**，预估特定 LLM 模型的 token 消耗量，并按各家厂商官方定价实时预估计费。

支持 **DeepSeek Harness 插件** + **MCP 服务器** 双形态 — Claude Desktop / Cursor / Trae / Cline / DSH 等 AI 工具都能用。

## 这工具解决什么问题


- **从这份企划书到成品软件，要花多少 token × 多少轮调用？**
- **半成品代码 + bug 会不会让成本反向上升？**
- **多份参考资料到底帮我省了还是反而让我塞爆 context？**

这个工具就是回答这些的。算法基于真实研究数据（SWE-bench / Aider / Lost in the Middle / COCOMO II / Kernighan's Law）。

## 三件套

```
词元预算/
├── packages/
│   ├── core/           平台无关核心：模型表 / 定价表 / tokenizer / 文件计数 / 项目预算估算器
│   ├── dsh-plugin/     DeepSeek Harness 原生插件（注册为 Agent 工具）
│   └── mcp-server/     MCP 服务器（暴露给所有 MCP 客户端）
└── examples/
    └── 示例-企划书.md    示例输入
```

## 工具一览（8 个）

| 工具 | 说明 |
|---|---|
| `estimate-tokens` | 估算文本/路径的 token 数（单模型精确） |
| `estimate-cost` | 多模型对比，按厂商官方定价计费，输出 Markdown/JSON 报告 |
| `list-models` | 列出所有支持模型（可按厂商过滤） |
| `list-pricing` | 列出定价表（可查分段定价） |
| **`plan-project-budget`** | **核心**：企划书 + 半成品 + 资料 → 完整 8 阶段预算清单（P10/P50/P90） |
| **`refresh-pricing`** | 让 AI 自己用 WebFetch/WebSearch 去搜最新价（生成任务清单） |
| **`apply-pricing-update`** | 接收 AI 搜回来的价格，校验+合并到定价表 |
| **`estimate-github-project`** | 自动拉 GitHub 仓库（README + docs/ + 源码）→ 直接算预算 |

## 覆盖的厂商（截至 2026-08-16）

- **OpenAI** — GPT-4.1 / 4o / 5.x 全系 / o1 / o3 / o3-pro / o4-mini
- **Anthropic** — Claude Haiku/Sonnet/Opus/Fable 4.5~5
- **Google** — Gemini 1.5 / 2.0 / 2.5 / 3 / 3.1
- **DeepSeek** — V3.2 chat / R1 reasoner / V4 Flash / V4 Pro
- **阿里通义** — Qwen Turbo / Plus / Max / Long / Coder
- **智谱** — GLM-4.5 / 4.6 / 5
- **月之暗面** — Moonshot V1 8K/32K/128K / Kimi K2
- **字节豆包** — Doubao Pro 32K/128K / Flash
- **MiniMax** — abab6.5 / 7
- **百度文心** — ERNIE 4.0 Turbo / Speed / Lite
- **xAI** — Grok 3 / 4 / 4.1
- **Mistral** — Large / Medium / Small
- **Together / Groq / Cohere** — Llama 3.x / Command R+

> 定价变化频繁。内置表每季度更新一次；如需最新价，调用 `refresh-pricing` 让 AI 自己去搜。

---

## 核心算法（plan-project-budget）

不是"称文件大小"，而是把开发拆成 **8 个阶段** 估算每阶段 token × 调用轮数：

| # | 阶段 | 基准输入 K | 基准输出 K | 默认调用轮数 |
|---|------|-----------|-----------|---------|
| 1 | 需求分析与规格书 | 20 | 15 | 3 |
| 2 | 系统设计与架构 | 40 | 25 | 4 |
| 3 | 数据建模 | 30 | 20 | 3 |
| 4 | 核心代码生成 | 65 | 98 | 12 |
| 5 | UI 与前端实现 | 60 | 100 | 10 |
| 6 | 测试与 QA | 100 | 60 | 15 |
| 7 | 文档撰写与本地化 | 60 | 96 | 5 |
| 8 | 发布与运维配置 | 40 | 30 | 4 |

### 三类非线性影响（基于真实论文）

**[R1] 参考资料**（[Lost in the Middle, arxiv 2307.03172](https://arxiv.org/abs/2307.03172)）：
- 资料 < 32K tokens：净收益线性增长（最多省 40% 前期成本）
- 资料 > 32K tokens：每多 1K，有效信息衰减 60%（边际收益转负）
- **质量信号**：检测资料里有没有 API schema / 数据字典 / ER图 / OpenAPI — 命中给质量系数 ×1.5-2.0，纯散文资料再大也没用

**[R2] 半成品代码**（[SWE-bench 实测](https://github.com/lemoncrowhq/lemoncrow/blob/main/BENCHMARKS.md) + COCOMO II）：
- 「省」：已完成的阶段（has_tests/has_docs/has_ui 等）定向 -10~50%
- 「费」：每轮调用要塞代码进 context，开销 = `(LOC/10K)^1.2 × 5%`（SWE-bench 幂律）
- **U 形现象**：0% 完成贵，50% 完成最贵，100% 净 0

**[R3] bug / 技术债**（[Kernighan's Law](https://www.metaphorex.org/entries/kernighans-law/) + [DEVLoRe](https://dl.acm.org/doi/pdf/10.1145/3770581)）：
- `Cost_debug = 2.0 × Cost_write × (1+TD_ratio)`
- 检测 `TODO/FIXME/HACK/XXX` 注释密度（每 100 LOC > 1 个开始惩罚，最多 +50%）
- 测试覆盖率 < 10% → 额外 +15%
- bug 密度爆表时，**半成品比从零写还贵**

### 实测对比（同一份企划书）

| 场景 | 完成度 | bug 密度 | 测试覆盖 | 总 tokens | DeepSeek Flash |
|------|--------|---------|---------|----------|----------------|
| 无半成品（从零写） | 0% | — | — | 74M | ¥96 |
| 半成品（本仓库） | 93% | 0.15/100 | 9% | 16M | ¥20（省 79%） |
| **半成品 + bug 爆表** | 50% | 67/100 | 0% | **118M** | **¥152（贵 59%）** |

---

## 快速开始

### 1. 安装依赖

```bash
git clone <your-fork> 词元预算
cd 词元预算
npm install
```

### 2. 命令行直接用（不依赖 DSH / MCP）

```bash
# 估算文本
node packages/core/src/cli.js --text "你的企划书全文..." --models gpt-4o,deepseek-chat

# 扫描半成品项目目录
node packages/core/src/cli.js ./my-game-project --calls 100 --currency CNY

# 已知 token 数直接估
node packages/core/src/cli.js --input-tokens 120000 --output-tokens 8000 --calls 50

# 列出所有模型
node packages/core/src/cli.js --list-models
```

### 3. 接入 DeepSeek Harness

```bash
# 装到 web profile
dsh plugin --profile web add ./packages/dsh-plugin

# 重启 dsh web
dsh web
```

Agent 会自动获得 8 个工具。

### 4. 接入 Claude Desktop / Cursor / Trae / Cline（通过 MCP）

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "token-budget": {
      "command": "node",
      "args": ["E:/词元预算/packages/mcp-server/src/index.js"]
    }
  }
}
```

**Cursor / Trae / Cline / Continue / 任何支持 MCP 的客户端** 配置同上，改 `args` 路径即可。

环境变量：
- `TB_DISPLAY_CURRENCY` — 默认输出货币（`USD` 或 `CNY`）
- `TB_FORCE_HEURISTIC` — `1` 强制启发式估算（不依赖 gpt-tokenizer）
- `TB_FX_USD_TO_CNY` — USD→CNY 汇率覆盖

---

## 实际使用场景

### 场景 1：从企划书估完整开发预算

```
Agent: 我把企划书发给你了，半成品代码在 ./my-project，资料在 ./docs。
[调用 plan-project-budget(
  docPath: "./企划书.md",
  codePath: "./my-project",
  materialPath: "./docs",
  workflow: "aider_loop",
  displayCurrency: "CNY"
)]
→ 返回 8 阶段分解 + 15 个模型对比 + 每阶段折扣来源 + U 形 / bug 惩罚明细
```

### 场景 2：从 GitHub 仓库直接算

```
Agent: 帮我估一下把 vercel/next.js 重构的预算。
[调用 estimate-github-project(
  repo: "vercel/next.js",
  token: "ghp_xxx",               # 可选，匿名也行（60 次/小时）
  displayCurrency: "CNY",
  debug: true                     # 可选，带详细调试日志
)]
→ 自动拉 README + docs/ + 源码 → 8 阶段预算
```

### 场景 3：让 AI 自己刷新价格

```
Agent: 内置价格可能过时，请刷新 openai 和 deepseek 的价格。
[调用 refresh-pricing(providers: ["openai","deepseek"])]
  ← 返回任务清单：每家厂商的官方定价页 URL + schema
[AI 自己用 WebFetch 抓 openai.com/api/pricing, api-docs.deepseek.com]
[调用 apply-pricing-update(prices: [{modelId:"gpt-4o", input:2.5, output:10, ...}])]
  ← 返回"成功合并 N 个模型"
[调用 estimate-cost(...)]  → 用新价算
```

### 场景 4：长对话成本对比

```
已知输入 50K tokens，对话 1000 轮，请对比成本。
[调用 estimate-cost(inputTokens=50000, calls=1000, models=["deepseek-v4-flash","gpt-5.4-nano"])]
```

### 场景 5：调试为什么数据不对

任何 plan / estimate-github 调用加 `debug: true`，返回 `debugLogs` 数组：
- 每个文件的 TODO 密度（路径 + 计数 + 是否触发惩罚）
- 资料质量系数逐步展开（6 种结构化类型 × 权重 → 上限 2.0）
- 每阶段的折扣来源 + 惩罚来源（完成度 / 文件类型 / 资料 / context overhead / 技术债）

---

## Tokenizer 精度

| 模型族 | 方式 | 说明 |
|---|---|---|
| GPT-4o / 4.1 / 5 / o 系列 / Grok | **精确** (o200k_base via gpt-tokenizer) | 与 OpenAI API 完全一致 |
| GPT-4 / Llama 3 (近似) | **精确** (cl100k_base) | OpenAI 旧编码 |
| Claude 4.7+ (Opus/Sonnet 4.6/5 等) | **估算** (o200k × 1.3) | 新 tokenizer 未开源，按 Anthropic 公告 35% 放大 |
| Gemini | 启发式 | Google 未开源 |
| DeepSeek / Qwen / GLM / Kimi / 豆包等 | 启发式 | 中文 ~1.5 字符/token |
| 任意模型 | 启发式回退 | 当 gpt-tokenizer 未安装时自动启用 |

---

## 配置 DSH 插件

`packages/dsh-plugin/cordis.patch.yml`:

```yaml
- insert:
    - id: token-budget
      name: ${DSH_PLUGIN_DIR}/src/index.js
      config:
        displayCurrency: USD           # 默认输出货币
        defaultCacheHitRatio: 0         # 默认缓存命中比例
        defaultOutputRatio: 0.3         # 输出/输入比例
        forceHeuristic: false           # 强制启发式
        # pricingOverrides:             # 自定义定价覆盖
        #   gpt-4.1: { input: 2.00, output: 8.00, currency: USD }
```

---

## 项目结构

```
packages/
├── core/
│   ├── src/
│   │   ├── models.js            模型元数据（厂商、tokenizer、上下文长度）
│   │   ├── pricing.js           定价表（含分段定价、缓存价）
│   │   ├── pricing-tasks.js     AI 自主搜价任务生成器（refresh-pricing）
│   │   ├── tokenizer.js         精确 tokenizer + 启发式回退
│   │   ├── counter.js           文件/目录递归计数器 + 技术债扫描
│   │   ├── calculator.js        成本计算 + Markdown/JSON 报告
│   │   ├── project-estimator.js 8 阶段项目预算算法（[R1][R2][R3] 论文依据）
│   │   ├── github-fetcher.js    GitHub REST API 拉取器
│   │   ├── cli.js               独立 CLI 入口
│   │   └── index.js             统一入口
│   └── package.json
├── dsh-plugin/
│   ├── src/index.js             DSH 插件入口（注册 8 个工具给 Agent）
│   ├── cordis.patch.yml         配置补丁
│   └── package.json
└── mcp-server/
    ├── src/index.js             MCP 服务器（stdio 协议，8 个工具）
    └── package.json
```

---

## 发布与分享

详见 [PUBLISH.md](./PUBLISH.md)。三种分发方式：

### 1. npm 发布（推荐 — 别人 `npm install` 即可）

```bash
# 给包起个统一名
cd packages/core && npm version 0.1.0 && npm publish --access public
cd packages/mcp-server && npm version 0.1.0 && npm publish --access public
cd packages/dsh-plugin && npm version 0.1.0 && npm publish --access public
```

别人就能直接：
```json
{
  "mcpServers": {
    "token-budget": { "command": "npx", "args": ["-y", "@token-budget/mcp-server"] }
  }
}
```

### 2. GitHub Release（开源贡献 + Fork 改进）

```bash
# 推到你的 GitHub 仓库
git remote add origin https://github.com/<your-username>/token-budget.git
git push -u origin main

# 打 Release
gh release create v0.1.0 --title "v0.1.0 首发版" --notes-file CHANGELOG.md
```

别人用：
```bash
dsh plugin --profile web add https://github.com/<your-username>/token-budget/archive/refs/tags/v0.1.0.tar.gz
```

### 3. DSH 插件商店

发布到 npm 后，去 [DeepSeek Harness 插件市场](https://github.com/deepseek-ai/deepseek-harness) 提 PR 登记 `package.json` 即可。

---

## 许可证

MIT — 随便用、随便改、欢迎 PR。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — Cordis 插件系统
- [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) — 纯 JS BPE tokenizer
- [Model Context Protocol](https://modelcontextprotocol.io) — 通用 AI 工具协议
- [Lost in the Middle](https://arxiv.org/abs/2307.03172) — 长上下文衰减曲线
- [SWE-bench](https://www.swebench.com/) — 真实 issue 修复 token 实测数据
- [COCOMO II](https://www.iceaaonline.com/wp-content/uploads/2017/09/SOF07-Reifer.pdf) — 软件维护成本模型
- 定价数据来源：各厂商官方定价页（截至 2026-08-16）
