# pi-subagent

把任务委派给**独立上下文窗口**的子代理。主会话只拿到压缩后的结论，不被探索过程撑爆。

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
| `reviewer` | 代码审查（质量 / 安全），只做只读 bash | read, grep, find, ls, bash |
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
| project | `<cwd>/.pi/agents/*.md` | 仅 `agentScope: "project"` 或 `"both"` |

`PI_SUBAGENT_AGENTS_DIR` 可覆盖 builtin 目录（测试或特殊布局用）。

## 安全模型

每个子代理都是一个独立的 `pi` 子进程，带独立的系统提示词与工具/模型配置。

- **项目级 agent（`.pi/agents/`）由仓库控制**，可以指示模型读文件、跑命令。默认不加载。
- 要启用必须显式传 `agentScope: "both"`（或 `"project"`），且仅在信任的仓库里用。
- 在未信任的项目里，交互模式会在运行项目级 agent 前再弹一次确认框（`confirmProjectAgents: false` 可关闭）。

## 工作流 prompt 模板

```
/implement <需求>               scout → planner → worker
/scout-and-plan <需求>          scout → planner（不实现）
/implement-and-review <需求>    worker → reviewer → worker
```

## 界面

- 折叠视图：状态图标、agent 名、最近 10 条工具调用/文本、用量统计。
- `Ctrl+O` 展开：完整任务、全部工具调用、Markdown 渲染的最终输出、每步骤用量。
- 并行模式实时显示 `2/3 done, 1 running`；Ctrl+C 会传递到子进程。

## 开发

```bash
node test/discovery.test.cjs   # 或 npm test
```

测试用 Pi 自带的 jiti 直接加载 `extensions/subagent/agents.ts`，在临时目录里校验三层优先级与覆盖规则，不触碰真实的 `~/.pi/agent`。

## 与官方示例的差异

1. **内置 agents 目录**：官方示例只找 user / project 两个目录，agent 定义必须手工拷到 `~/.pi/agent/agents`。这里增加了 `builtin` 层，包自带 4 个 agent，开箱即用，同时仍可被 user / project 覆盖。
2. **agent 模型改为继承**：官方示例写死 `claude-*`；这里默认继承派发会话的模型。
3. **发现能力**：新增「无参数即列出 agent 清单」与 `/subagent-agents` 命令。
4. **系统提示集成**：补上 `promptSnippet` 与 `promptGuidelines`，让工具出现在默认系统提示的可用工具列表里，并给出使用时机建议。
5. **测试**：新增 `test/discovery.test.cjs` 回归测试。
6. **无效参数改为抛错**：官方示例返回 `{ content, isError: true }`，但当前 Pi 版本会忽略结果对象上的 `isError`（只有 `execute()` 抛错才会产生失败的工具结果），于是模型会把参数错误当成功。这里改成 `throw`。

## 错误处理与取舍

- **参数错误**：抛错，模型能明确看到失败并自我纠正。
- **单个子代理失败**（agent 不存在、进程非 0 退出、LLM 报错）：返回以 `Agent failed:` / `Chain stopped at step N` 开头的文本。这些路径**故意不抛错**，因为抛错会丢失 `details`，而失败时用户往往最想看子代理挂掉前做了什么工具调用。代价是模型要自己读懂文本里的失败语义。
- **中止**：Ctrl+C 会 SIGTERM（5 秒后 SIGKILL）子进程并抛错。

## 已知限制

- 折叠视图只显示最近 10 条项目；并行模式给模型看的输出每个任务上限 50 KB（完整结果仍在 tool details 里）。
- 每次调用都会重新扫描 agent 目录，所以会话中途改 agent 文件立即生效。
