# 贡献指南

欢迎提 PR、issue、新模型、新算法依据。这个工具的算法是基于公开论文的，欢迎用更新的研究数据改进。

## 提 PR 前必做

### 1. 跑测试

```bash
cd packages/core
node --test test/core.test.js
# 必须 19/19 通过（或更多，如果你加了新测试）
```

### 2. 语法检查

```bash
node --check packages/core/src/*.js
node --check packages/dsh-plugin/src/*.js
node --check packages/mcp-server/src/*.js
```

### 3. MCP smoke test（如改了工具 schema）

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node packages/mcp-server/src/index.js
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node packages/mcp-server/src/index.js
# 必须返回 8 个工具
```

### 4. 更新文档

- 改了 `MODELS` 数组 → 更新 README 的"覆盖的厂商"
- 加了新工具 → 更新 README 的"工具一览"和 PUBLISH.md 的"DSH 商店收录清单"
- 改了 `pricing.js` → 更新 `effectiveDate`
- 改了算法 → 更新 [project-estimator.js](packages/core/src/project-estimator.js) 顶部注释里的 `[R1][R2][R3]` 论文依据

## 提 PR 流程

```bash
# 1. Fork & clone
git clone https://github.com/<你的用户名>/token-budget.git
cd token-budget

# 2. 加 upstream 同步最新
git remote add upstream https://github.com/<原作者>/token-budget.git
git fetch upstream

# 3. 开分支
git checkout -b fix/your-bug upstream/main

# 4. 改代码 + 跑测试
npm install
cd packages/core && node --test test/core.test.js && cd ../..

# 5. commit & push
git add .
git commit -m "fix: 修复 xxx"
git push origin fix/your-bug

# 6. 在 GitHub 网页上点 "Compare & pull request"
```

## Commit 信息约定

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` 新功能（如 `feat: 加 estimate-github-project 工具`）
- `fix:` bug 修复（如 `fix: 货币折算 CNY 方向错误`）
- `docs:` 文档（如 `docs: 更新 README 工具表到 8 个`）
- `refactor:` 重构（如 `refactor: 把 debt 扫描抽到 counter.js`）
- `test:` 测试（如 `test: 加 plan-project-budget U 形现象测试`）
- `chore:` 杂事（如 `chore: bump 依赖版本`）

## 加新模型

1. 编辑 [packages/core/src/models.js](packages/core/src/models.js) 的 `MODELS` 数组
2. 编辑 [packages/core/src/pricing.js](packages/core/src/pricing.js) 的 `PRICING` 数组
3. 跑 `node packages/core/src/cli.js --list-models` 验证
4. 更新 README 的"覆盖的厂商"

## 加新算法依据

如果你找到一篇更准确的论文，欢迎替换 `[R1][R2][R3]` 中的某个公式。PR 描述里附：

- 论文 URL
- 原公式 + 你替换后的公式
- 对照测试结果（替换前后的 token 数 / 成本对比）

## 报 bug

提 issue 时务必附 `debug: true` 调出来的 `debugLogs` 数组，方便定位是哪个阶段 / 哪个文件算错了。

## 行为准则

- 友善、尊重、对事不对人
- 欢迎新手提问（即便看起来"很基础"）
- 论文 / 数据要标来源，不要编
