# Cairn

[中文](README.md) · [English](README.en.md)

<p align="center">
  <strong>自托管的个人内容中枢</strong><br>
  存进自己的空间，找得到、用得上、带得走。
</p>

<p align="center">
  <a href="#当前状态"><img src="https://img.shields.io/badge/status-unreleased_core_preview-8b5cf6?style=flat-square" alt="状态：未发行核心预览版"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4ed8b0?style=flat-square" alt="许可证：MIT"></a>
  <a href="go.mod"><img src="https://img.shields.io/badge/go-1.26-79c2ff?style=flat-square" alt="Go 1.26"></a>
</p>

> Cairn 面向 NAS 与家庭存储爱好者，主张“自托管的个人内容中枢”：存进自己的空间，找得到、用得上、带得走。当前 `main` 是 `v0.1.0-prealpha.1` 之后的未发行开发预览，不是生产发行版。正式安装包、生产仓库资格、LinkGroup 和完整多平台发行保证仍在后续阶段。

<p align="center">
  <img src="docs/assets/screenshots/unreleased/library-zh.png" alt="Cairn 内容优先主页：搜索、多标签、Notes、保护与索引状态" width="1100">
</p>
<p align="center"><sub>开发版 WebUI，使用仓库文档构造的脱敏演示数据。</sub></p>

