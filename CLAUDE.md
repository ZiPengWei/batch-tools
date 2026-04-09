# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

- 安装依赖：`pnpm install`
- 启动本地开发：`pnpm dev`
  - 会同时启动 Vite 渲染进程开发服务器和 Electron 应用。
- 构建应用：`pnpm build`
  - 依次执行 `vue-tsc`、构建渲染进程，并通过 `electron-builder` 打包 Electron 应用。
- 类型检查：`pnpm typecheck`
- 代码检查：`pnpm lint`
- 自动修复 lint 问题：`pnpm lint:fix`
- 运行单元测试：`pnpm test`
- 运行单个 Vitest 测试文件：`pnpm exec vitest run tests/mergeService.test.ts`
- 按名称运行单个 Vitest 测试：`pnpm exec vitest run tests/mergeService.test.ts -t "test name"`
- 运行默认校验流程：`pnpm check`
  - 等价于 `pnpm run typecheck && pnpm run test`
- 安装 Playwright 浏览器：`pnpm e2e:install`
- 运行 E2E 测试：`pnpm e2e`
- 运行单个 Playwright 用例：`pnpm exec playwright test e2e/app-scroll.spec.ts`
- 在不启动 Electron 的情况下调试 Playwright 使用的 Web 服务器：`VITE_E2E=1 pnpm vite --config vite.e2e.config.ts --port 4173 --strictPort`

## 高层架构

这是一个基于 Electron + Vue 3 的桌面应用，用于批量合并 GitLab 分支。

### 运行时分层

- `electron/main.ts`
  - 负责 Electron 应用与窗口生命周期。
  - 注册全部 IPC 处理器。
  - 实例化主进程服务：`GitLabClient`、`MergeService`、`LocalGitConflictService`。
- `electron/preload.ts`
  - 向渲染进程暴露一个最小化的 `window.ipcRenderer` 桥接层。
  - 内置监听器去重与引用计数逻辑；渲染进程与主进程的通信应继续通过这一边界完成。
- `src/main.ts`
  - Vue 渲染进程入口；挂载 `App.vue` 与 Pinia。
- `src/renderer/ipc/bridge.ts`
  - 渲染进程侧的 IPC 调用/事件封装。
  - 新增 IPC 能力时，优先扩展这里，而不是在组件或 store 中直接调用 `window.ipcRenderer`。

### 渲染进程结构

- `src/App.vue`
  - 主界面外壳，负责认证、项目选择、源分支选择、目标分支选择以及对话框流程编排。
- Pinia stores 承担大部分渲染层状态：
  - `src/renderer/store/auth.ts` — GitLab 认证、本地持久化设置、E2E 认证绕过。
  - `src/renderer/store/projects.ts` — 项目列表、分支列表与选择状态。
  - `src/renderer/store/merge.ts` — 目标分支选择、批量合并运行状态、流式日志。
- 共享类型位于：
  - `src/shared/gitlab/types.ts`
  - `src/renderer/ipc/types.ts`

### GitLab 集成与合并编排

- `src/main/services/gitlabClient.ts`
  - GitLab HTTP 访问的唯一入口。
  - 封装项目/分支接口、MR 的创建与更新、合并操作、文件读取、提交创建、merge base 查询以及冲突相关接口。
  - 当 REST 冲突数据不完整时，还会回退使用 GitLab Web 端点，如 `conflicts.json`、`conflict_for_path`、`resolve_conflicts`。
  - 内含重试/退避逻辑，并会清洗诊断日志中的敏感请求头。
- `src/main/services/mergeService.ts`
  - 很薄的一层入口，实际逻辑委托给 merge strategy。
- `src/main/services/mergeStrategies/merge.ts`
  - 原子批量合并的核心流程：
    1. 为每个源/目标分支对创建或复用 MR。
    2. 等待每个 MR 进入可合并状态。
    3. 真正执行合并。
    4. 若在原子阶段出现冲突或失败，则回滚本次创建的 MR。
  - `noop` 情况包括 `source === target` 以及“没有可合并的变更”。

### 冲突处理流程

- `src/renderer/components/ConflictDialog.vue`
  - 冲突查看与手动解决的主 UI。
  - 这个组件较大，承载了大部分冲突处理流程。
- `src/main/services/localGitConflictService.ts`
  - 当 GitLab 标记 MR 存在冲突，但没有返回足够的文件细节时的兜底方案。
  - 它会将仓库克隆到临时目录，拉取 source/target 引用，通过 `git merge --no-commit` 发现冲突文件，再通过 `git show` 读取文件内容，并可通过 `git merge-file` 进行内容合并。
- `src/renderer/workers/conflictWorker.ts`
  - 将较重的冲突分析工作移出主 UI 线程。扩展冲突逻辑时请保留这个 worker 边界。

### 事件 / 数据流

典型流程如下：

1. Vue/Pinia 触发操作。
2. `src/renderer/ipc/bridge.ts` 发起 IPC 调用。
3. `electron/main.ts` 将请求分发到主进程服务。
4. 服务调用 GitLab API；必要时调用本地 git 辅助逻辑。
5. 主进程将进度事件 / 冲突事件回传给渲染进程。
6. 渲染进程中的 store / 组件更新 UI 并推进后续流程。

## 测试与 E2E 行为

- `vitest.config.ts` 使用 `jsdom`，并且只包含 `tests/**/*.test.ts`。
- `playwright.config.ts` 通过 `vite.e2e.config.ts` 启动一个普通的 Vite 服务，地址为 `http://127.0.0.1:4173`。
- E2E 模式是由 store 驱动的，不依赖真实 GitLab：
  - `src/renderer/store/auth.ts`
  - `src/renderer/store/projects.ts`
  - `src/renderer/store/merge.ts`
- 当 `VITE_E2E=1` 或 `MODE=e2e` 时，这些 store 会用可预测的假数据和进度日志替代真实的认证 / 项目 / 分支 / 合并行为。修改 store 逻辑时必须保留这些分支，否则 Playwright 覆盖会失效。

## 需要保留的仓库约定

- 该包使用 ESM（`"type": "module"`）。需要 CommonJS 的配置文件应保持 `.cjs` 形式，例如 `.eslintrc.cjs`。
- Naive UI 必须保持“原生”用法。测试已经在 Vue 模板层面强制此约束：
  - 不要直接给 `n-*` 组件添加 `class`、`style` 或 `size` 属性。
  - 不要在 `n-config-provider` 上设置 `theme-overrides`、`cls-prefix`、`namespace` 或 `breakpoints`。
  - 如需定制样式，使用外层包装元素与周边 CSS，而不是直接修改 Naive UI 组件。
- 继续统一从 `src/renderer/ui/naive.ts` 导入 Naive UI，不要把 `naive-ui` 的直接导入分散到各处。
- `App.vue` 和 `ConflictDialog.vue` 已经较大。新增功能时，优先把逻辑下沉到 store、service、worker 或更小的子组件中，不要继续往这两个文件塞无关职责。
- 构建产物位于 `dist/` 和 `dist-electron/`。打包后的 Electron 主入口是 `dist-electron/main.js`。
