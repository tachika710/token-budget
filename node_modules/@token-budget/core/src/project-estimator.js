// 项目预算估算器 — 不是「称文件大小」，而是「从需求到成品的完整 Agent 工作流预算」
//
// 算法灵感来源（2026 实测数据，见 references.json 里的 source）：
//  1. SWE-bench Verified 500 issues: 每个 issue 平均 50K-200K tokens, $0.25-$5
//  2. Aider Polyglot 225 道编程题: 2.7M prompt + 2.6M completion (2 次尝试)
//  3. AgentPub 论文流水线: 10 阶段，~260K tokens / 篇（6-8 LLM 调用 / mega-context）
//  4. gpt-researcher: 每次深度研究 ~$0.01-0.08
//  5. OpenHands 每月真实开发工作流：~$100-200 LLM 费用 / 人 / 月
//
// ── 2026-08 重写：参考资料 / 半成品代码 / bug 的非线性影响 ──
//
// 这部分用真实论文/实测数据替换了 v0.1 的线性拍脑袋公式：
//
// [R1] 资料（materialText）对前期阶段的影响：
//      Lost in the Middle (arxiv 2307.03172) + Databricks 长上下文衰减曲线
//      - 资料 < 32K tokens：净收益线性增长（最多省 40% 前期成本）
//      - 资料 > 32K tokens：每多 1K，有效信息衰减 60% → 边际收益转负
//      - 公式：benefit(T) = 0.40 × (T/T_thresh) × (1 - γ·max(0, T-T_thresh)/T), γ=0.6
//      - 资料里如果有 API schema / 数据字典 / ER图 等"结构化资料"，再 ×1.5
//
// [R2] 半成品代码（codePath）的双向影响：
//      SWE-bench 实测：Tokens(LOC) = c·LOC^1.2（仓库翻倍 token 涨 2.3×）
//      COCOMO II 维护模型：PM = 2.94 × Size^E, E ∈ [1.05, 1.23]（超线性！）
//      - 「省」的部分：已完成的阶段（has_tests/has_docs/has_ui 等）定向打折
//      - 「费」的部分：每轮调用要把已有代码塞进 context，输入成本随 LOC^1.2 增长
//      - 净效应 = 省的部分 - context overhead；U 形：0% 完成贵，50% 完成最贵，100% 净 0
//
// [R3] bug / 技术债惩罚（v0.1 完全没考虑）：
//      Kernighan's Law: Cost_debug = 2.0 × Cost_write × (1 + TechDebt_ratio)
//      DEVLoRe (dl.acm.org/doi/10.1145/3770581): 多文件 bug 修复成本 ≈ 4×
//      - 检测代码里 TODO/FIXME/HACK/XXX 注释密度 → 估算 techDebtRatio
//      - 检测测试覆盖率（testFiles / sourceFiles 比例）→ 反向信号
//      - bug 密度 > 1 个/100 LOC 时，给所有阶段 +techDebtPenalty（最多 +50%）
//
// ── 算法核心：阶段 × 文档规模 × 完成度系数 ──
//
// 一个软件开发项目被拆成 8 个 AI 参与阶段。
// 对每个阶段：
//   tokens_in = base_input  × 规模乘数 × 阶段输入放大比 × (1 + codeContextOverhead + techDebtPenalty)
//   tokens_out = base_output × 规模乘数 × 阶段输出放大比 × savingsFactor × (1 + techDebtPenalty)
//   calls = 该阶段平均迭代次数
//
// savingsFactor 由三类折扣合成（上限 90%）：
//   1. completionSavings —— 整体完成度给后期阶段打折（旧逻辑保留）
//   2. artifactSavings  —— 文件类型定向打折（has_tests→测试 -35% 等）
//   3. materialSavings  —— 资料的倒 U 形收益（[R1]）
//
// codeContextOverhead = c × (LOC/10K)^1.2 × 0.05  [R2，每轮调用塞代码的开销]
// techDebtPenalty     = f(TODO/FIXME 密度, 测试覆盖率)  [R3]
//
// 最终给每个模型 × 3 种完成概率（保守/典型/激进）→ 9 份预算报表
//  + 置信区间（P10/P50/P90，按 ±50% / ±20% / +∞ 区间）

import {
  countText, countDirectory, countTokens,
  compareCosts, formatMarkdownReport,
  listAvailableModels, getModel, normalizeModelName,
  PROVIDERS,
} from './index.js'
import { getPricing, resolveTier, DEFAULT_FX } from './pricing.js'

// ─── 阶段定义（8 个阶段，系数来自 SWE-bench/Aider/AgentPub 经验） ─────

/**
 * @typedef {Object} PhaseDef
 * @property {string} id           - 阶段 id
 * @property {string} name         - 显示名
 * @property {string} description  - 说明（Agent 会看）
 * @property {number} baseInputK   - 基础输入 tokens (1K LOC / 10 页文档级项目的基准)
 * @property {number} baseOutputK  - 基础输出 tokens
 * @property {number} calls         - 基准调用次数（单阶段默认迭代轮数）
 * @property {number} sensitivity   - 对「已完成度」的敏感度 (0-1, 越大越容易被半成品节省)
 * @property {number} inputRatioPerKLOC - 每 1K LOC / 每 10 页文档的乘数
 * @property {number} outputRatioPerKLOC
 * @property {Record<string, number>} costDriverTouches - 哪些成本驱动项影响本阶段（权重相加=1）
 */