[5 分钟启动](#5-分钟启动) · [核心能力](#核心能力) · [Wiki](docs/wiki/README.md) · [完整文档](docs/README.md) · [变更记录](CHANGELOG.md)

## 核心能力

- **放入并确认**：选择文件或服务器文件夹，先查看计划，再确认是否精确保留。
- **找到内容**：关键词、结构化条件、标签和 Notes 一起检索；显式安装并校验本地 BGE bundle 后还可使用语义搜索。
- **保留上下文**：名称、来源路径、文件事实、多个标签和一个 Notes 界面随内容保留。
- **带走原件**：预览受支持内容，下载原始文件，或导出并校验文件字节。
- **减少重复**：以完整内容的 SHA-256 和逻辑长度识别相同文件，重复内容只保存一份。

Cairn 的方向是把照片、音频、视频、文档和其他可读文件放进同一内容库，共享内容身份、搜索、标签、Notes、访问、导出和恢复。它仍是内容、发现、导出和恢复层，不是网盘文件系统、挂载服务或 OpenList fork。未知格式可以按声明范围精确保留，但不承诺解析或播放。

## 一次使用流程

```text
配置存储位置
→ 检查要加入的来源
→ 预览并确认保护计划
→ 保存精确内容并复用重复对象
→ 搜索、加标签、维护 Notes
→ 导出或恢复并校验原始字节
```

## 5 分钟启动

需要 Go 1.26（或 `go.mod` 声明的版本）以及 Vite 7 支持的 Node.js：

```bash
git clone https://github.com/ailiheizi/restoreweave.git
cd restoreweave
go build -tags=purego -o bin/restoreweaved ./server/cmd/restoreweaved
go build -o bin/rw ./client/cmd/rw
bin/rw config init --path ./restoreweave.toml
```

在配置中启用本机 WebUI API：

```toml
[api]
enabled = true
listen = "127.0.0.1:4534"
```

分别启动 daemon 和前端：

```bash
# 终端 1
bin/restoreweaved --config ./restoreweave.toml --socket /tmp/restoreweaved.sock

# 终端 2
cd web
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/`。当前 API 只按 loopback convenience adapter 设计，不要直接暴露到公网。完整配置、来源检查和恢复步骤见 [Wiki 快速开始](docs/wiki/quick-start.md)。

## 真实界面

<details>
<summary>查看添加来源时的存储计划预览</summary>

<p align="center">
  <img src="docs/assets/screenshots/unreleased/protection-plan-zh.png" alt="添加来源前的真实存储计划：逻辑大小、新增空间和重复内容" width="1100">
</p>

预览不会写入文件字节；重复复用和新增空间会在确认前明确显示。
</details>

## 当前状态

当前本地开发体验已包含照片墙、连续查看和沉浸展厅，以及音乐曲目／艺人／专辑浏览、原件播放、队列排序、随机播放后续曲目和循环控制。艺人和专辑来自服务已记录的音频标签，缺失信息保留文件名和未知分组。页面及完整界面已有独立的编译注册入口，默认保持简单，后续内容体验可以持续扩展。

照片墙与展览是“照片”下的两种展示方式，共用当前搜索和标签结果；“音乐”也在同一已返回结果范围内呈现曲目和已有音频标签。工作台与内容展厅是另一层整体界面布局。页面和布局通过项目审阅、编译进客户端的代码扩展，目前不提供运行时第三方插件加载或安全隔离。

照片、音乐和资料总览中的星标与“仅看收藏”共用可见的 `Favorite` 用户标签和现有标签操作。它是日常标签捷径，不是相册或歌单；标签保存在现有资料库中，但每次标记不会立即生成新的签名便携备份。策展相册和可重复曲目的持久歌单仍待独立组织、恢复与导出契约审查。

“资料总览”可在同一搜索／标签范围内一起浏览照片、音频和其他资料，直接选择、打开详情或使用共享播放器。每个分区最多展示六项，并明确区分展示数量与当前范围数量；切换至照片或音乐不重新搜索。相册与持久歌单已有[候选设计](docs/technical/durable-media-organization-design.md)，尚未实现。详见[总览验收](docs/technical/fixed-overview-acceptance-20261009.md)。

所选原件现在可以下载为一个经逐文件校验的 ZIP，支持进度和取消；照片墙和展厅支持 8 MiB／1200 万像素以内的 PNG、JPEG 临时缩略图，并可直接查看大图。ZIP 当前限 32 个文件、单文件 32 MiB、合计 64 MiB，更大的内容仍可单独下载原件或导出至服务器目录。显式图片查看限 8 MiB，音频原件播放限 32 MiB。本机浏览器已实际验证混合原件 ZIP、同名文件、空文件、大图与方向显示。照片相册、拍摄日期／EXIF 提取、持久缩略图、封面提取、持久歌单和完整移动端旅程仍待完成。详见 [ADR-027](docs/technical/build-stack-and-architecture-selection.md#adr-027-frozen-original-zip-takeout-and-transient-ordinary-photo-renditions)、[扩展贡献指南](docs/technical/client-experience-extension-guide.md)和[本轮验收](docs/technical/takeout-photo-acceptance-20261009.md)。这是 [RW-PERSONAL-UX-1](docs/requirements/first-party-client-experiences.md) 的本地开发范围；完整产品及发布资格仍未完成。

### 已实现并测试（当前开发配置）

- TOML 配置、明确的数据路径、来源扫描、保护计划和确认写入。
- SHA-256 + 长度身份、整文件精确去重、Notes、多个用户标签、关键词/结构化搜索。
- 真实 BGE-small-zh + ONNX + zvec 组件可在明确安装并校验的模型包上运行；没有模型包时会诚实降级为普通搜索。
- SavedView（保存的视图）、ExportManifest（导出清单）、materialize/verify、签名恢复、clean reader、篡改拒绝、迁移和跨进程安全证据（均为本地开发范围）。
- Photos 与 Music 的本地开发切片：照片墙／展厅、已记录艺人和专辑浏览、经长度与 SHA-256 校验的受限原件播放、队列排序／随机／循环，以及已命名词法检索；策展相册、持久歌单和完整移动体验仍待完成。
- Photos、Music 与资料总览共用现有 `Favorite` TAG 星标及筛选；它不建立相册／歌单成员关系，也不承诺点击后立即更新签名备份。
- React WebUI 与 loopback `/api/v1` 便利接口；窄屏布局和中文界面。
- 设置 → 外观可切换“工作台”和“内容展厅”两套内置布局；共用内容、搜索和 Notes，配色是独立的次级选项。详见[本地验收记录](docs/technical/client-interface-experiences-acceptance-20261006.md)。

### 候选、计划或明确不做

- `local-zstd-v1` 是可运行的整文件压缩候选，不是生产仓库；Restic/Kopia/Plakar 也尚未被选为默认引擎。
- 正式离线安装包、跨平台发行、升级/备份和生产资格仍需独立验证。
- LinkGroup 是后续的最小文件链接组；当前没有组版本历史，也没有实现完整页面流程。
- 图片 CLIP/SigLIP、音乐特征索引、RWKV/Transformer 压缩和破坏性 GC 不属于当前默认核心；reachability 保持 `NON_DESTRUCTIVE_ONLY`。

“已实现并测试”只表示当前声明范围有执行证据，不等于生产支持。完整状态矩阵在 [内容、去重、搜索与导出规范](docs/requirements/content-store-views-and-exports.md) 和 [核心执行计划](docs/technical/core-mvp-execution-plan.md)。

## 深入文档

- [Wiki 总览](docs/wiki/README.md)：用人话解释日常操作和边界。
- [详细能力参考](docs/wiki/capability-reference.md)：配置、存储、搜索、Notes、恢复和状态的完整说明。
- [快速开始](docs/wiki/quick-start.md) · [存储与容量](docs/wiki/storage-and-capacity.md) · [索引与搜索](docs/wiki/index-status-and-search.md) · [恢复与边界](docs/wiki/recovery-and-boundaries.md)
- [文档地图](docs/README.md)：规范、ADR、技术计划和资格记录的入口。
- [内容存储与导出规范](docs/requirements/content-store-views-and-exports.md) · [核心执行顺序](docs/technical/core-mvp-execution-plan.md)
- [变更记录](CHANGELOG.md)

## 许可

源码采用 [MIT License](LICENSE)。模型权重、tokenizer、ONNX Runtime、zvec、第三方依赖和未来安装 bundle 仍分别遵循各自的许可证与再分发条件。
