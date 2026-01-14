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
- 自动检查：运行 `pnpm test`（或 `pnpm lint`）会包含使用规范检查用例，确保没有遗漏。
- 代码审查要点：Review 时重点检查新增/修改的 `n-*` 组件是否引入了额外样式或非默认配置。

## 📄 License

[MIT](LICENSE)