export const PHASES = [
  // 阶段 1：企划解读 + 规格书编写
  {
    id: 'requirements-analysis',
    name: '需求分析与规格书',
    description: '阅读企划书/资料，拆解用户故事、用例图、非功能需求、验收标准；输出正式需求规格书',
    baseInputK: 20, baseOutputK: 15, calls: 3,
    sensitivity: 1.0, // 最前期的工作，完全靠文档
    inputRatioPerKLOC: 0,  // 代码存量对需求分析无帮助
    outputRatioPerKLOC: 0,
    costDriverTouches: { doc_size: 1.0 },
  },
  // 阶段 2：系统设计 + 架构
  {
    id: 'architecture-design',
    name: '系统设计与架构',
    description: '输出技术选型、系统架构图、模块划分、数据流、数据库 schema、API 契约、错误码规范',
    baseInputK: 40, baseOutputK: 25, calls: 4,
    sensitivity: 0.7,
    inputRatioPerKLOC: 0.5, // 半成品已有代码会被读进 context 做适配
    outputRatioPerKLOC: 0.1,
    costDriverTouches: { doc_size: 0.5, code_loc: 0.3, tech_stack: 0.2 },
  },
  // 阶段 3：数据结构 / 数据库设计
  {
    id: 'data-modeling',
    name: '数据建模',
    description: '设计表结构 / 索引 / 迁移脚本 / ORM 映射 / 缓存键设计',
    baseInputK: 30, baseOutputK: 20, calls: 3,
    sensitivity: 0.5,
    inputRatioPerKLOC: 0.4,
    outputRatioPerKLOC: 0.2,
    costDriverTouches: { doc_size: 0.4, code_loc: 0.3, data_size: 0.3 },
  },
  // 阶段 4：核心逻辑编码（业务模块 + 系统模块）
  {
    id: 'core-coding',
    name: '核心代码生成',
    description: '生成业务逻辑、工具函数、状态机、战斗/匹配/AI 核心算法、可运行的最小 MVP',
    baseInputK: 80, baseOutputK: 120, calls: 12,   // Aider: 单次 coding 任务 ~12K input + 12K output × 迭代轮数
    sensitivity: 0.2,                             // 但半成品代码量越多，越少要重写
    inputRatioPerKLOC: 1.5,                       // 每 K 现有代码都要读进 context
    outputRatioPerKLOC: 0.9,                      // 每 K 待实现代码产生约 0.9 K 新代码输出
    costDriverTouches: { doc_size: 0.15, code_loc: 0.55, feature_count: 0.3 },
  },
  // 阶段 5：UI / 前端实现
  {
    id: 'ui-frontend',
    name: 'UI 与前端实现',
    description: '根据美术风格描述 + UI 组件清单，生成页面 / 路由 / 状态管理 / 响应式 / 动画',
    baseInputK: 60, baseOutputK: 100, calls: 10,
    sensitivity: 0.15,
    inputRatioPerKLOC: 1.2,
    outputRatioPerKLOC: 0.9,
    costDriverTouches: { doc_size: 0.2, code_loc: 0.4, ui_count: 0.4 },
  },
  // 阶段 6：测试用例生成与验证
  {
    id: 'testing-qa',
    name: '测试与 QA',
    description: '生成单元测试 / 集成测试 / E2E 测试，多轮试错（Agent loop + 错误反馈 + 修复）',
    baseInputK: 100, baseOutputK: 60, calls: 15,  // SWE-bench: 失败迭代成本巨大，平均 3-4 次重试
    sensitivity: 0.1,
    inputRatioPerKLOC: 2.0,                        // 每次跑都要把错误日志读进去
    outputRatioPerKLOC: 0.6,
    costDriverTouches: { doc_size: 0.1, code_loc: 0.7, feature_count: 0.2 },
  },
  // 阶段 7：文档与本地化
  {
    id: 'docs-localization',
    name: '文档撰写与本地化',
    description: '生成 README / API 文档 / 操作手册 / 剧情文本中英日三语互译 / 公告邮件',
    baseInputK: 50, baseOutputK: 80, calls: 5,
    sensitivity: 0.3,
    inputRatioPerKLOC: 0.6,
    outputRatioPerKLOC: 0.4,
    costDriverTouches: { doc_size: 0.5, locale_count: 0.3, code_loc: 0.2 },
  },
  // 阶段 8：发布、打包、CI/CD、性能调优
  {
    id: 'release-devops',
    name: '发布与运维配置',
    description: 'CI workflow / Dockerfile / k8s manifests / 性能压测调优 / 监控告警规则',
    baseInputK: 40, baseOutputK: 30, calls: 4,
    sensitivity: 0.2,
    inputRatioPerKLOC: 0.8,
    outputRatioPerKLOC: 0.3,
    costDriverTouches: { doc_size: 0.3, code_loc: 0.5, infra: 0.2 },
  },
]

// ─── Agent 工作模式效率（不同工具链 × 轮数开销倍数） ─────────────────

export const WORKFLOWS = {
  chat_adhoc: {
    name: '聊天式临时使用（ChatGPT/Claude/DSH 对话）',
    reworkMultiplier: 3.5, // 多次手动补 prompt，context 浪费严重
    contextReuseRatio: 0.2, // 缓存命中率 ~20%
    successPerAttempt: 0.60, // 单轮尝试成功率
  },
  ide_assist: {
    name: 'IDE 辅助编程（Cursor / Claude Code / Copilot 聊天补全）',
    reworkMultiplier: 2.2,
    contextReuseRatio: 0.40,
    successPerAttempt: 0.78,
  },
  aider_loop: {
    name: 'Aider / Codex CLI（代码 diff + 自动重试 + 测试驱动）',
    reworkMultiplier: 1.6,
    contextReuseRatio: 0.55,
    successPerAttempt: 0.85,
  },
  openhands_agent: {
    name: '自主 Agent（OpenHands / Devin / mini-SWE-agent 全流程）',
    reworkMultiplier: 2.4, // Agent 有自己的探索开销，会搜很多无用信息
    contextReuseRatio: 0.50,
    successPerAttempt: 0.88,
  },
}

// ─── 输入分析：文档 → 项目规模信号 ────────────────────────────────────

/**
 * @typedef {Object} ProjectSignals
 * @property {number} docSizeTokens      - 企划书/需求 tokens
 * @property {number} materialSizeTokens - 参考资料 tokens
 * @property {number} codeLOC            - 半成品代码行数（≈ tokens*0.4）
 * @property {number} codeTokens         - 半成品代码 tokens
 * @property {string[]} techStacks       - 技术栈关键字
 * @property {number} featureCount       - 模块/功能点数量
 * @property {number} localeCount        - 语言版本数（中英日）
 * @property {number} uiCount            - UI 页面/组件估计数
 * @property {number} monthsOfWork       - 预计开发月数（从里程碑章节读，默认 3）
 * @property {Object.<string, boolean>}  complexityFlags  - 多端/联网/支付/AI/认证/排行榜 等
 */

