# AGENTS.md

本文件为 AI 编程助手（Claude Code、Codex 等）在本仓库中工作时提供指引。

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

这是一个基于 Electron + Vue 3 的桌面应用，用于在 CNB (cnb.cool) 仓库中批量合并分支。

### 运行时分层

- `electron/main.ts`
  - 负责 Electron 应用与窗口生命周期。
  - 注册全部 IPC 处理器（`cnb:*` 前缀与 `shell:open-external`）。
  - 实例化主进程服务：`CnbClient`、`MergeService`。
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
  - 主界面外壳，负责认证、仓库选择、源分支选择、目标分支选择以及对话框流程编排。
- Pinia stores 承担大部分渲染层状态：
  - `src/renderer/store/auth.ts` — CNB 认证（API 地址 + 访问令牌）、本地持久化设置（localStorage key `cnb-auth`）、E2E 认证绕过。
  - `src/renderer/store/projects.ts` — 仓库列表、分支列表与选择状态（仓库以完整路径字符串 `org/repo` 标识，存于 `selectedRepo`）。
  - `src/renderer/store/merge.ts` — 目标分支选择、批量合并运行状态、流式日志与分支级结果摘要。
- 共享类型位于：
  - `src/shared/cnb/types.ts`
  - `src/renderer/ipc/types.ts`

### CNB 集成与合并编排

- `src/main/services/cnbClient.ts`
  - CNB Open API（https://api.cnb.cool/）HTTP 访问的唯一入口。
  - 认证方式：`Authorization: Bearer <token>`。
  - 封装：用户信息（`GET /user`）、仓库列表（`GET /user/repos?role=Developer`，分页）、分支列表、分支比较（无变更预检）、PR 的创建/查询/合并/关闭，以及按源+目标分支查找已存在的 open PR。
  - 仓库路径会逐段 URL 编码（支持多级组织 `a/b/c`）。
  - 内含重试/退避逻辑（429/5xx）。
- `src/main/services/mergeService.ts`
  - 很薄的一层入口，实际逻辑委托给 merge strategy。
- `src/main/services/mergeStrategies/merge.ts`
  - 批量合并的核心流程（每个目标分支独立处理，互不影响）：
    1. `source === target` 或比较无新提交 → 跳过（noop）。
    2. 为每个源/目标分支对创建 PR，或复用已存在的同源同目标 open PR。
    3. 轮询 PR 的 `mergeable_state` / `blocked_on`：
       - `mergeable` → 直接调用合并接口。
       - `conflict` / `blocked_on=code_conflict` / `no-merge-base` → **跳过该分支并关闭（取消）PR**，记入 conflicts。
       - `state=merged` → 视为成功（可能被手动合并）。
    4. 全部处理完后汇总日志与结果：merged / conflicts / noop / failures。
  - 结果 `MergeResult.ok` 仅在没有任何冲突与失败时为 true。

### 事件 / 数据流

典型流程如下：

1. Vue/Pinia 触发操作。
2. `src/renderer/ipc/bridge.ts` 发起 IPC 调用（`cnb:*`）。
3. `electron/main.ts` 将请求分发到主进程服务。
4. 服务调用 CNB Open API。
5. 主进程将进度事件（`cnb:batch-merge-log`）回传给渲染进程。
6. 渲染进程中的 store / 组件更新 UI（确认弹窗实时日志、结果弹窗分支明细）。

## 测试与 E2E 行为

- `vitest.config.ts` 使用 `jsdom`，并且只包含 `tests/**/*.test.ts`。
- `playwright.config.ts` 通过 `vite.e2e.config.ts` 启动一个普通的 Vite 服务，地址为 `http://127.0.0.1:4173`。
- E2E 模式是由 store 驱动的，不依赖真实 CNB：
  - `src/renderer/store/auth.ts`
  - `src/renderer/store/projects.ts`
  - `src/renderer/store/merge.ts`
- 当 `VITE_E2E=1` 或 `MODE=e2e` 时，这些 store 会用可预测的假数据和进度日志替代真实的认证 / 仓库 / 分支 / 合并行为。修改 store 逻辑时必须保留这些分支，否则 Playwright 覆盖会失效。

## 发版流程（触发词："发版"）

当用户说"发版"（可附带版本号，如"发版 1.1.0"；未附带时默认递增 patch 位）时，按以下顺序执行：

1. **前置检查**：
   - `git status` 确认工作区干净；有未提交改动则先按惯例提交（fix 分支）。
   - `pnpm check`（typecheck + 全部测试）必须全绿，失败则中止发版并报告。
