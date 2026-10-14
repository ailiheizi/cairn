# Cairn

[中文](README.md) · [English](README.en.md)

<p align="center">
  <strong>自部署、更好用的私人网盘</strong><br>
  存进自己的空间，找得到、用得上、带得走。
</p>

<p align="center">
  <a href="#当前状态"><img src="https://img.shields.io/badge/status-unreleased_core_preview-8b5cf6?style=flat-square" alt="状态：未发行核心预览版"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-4ed8b0?style=flat-square" alt="许可证：MIT"></a>
  <a href="go.mod"><img src="https://img.shields.io/badge/go-1.26-79c2ff?style=flat-square" alt="Go 1.26"></a>
</p>

> Cairn 面向 NAS 与家庭存储爱好者：把文件放进自己的空间，通过统一搜索找到它们，再用舒服的照片、音乐和资料界面使用、下载原件。当前 `main` 是 `v0.1.0-prealpha.1` 之后的未发行开发预览，不是生产发行版。正式安装包、生产仓库资格、LinkGroup 和完整多平台发行保证仍在后续阶段。

<p align="center">
  <img src="docs/assets/screenshots/unreleased/library-zh.png" alt="Cairn 资料库开发预览：内容搜索、Notes、批量标签和索引状态" width="1100">
</p>
<p align="center"><sub>当前本地开发预览中的演示资料。</sub></p>

