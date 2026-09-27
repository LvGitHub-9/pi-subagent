# pi-subagent

**在 [Pi](https://pi.dev) 里把任务委派给独立上下文窗口的子代理。** 主会话只拿到压缩后的结论，不被探索过程撑爆。

[English](README.md) | **中文**

[![CI](https://github.com/LvGitHub-9/pi-subagent/actions/workflows/ci.yml/badge.svg)](https://github.com/LvGitHub-9/pi-subagent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

基于 Pi 官方 `examples/extensions/subagent` 改造，主要改动见文末「与官方示例的差异」。

## 安装

作为本地 Pi 包安装（推荐，走 git 管理）：

```bash
pi install ./pi-subagent
```

或写进 `~/.pi/agent/settings.json`：

```json
{ "packages": ["/absolute/path/to/pi-subagent"] }
```

临时试用某一次启动：

```bash
pi -e ./pi-subagent
```

装上以后主模型会多出一个 `subagent` 工具。

## 三种模式

| 模式 | 参数 | 说明 |
|---|---|---|
| 单发 | `{ agent, task }` | 一个代理干一件事 |
| 并行 | `{ tasks: [...] }` | 最多 8 个任务，最多 4 个并发 |
| 串联 | `{ chain: [...] }` | 顺序执行，后续步骤用 `{previous}` 引用上一步输出 |

不带任何模式参数调用时，工具会返回当前可用的 agent 清单（方便模型自己发现）。

例子：

```
Use scout to find all authentication code
Run 2 scouts in parallel: one to find models, one to find providers
Chain: scout finds the read tool, planner suggests improvements
```

## 内置 agent

| Agent | 用途 | 工具 |
|---|---|---|
| `scout` | 快速侦察代码库，返回压缩后的结构化上下文 | read, grep, find, ls, bash |
| `planner` | 只读分析，产出可执行计划 | read, grep, find, ls |
| `reviewer` | 代码审查（质量 / 安全），只读 bash（提示词约束，非硬性） | read, grep, find, ls, bash |
| `worker` | 通用执行者，能力不受限 | 全部 |

内置 agent 不写死模型，默认**继承派发会话的模型与思考等级**。

## 自定义 agent

在 `agents/` 下放 markdown 文件，YAML frontmatter 定义元数据：

```markdown
---
name: my-agent
description: 这个 agent 干什么
tools: read, grep, find
model: deepseek/deepseek-flash   # 省略则继承父会话
---

这里是系统提示词。
```

三层目录，后者覆盖前者（同名以高优先级为准）：

| 层级 | 位置 | 何时加载 |
|---|---|---|
| builtin | `<本包>/agents/*.md` | 始终 |
| user | `~/.pi/agent/agents/*.md` | `agentScope: "user"`（默认）或 `"both"` |
| project | `<cwd>` 或其**任意祖先目录**的 `.pi/agents/*.md`；调用时传 `cwd` 可指定目标项目 | 仅 `agentScope: "project"` 或 `"both"` |

`PI_SUBAGENT_AGENTS_DIR` 可覆盖 builtin 目录（测试或特殊布局用）。

## 安全模型

每个子代理都是一个独立的 `pi` 子进程，带独立的系统提示词与工具/模型配置。

- **项目级 agent（`.pi/agents/`）由仓库控制**，默认不加载；要启用必须显式传 `agentScope: "both"`（或 `"project"`）。
- 只要**实际请求**了项目级 agent，交互模式就一律先弹确认框。**pi 自身的项目信任在这里不起作用**：`.pi/agents/` 不属于 pi 的受保护资源（settings/extensions/skills/themes 才是），所以只含 `.pi/agents` 的项目会被 pi 判为「已信任」，`ctx.isProjectTrusted()` 恒为真——依赖它会让这道门形同虚设。因此改为「请求即确认」。
- **无 UI 时一律拒绝**（`pi -p` / `--mode json` 这类无头场景），而不是默默放行：没人能同意就不跑。报错会提示换交互模式或改用 `agentScope: "user"`。
- 用户可以一次性豁免这道门：`PI_SUBAGENT_CONFIRM_PROJECT_AGENTS=0`，必须是 **Pi 启动时的进程环境**。这个开关**只属于用户**——它不在工具参数里，所以模型无法自己关掉。
- `/subagent-agents` 只在项目被信任时才列举项目级 agent。

## 工作流 prompt 模板

```
/implement <需求>               scout → planner → worker
/scout-and-plan <需求>          scout → planner（不实现）
/implement-and-review <需求>    worker → reviewer → worker
```

## 界面

- 折叠视图：状态图标、agent 名、用量统计；单发模式显示最近 10 条工具调用/文本，串联与并行模式每个步骤显示最近 5 条。
- `Ctrl+O` 展开：完整任务、全部工具调用、Markdown 渲染的最终输出、每步骤用量。
- 并行模式实时显示 `2/3 done, 1 running`；Ctrl+C 会传递到子进程。

## 测试

```bash
npm test        # 4 个套件，全部离线：零模型调用、零终端、不碰真实的 ~/.pi/agent
```

| 套件 | 覆盖 |
|---|---|
| `test/discovery.test.cjs` | 三层优先级、scope 隔离、`PI_SUBAGENT_AGENTS_DIR` 覆盖、坏 agent 文件容错 |
| `test/render.test.cjs` | `renderCall` / `renderResult`：三种模式 × 折叠/展开 × 成功/失败/运行中（76 项断言），含窄宽度与可视宽度不溢出 |
| `test/tool.test.cjs` | 整条执行链路（93 项断言）：spawn、JSONL 解析、用量汇总、`{previous}` 替换、50 KB 截断、信任门控、中止、临时文件清理 |
| `test/extension.test.cjs` | 注册面：工具与参数 schema、prompt 集成、`/subagent-agents` 的信任行为、不在工厂里订阅事件 |

两个关键点让离线测试成为可能：

1. **渲染无需终端**：`renderCall` / `renderResult` 返回的是 pi-tui 组件，唯一要求是 `render(width): string[]`。
2. **无需模型调用**：子代理是按 `node <process.argv[1]>` 启动的，测试把 `process.argv[1]` 指向 `test/fake-pi.cjs`；它按 `--mode json` 格式回放消息，并把收到的每个参数写进报告文件供断言。

`test/_harness.cjs` 负责定位 Pi 安装位置并用 jiti 加载真实扩展。alias 指向包的 **dist 目录**而非入口文件——指向文件会被 jiti 做前缀替换，从而破坏 `@earendil-works/pi-ai/compat` 这类子路径导入。

### 手工验收确认框（需要真实 TUI）

测试套件用的是伪造的 `ctx`，真弹窗只能人看。仓库自带 `.pi/agents/demo.md` 作为固定夹具：

1. 在仓库目录开一个新会话（或在任意位置传 `cwd` 指向它）；
2. 让它用 `agentScope: "both"` + `agent: "demo"` 调用 subagent；
3. 应当弹确认框；选「否」应返回 `Canceled: project-local agents not approved.`。

注意：项目 agent 目录是从**会话 cwd 向上**查找的，所以会话开在父目录时得靠 `cwd` 参数指定目标项目，否则会报 `Unknown agent`。

## 与官方示例的差异

1. **内置 agents 目录**：官方示例只找 user / project 两个目录，agent 定义必须手工拷到 `~/.pi/agent/agents`。这里增加了 `builtin` 层，包自带 4 个 agent，开箱即用，同时仍可被 user / project 覆盖。
2. **agent 模型改为继承**：官方示例写死 `claude-*`；这里默认继承派发会话的模型。
3. **发现能力**：新增「无参数即列出 agent 清单」与 `/subagent-agents` 命令。
4. **系统提示集成**：补上 `promptSnippet` 与 `promptGuidelines`，让工具出现在默认系统提示的可用工具列表里，并给出使用时机建议。
5. **测试**：从手工验证升级为回归套件。
6. **无效参数改为抛错**：官方示例的这个分支只返回一段普通文本，模型会把「参数写错了」当成一次成功调用。这里改成 `throw`。
7. **修中止升级**：官方示例用 `if (!proc.killed)` 判断是否补发 SIGKILL，但 `proc.killed` 在 SIGTERM 发出后即为 `true`，所以 SIGKILL 永远不会发出。改为按 `exitCode` / `signalCode` 判断子进程是否真的还在跑，并 `unref()` 定时器、在 close 时清理。
8. **信任门控重做**：官方示例的门控条件有两个漏洞——(a) 它用 `!ctx.isProjectTrusted()`，但 `.pi/agents/` 不属于 pi 的受保护资源，只含 agent 的项目会被判为已信任，所以这道门在真实场景里几乎不会触发；(b) `confirmProjectAgents` 是工具参数，实测模型会主动把它设成 `false` 从而静默绕过确认框。这里改为「请求项目级 agent 即确认、无 UI 即拒绝、豁免开关只放在用户环境变量里」。
9. **`/subagent-agents` 尊重项目信任**：官方没有这个命令；新增时默认只在信任的项目里列举项目级 agent。
10. **离线测试套件**：官方示例只有手工验证。这里用「假 pi 子进程 + 无终端渲染」做到零模型调用、零终端的完整覆盖。
11. **`cwd` 参与 agent 发现**：官方示例只用会话 cwd 找 `.pi/agents`，所以在父目录开会话、委派到子项目时会找不到该子项目的 agent（实测模型只能把 agent 文件复制到父目录来绕过，把仓库搞脏）。这里让 `cwd` 同时决定发现目录与子进程工作目录。

## 错误处理与取舍

Pi 只在 `execute()` **抛错**时才把工具结果标记为失败：返回对象上的 `isError: true` 会被忽略（实测事件流与模型看到的 `toolResult.isError` 都是 `false`，官方示例的失败分支也是这样被忽略的）。

- **参数组合错误**（同时给了多个模式）：抛错，模型能明确看到失败并自我纠正。此时没有已完成的工作需要展示。
- **其余失败**：返回自描述文本，**故意不抛错**——抛错会丢掉 `details`，而失败时用户往往最想看子代理挂掉前调了哪些工具。各模式的前缀：
  - 单发：`Agent <stopReason>: <输出>`（通常是 `Agent error:` / `Agent aborted:`，进程非 0 退出时为 `Agent failed:`）
  - 串联：`Chain stopped at step N (<agent>): <输出>`
  - 并行：`Parallel: N/M succeeded`，每个失败任务带 `### [<agent>] failed`
  - 超过 8 个并行任务：`Too many parallel tasks (...)`
  - 项目级 agent 未获批准：`Canceled: project-local agents not approved.`，无 UI 时 `Refused to run project-local agents: no UI is available to confirm them.`
- **中止**：Ctrl+C 后先 SIGTERM，5 秒内未退出再 SIGKILL，然后抛 `Subagent was aborted`。注意 Windows 上 `process.kill` 的 SIGTERM 会直接终止进程（不可捕获），升级分支实际只在 POSIX 生效；POSIX 下有测试覆盖，Windows 下只验证「不挂起、确实已终止」。

## 已知限制

- 折叠视图：单发模式显示最近 10 条，串联 / 并行模式每个步骤显示最近 5 条。
- 并行模式给模型看的输出每个任务上限 50 KB（完整结果仍在 tool details 里）。
- `reviewer` 的只读是提示词层面的约束，`--tools` 管不住 bash 的读写；硬性限制需要额外的权限门控扩展。
- 每次调用都会重新扫描 agent 目录，所以会话中途改 agent 文件立即生效。

## 许可证

MIT，见 [LICENSE](LICENSE)。变动记录在 [CHANGELOG.md](CHANGELOG.md)；开发与发版流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。
