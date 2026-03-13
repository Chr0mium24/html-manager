# HTML Manager（纯 GitHub 存储版）

一个纯前端的 HTML 项目管理器。

- 无自建后端
- 数据直接写入 GitHub 仓库（Contents API）
- 支持项目/版本管理、在线编辑、下载备份、PWA 安装

## 1. 项目形态

当前分支已经改为纯静态前端实现：

- 页面入口：`index.html`
- 启动入口：`app.js`
- 功能模块：`modules/*.js`
- 样式：`styles.css`
- 离线缓存：`service-worker.js`

不再依赖 Python/FastAPI/SQLite。

## 2. 本地启动

本项目是静态站点，请用任意静态服务器启动（不要直接双击 `index.html`）。

例如：

```bash
python3 -m http.server 18237
```

然后访问：

```text
http://localhost:18237
```

## 3. 首次配置

点击右上角设置按钮，填写：

- `GitHub Owner`：仓库所有者（例如 `Chr0mium24`）
- `GitHub Repo`：仓库名（例如 `html-manager`）
- `GitHub Branch`：分支名，默认 `content`
- `Storage Root`：存储根目录，默认 `html-projects`
- `ghp_token`：管理员登录令牌（在登录弹窗输入）

## 4. Token 权限要求

建议使用 Fine-grained PAT，并仅授予目标仓库最小权限。

至少需要：

- Repository permissions -> `Contents: Read and write`

如果仓库是私有并且需要校验仓库访问，也建议给：

- `Metadata: Read`

## 5. 仓库内数据结构

应用会在目标仓库中写入：

```text
html-projects/
  index.json
  projects/
    <projectId>/
      versions/
        <versionId>.html
```

其中：

- `index.json` 记录项目元数据与版本索引
- HTML 文件是每个版本的实际内容

## 6. 主要功能

- 项目列表与版本列表
- 上传 HTML 新建项目
- 为项目追加新版本
- 在线编辑版本 HTML（Ace Editor）
- 重命名项目、重命名版本
- 删除项目、删除版本
- 下载单个版本 / 下载仓库 ZIP 备份
- 粘贴或拖拽 HTML 快速创建

## 7. 模块划分

- `modules/context.js`：全局配置、状态、`window.app`
- `modules/core-module.js`：基础工具函数与通用 UI
- `modules/github-module.js`：GitHub API + 索引读写（含统一保存函数 `saveGitHubFile`）
- `modules/auth-module.js`：登录、设置、Token 校验
- `modules/view-module.js`：列表/详情渲染与导航
- `modules/content-module.js`：上传、编辑、删除、备份等业务动作
- `modules/events-module.js`：输入、键盘、粘贴、拖拽等事件绑定

## 8. 注意事项

- Token 目前保存在浏览器本地存储，请仅在可信环境使用。
- 多端并发修改同一索引时，应用会进行一次冲突重试，但仍建议避免高并发同时编辑。
- 若使用 PWA，更新后若出现旧缓存，请刷新或清理 Service Worker 缓存。