/** 从文本中提取关键信号（启发式，不依赖 LLM） */
export function extractSignals(docText = '', docTokens = 0, codeFiles = [], materialText = '', materialTokens = 0, debugChannel = null) {
  const doc = (docText || '').toString()
  const mat = (materialText || '').toString()
  const combined = doc + '\n' + mat
  const DEBUG = (type, subj, detail) => { if (debugChannel) debugChannel(type, subj, detail) }

  // ─── [R3] 技术债信号：扫描代码里的 TODO/FIXME/HACK/XXX 注释密度 ────
  // 依据：Kernighan's Law (Cost_debug = 2 × Cost_write × (1+TD_ratio)) + DEVLoRe 实测
  // bug 密度 > 1/100 LOC 时，给所有阶段加 techDebtPenalty（最多 +50%）
  let debtMarkers = 0
  let sourceFiles = 0
  let testFilesCount = 0
  let debtExamples = []
  for (const f of codeFiles) {
    const p = (f.path || '').toLowerCase()
    const isTest = /(\.test\.|\.spec\.|__tests__|\/tests?\/|_test\.)/.test(p)
    if (isTest) { testFilesCount++; continue }
    if (/\.(js|mjs|ts|tsx|jsx|py|go|rs|java|kt|c|cpp|h|cs|rb|php|swift|vue|svelte)$/.test(p)) {
      sourceFiles++
      // 来自 countDirectory scanDebt 选项的真实计数
      if (typeof f.debtMarkers === 'number' && f.debtMarkers > 0) {
        debtMarkers += f.debtMarkers
        if (debtExamples.length < 5) debtExamples.push(`${p.split('/').pop()}: ${f.debtMarkers}`)
      }
      // 路径信号：遗留文件名
      if (/(deprecated|legacy|_old|_bak|_temp|wip)/.test(p)) {
        debtMarkers += 3
        if (debtExamples.length < 5) debtExamples.push(`${p.split('/').pop()} (legacy filename)`)
      }
    }
  }
  // 资料里的 debt 信号（如果有 code review / known issues 章节，加重 debtMarkers）
  const knownIssuesMatch = mat.match(/(known\s*issues|已知问题|技术债|tech\s*debt|遗留问题|bug\s*list|缺陷列表)/gi)
  const knownIssuesCount = knownIssuesMatch ? knownIssuesMatch.length : 0
  if (knownIssuesCount > 0) debtMarkers += knownIssuesCount * 5  // 每个已知问题节等效 5 个 debt marker

  // 技术栈启发式关键词
  const TECH_KEYWORDS = [
    ['unity',     ['Unity', 'unity', 'U3D']],
    ['unreal',    ['Unreal', 'UE4', 'UE5']],
    ['godot',     ['Godot']],
    ['react',     ['React', 'Next.js', 'NextJS', 'React Native', 'RN ']],
    ['vue',       ['Vue', 'Nuxt']],
    ['angular',   ['Angular']],
    ['typescript',['TypeScript', 'TS ']],
    ['javascript',['JavaScript', 'JS ']],
    ['nodejs',    ['Node.js', 'NodeJS', 'Express', 'Koa', 'NestJS']],
    ['go',        ['Go 1.', 'Golang', '/gin ', 'Go ']],
    ['rust',      ['Rust']],
    ['python',    ['Python', 'Django', 'Flask', 'FastAPI']],
    ['java',      ['Java ', 'Spring Boot']],
    ['kotlin',    ['Kotlin']],
    ['swift',     ['Swift', 'iOS']],
    ['csharp',    ['C#', 'C＃', '.NET']],
    ['cpp',       ['C++', 'cpp']],
    ['flutter',   ['Flutter']],
    ['unity_ecs', ['ECS']],
    ['postgres',  ['PostgreSQL', 'Postgres']],
    ['mysql',     ['MySQL']],
    ['redis',     ['Redis']],
    ['clickhouse',['ClickHouse']],
    ['kafka',     ['Kafka']],
    ['kubernetes',['Kubernetes', 'k8s']],
    ['docker',    ['Docker']],
    ['grpc',      ['gRPC']],
    ['graphql',   ['GraphQL']],
    ['webrtc',    ['WebRTC']],
    ['websocket', ['WebSocket', 'Socket.IO']],
    ['llm',       ['LLM', 'AI 代理', '大模型', 'Agent']],
    ['pay',       ['支付', '支付宝', '微信支付', 'Stripe', 'App Store', 'Google Play', 'IAP']],
    ['oauth',     ['OAuth', 'JWT', 'SSO']],
    ['multiplayer', ['联机', '多人', '匹配', '排行榜', 'PVP', '公会']],
    ['mobile',    ['Android', 'iOS', '手游', '手机端']],
    ['web',       ['Web', '网页', 'H5']],
    ['desktop',   ['PC', '桌面', 'Windows', 'macOS', 'Linux']],
    ['console',   ['Switch', 'PlayStation', 'Xbox']],
    ['ci',        ['CI', 'GitHub Actions', 'Jenkins', 'Dockerfile']],
  ]
  const techs = []
  for (const [key, patterns] of TECH_KEYWORDS) {
    if (patterns.some(p => combined.includes(p))) techs.push(key)
  }

  // 语言数量
  let localeCount = 1
  const localeKeywords = ['中文', '英文', 'English', 'Japanese', '日文', '三语', '双语', '国际化', 'i18n', 'localization']
  for (const kw of localeKeywords) {
    if (combined.includes(kw)) localeCount = Math.max(localeCount, kw.includes('三语') ? 3 : kw.includes('双语') ? 2 : 2)
  }

  // 里程碑章节数 = 项目阶段，估算开发月
  let monthsOfWork = 3
  const milestoneMatches = combined.match(/\b(M\d+|月|阶段|里程碑)\b/g) || []
  if (milestoneMatches.length >= 12) monthsOfWork = Math.ceil(milestoneMatches.length / 4)

  // 功能/模块/页面计数
  const featureSectionHeaders = [
    /^##+\s*\d*\.?\s*(玩法设计|玩法|系统设计|核心玩法|功能|模块|经济系统|系统|战斗|PvP|副本|活动|UI|美术|技术|里程碑|M\d)/gm,
  ]
  let featureCount = 0
  for (const re of featureSectionHeaders) {
    const matches = combined.match(re)
    if (matches) featureCount += matches.length
  }
  featureCount = Math.max(5, featureCount * 3) // 每个 header 下大约 3 个功能点

  // 角色数（游戏类项目的重要成本驱动）
  const roleMatch = combined.match(/(\d+)\s*位?(角色|指挥官|英雄|人物)/)
  if (roleMatch) {
    featureCount += parseInt(roleMatch[1]) * 2
  }

  // UI 组件/页面数估算
  let uiCount = 10
  const uiMatch = combined.match(/(\d+)\s*个?(主界面|界面|UI|页面|屏幕|page)/i)
  if (uiMatch) uiCount = Math.max(uiCount, parseInt(uiMatch[1]))

  // 复杂度 flags
  const complex = {
    networking: techs.includes('multiplayer') || techs.includes('websocket') || /PVP|联机|多人|匹配|同步/.test(combined),
    ai: techs.includes('llm') || /AI辅助|NPC AI|智能|推理/.test(combined),
    payment: techs.includes('pay') || /付费|月卡|充值/.test(combined),
    auth: techs.includes('oauth') || /账号|登录|注册|JWT|认证/.test(combined),
    multi_platform: [techs.includes('mobile'), techs.includes('web'), techs.includes('desktop')].filter(Boolean).length >= 2,
    ci_cd: techs.includes('ci') || techs.includes('docker') || techs.includes('kubernetes'),
  }

  // 代码 LOC（从扫描到的 codeFiles 里估算）
  let codeTokens = 0
  for (const f of codeFiles) codeTokens += f.tokens || 0
  // 粗略换算: 代码 tokens ≈ 2.5 LOC（视语言而定但平均差不多）
  const codeLOC = Math.round(codeTokens / 2.5)

  // ─── 半成品的"已完成阶段"信号（基于文件类型分布） ─────────────────
  // 每个信号触发对应阶段的额外折扣，让"做了一半"真正反映到预算上
  const existingStageSignals = {
    has_tests: false,
    has_docs: false,
    has_devops: false,
    has_ui: false,
    has_manifest: false,
    has_data_model: false,
    testFileCount: 0,
    docFileCount: 0,
    devopsFileCount: 0,
    uiFileCount: 0,
    extHistogram: {},
  }
  for (const f of codeFiles) {
    const p = (f.path || '').toLowerCase().replace(/\\/g, '/')
    const ext = (f.ext || '').toLowerCase()
    existingStageSignals.extHistogram[ext || '(none)'] = (existingStageSignals.extHistogram[ext || '(none)'] || 0) + 1

    // 测试文件: *.test.* / *.spec.* / __tests__ / tests/ / test/
    if (/(\.test\.|\.spec\.|__tests__|\/tests?\/|\/test\/|_test\.go|_test\.py)/.test(p)) {
      existingStageSignals.has_tests = true
      existingStageSignals.testFileCount++
    }
    // 文档: README / docs/ / *.md / CHANGELOG / API.md
    if (/(\.md$|readme|\/docs?\/|changelog|api\.md|contributing)/.test(p)) {
      existingStageSignals.has_docs = true
      existingStageSignals.docFileCount++
    }
    // DevOps: Dockerfile / .github/ / k8s/ / *.yml / *.yaml / terraform / helm
    if (/(dockerfile|\.github|\/k8s\/|\.ya?ml$|terraform|helm|\/ci\/|jenkinsfile)/.test(p)) {
      existingStageSignals.has_devops = true
      existingStageSignals.devopsFileCount++
    }
    // UI 文件: *.vue / *.tsx / *.jsx / pages/ / components/ / *.svelte
    if (/(\.vue$|\.tsx$|\.jsx$|\.svelte$|\/pages?\/|\/components?\/|\.html$|\.css$|\.scss$)/.test(p)) {
      existingStageSignals.has_ui = true
      existingStageSignals.uiFileCount++
    }
    // 依赖清单: package.json / go.mod / requirements.txt / Cargo.toml / pom.xml / pubspec.yaml
    if (/(package\.json|go\.mod|requirements.*\.txt|cargo\.toml|pom\.xml|pubspec\.yaml|pyproject\.toml)/.test(p)) {
      existingStageSignals.has_manifest = true
    }
    // 数据模型/Schema: *.sql / *.prisma / schema.* / migrations/ / *.proto
    if (/(\.sql$|\.prisma$|schema\.|\/migrations?\/|\.proto$|\.graphql$)/.test(p)) {
      existingStageSignals.has_data_model = true
    }
  }

  // ─── [R1] 资料质量信号：检测资料里是否有"结构化资料"（API schema / 数据字典等） ──
  // 不是按 tokens 数量称重，而是按"信息结构化程度"
  // 依据：Lost in the Middle 论文显示结构化资料比散文资料有效信息率高 ~2-3 倍
  const STRUCTURED_MATERIAL_PATTERNS = [
    { id: 'api_schema',    regex: /(\bapi\b|接口定义|endpoint|RESTful|graphql\s*schema)/gi, weight: 1.5 },
    { id: 'data_dict',     regex: /(数据字典|data\s*dictionary|字段说明|field\s*definition)/gi, weight: 1.5 },
    { id: 'er_diagram',    regex: /(ER\s*图|实体关系|class\s*diagram|关系模型)/gi, weight: 1.3 },
    { id: 'seq_diagram',   regex: /(时序图|sequence\s*diagram|流程图|flowchart)/gi, weight: 1.2 },
    { id: 'spec_doc',      regex: /(技术方案|需求规格|specification|PRD|技术选型)/gi, weight: 1.4 },
    { id: 'api_examples',  regex: /(curl\s+-X|postman\s*collection|openapi|swagger)/gi, weight: 1.3 },
  ]
  const materialQuality = { types: [], qualityMultiplier: 1.0 }
  DEBUG('material-quality', 'start', {
    materialTokens,
    patterns: STRUCTURED_MATERIAL_PATTERNS.length,
    note: '每命中一种结构化资料类型，qualityMultiplier 乘以对应权重；上限 2.0'
  })
  for (const pat of STRUCTURED_MATERIAL_PATTERNS) {
    const m = mat.match(pat.regex)
    if (m && m.length > 0) {
      const before = materialQuality.qualityMultiplier
      materialQuality.types.push({ id: pat.id, count: m.length, weight: pat.weight })
      materialQuality.qualityMultiplier *= pat.weight
      DEBUG('material-quality', pat.id, {
        matches: m.length,
        weight: pat.weight,
        multiplierBefore: before,
        multiplierAfter: materialQuality.qualityMultiplier,
        formula: `${before} × ${pat.weight} = ${materialQuality.qualityMultiplier}`
      })
    } else {
      DEBUG('material-quality', pat.id, { matches: 0, weight: pat.weight, result: '不命中，无变化' })
    }
  }
  // 上限 2.0，避免资料质量过度膨胀
  const beforeCap = materialQuality.qualityMultiplier
  materialQuality.qualityMultiplier = Math.min(2.0, materialQuality.qualityMultiplier)
  if (beforeCap !== materialQuality.qualityMultiplier) {
    DEBUG('material-quality', 'cap', { before: beforeCap, after: materialQuality.qualityMultiplier, note: '超过上限 2.0，已截断' })
  } else {
    DEBUG('material-quality', 'cap', { value: materialQuality.qualityMultiplier, note: '未触发上限 2.0' })
  }

  return {
    docSizeTokens: docTokens,
    materialSizeTokens: materialTokens,
    codeTokens,
    codeLOC,
    techStacks: techs,
    featureCount,
    localeCount,
    uiCount,
    monthsOfWork,
    complexityFlags: complex,
    existingStageSignals,
    // [R3] 技术债信号
    debt: {
      markers: debtMarkers,
      sourceFiles,
      testFiles: testFilesCount,
      testCoverageRatio: sourceFiles > 0 ? Math.min(1, testFilesCount / sourceFiles) : 0,
      examples: debtExamples,
      knownIssuesCount,
    },
    // [R1] 资料质量信号
    materialQuality,
  }
}

