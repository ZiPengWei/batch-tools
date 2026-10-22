# CNB 批量合并工具 (CNB Batch Merge Tool)

这是一个基于 **Electron** + **Vue 3** 构建的桌面应用程序，旨在帮助开发者高效地在 [CNB (cnb.cool)](https://cnb.cool) 仓库中执行多分支批量合并操作，简化发布流程中的分支管理。

## ✨ 主要特性

- **可视化操作界面**: 提供直观的源分支与目标分支选择界面，支持模糊搜索，快速定位分支。
- **智能分支管理**:
  - 自动识别并置顶核心环境分支（如 `dev`, `test`, `gray`）。
  - 支持多选目标分支，一次性将代码合并到多个环境。
- **独立批量合并**: 每个目标分支独立处理，互不影响：
  - 无变更 → 自动跳过。
  - **检测到冲突 → 跳过该分支并自动取消（关闭）对应 PR**。
  - 无冲突 → 直接合并。
  - 结束后汇总提示：哪些分支冲突、哪些分支成功合并。
- **实时日志反馈**: 在合并过程中实时展示操作日志，方便追踪进度和排查错误。
- **安全认证**: 支持通过 CNB 访问令牌（Access Token）进行安全连接与鉴权。

## 🛠️ 技术栈

本项目采用现代化的前端与桌面开发技术栈：

- **核心框架**: [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **桌面容器**: [Electron](https://www.electronjs.org/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **单元测试**: [Vitest](https://vitest.dev/)

## 🚀 开发环境设置

### 前置要求

- **Node.js**: 建议版本 v18 或更高
- **包管理器**: 推荐使用 [pnpm](https://pnpm.io/) (本项目使用 `pnpm` 进行依赖管理)

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动开发模式

此命令将同时启动 Vite 开发服务器和 Electron 应用窗口，支持热更新。

```bash
pnpm dev
```

### 3. 构建应用

构建生产环境的安装包（支持 macOS, Windows, Linux，具体取决于构建配置）。

```bash
pnpm build
```

### 4. 运行测试

运行单元测试以确保功能正常。

```bash
pnpm test
```

### 5. ESLint（Airbnb Base + Vue）

本项目使用 ESLint 做静态检查，规则集以 Airbnb JavaScript Base 为基础，并叠加 Vue 3 推荐规则与部分模板最佳实践规则。

```bash
pnpm lint
pnpm lint:fix
pnpm check
```

配置文件说明：

- 由于本项目 `package.json` 设置了 `"type": "module"`，ESLint 传统配置文件使用 `.eslintrc.cjs`（而不是 `.eslintrc.js`）以避免 ESM/CJS 加载冲突。

规则定制决策（与现有代码风格兼容）：

- `quotes` / `semi` 关闭：当前项目存在单双引号与分号风格混用，避免首次引入 ESLint 造成大面积改动。
- `import/no-unresolved` 关闭：在 TS + Vue SFC + bundler 模式下，解析 `.vue` 与部分构建期路径时更适合交给 TypeScript/Vite 处理，避免误报。
- `no-underscore-dangle` 关闭：Electron 主进程中使用 `__dirname` 等写法较常见。
- `vue/multi-word-component-names` 关闭：允许 `App` 等单词组件名。

IDE/编辑器建议（以 VS Code 为例）：

- 安装扩展：ESLint（dbaeumer.vscode-eslint）
- 启用保存自动修复（用户/工作区设置均可）：

```json
{
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "eslint.validate": ["javascript", "typescript", "vue"]
}
```

开发集成：

- `pnpm dev` 会通过 Vite 插件在开发过程中执行 ESLint 检查并输出问题（终端/覆盖层提示）。

## 📖 使用指南

1.  **创建访问令牌**: 登录 [cnb.cool](https://cnb.cool) → 个人设置 → 访问令牌，创建包含以下权限的令牌：
    - `account-profile:r`（验证令牌）
    - `account-engage:r`（获取仓库列表）
    - `repo-code:r`（获取分支、比较差异）
    - `repo-pr:rw`（创建/合并/取消 PR）
2.  **配置连接**: 启动应用后，输入 CNB API 地址（默认 `https://api.cnb.cool`）和访问令牌。
3.  **选择仓库**: 从列表中选择您要操作的仓库（以完整路径展示，如 `org/repo`）。
4.  **选择源分支**: 在左侧面板选择包含新代码的源分支（Source Branch）。
5.  **选择目标分支**: 在右侧面板勾选一个或多个需要合并到的目标分支（Target Branches）。
6.  **执行合并**: 点击底部的“合并”按钮并确认。
7.  **查看结果**: 合并结束后会弹出结果窗口，按分支展示：
    - ✓ 成功合并的分支
    - ✗ 存在冲突被跳过（PR 已自动取消）的分支
    - 失败/无变更的分支及原因

例如：`fix-1` 分支同时合并到 `dev` 和 `test`，若 `dev` 存在冲突，则跳过 `dev` 并取消其 PR，`test` 无冲突则直接合并；最终提示“存在冲突已跳过的分支: fix-1 -> dev”、“成功合并的分支: fix-1 -> test”。

## 📂 项目结构

```text
├── electron/        # Electron 主进程代码 (Main Process)
├── src/
│   ├── main/        # 核心业务逻辑 (CNB Client, Merge Service)
│   ├── renderer/    # 渲染进程代码 (Vue Components, Stores)
│   ├── shared/      # 前后端共享的类型定义
│   └── ...
├── tests/           # 单元测试文件
└── ...
```

## 🔌 CNB Open API 说明

应用通过 [CNB Open API](https://api.cnb.cool/) 与 CNB 交互，主要接口映射：

| 功能 | API |
|---|---|
| 验证令牌 | `GET /user` |
| 仓库列表 | `GET /user/repos?role=Developer`（分页） |
| 分支列表 | `GET /{repo}/-/git/branches`（分页） |
| 无变更预检 | `GET /{repo}/-/git/compare/{base...head}` |
| 创建 PR | `POST /{repo}/-/pulls` |
| 查询 PR（含冲突状态） | `GET /{repo}/-/pulls/{number}` |
| 查询已存在 PR | `GET /{repo}/-/pulls?state=open&base_ref=...` |
| 合并 PR | `PUT /{repo}/-/pulls/{number}/merge` |
| 取消（关闭）PR | `PATCH /{repo}/-/pulls/{number}` `{state: closed}` |

冲突判定基于 PR 的 `mergeable_state`（`conflict`）与 `blocked_on`（`code_conflict`）字段。

## 🎨 UI 规范：Naive UI 组件保持原生

- 禁止通过 `theme-overrides` / `cls-prefix` / `namespace` 等全局配置改变组件样式或类名前缀。
- 禁止在任意 `n-*` 组件上使用 `class` / `style` / `size` 等会改变表现的属性。
- 如必须定制，仅允许使用 Naive UI 官方提供的 props 或主题配置，并确保视觉与交互保持原生一致。
- 自动检查：运行 `pnpm test`（或 `pnpm check`）会包含使用规范检查用例，确保没有遗漏。
- 代码审查要点：Review 时重点检查新增/修改的 `n-*` 组件是否引入了额外样式或非默认配置。

## 布局与排版（黄金比例基准）

- 以 φ=1.618 作为间距与圆角的比例基准，使用 9/15/24/39px 作为主要间距梯度。
- 主容器最大宽度约 1618px（≈ 1000 × φ），在大屏下保持视觉密度稳定。
- 列表类文本默认允许自动换行，不使用省略号；通过更大的行高与轻微字间距提升可读性。

## 🖼️ 对比截图获取方式（优化前/后）

- 本项目为 Electron 应用，截图需在本机 GUI 环境中完成。
- 建议流程：先在改动前启动应用并截取主界面；应用改动后再次截取相同窗口尺寸的主界面，用于对比。
- 启动命令：`pnpm dev`，macOS 可用系统截图工具或 `⌘ + Shift + 4` 获取指定区域截图。

## License

[MIT](LICENSE)
