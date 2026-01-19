# GitLab 批量合并工具 (GitLab Batch Merge Tool)

这是一个基于 **Electron** + **Vue 3** 构建的桌面应用程序，旨在帮助开发者高效地在 GitLab 项目中执行多分支批量合并操作，简化发布流程中的分支管理。

## ✨ 主要特性

- **可视化操作界面**: 提供直观的源分支与目标分支选择界面，支持模糊搜索，快速定位分支。
- **智能分支管理**:
  - 自动识别并置顶核心环境分支（如 `dev`, `test`, `gray`）。
  - 支持多选目标分支，一次性将代码合并到多个环境。
- **原子批量合并**: 核心合并逻辑支持原子化操作，确保合并流程的可控性。
- **冲突处理机制**:
  - 内置冲突检测功能。
  - 提供可视化冲突解决弹窗 (`ConflictDialog`)，辅助处理合并冲突。
- **实时日志反馈**: 在合并过程中实时展示操作日志，方便追踪进度和排查错误。
- **安全认证**: 支持通过 GitLab Personal Access Token 进行安全连接与鉴权。

## 🛠️ 技术栈

本项目采用现代化的前端与桌面开发技术栈：

- **核心框架**: [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **桌面容器**: [Electron](https://www.electronjs.org/)
- **状态管理**: [Pinia](https://pinia.vuejs.org/)
- **编辑器组件**: [Monaco Editor](https://microsoft.github.io/monaco-editor/) (用于代码查看与冲突解决)
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

1.  **配置连接**: 启动应用后，输入您的 GitLab 实例地址（URL）和 Personal Access Token。
2.  **选择项目**: 从列表中选择您要操作的 GitLab 项目。
3.  **选择源分支**: 在左侧面板选择包含新代码的源分支（Source Branch）。
4.  **选择目标分支**: 在右侧面板勾选一个或多个需要合并到的目标分支（Target Branches）。
5.  **执行合并**: 点击底部的“开始批量合并”按钮。
6.  **处理冲突**: 如果合并过程中发生冲突，应用会弹出冲突解决对话框，请根据提示解决冲突并提交。

## 📂 项目结构

```text
├── electron/        # Electron 主进程代码 (Main Process)
├── src/
│   ├── main/        # 核心业务逻辑 (GitLab Client, Merge Service)
│   ├── renderer/    # 渲染进程代码 (Vue Components, Stores)
│   ├── shared/      # 前后端共享的类型定义
│   └── ...
├── tests/           # 单元测试文件
└── ...
```

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