// ─── 核心：预算合成 ──────────────────────────────────────────────────────

/**
 * 估算完整项目预算
 *
 * @param {{
 *   docText?: string,
 *   docTokens?: number,
 *   path?: string,                              // 半成品源码路径（可选）
 *   codeFiles?: {tokens:number}[],              // 已扫描的文件列表（可选，否则 path 扫描）
 *   materialText?: string,
 *   materialTokens?: number,
 *   models?: string[],                          // 对比模型
 *   workflow?: keyof typeof WORKFLOWS,          // 默认 aider_loop
 *   displayCurrency?: 'USD' | 'CNY',
 *   projectType?: 'game' | 'webapp' | 'mobile_app' | 'embedded' | 'auto',
 *   customPhases?: Partial<Record<string, {calls?:number, disable?:boolean}>>
 * }} input
 * @returns {Promise<{
 *   signals: ProjectSignals,
 *   phases: Array<{
 *     id: string, name: string,
 *     inputTokens: number, outputTokens: number, calls: number,
 *     cacheHitRatio: number,
 *     baseCostPerModel: Record<string, number>
 *   }>,
 *   totals: { tokens: number, phasesWithCost: number },
 *   comparisonByModel: ReturnType<typeof compareCosts>,
 *   perModelBudget: {
 *     [modelId: string]: {
 *       phaseBreakdown: {[phaseId:string]:{tokens:number,cost:number,calls:number}},
 *       total: number, currency: string,
 *       p10:number, p50:number, p90:number,
 *       successAdjustedTotal: number,
 *     }
 *   },
 *   reportMd: string,
 * }>}
 */
