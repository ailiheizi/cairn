// Catalog partial: The trusted status surface.
//
// Owner: components/StatusPanel.tsx (health facts, service reachability, core
// storage, capacity, discovery-index and recovery-point projections). The
// status agent owns this file, styles/status.css, and scripts/e2e/status.mjs.
//
// Keys are the English message; values are the zh-CN translation. Every key
// lives in exactly one partial; `web/src/i18n.ts` merges them and keeps the
// public t()/Translator/Locale contract. `scripts/web-i18n-check.mjs` proves
// the split lost and duplicated nothing.

export const status: Record<string, string> = {
  "Checking service": "正在检查服务",
  "Connected": "已连接",
  "Unavailable": "不可用",
  "Could not connect to RestoreWeave service. Start the service, then refresh.": "无法连接 RestoreWeave 服务。请启动服务后刷新。",
  "RestoreWeave returned an invalid response.": "RestoreWeave 服务返回了无效响应。",
  // The upload transport (app/command.ts uploadFiles) shares the fail-closed
  // messages above; this one covers its empty-selection guard.
  "Choose at least one file to upload.": "请先选择要上传的文件。",
  "RestoreWeave service is unavailable": "RestoreWeave 服务不可用",
  "Start the service, then refresh this page. Saved content has not been changed.": "请启动服务后刷新页面。已保存的内容没有被修改。",
  "System readiness": "系统状态",
  "SYSTEM READY": "核心存储已就绪",
  "Exact repository": "原始内容仓库",
  "Catalog ready": "目录数据库就绪",
  "Catalog unavailable": "目录数据库不可用",
  "Repository unavailable": "内容仓库不可用",
  "Core storage status unavailable": "核心存储状态暂不可用",
  "Service connected, but core storage is unavailable: {{component}}": "服务已连接，但核心存储不可用：{{component}}",
  "Core storage unavailable": "核心存储不可用",
  "Service connected, but catalog is unavailable.": "服务已连接，但目录数据库不可用。",
  "Keyword search": "关键词搜索",
  "Semantic ready": "语义搜索就绪",
  "Semantic offline": "语义搜索离线",
  "Semantic search ready": "语义搜索已就绪",
  "Recovery point ready": "恢复点就绪",
  "No recovery point": "暂无恢复点",
  "Capacity": "容量",
  "Total": "总容量",
  "Used": "已用",
  "Physical repository capacity": "内容仓库物理容量",
  "Not published yet": "尚未发布",
  "Recovery point": "恢复点",

  // --- The trusted status surface (components/StatusPanel.tsx) -------------
  //
  // Every fact row renders exactly one of
  //   PROVEN · {value} · {as-of}
  //   UNKNOWN — {reason}
  //   DEGRADED — {reason}
  //   FAILED — {reason}
  // so a fact this build cannot source says UNKNOWN and names the missing
  // capability instead of showing zero or a healthy default.
  //
  // The body groups those rows: "Protection and recovery" holds the facts the
  // headline may draw from, "Discovery" holds the search/index facts, and
  // "Not sourced by this build" holds the facts whose only source is an
  // operation this build does not have.
  "Health: {{fact}}": "健康：{{fact}}",
  "all protection and recovery facts proven": "所有保护与恢复事实均已证明",
  "Protection and recovery": "保护与恢复",
  "Discovery": "检索与发现",
  "Not sourced by this build": "此构建无法提供来源",
  "{{count}} facts": "{{count}} 项事实",
  "service unreachable": "服务不可达",
  // The proven form of each headline fact. A fact's name is its alarm wording,
  // so a proven panel must name the proven form instead of reading "unproven".
  "service reachable": "服务可达",
  "repository available": "仓库可用",
  "writability and capacity proven": "写入能力与容量已证明",
  "catalog available": "目录数据库可用",
  "catalog schema current": "目录架构为当前版本",
  "verification proven": "验证已证明",
  "protection proven": "保护状态已证明",
  "repository unproven": "仓库尚未证明",
  "catalog unproven": "目录数据库尚未证明",
  "catalog schema unproven": "目录架构尚未证明",
  "Reading service facts…": "正在读取服务事实……",
  "Every health fact states what this browser can prove now. UNKNOWN names the missing source; it is never a zero or a healthy default.": "每条健康事实都只说明本浏览器当前能够证明的内容。UNKNOWN 会指出缺失的来源，绝不表示零或默认健康。",
  "Open verification report": "打开验证报告",
  "Details": "详情",
  "Open activity": "打开活动",
  "Run doctor check": "运行体检检查",
  "Running...": "运行中……",
  "The doctor check reads repository bytes; this browser never runs it automatically.": "体检检查会读取仓库字节；本浏览器不会自动运行它。",
  "Refresh facts": "刷新事实",
  "as of {{time}} (this browser)": "截至 {{time}}（本浏览器）",
  "Cannot prove any health fact while the service is unreachable": "服务不可达时无法证明任何健康事实",
  "the service did not answer this browser session": "服务未在本次浏览器会话中应答",
  "the service has not answered yet in this browser session": "服务尚未在本次浏览器会话中应答",
  "this browser session has not read the service yet": "本次浏览器会话尚未读取服务",
  "Service: reachable": "服务：可达",
  "the repository at {{path}} did not open": "仓库 {{path}} 未能打开",
  "this service reports no repository fact": "此服务未报告仓库事实",
  "Repository: {{path}} · profile {{profile}} · {{count}} restore points": "仓库：{{path}} · 配置 {{profile}} · {{count}} 个恢复点",
  "profile not reported": "未报告配置",
  "Writability: writable": "写入能力：可写",
  "probed {{time}}": "探测于 {{time}}",
  "not probed (this build reports no repository write probe)": "未探测（此构建不报告仓库写入探测）",
  "the repository is read-only: {{reason}}": "仓库为只读：{{reason}}",
  "the write probe did not answer: {{reason}}": "写入探测未应答：{{reason}}",
  "reason not reported": "未报告原因",
  "Capacity: {{total}} total · {{free}} free · {{used}} used": "容量：总 {{total}} · 可用 {{free}} · 已用 {{used}}",
  "measured {{time}}": "测量于 {{time}}",
  "capacity was not measured: {{reason}}": "未测量容量：{{reason}}",
  "this service reports no capacity measurement": "此服务未报告容量测量",
  "the catalog at {{path}} did not open": "目录数据库 {{path}} 未能打开",
  "this service reports no catalog fact": "此服务未报告目录数据库事实",
  "Catalog: {{path}}": "目录数据库：{{path}}",
  "Catalog schema: version {{version}} ({{migration}})": "目录架构：版本 {{version}}（{{migration}}）",
  "the migration ledger was not read: {{reason}}": "未能读取迁移记录：{{reason}}",
  "this service reports no catalog schema state": "此服务未报告目录架构状态",
  "No catalog subject count operation exists in this build.": "此构建没有目录主题计数操作。",
  "Last freeze: {{time}} · {{count}} published restore points": "最近冻结：{{time}} · 已发布 {{count}} 个恢复点",
  "Last freeze: no restore point is published yet": "最近冻结：尚未发布任何恢复点",
  "Last materialize: {{time}} · manifest {{digest}}": "最近输出：{{time}} · 清单 {{digest}}",
  "Last materialize: no export manifest is frozen yet": "最近输出：尚未冻结任何导出清单",
  "Last verification: {{time}} · {{mode}} · files {{passed}}/{{attempted}}": "上次验证：{{time}} · {{mode}} · 文件 {{passed}}/{{attempted}}",
  "Verification failed: {{reason}}": "验证失败：{{reason}}",
  "Verification coverage is degraded: {{reason}}": "验证覆盖已降级：{{reason}}",
  "no verification receipt is recorded (service reason: {{reason}})": "尚无验证凭据（服务原因：{{reason}}）",
  "no restore point is published yet": "尚未发布任何恢复点",
  "snapshot.list did not answer in this browser session: {{message}}": "本次浏览器会话中 snapshot.list 未应答：{{message}}",
  "export.list did not answer in this browser session: {{message}}": "本次浏览器会话中 export.list 未应答：{{message}}",
  "Protection: {{protected}} of {{files}} files exact-protected · {{unprotected}} unprotected": "保护：{{files}} 个文件中有 {{protected}} 个已精确保护 · {{unprotected}} 个未保护",
  "Protection: the newest restore point has no regular files": "保护：最新恢复点没有普通文件",
  "the newest restore point reports no protection mix": "最新恢复点未报告保护构成",
  "logical byte total incomplete": "逻辑大小合计不完整",
  "Doctor gates: {{count}} checks passed · checked {{time}}": "体检门禁：{{count}} 项检查通过 · 检查于 {{time}}",
  "{{id}}: {{message}}": "{{id}}：{{message}}",
  "the byte-reading doctor check has not been run in this browser session": "读取字节的体检检查尚未在本次浏览器会话中运行",
  "Lexical index: {{state}}": "词法索引：{{state}}",
  "Semantic index: {{state}}": "语义索引：{{state}}",
  "no index generation is published for this workspace": "此工作区尚未发布索引代次",
  "capability.list reports {{id}} as {{state}}": "capability.list 报告 {{id}} 为 {{state}}",
  "no operation lists portable recovery record exports in this build": "此构建没有列出可移植恢复记录导出的操作",
  "Jobs: {{count}} durable jobs recorded · newest {{state}} at {{time}}": "作业：已记录 {{count}} 个持久作业 · 最新 {{state}} 于 {{time}}",
  "Jobs: no durable job is recorded yet": "作业：尚未记录任何持久作业",
  "subject counts unproven": "主题计数尚未证明",
  "last freeze unproven": "最近冻结尚未证明",
  "last materialize unproven": "最近输出尚未证明",
  "verification unproven": "验证状态尚未证明",
  "protection mix unproven": "保护构成尚未证明",
  "doctor gates unproven": "体检门禁尚未证明",
  "lexical index unproven": "词法索引尚未证明",
  "semantic index unproven": "语义索引尚未证明",
  "portable record exports unproven": "可移植记录导出尚未证明",
  "job state unproven": "作业状态尚未证明",
  "capability.list reports no state for this dimension": "capability.list 未报告该维度的状态",
  "doctor.check did not answer: {{message}}": "doctor.check 未应答：{{message}}",
  "Image index: {{state}}": "图像索引：{{state}}",
  "image index unproven": "图像索引尚未证明",
  "Text in images: {{state}}": "图片文字（OCR）：{{state}}",
  "text-in-image extraction unproven": "图片文字提取尚未证明",
  "capability.list reports no state for this component": "capability.list 未报告该组件的状态",
};
