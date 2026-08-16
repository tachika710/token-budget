# 发布与分享指南

本工具采用 monorepo 三包结构，每个包可以独立发布。三种分发方式任选其一或全上：

| 方式 | 适合谁 | 别人怎么用 | 让别人改 |
|------|--------|-----------|---------|
| **npm 发布** | 所有 MCP 客户端用户 | `npx` 一行接入 | Fork → PR |
| **GitHub Release** | 想看源码 / 自己编译的人 | 下载 tarball 或 git clone | 提 PR / issue |
| **DSH 插件商店** | DeepSeek Harness 用户 | `dsh plugin add <name>` | 同上 |

---

## 0. 发布前检查清单

每次发版前都跑一遍：

```bash
# 1. 语法检查所有源文件
node --check packages/core/src/*.js
node --check packages/dsh-plugin/src/*.js
node --check packages/mcp-server/src/*.js

# 2. 单元测试
cd packages/core && node --test test/core.test.js && cd ../..

# 3. MCP 服务器 smoke test（应输出 8 个工具）
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node packages/mcp-server/src/index.js
echo '{"jsonrpc":"2.0","method":"notifications/initialized"}' | node packages/mcp-server/src/index.js
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node packages/mcp-server/src/index.js

# 4. 跑一个真实预算（无 token 也能跑）
node -e "import('./packages/core/src/index.js').then(async m => {
  const fs = await import('node:fs/promises')
  const txt = await fs.readFile('./examples/示例-企划书.md','utf8')
  const r = await m.planProjectBudget({ docText: txt, displayCurrency: 'CNY', workflow: 'aider_loop' })
  console.log('总 tokens:', r.totals.tokens, 'DeepSeek Flash: ¥' + r.perModelBudget['deepseek-v4-flash'].total.toFixed(2))
})"

# 5. 跑 GitHub 拉取 smoke test（需联网）
node --use-system-ca -e "import('./packages/core/src/index.js').then(async m => {
  const r = await m.fetchAndPlanGitHub({ repo: 'paulirish/git-open', planOptions: { displayCurrency:'CNY' } })
  console.log(r.github.fullName, '总 tokens:', r.totals.tokens)
})"
```

确认检查清单：
- [ ] `packages/core/src/pricing.js` 中 `effectiveDate` 已更新到最新季度
- [ ] `MODELS` 数组覆盖了所有当前在售模型
- [ ] MCP `tools/list` 返回 **8** 个工具
- [ ] 8 个工具的 schema 都能通过 JSON Schema 校验
- [ ] `packages/*/package.json` 版本号同步 bump
- [ ] README 的"工具一览"和"覆盖厂商"两节与代码一致

---

## 1. npm 发布（最推荐 — 别人 `npx` 一行接入）

### 1.1 准备 npm 账号

```bash
# 首次：注册 + 登录
npm adduser    # 或 npm login
npm whoami     # 验证已登录
```

### 1.2 检查包名是否被占

```bash
npm view @token-budget/core
npm view @token-budget/mcp-server
npm view @token-budget/dsh-plugin
# 404 就代表没人占，可以用
```

如果你的包名被占（比如 `@token-budget` scope 被抢了），改 `packages/*/package.json` 里的 `name` 字段为你自己的 scope，比如 `@yourname/token-budget-core`。

### 1.3 三个子包依次发布

```bash
# 顺序很重要：core 先发，因为 mcp-server / dsh-plugin 依赖它
cd packages/core
npm version 0.1.0           # 或 0.1.1 / 0.2.0，遵循 semver
npm publish --access public
cd ../..

cd packages/mcp-server
npm version 0.1.0
npm publish --access public
cd ../..

cd packages/dsh-plugin
npm version 0.1.0
npm publish --access public
cd ../..
```

### 1.4 别人怎么用

**MCP 客户端**（Claude Desktop / Cursor / Trae / Cline）配置：

```json
{
  "mcpServers": {
    "token-budget": {
      "command": "npx",
      "args": ["-y", "@token-budget/mcp-server"]
    }
  }
}
```

**DSH 用户**：
```bash
dsh plugin --profile web add @token-budget/dsh-plugin@0.1.0
```