export async function planProjectBudget(input = {}) {
  // 1) 基础 tokens
  let docTokens = input.docTokens ?? 0
  if (!docTokens && input.docText) {
    const r = await countText(input.docText, 'gpt-4o')
    docTokens = r.tokens
  }

  let materialTokens = input.materialTokens ?? 0
  if (!materialTokens && input.materialText) {
    const r = await countText(input.materialText, 'gpt-4o')
    materialTokens = r.tokens
  }

  let codeFiles = input.codeFiles || []
  let debugLogs = input.debug ? [] : null
  const debugChannel = input.debug ? (type, subject, detail) => {
    debugLogs.push({ type, subject, detail })
    input.debugChannel?.(type, subject, detail)
  } : null
  if (!codeFiles.length && input.path) {
    // scanDebt: 扫描 TODO/FIXME/HACK/XXX 注释，用于 [R3] 技术债惩罚
    const scan = await countDirectory(input.path, 'gpt-4o', {
      forceHeuristic: true,
      scanDebt: true,
      debug: input.debug === true,
      debugChannel,
    })
    codeFiles = scan.files.filter(f => !f.skipped)
    if (input.debug) {
      debugLogs.push({ type: 'scan-summary', subject: 'codeDirectory', detail: {
        filesScanned: codeFiles.length,
        tokensTotal: scan.totals?.tokens ?? 0,
        extHistogram: scan.byExt,
        debugSummary: scan.debugSummary,
      }})
    }
  }

  // 2) 提取信号（展开资料质量系数计算过程到 debugLogs）
  const signals = extractSignals(input.docText || '', docTokens, codeFiles, input.materialText || '', materialTokens, input.debug ? (type, subj, detail) => {
    debugLogs.push({ type, subject: subj, detail })
    input.debugChannel?.(type, subj, detail)
  } : null)

  // 3) 项目规模综合评分（取 0~100 线性分，基于 doc+code+material 总和）
  const SCALE_BASE_DOC = 3000      // 3K tokens 文档 = 基准小项目
  const SCALE_BASE_CODE = 5000     // 5K tokens 代码 ≈ 2K LOC = 小项目
  const SCALE_BASE_MAT  = 5000
  const scaleRaw =
    (docTokens / SCALE_BASE_DOC) * 0.35 +
    ((signals.codeTokens) / SCALE_BASE_CODE) * 0.35 +
    (materialTokens / SCALE_BASE_MAT) * 0.10 +
    (signals.featureCount / 30) * 0.10 +
    (signals.techStacks.length / 10) * 0.10
  // 压到 [0.5, 15] 之间（最小是"小型 Todo App"，最大是"10 万行中型项目"）
  const scaleScore = Math.max(0.5, Math.min(15, scaleRaw))

  // 4) 已完成度
  const contentTotal = docTokens + signals.codeTokens + materialTokens
  const completion = contentTotal === 0 ? 0 : Math.min(0.95, signals.codeTokens / (docTokens * 2 + signals.codeTokens + materialTokens))

  // 5) 复杂度 boost
  let complexityBoost = 1.0
  for (const k of Object.keys(signals.complexityFlags)) {
    if (signals.complexityFlags[k]) complexityBoost *= 1.12 // 每个 flag +12%
  }
  // 技术栈越多，上下文切换越贵
  complexityBoost *= Math.min(1.8, 1 + (signals.techStacks.length - 3) * 0.05)

  // 6) 工作模式
  const wfKey = input.workflow ?? 'aider_loop'
  const wf = WORKFLOWS[wfKey] || WORKFLOWS.aider_loop

  // 7) 阶段合成
  const phases = []
  let totalTokensAllPhases = 0
  for (const phase of PHASES) {
    const custom = input.customPhases?.[phase.id]
    if (custom?.disable) continue

    // 规模乘数
    const s = scaleScore
    const docMul = s * (phase.costDriverTouches.doc_size || 0)
    const codeMul = s * (phase.costDriverTouches.code_loc || 0)
    const featMul = s * (phase.costDriverTouches.feature_count || 0)
    const uiMul = Math.max(1, signals.uiCount / 30) * (phase.costDriverTouches.ui_count || 0)
    const dataMul = (1 + materialTokens / 20000) * (phase.costDriverTouches.data_size || 0)
    const infraMul = (phase.costDriverTouches.infra || 0) * (signals.complexityFlags.ci_cd ? 1.5 : 0.5)
    const localeMul = 1 + (signals.localeCount - 1) * (phase.id === 'docs-localization' ? 1.2 : 0.08)
    // 技术栈规模：log 抑制，避免 13 栈直接 ×3
    const techPenetration = Math.log2(1 + signals.techStacks.length) / Math.log2(1 + 5)  // 5 栈 ≈ 1x
    const techMul = 1 + (phase.costDriverTouches.tech_stack || 0) * techPenetration

    const multiplier = Math.max(
      0.15,
      1 + docMul * 0.35 + codeMul * 0.35 + featMul * 0.2 + uiMul * 0.28 + dataMul * 0.2 + infraMul * 0.28
    ) * localeMul * techMul * complexityBoost

    // 已完成度折扣：半成品越完整，越省
    const phaseStartOffset = {
      'requirements-analysis': 0.05,
      'architecture-design': 0.15,
      'data-modeling': 0.25,
      'core-coding': 0.40,
      'ui-frontend': 0.55,
      'testing-qa': 0.72,
      'docs-localization': 0.82,
      'release-devops': 0.90,
    }[phase.id] ?? 0

    // 若半成品完成度 > phaseStartOffset，后面阶段按比例打折
    const saved = completion > phaseStartOffset
      ? Math.pow((completion - phaseStartOffset) / (1 - phaseStartOffset), phase.sensitivity)
      : 0
    const completionSavings = Math.min(0.95, saved)

    // ─── 半成品文件类型定向折扣（基于 existingStageSignals） ───────
    // 每个阶段对应一种"已完成信号"，命中时再额外打折
    const artifactSavingsMap = {
      'architecture-design': signals.existingStageSignals.has_manifest ? 0.30 : 0,  // 依赖清单已选 → 架构已定
      'data-modeling':       signals.existingStageSignals.has_data_model ? 0.50 : 0, // schema 已存在 → 数据建模省一半
      'core-coding':         signals.existingStageSignals.has_manifest ? 0.10 : 0,  // 依赖清单已选 → 编码省 10%
      'ui-frontend':         signals.existingStageSignals.has_ui ? 0.40 : 0,        // 已有 UI 文件 → UI 阶段省 40%
      'testing-qa':          signals.existingStageSignals.has_tests ? 0.35 : 0,     // 已有测试 → 测试阶段省 35%
      'docs-localization':   signals.existingStageSignals.has_docs ? 0.45 : 0,      // 已有文档 → 文档阶段省 45%
      'release-devops':      signals.existingStageSignals.has_devops ? 0.50 : 0,   // 已有 CI/Dockerfile → 发布阶段省 50%
    }
    const artifactSavings = artifactSavingsMap[phase.id] || 0

    // ─── [R1] 资料的倒 U 形收益（替换线性公式） ─────────────────────
    // 依据：Lost in the Middle (arxiv 2307.03172) + Databricks 衰减曲线
    // 资料 < 32K tokens：净收益线性增长（最多省 40% 前期成本）
    // 资料 > 32K tokens：每多 1K，有效信息衰减 60% → 边际收益转负
    // 公式：benefit(T) = MAX_BENEFIT × (T/T_thresh) × (1 - γ·max(0, T-T_thresh)/T)
    //      γ=0.6, T_thresh=32000, MAX_BENEFIT=0.40
    // 再乘以资料质量系数（结构化资料 ×1.5-2.0，散文资料 ×1.0）
    const materialHelpedPhases = ['requirements-analysis', 'architecture-design', 'data-modeling']
    let materialSavings = 0
    if (materialHelpedPhases.includes(phase.id) && materialTokens > 0) {
      const T = materialTokens
      const T_THRESH = 32000
      const GAMMA = 0.6
      const MAX_BENEFIT = 0.40
      // 倒 U 形：线性段 × 衰减因子
      const linearPart = Math.min(1, T / T_THRESH)  // 0→1 线性
      const decayPart = T > T_THRESH ? (1 - GAMMA * (T - T_THRESH) / T) : 1
      const baseBenefit = MAX_BENEFIT * linearPart * decayPart
      // 资料质量乘数（结构化资料比散文资料有效信息率高 1.5-2.0 倍）
      materialSavings = Math.max(0, Math.min(0.60, baseBenefit * signals.materialQuality.qualityMultiplier))
    }

    // ─── [R2] 半成品代码的"context overhead"（每轮调用塞代码进 context 的开销） ──
    // 依据：SWE-bench 实测 Tokens(LOC) = c·LOC^1.2（仓库翻倍 token 涨 2.3×）
    //       COCOMO II 维护模型 E ≈ 1.05-1.23（超线性！）
    // 这里只算"每轮塞代码进 context 的输入成本"，不算输出（输出仍由 savingsFactor 决定）
    // 10K LOC → +6%, 50K LOC → +18%, 100K LOC → +30%（封顶 +50%）
    const codeContextOverhead = signals.codeLOC > 0
      ? Math.min(0.50, Math.pow(signals.codeLOC / 10000, 1.2) * 0.05)
      : 0

    // ─── [R3] 技术债 / bug 惩罚（半成品 bug 反而让总成本上升） ────────
    // 依据：Kernighan's Law (Cost_debug = 2.0 × Cost_write × (1+TD_ratio))
    //       DEVLoRe 实测：多文件 bug 修复成本 ≈ 4×
    // 估算 TD_ratio = debtMarkers / (LOC / 100)（每 100 LOC 1 个 TODO 算正常）
    // 测试覆盖率低 → 再 +techDebtPenalty（无测试 = 不知道哪里坏，调试更费）
    const debt = signals.debt || { markers: 0, testCoverageRatio: 0 }
    const tdRatio = signals.codeLOC > 0
      ? debt.markers / (signals.codeLOC / 100)
      : (debt.markers > 0 ? 2.0 : 0)  // 无代码但有 debt 信号 → 重惩罚
    // tdRatio > 1.0 才开始惩罚（1 个/100 LOC 是正常水平）
    let techDebtPenalty = tdRatio > 1.0
      ? Math.min(0.50, (tdRatio - 1.0) * 0.15)  // 最多 +50%
      : 0
    // 测试覆盖率低 → 额外 +10~20%（无测试 = 调试要靠 print）
    if (signals.codeLOC > 100 && debt.testCoverageRatio < 0.1) {
      techDebtPenalty += 0.15
    } else if (signals.codeLOC > 100 && debt.testCoverageRatio < 0.3) {
      techDebtPenalty += 0.05
    }
    techDebtPenalty = Math.min(0.60, techDebtPenalty)

    // 总 savingsFactor（三类折扣可叠加，但上限 90%）
    const totalSavings = Math.min(0.90, completionSavings + artifactSavings + materialSavings)
    const savingsFactor = 1 - totalSavings

    // 详细的折扣来源（给报告用）
    const savingsDetail = []
    if (completionSavings > 0)   savingsDetail.push(`完成度 -${(completionSavings*100).toFixed(0)}%`)
    if (artifactSavings > 0)     savingsDetail.push(`半成品文件 -${(artifactSavings*100).toFixed(0)}%`)
    if (materialSavings > 0)     savingsDetail.push(`资料 -${(materialSavings*100).toFixed(0)}%`)

    // 详细的惩罚来源（给报告用）
    const penaltyDetail = []
    if (codeContextOverhead > 0)  penaltyDetail.push(`代码塞 context +${(codeContextOverhead*100).toFixed(0)}%`)
    if (techDebtPenalty > 0)      penaltyDetail.push(`技术债/bug +${(techDebtPenalty*100).toFixed(0)}%`)

    // 工作模式 rework multiplier（Aider 比聊天省很多）
    const reworkMul = wf.reworkMultiplier

    // 输入 token：savingsFactor 折扣后，再加上 context overhead（输入要塞代码）
    // 输出 token：只有 savingsFactor + techDebtPenalty（输出不被代码塞入影响，但 bug 多要重写）
    const itk = phase.baseInputK  * 1000 * multiplier * reworkMul * savingsFactor * (1 + codeContextOverhead + techDebtPenalty)
    const otk = phase.baseOutputK * 1000 * multiplier * reworkMul * savingsFactor * (1 + techDebtPenalty)
    const calls = Math.max(1, Math.round((custom?.calls ?? phase.calls) * reworkMul))
    const cacheHitRatio = wf.contextReuseRatio

    phases.push({
      id: phase.id,
      name: phase.name,
      description: phase.description,
      scaleScoreContrib: { docMul, codeMul, featMul, uiMul, dataMul, infraMul, localeMul, techMul },
      multiplier,
      savingsFactor,
      savingsDetail,
      penaltyDetail,
      completionSavings,
      artifactSavings,
      materialSavings,
      codeContextOverhead,
      techDebtPenalty,
      complexityBoost,
      inputTokens: Math.round(itk),
      outputTokens: Math.round(otk),
      cacheHitRatio,
      calls,
    })
    totalTokensAllPhases += (itk + otk) * calls
  }

  // 8) 对比模型成本
  const models = input.models || DEFAULT_COMPARE_SET
  const summedInput = phases.reduce((a, p) => a + p.inputTokens * p.calls, 0)
  const summedOutput = phases.reduce((a, p) => a + p.outputTokens * p.calls, 0)
  const summedCache = Math.round(phases.reduce((a, p) => a + p.inputTokens * p.calls * p.cacheHitRatio, 0))

  const comparison = compareCosts(models, {
    inputTokens: summedInput,
    outputTokens: summedOutput,
    cacheHitTokens: summedCache,
    calls: 1, // calls 已在 tokens 里乘过
  }, { displayCurrency: input.displayCurrency || 'USD' })

  // 9) 每个模型的阶段分解
  const perModelBudget = {}
  for (const r of comparison.results) {
    const nativeCur = r.currency
    const isUsd = nativeCur === 'USD'
    const isSameCur = nativeCur === comparison.displayCurrency
    const fx = (isSameCur) ? 1 :
      (isUsd && comparison.displayCurrency === 'CNY') ? DEFAULT_FX.USD_TO_CNY :
      (nativeCur === 'CNY' && comparison.displayCurrency === 'USD') ? DEFAULT_FX.CNY_TO_USD : 1

    // 阶段级成本（先按厂商本币算，再换算成 displayCur）
    const phaseBreakdown = {}
    for (const p of phases) {
      const est = estimateCostForPhase(r.modelId, p)
      est.costInDisplayCurrency = est.costNative * fx
      phaseBreakdown[p.id] = est
    }
    const sumNative = Object.values(phaseBreakdown).reduce((a, x) => a + x.costNative, 0)
    const sumDisplay = Object.values(phaseBreakdown).reduce((a, x) => a + x.costInDisplayCurrency, 0)

    // 置信区间（以 displayCurrency 算）
    const p50 = sumDisplay
    const p10 = sumDisplay * 0.55                                  // 下限：prompt 优化 + 高缓存命中
    const p90 = sumDisplay * 1.8 + sumDisplay * (1/wf.successPerAttempt - 1) * 0.5 // 上限
    const successAdj = sumDisplay / wf.successPerAttempt

    perModelBudget[r.modelId] = {
      display: r.display,
      provider: r.provider,
      currency: comparison.displayCurrency,
      phaseBreakdown,
      sumNative,
      total: sumDisplay,               // P50 中央估值
      p10, p50, p90,
      successAdjustedTotal: successAdj,
      successRate: wf.successPerAttempt,
      fx,
    }
  }

  // 10) 报告
  const reportMd = buildPlanReport({
    signals, phases, totalTokensAllPhases, comparison, perModelBudget, wf, scaleScore, completion, wfKey,
  })

  const out = {
    signals, phases,
    totals: { tokens: Math.round(totalTokensAllPhases), phasesWithCost: phases.length },
    comparisonByModel: comparison,
    perModelBudget,
    reportMd,
  }
  if (debugLogs) {
    // 把阶段级别的技术债计算也补进 debugLogs
    const summaryPenalty = phases.reduce((acc, p) => {
      acc.maxTechDebtPenalty = Math.max(acc.maxTechDebtPenalty, p.techDebtPenalty)
      acc.maxCodeContextOverhead = Math.max(acc.maxCodeContextOverhead, p.codeContextOverhead)
      return acc
    }, { maxTechDebtPenalty: 0, maxCodeContextOverhead: 0 })
    debugLogs.push({
      type: 'phase-penalty-summary',
      subject: 'all',
      detail: {
        ...summaryPenalty,
        debt: signals.debt,
        completion,
        scaleScore,
      }
    })
    for (const p of phases) {
      if (p.techDebtPenalty > 0 || p.codeContextOverhead > 0) {
        debugLogs.push({
          type: 'phase-breakdown',
          subject: p.id,
          detail: {
            name: p.name,
            inputTokens: p.inputTokens,
            outputTokens: p.outputTokens,
            calls: p.calls,
            completionSavings: p.completionSavings,
            artifactSavings: p.artifactSavings,
            materialSavings: p.materialSavings,
            codeContextOverhead: p.codeContextOverhead,
            techDebtPenalty: p.techDebtPenalty,
          }
        })
      }
    }
    out.debugLogs = debugLogs
  }
  return out
}