2. **递进版本号**：修改 `package.json` 的 `version`（唯一版本来源），提交（`chore: release v{X.Y.Z}`）。
3. **同步远程**：`git push origin fix` → `git checkout master && git merge fix --ff-only && git push origin master && git checkout fix`。
4. **打 tag**：annotated 标签 `v{X.Y.Z}`（附中文版本说明，列出主要功能与修复），`git push origin v{X.Y.Z}`。**若 tag 已存在，中止并询问用户，不得覆盖**。
5. **打包**：完整构建 mac dmg 与 Windows 便携 exe（单文件，无安装包）。沙盒环境下必须剥离钩子与代理变量：
   ```sh
   env -u CODEBUDDY_BROKERED_FS_HOOK_ENABLED -u NODE_OPTIONS -u BASH_ENV -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy \
     ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
     sh -c 'pnpm build && npx electron-builder && npx electron-builder --win --x64'
   ```
   产物在 `release/{version}/`：`CNB-Tools-Mac-{version}.dmg`、`CNB-Tools-Windows-{version}.exe`。
6. **创建/更新 Release 并上传**：
   - 令牌从项目根目录 `.env.local` 读取（`GITHUB_TOKEN`），仓库地址读 `GITHUB_REPO`。**不要在命令行参数、日志或对话中明文输出令牌**；用 `export GH_TOKEN=$(grep '^GITHUB_TOKEN=' .env.local | cut -d= -f2)` 方式载入。
   - 用 GitHub API 创建 Release（`POST /repos/{repo}/releases`，tag_name 对应版本，name 与 body 用中文写功能/修复摘要）。
   - 逐个 `POST https://uploads.github.com/repos/{repo}/releases/{id}/assets?name=...` 上传产物（`Content-Type: application/octet-stream`，`--data-binary @文件`）。
   - **同版本 Release 已存在时**：更新它——复用已有 release id，删除同名旧资产后重新上传，并追加更新说明。
   - 上传后调 `GET /repos/{repo}/releases/latest` 比对资产 `size` 与本地字节数，必须完全一致才算成功。
7. **收尾**：向用户报告 Release 链接（`https://github.com/{repo}/releases/tag/v{X.Y.Z}`）与资产清单；提醒可在 GitHub 设置中轮换令牌。

### 令牌文件 `.env.local`

- 位置：项目根目录 `.env.local`，**已被 `.gitignore` 忽略，严禁提交、严禁粘贴到对话或复制到其他文件**。
- 内容：`GITHUB_TOKEN=<GitHub fine-grained PAT>`（需 Contents 读写权限）、`GITHUB_REPO=<owner/repo>`。
- 令牌失效（API 返回 401/403）时，提示用户到 GitHub → Settings → Developer settings → Fine-grained tokens 重新生成并更新该文件，不要把新令牌写进代码或提交。
- 新同事/新环境：复制本文件格式自行创建，该文件不入库。

## 需要保留的仓库约定

- 该包使用 ESM（`"type": "module"`）。需要 CommonJS 的配置文件应保持 `.cjs` 形式，例如 `.eslintrc.cjs`。
- Naive UI 必须保持“原生”用法。测试已经在 Vue 模板层面强制此约束：
  - 不要直接给 `n-*` 组件添加 `class`、`style` 或 `size` 属性。
  - 不要在 `n-config-provider` 上设置 `theme-overrides`、`cls-prefix`、`namespace` 或 `breakpoints`。
  - 如需定制样式，使用外层包装元素与周边 CSS，而不是直接修改 Naive UI 组件。
- 继续统一从 `src/renderer/ui/naive.ts` 导入 Naive UI，不要把 `naive-ui` 的直接导入分散到各处。
- `App.vue` 已经较大。新增功能时，优先把逻辑下沉到 store、service 或更小的子组件中，不要继续往这个文件塞无关职责。
- 构建产物位于 `dist/` 和 `dist-electron/`。打包后的 Electron 主入口是 `dist-electron/main.js`。

## 历史迁移说明

- 本项目早期版本面向 GitLab（数字 projectId + PRIVATE-TOKEN），并内置冲突解决弹窗（ConflictDialog）与本地 git 冲突检测（localGitConflictService）。
- v2.1 起迁移到 CNB：仓库以路径字符串标识，认证改为 Bearer Token；应用内冲突解决流程已整体移除，改为“冲突 → 跳过并取消 PR”的独立处理策略。相关旧组件与测试已删除，不要恢复它们。
