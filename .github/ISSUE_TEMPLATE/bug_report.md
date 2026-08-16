---
name: Bug 报告
about: 报告估算结果不对 / 工具调用失败 / 文档错误等问题
title: "[Bug] 简短描述"
labels: bug
assignees: ''

---

## 复现步骤

1. 我调用了哪个工具（选择一个）：
   - [ ] `estimate-tokens`
   - [ ] `estimate-cost`
   - [ ] `plan-project-budget`
   - [ ] `estimate-github-project`
   - [ ] `refresh-pricing` / `apply-pricing-update`
   - [ ] 其他：

2. **调用参数**（复制粘贴完整参数对象，别只写一小部分）：

```json
{
  "docPath": "...",
  "codePath": "...",
  "workflow": "aider_loop",
  "displayCurrency": "CNY"
}
```

3. 期望输出：
   （写清楚你觉得应该出来什么，比如「总 tokens 应该比 10M 少」「阶段 X 不应该有 bug 惩罚」）

4. 实际输出：
   （粘贴实际返回的 Markdown 片段或错误堆栈）

```
在这里贴错误信息或输出片段...
```

## 调试日志

> **如果是 `plan-project-budget` / `estimate-github-project` 相关，请**必须**加 `debug: true` 重新跑一次，把 `debugLogs` 数组贴这里**。没有 `debugLogs` 我没法定位。

```json
[
  粘贴 debugLogs 数组（从完整 JSON 里复制即可；太长可以只贴最后 20 行 + 你觉得异常的行）
]
```

## 环境信息

- 模型：[e.g. `gpt-4o` / `deepseek-v4-flash` / 多个模型]
- 工作模式：[`chat` / `aider_loop` / `ide_assist` / `autonomous`]
- 接入方式：[`CLI` / `DSH 插件` / `Claude Desktop MCP` / `Cursor MCP` / `Trae MCP` / 其他]
- Node 版本：（`node --version`）
- 本项目版本 / commit：（`git rev-parse HEAD` 或 `v0.1.0`）

## 其他说明

- 复现的输入文件（企划书/代码）能分享吗？如果能：
  - 是的，附在 issue 后面（压缩包 / gist 链接）
  - 不行，我会按你的提示造一个最小可复现的示例再发评论