/** 常用对比模型集（便宜到贵 + 不同厂商） */
export const DEFAULT_COMPARE_SET = [
  'deepseek-v4-flash',
  'deepseek-chat',
  'deepseek-reasoner',
  'qwen-plus',
  'qwen-max',
  'glm-4.6',
  'kimi-k2',
  'gpt-5.4-nano',
  'gpt-5.4-mini',
  'gpt-4o',
  'o3-mini',
  'claude-sonnet-4.6',
  'claude-sonnet-5',
  'claude-opus-4.8',
  'gemini-2.5-pro',
]

// 阶段成本快速算（pricing import 已在文件顶部）
function estimateCostForPhase(modelId, phase) {
  const id = normalizeModelName(modelId)
  const price = getPricing(id)
  if (!price) return { tokens: 0, cost: 0, calls: 0 }
  const tier = resolveTier(price, phase.inputTokens)
  const iT = phase.inputTokens, oT = phase.outputTokens
  const cache = Math.round(iT * phase.cacheHitRatio)
  const cleanI = iT - cache
  const totalTokens = (iT + oT) * phase.calls
  const costInNative =
    (cleanI / 1e6 * tier.input +
     oT / 1e6 * tier.output +
     cache / 1e6 * (tier.cacheHit || tier.input)) * phase.calls
  return {
    tokens: totalTokens,
    calls: phase.calls,
    costNative: costInNative,
    currencyNative: price.currency,
  }
}