**Node 开发者**：
```bash
npm install @token-budget/core
```
```js
import { planProjectBudget, fetchAndPlanGitHub } from '@token-budget/core'
```

---

## 2. GitHub 开源（让别人能 Fork 改进）

### 2.1 初始化 + 推送

如果还没推到 GitHub：

```bash
# 1. 在 github.com 网页上创建空仓库（不要勾 README / .gitignore / license，避免冲突）
# 2. 本地初始化
cd 词元预算
git init
git add .
git commit -m "feat: initial release v0.1.0"

# 3. 关联远程并推送
git remote add origin https://github.com/<你的用户名>/token-budget.git
git branch -M main
git push -u origin main
```

### 2.2 添加开源必备文件

仓库根目录要有这几个文件，别人才会放心用：
- `LICENSE` — MIT（已在 `package.json` 声明，加个 LICENSE 文件即可）
- `README.md` — 已有
- `PUBLISH.md` — 本文件
- `CONTRIBUTING.md` — 告诉别人怎么提 PR（见下方模板）
- `.github/ISSUE_TEMPLATE/bug_report.md` — bug 报告模板
- `.github/ISSUE_TEMPLATE/feature_request.md` — 功能请求模板

### 2.3 打 GitHub Release

```bash
# 1. 打 tag
git tag -a v0.1.0 -m "v0.1.0 首发版"

# 2. 推 tag
git push origin v0.1.0

# 3. 用 gh CLI 创建 Release（自动从 commits 生成 changelog）
gh release create v0.1.0 --generate-notes --title "v0.1.0 首发版"

# 4. 附带 tarball（不想发布到 npm 也能让用户下载）
npm pack --workspace @token-budget/core
npm pack --workspace @token-budget/mcp-server
gh release upload v0.1.0 tokenbudget-core-0.1.0.tgz tokenbudget-mcp-server-0.1.0.tgz
```

### 2.4 别人怎么用

```bash
# 直接 clone 跑
git clone https://github.com/<你的用户名>/token-budget.git
cd token-budget
npm install
node packages/core/src/cli.js --list-models

# 或下载 Release tarball 解压
gh release download v0.1.0 --repo <你的用户名>/token-budget
```

### 2.5 别人怎么改（贡献流程）

```bash
# 1. Fork 你的仓库到他的 GitHub
# 2. clone 他自己的 fork
git clone https://github.com/<贡献者>/token-budget.git
cd token-budget

# 3. 加你的仓库为 upstream，同步最新
git remote add upstream https://github.com/<你的用户名>/token-budget.git
git fetch upstream
git checkout -b fix/some-bug upstream/main

# 4. 改代码 + 跑测试
npm install
cd packages/core && node --test test/core.test.js

# 5. 提 PR
git push origin fix/some-bug
# 在 GitHub 网页上点 "Compare & pull request"
```

建议在 `CONTRIBUTING.md` 里写清楚：
- 测试必须通过
- 新增模型 / 工具必须更新 README 工具表
- 改动 pricing.js 必须更新 `effectiveDate`

---

## 3. DSH 插件商店（DeepSeek Harness 用户专属）

### 3.1 前置：发布到 npm

DSH 插件商店要求插件已发布到 npm，所以先完成第 1 步。

### 3.2 提交到 DSH 官方插件列表