[5 分钟启动](#5-分钟启动) · [核心能力](#核心能力) · [Wiki](docs/wiki/README.md) · [完整文档](docs/README.md) · [变更记录](CHANGELOG.md)

## 核心能力

- **轻松存入**：选择或拖入文件，自动准备本次文件清单，确认后保存原件；也可导入 NAS 上已有的目录。
- **找到内容**：关键词、结构化条件、标签和 Notes 一起检索；显式安装并校验本地 BGE bundle 后还可使用语义搜索。
- **保留上下文**：名称、来源路径、文件事实、多个标签和一个 Notes 界面随内容保留。
- **批量整理**：对当前所选内容添加或移除标签、批量收藏；普通资料列表支持按显示顺序扩展选择范围。
- **带走原件**：预览受支持内容，下载原始文件，或导出并校验文件字节。
- **减少重复**：以完整内容的 SHA-256 和逻辑长度识别相同文件，重复内容只保存一份。

Cairn 把文件原件与描述、发现、导出和恢复放在一个自托管内容库中。照片和音乐已有专属界面，其他文件通过通用资料库检索和取出。可识别格式不代表一定能预览或播放；视频目前没有专属影视体验，见下文。日常组织以内容、标签和检索为中心；原始目录保留为来源和恢复依据。

## 一次使用流程

```text
首次配置自己的存储位置
→ 选择或拖入文件，也可导入 NAS 目录
→ 核对本次文件，确认存入
→ 搜索、收藏、加标签、写备注
→ 在照片、音乐或资料界面使用
→ 下载原件，或导出、恢复并校验
```

## 5 分钟启动

需要 Go 1.26（或 `go.mod` 声明的版本）以及 Vite 7 支持的 Node.js：

```bash
git clone https://github.com/ailiheizi/restoreweave.git
cd restoreweave
go build -tags=purego -o bin/cairnd ./server/cmd/cairnd
go build -o bin/cairn ./client/cmd/cairn
bin/cairn config init --path ./cairn.toml
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
bin/cairnd --config ./cairn.toml --socket /tmp/cairnd.sock

# 终端 2
cd web
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/`。当前 API 只按 loopback convenience adapter 设计，不要直接暴露到公网。完整配置、来源检查和恢复步骤见 [Wiki 快速开始](docs/wiki/quick-start.md)。

## 真实界面

以下截图来自当前本地开发预览。

<details>
<summary>照片浏览与检查</summary>

<p align="center"><img src="docs/assets/screenshots/unreleased/photos-zh.png" alt="照片墙、照片检查和共享选择操作" width="1100"></p>
<p align="center"><sub>当前本地开发预览中的演示资料。</sub></p>

照片墙、连续查看和展厅共用当前内容范围。查看器与展厅支持选择照片，并返回现有批量操作区域；图片读取仍受当前大小和像素预算限制。
</details>

<details>
<summary>音乐浏览与队列</summary>

<p align="center"><img src="docs/assets/screenshots/unreleased/music-zh.png" alt="音乐列表、排序与队列操作" width="1100"></p>
<p align="center"><sub>当前本地开发预览中的演示资料。</sub></p>

音乐列表可按已有曲目事实排序，并筛选可尝试原件播放的项目。队列支持追加、插到当前曲目之后、排序、单次随机播放后续曲目和循环；插入下一首不会打断当前曲目。浏览器是否能解码仍取决于音频格式。
</details>

<details>
<summary>添加文件</summary>

<p align="center"><img src="docs/assets/screenshots/unreleased/protection-plan-zh.png" alt="选择或拖入文件，核对后确认保存" width="1100"></p>
<p align="center"><sub>当前本地开发预览中的演示资料。</sub></p>

选择或拖入文件后，添加流程会准备本次文件清单供核对；暂存不代表已保存。只有用户明确确认保存，内容才会写入受保护资料库。
</details>

## 当前状态

当前本地开发预览包含照片墙、连续查看和展厅；照片检查可选择项目并跳转至共用批量操作区。音乐浏览曲目及服务已有的艺人／专辑事实，可对已加载列表排序、筛选符合原件播放尝试条件的项目，并操作暂态队列。插入下一首会放在当前曲目之后且不重启当前播放；队列支持追加、排序、单次随机播放后续曲目和循环。未知事实保留在末尾或未知分组，浏览器解码不作保证。页面及完整界面通过项目内编译注册，默认保持简单。

照片墙与展厅是“照片”下的展示方式，共用当前搜索和标签结果；照片查看器和展厅中的选择会联动到同一批量操作区。“音乐”在同一已返回结果范围内呈现曲目和已有音频标签。工作台与内容展厅是另一层整体界面布局。页面和布局由项目内代码编译注册，不提供运行时第三方插件加载或安全隔离。

普通资料库列表支持 Shift 点击，在当前已显示行顺序内选择包含首尾的范围；照片／音乐各自的局部筛选不扩大这个范围。批量添加标签会复用所选内容上已存在的同名标签，移除只作用于匹配的 `TAG`，保留其他标签与 Notes。照片、音乐和分类总览中的星标与“仅看收藏”共用可见的 `Favorite` 用户标签。它是日常标签捷径，不是相册或歌单；标记不会立即生成新的签名便携备份。策展相册和可重复曲目的持久歌单仍待独立组织、恢复与导出契约审查。

“分类总览”可在同一搜索／标签范围内一起浏览照片、音频和其他资料，直接选择、打开详情或使用共享播放器。每个分区最多展示六项，并区分展示数量与当前范围数量；切换至照片或音乐不重新搜索。资料库和分类总览可直接访问“已保存的检索”；照片和音乐需从资料库工具入口打开。保存只接受已提交且受支持的查询条件；照片／音乐的显示选择或其他不支持的活动条件会被明确拒绝。召回会重新执行动态词法查询，并显示空结果、降级或不同存储范围，不代表固定语义结果。相册与持久歌单已有[候选设计](docs/technical/durable-media-organization-design.md)，尚未实现。详见[总览验收](docs/technical/fixed-overview-acceptance-20261009.md)。

所选原件可以下载为逐文件校验的 ZIP，支持进度和取消；照片墙和展厅支持 8 MiB／1200 万像素以内的 PNG、JPEG 临时缩略图，并可直接查看大图。ZIP 当前限 32 个文件、单文件 32 MiB、合计 64 MiB；更大的内容仍可单独下载原件或导出至服务器目录。显式图片查看限 8 MiB，音频原件播放限 32 MiB。照片相册、拍摄日期／EXIF 提取、持久缩略图、封面提取、持久歌单和完整移动端旅程仍待完成。

### 视频与其他文件

视频文件目前通过通用资料库进行保存、搜索和原件取出；不提供专属视频／影视资料库或视频播放，也没有系列／集数组织、字幕、观看进度、Bangumi 或弹幕功能。未知格式是否能预览仍取决于实际支持。上述专属视频能力尚未实现。

这些 Photos/Music 和取出能力属于 [RW-PERSONAL-UX-1](docs/requirements/first-party-client-experiences.md) 的本地开发范围；完整产品及发布资格仍未完成。详见 [ADR-027](docs/technical/build-stack-and-architecture-selection.md#adr-027-frozen-original-zip-takeout-and-transient-ordinary-photo-renditions)、[扩展贡献指南](docs/technical/client-experience-extension-guide.md)和[本轮验收](docs/technical/takeout-photo-acceptance-20261009.md)。

### 已实现并测试（当前开发配置）

- TOML 配置、明确的数据路径、来源扫描、保护计划和确认写入。
- SHA-256 + 长度身份、整文件精确去重、Notes、多个用户标签、关键词/结构化搜索。
- 真实 BGE-small-zh + ONNX + zvec 组件可在明确安装并校验的模型包上运行；没有模型包时会诚实降级为普通搜索。
- SavedView（保存的视图）、ExportManifest（导出清单）、materialize/verify、签名恢复、clean reader、篡改拒绝、迁移和跨进程安全证据（均为本地开发范围）。
- 资料库批量组织：对捕获的所选项目幂等添加标签、移除匹配标签、批量收藏／取消收藏；普通列表的 Shift 范围选择按当前显示行顺序包含首尾。
- Photos 与 Music 的本地开发切片：照片墙／展厅和检查中联动的选择；已记录艺人和专辑浏览、受限且身份校验的原件播放、音乐列表排序／资格筛选、追加和插入下一首等暂态队列控制，以及已命名词法检索。策展相册、持久歌单和完整移动体验仍待完成。
- 资料库和分类总览可直接打开现有“已保存的检索”面板；照片／音乐保留在资料库工具内。支持的查询可动态召回，不支持的条件、空结果、降级和其他存储范围会如实呈现。
- Photos、Music 与资料总览共用现有 `Favorite` TAG 星标及筛选；它不建立相册／歌单成员关系，也不承诺点击后立即更新签名备份。
- React WebUI 与 loopback `/api/v1` 便利接口；窄屏布局和中文界面。
- 设置 → 外观可切换“工作台”和“内容展厅”两套内置布局；共用内容、搜索和 Notes，配色是独立的次级选项。详见[本地验收记录](docs/technical/client-interface-experiences-acceptance-20261006.md)。

### 候选、计划或明确不做

- `local-zstd-v1` 是可运行的整文件压缩候选，不是生产仓库；Restic/Kopia/Plakar 也尚未被选为默认引擎。
- 正式离线安装包、跨平台发行、升级/备份和生产资格仍需独立验证。
- LinkGroup 是后续的最小文件链接组；当前没有组版本历史，也没有实现完整页面流程。
- 视频目前只有通用内容保存、搜索和原件取出；专属影视库、播放、系列／集数、字幕、观看进度、Bangumi 和弹幕均未实现。
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