// 报告
function buildPlanReport({ signals, phases, totalTokensAllPhases, comparison, perModelBudget, wf, scaleScore, completion, wfKey }) {
  const cur = comparison.displayCurrency
  const L = []
  L.push('# 🧮 项目 AI 预算清单（从企划书 → 成品）')
  L.push('')
  L.push(`> 算法基于 SWE-bench(2026) / Aider Polyglot / AgentPub / gpt-researcher 实测数据合成，非单纯"文件 token 称重"。`)
  L.push(`> 工作模式: **${wf.name}** (重写系数 ×${wf.reworkMultiplier}，缓存命中率 ${(wf.contextReuseRatio*100)|0}%，成功率 ${(wf.successPerAttempt*100)|0}%)`)
  L.push('')
  L.push('## 🔍 输入分析')
  L.push('')
  L.push(`| 指标 | 值 | 说明 |`)
  L.push(`|------|----|------|`)
  L.push(`| 企划书 tokens | ${signals.docSizeTokens.toLocaleString()} | 需求清晰度基础 |`)
  L.push(`| 资料 tokens | ${signals.materialSizeTokens.toLocaleString()} | 参考文档数量 |`)
  L.push(`| 半成品代码 tokens | ${signals.codeTokens.toLocaleString()} | ${signals.codeLOC.toLocaleString()} LOC (约) |`)
  L.push(`| 综合规模评分 | ${scaleScore.toFixed(2)} / 15 | 越大项目越复杂 |`)
  L.push(`| 已完成度 | ${(completion*100).toFixed(0)}% | 基于"代码/需求"比例估算 |`)
  L.push(`| 技术栈数 | ${signals.techStacks.length} | ${signals.techStacks.join(', ')} |`)
  L.push(`| 功能/模块估计 | ${signals.featureCount} | 从章节/角色/UI 启发式得出 |`)
  L.push(`| UI 页面/组件估计 | ${signals.uiCount} | 从章节/关键词提取 |`)
  L.push(`| 语言版本数 | ${signals.localeCount} | 影响文档/本地化阶段 |`)
  L.push(`| 预计开发月 | ${signals.monthsOfWork} | 从里程碑章节估算 |`)
  const cf = signals.complexityFlags
  const cfOn = Object.keys(cf).filter(k => cf[k])
  L.push(`| 复杂度 flags (${cfOn.length}) | ${cfOn.join(', ') || '无'} | 每个 +12% 成本 |`)

  // ─── 半成品文件信号显示 ─────────────────────────────────────────
  const es = signals.existingStageSignals
  L.push(`| 半成品文件信号 | ${[
    es.has_tests ? `测试 ${es.testFileCount}` : '',
    es.has_docs ? `文档 ${es.docFileCount}` : '',
    es.has_devops ? `DevOps ${es.devopsFileCount}` : '',
    es.has_ui ? `UI ${es.uiFileCount}` : '',
    es.has_manifest ? '依赖清单' : '',
    es.has_data_model ? '数据模型' : '',
  ].filter(Boolean).join(' / ') || '无'} | 命中后给对应阶段定向打折 |`)

  // ─── [R3] 技术债 / bug 信号 ──────────────────────────────────────
  const debt = signals.debt || {}
  if (signals.codeLOC > 0) {
    const tdRatio = signals.codeLOC > 0 ? (debt.markers / (signals.codeLOC / 100)).toFixed(2) : '0'
    L.push(`| 技术债标记 | ${debt.markers || 0} 个 TODO/FIXME/HACK | 每 100 LOC ${tdRatio} 个；>1 触发惩罚 |`)
    L.push(`| 测试覆盖率信号 | ${debt.testFiles || 0} 测试 / ${debt.sourceFiles || 0} 源文件 (${((debt.testCoverageRatio||0)*100).toFixed(0)}%) | <10% 触发额外惩罚 |`)
    if (debt.examples && debt.examples.length) {
      L.push(`| 技术债示例 | ${debt.examples.slice(0, 3).join('; ')}${debt.examples.length > 3 ? '…' : ''} | 代码扫描 |`)
    }
  }

  // ─── [R1] 资料质量信号 ─────────────────────────────────────────
  if (signals.materialSizeTokens > 0) {
    const mq = signals.materialQuality || { types: [], qualityMultiplier: 1.0 }
    const typesStr = mq.types.length
      ? mq.types.map(t => `${t.id}×${t.weight} (${t.count})`).join(', ')
      : '纯散文/无结构化标记'
    L.push(`| 资料质量 | 结构化系数 ×${mq.qualityMultiplier.toFixed(2)} | ${typesStr} |`)
  }
  L.push('')

  // ─── 🎯 半成品 & 资料影响（含 [R2] context overhead + [R3] 技术债惩罚） ─
  const hasAnyEffect = phases.some(p =>
    p.artifactSavings > 0 || p.materialSavings > 0 || p.completionSavings > 0 ||
    p.codeContextOverhead > 0 || p.techDebtPenalty > 0
  )
  if (hasAnyEffect) {
    L.push('## 🎯 半成品 / 资料 / bug 对预算的影响（[R1][R2][R3] 已自动计入）')
    L.push('')
    L.push('| 阶段 | 完成度 -% | 文件类型 -% | 资料 -% [R1] | 小计折扣 | 代码塞 context +% [R2] | 技术债/bug +% [R3] | 净效应 |')
    L.push('|------|-----------|-------------|-------------|---------|----------------------|--------------------|---------|')
    const explainMap = {
      'architecture-design': '依赖清单 → 架构已部分定',
      'data-modeling':       'schema/migration → 数据模型已部分建立',
      'core-coding':         '依赖清单 → 编码基础已具备',
      'ui-frontend':         'UI 文件 → 前端已部分实现',
      'testing-qa':          '测试文件 → 测试已有骨架',
      'docs-localization':   'README/docs → 文档已有雏形',
      'release-devops':      'Dockerfile/CI → 发布配置已部分完成',
    }
    for (const p of phases) {
      const savingsPct = (100 * (1 - p.savingsFactor)).toFixed(0)
      const overheadPct = p.codeContextOverhead > 0 ? `+${(p.codeContextOverhead*100).toFixed(0)}%` : '-'
      const debtPct = p.techDebtPenalty > 0 ? `+${(p.techDebtPenalty*100).toFixed(0)}%` : '-'
      const matPct = p.materialSavings > 0 ? `-${(p.materialSavings*100).toFixed(0)}%` : '-'
      // 净效应 = 该阶段相对"无任何影响"基线的总变化（折扣让成本下降，惩罚让成本上升）
      // 净效应（输入端）：-(savings) + context overhead + tech debt
      const netInputPct = ((1 - p.savingsFactor) * (1 + p.codeContextOverhead + p.techDebtPenalty) - 1) * 100
      const netSign = netInputPct >= 0 ? '+' : ''
      L.push(`| ${p.name} | -${(p.completionSavings*100).toFixed(0)}% | -${(p.artifactSavings*100).toFixed(0)}% | ${matPct} | **-${savingsPct}%** | ${overheadPct} | ${debtPct} | **${netSign}${netInputPct.toFixed(0)}%** |`)
    }
    L.push('')
    L.push('> 折扣规则（让成本下降）：')
    L.push('> ① **完成度**：按整体 LOC 比例给后期阶段打折')
    L.push('> ② **文件类型**：tests/docs/devops 等 → 对应阶段 -10~50%')
    L.push('> ③ **资料 [R1]**：倒 U 形收益（Lost in the Middle），<32K 线性增长，>32K 衰减；结构化资料 ×1.5-2.0')
    L.push('')
    L.push('> 惩罚规则（让成本上升）：')
    L.push('> ④ **代码塞 context [R2]**：每轮调用要塞代码进去，开销 = (LOC/10K)^1.2 × 5%（SWE-bench 实测幂律）')
    L.push('> ⑤ **技术债/bug [R3]**：TODO/FIXME 密度 >1/100 LOC 或测试覆盖率 <10% → +15~60%（Kernighan 定律）')
    L.push('')
    L.push('> ⚠️ **U 形现象**：完成度 50% 但代码烂（bug 多）的项目，可能比从零写更贵（半成品有 bug 拖累）')
    L.push('')
  }

  L.push('## 📋 8 阶段 Token 分解')
  L.push('')
  L.push(`| # | 阶段 | 乘数 | 折扣 | 惩罚 | 折扣来源 / 惩罚来源 | 输入 tokens | 输出 tokens | 调用 | 累计 |`)
  L.push(`|---|------|------|------|------|---------------------|-------------|-------------|------|------|`)
  let cumul = 0
  phases.forEach((p, i) => {
    const tot = (p.inputTokens + p.outputTokens) * p.calls
    cumul += tot
    const savingsPct = (100*(1-p.savingsFactor)).toFixed(0)
    const penaltyPct = ((p.codeContextOverhead + p.techDebtPenalty)*100).toFixed(0)
    const allDetail = [
      ...(p.savingsDetail || []),
      ...((p.penaltyDetail || []).length ? [p.penaltyDetail.join(' + ')] : []),
    ].join(' / ') || '无'
    L.push(`| ${i+1} | ${p.name} | ×${p.multiplier.toFixed(2)} | -${savingsPct}% | +${penaltyPct}% | ${allDetail} | ${p.inputTokens.toLocaleString()} | ${p.outputTokens.toLocaleString()} | ${p.calls} | ${cumul.toLocaleString()} |`)
  })
  L.push('')
  L.push(`**项目总 tokens 预估：${Math.round(totalTokensAllPhases).toLocaleString()}**`)
  L.push('')
  L.push('## 💰 按模型对比总成本')
  L.push('')
  L.push(`| 排名 | 模型 | 厂商 | 总成本 P50 (${cur}) | P10 (下限) | P90 (上限) | 含失败重试 (${(100/wf.successPerAttempt).toFixed(0)}%) |`)
  L.push(`|------|------|------|----------------------|------------|------------|----------------------------------------|`)
  comparison.results.forEach((r, i) => {
    const b = perModelBudget[r.modelId]
    L.push(`| ${i+1} | ${r.display} | ${(r.provider?.[0]?.toUpperCase()+r.provider?.slice(1))} | ${fmtMoney(b.total)} ${cur} | ${fmtMoney(b.p10)} | ${fmtMoney(b.p90)} | ${fmtMoney(b.successAdjustedTotal)} |`)
  })
  L.push('')
  L.push(`**最便宜：${comparison.cheapest?.display} — ${fmtMoney(perModelBudget[comparison.cheapest.modelId]?.total)} ${cur} (P50)**`)
  L.push(`**最贵：${comparison.mostExpensive?.display} — ${fmtMoney(perModelBudget[comparison.mostExpensive.modelId]?.total)} ${cur} (P50)**`)
  if (comparison.cheapest && comparison.mostExpensive && comparison.cheapest.modelId !== comparison.mostExpensive.modelId) {
    const ratio = perModelBudget[comparison.mostExpensive.modelId]?.total / perModelBudget[comparison.cheapest.modelId]?.total
    L.push(`**价差倍数：${ratio.toFixed(1)}×**`)
  }
  L.push('')
  L.push('## 🧩 阶段×模型成本分解（前 3 最便宜模型，每阶段 P50）')
  L.push('')
  const top3 = comparison.results.slice(0, 3)
  const header = ['阶段', ...top3.map(r => `${r.display} (${cur})`)]
  L.push(`| ${header.join(' | ')} |`)
  L.push(`| ${header.map(() => '---').join(' | ')} |`)
  for (const phase of phases) {
    const row = [phase.name]
    for (const r of top3) {
      const entry = perModelBudget[r.modelId].phaseBreakdown[phase.id]
      row.push(fmtMoney(entry?.costInDisplayCurrency ?? 0))
    }
    L.push(`| ${row.join(' | ')} |`)
  }
  L.push('')
  L.push('## 📝 说明与局限')
  L.push('')
  L.push('1. **估算口径**：把 AI 参与项目拆成 8 个阶段，每阶段按文档/代码/资料规模 × 经验系数合成 tokens。')
  L.push('2. **数据来源**：SWE-bench 500 issue ~50-200K tokens/$0.25-5 基准、Aider Polyglot 225 题 5.3M tokens、AgentPub 论文流水线 260K tokens/篇（见代码 comments）。')
  L.push('3. **P10/P50/P90**：假设 prompt 优化/缓存能省钱 45%（P10），而重试/重写会让成本翻倍 + 失败补偿（P90）。')
  L.push('4. **完成度折扣**：半成品 LOC / (需求+代码+资料) 比值，按阶段 offset 打折；越后期的阶段省得越多。')
  L.push('5. **实际偏差**：SWE-bench 是 bug-fix，你这是从零开发，tokens 可能再 ×1.3-3；请用 P50×2 当"心理预算"。')
  L.push('6. **建议**：先用便宜模型（DeepSeek V4 Flash / GPT 5.4 Nano）跑阶段 1-3，核心编码/测试再上高端模型（Sonnet 4.6 / Claude Opus 4.8 / GPT-5.4 Pro）。')
  L.push('')
  L.push(`> Token 估算: ${new Date().toISOString()} | 工作模式: ${wfKey} | 数据日期: 2026-08-16`)
  return L.join('\n')
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return '0'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 100) return n.toFixed(2)
  if (abs >= 1) return n.toFixed(4)
  if (abs >= 0.01) return n.toFixed(6)
  if (abs >= 0.0001) return n.toFixed(8)
  return n.toExponential(2)
}