DSH 官方在 [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 维护一个插件目录。提 PR 加一行：

```yaml
# 在 deepseek-harness 仓库的 plugins/registry.yml 里加：
- id: token-budget
  name: 词元预算
  description: 企划书 → 成品 AI 预算估算（8 阶段 / 多模型对比 / GitHub 拉取）
  npm: @token-budget/dsh-plugin
  homepage: https://github.com/<你的用户名>/token-budget
  tags: [cost, budget, tokens, pricing, mcp]
```

### 3.3 用户安装

```bash
# 装到 web profile
dsh plugin --profile web add @token-budget/dsh-plugin@0.1.0

# 重启 DSH
dsh web
```

之后 Agent 自动获得 8 个工具。

---

## 4. 版本管理（semver）

| 变更类型 | 版本 bump | 例子 |
|---------|----------|------|
| 配置 schema 破坏性变更（工具参数重命名） | MAJOR (1.0.0 → 2.0.0) | 工具参数改名 |
| 新增模型 / 新增工具 / 新增配置项（向后兼容） | MINOR (0.1.0 → 0.2.0) | 加 `estimate-github-project` |
| 修正定价表 / 修复 bug / 文档改进 | PATCH (0.1.0 → 0.1.1) | 修 pricing 表 |

三个子包版本保持同步发布。`packages/core` 升级时，`mcp-server` 和 `dsh-plugin` 也 bump 同样的版本号并更新依赖。

---

## 5. 自动化发布（GitHub Actions）

`.github/workflows/publish.yml`：

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'           # 推 v0.1.0 这样的 tag 时触发

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write    # 用于创建 GitHub Release
      id-token: write     # 用于 npm provenance
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'
      - run: npm install
      - run: node --check packages/core/src/*.js
      - run: cd packages/core && node --test test/core.test.js

      # 三个包依次发布
      - run: npm publish --access public --workspace @token-budget/core
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - run: npm publish --access public --workspace @token-budget/mcp-server
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      - run: npm publish --access public --workspace @token-budget/dsh-plugin
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # 自动建 GitHub Release + Changelog
      - run: gh release create ${{ github.ref_name }} --generate-notes --title ${{ github.ref_name }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 5.1 配置 NPM_TOKEN

1. 登录 npm → Access Tokens → Generate New Token（Type: Automation）
2. GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret
3. Name: `NPM_TOKEN`，Value: 粘贴上面的 token

### 5.2 一键发版

```bash
git tag v0.1.0
git push origin v0.1.0
# GitHub Actions 自动跑测试 → 发 npm → 建 Release
```

---

## 6. 让别人方便提 issue（必备模板）

`.github/ISSUE_TEMPLATE/bug_report.md`：

```markdown
---
name: Bug 报告
about: 报告估算结果不对 / 工具调用失败
---

## 复现步骤
1. 调用 `plan-project-budget(...)` 参数：...
2. 期望输出：...
3. 实际输出：...

## 调试日志
请加 `debug: true` 重新跑一次，把 `debugLogs` 数组贴这里：

\`\`\`json
[...]
\`\`\`

## 环境
- 模型：[e.g. gpt-4o]
- 工作模式：[chat / aider_loop / ide_assist / autonomous]
- Node 版本：
```

`.github/ISSUE_TEMPLATE/feature_request.md`：

```markdown
---
name: 功能请求
about: 建议加新模型 / 新工具 / 新算法依据
---

## 想解决的问题
...

## 期望的方案
...

## 算法依据（可选）
- 论文 URL：...
- 公式：...
```

---

## 7. 已知限制（README 必须声明）

1. **定价可能过期** — 用 `refresh-pricing` 让 AI 自己刷新，或配置 `pricingOverrides`
2. **Claude 新 tokenizer 未开源** — 按 o200k × 1.3 估算（误差 ±10%）
3. **Gemini / 国内模型无精确 tokenizer** — 启发式估算（误差 ±10%）
4. **大文件 > 5MB 自动跳过** — `MAX_FILE_SIZE` 不可调（避免内存爆）
5. **二进制文件按扩展名 + 内容双检跳过** — `.lock` / `.map` 已加入跳过列表
6. **GitHub 匿名 API 60 次/小时** — 传 `token` 参数提权至 5000 次/小时
7. **未支持的模型** — 提 issue 加进 `MODELS` 表

---

## 8. 推广素材（可选但加分）

提交 PR 到 DSH 社区插件列表时附上：

- **1 张截图**：Agent 调用 `plan-project-budget` 后输出的 8 阶段预算报告
- **1 段 GIF**（30s 内）：从 `dsh plugin add` 到调用 `estimate-github-project` 全流程
- **100 字简述**：解决什么问题、跟纯"称重"工具的差异、3 个关键论文依据

GitHub 仓库的 `topics` 字段建议加：
```
llm, token-budget, cost-estimation, mcp, dsh-plugin, ai-coding, swe-bench, project-estimation
```
