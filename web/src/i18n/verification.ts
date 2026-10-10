// Catalog partial: The verification report drawer.
//
// Owner: the verification agent (components/VerificationDrawer.tsx and
// scripts/e2e/verification.mjs). Keys here are new strings only, never moves
// out of another partial; a key that already exists in `common`/`status`/`
// library` (a generic Refresh/Cancel/Close, the status surface's own doctor
// label) is reused through the merged catalog instead of being redefined.
//
// The wording is the contract: an unrecorded receipt renders "Last
// verification: UNKNOWN — {reason}" (Chinese "上次验证：UNKNOWN — {reason}")
// with the daemon's own reason and never a time or a pass; a session result is
// labelled "in this browser session"; the full-bytes mode is named with its
// cost before it runs.
//
// Keys are the English message; values are the zh-CN translation. Every key
// lives in exactly one partial; `web/src/i18n.ts` merges them and keeps the
// public t()/Translator/Locale contract. `scripts/web-i18n-check.mjs` proves
// the split lost and duplicated nothing.

export const verification: Record<string, string> = {
  // --- chrome and framing ------------------------------------------------
  "Verification report": "验证报告",
  "Close verification report": "关闭验证报告",
  "INTEGRITY": "完整性",
  "This report states what the daemon has recorded about its restore points and runs a verification level only when you ask. It writes nothing, it never polls in the background, and anything this service did not record stays UNKNOWN.": "本报告说明服务进程已记录的恢复点事实，并且只在你主动请求时运行验证级别。它不写入任何内容，也不在后台轮询；此服务没有记录的结果一律保持 UNKNOWN。",
  "Restore points": "恢复点",
  "Read from snapshot.list: the freeze facts and the newest verification receipt the catalog records for each restore point. A receipt that does not exist is UNKNOWN with the daemon's reason; it is never a time and never a pass.": "数据来自 snapshot.list：每个恢复点的冻结事实，以及目录数据库记录的最新验证凭据。不存在的凭据显示为 UNKNOWN 并带上服务进程给出的原因；它绝不是时间，也绝不是通过。",
  "Reading verification record…": "正在读取验证记录……",
  "record read at {{time}} (this browser)": "记录读取于 {{time}}（本浏览器）",
  "Reading the verification record failed: {{message}}": "读取验证记录失败：{{message}}",
  "No restore point is published yet, so there is no verification record to report.": "尚未发布恢复点，因此没有可报告的验证记录。",
  "Newest restore point": "最新恢复点",
  "Frozen {{time}}": "冻结于 {{time}}",
  "manifest {{digest}}": "清单 {{digest}}",
  "entries {{entries}} · files {{files}}": "条目 {{entries}} · 文件 {{files}}",
  "bytes {{bytes}}": "字节 {{bytes}}",
  "the logical byte total is incomplete": "逻辑大小合计不完整",
  "exact-protected {{protected}} · unprotected {{unprotected}}": "精确保护 {{protected}} · 未保护 {{unprotected}}",
  "recorded outcomes: {{outcomes}}": "已记录结果：{{outcomes}}",
  "no protection mix is recorded": "未记录保护构成",
  // The freshness line over the restore points this drawer read. The time and
  // the age both come from the daemon's own recorded receipt; when no recorded
  // passing full-bytes receipt exists this line is absent rather than empty.
  "Last full-bytes verification: {{time}} · {{age}}": "上次全量校验：{{time}} · {{age}}",

  // --- the receipt line (RECORDED / UNRECORDED / FAILED / UNAVAILABLE) ---
  "Last verification: UNKNOWN — {{reason}}": "上次验证：UNKNOWN — {{reason}}",
  "this service reports no verification receipt and no reason": "此服务未报告验证凭据，也未报告原因",
  "Last verification: {{time}} · {{mode}} · {{outcome}} · ok {{ok}} · passed {{passed}}/{{attempted}} files · {{passedBytes}}/{{attemptedBytes}} bytes · restore verified {{restore}} · request {{request}}": "上次验证：{{time}} · {{mode}} · {{outcome}} · 通过 {{ok}} · 文件 {{passed}}/{{attempted}} · 字节 {{passedBytes}}/{{attemptedBytes}} · 恢复已验证 {{restore}} · 请求 {{request}}",
  "Verification failed — {{reason}} · scope {{mode}} · recorded {{time}} · attempted {{attempted}} files · passed {{passed}} files · request {{request}}": "验证失败 — {{reason}} · 范围 {{mode}} · 记录于 {{time}} · 尝试 {{attempted}} 个文件 · 通过 {{passed}} 个文件 · 请求 {{request}}",
  "Verification coverage unavailable — {{reason}} · scope {{mode}} · recorded {{time}} · attempted {{attempted}} files · passed {{passed}} files · request {{request}}": "验证覆盖不可用 — {{reason}} · 范围 {{mode}} · 记录于 {{time}} · 尝试 {{attempted}} 个文件 · 通过 {{passed}} 个文件 · 请求 {{request}}",
  "mode not reported": "未报告模式",
  "outcome not reported": "未报告结果",
  "yes": "是",
  "no": "否",

  // --- the levels and their cost -----------------------------------------
  "Verification levels and their cost": "验证级别及其成本",
  "authenticated-metadata: the manifest metadata is authenticated; repository bytes are not read.": "authenticated-metadata：仅认证清单元数据，不读取仓库字节。",
  "sampled-content: a deterministic sample of repository bytes is read.": "sampled-content：读取一份确定性的仓库字节抽样。",
  "full-bytes: every repository byte is read; this is the expensive full check.": "full-bytes：读取整个仓库字节；这是成本最高的完整检查。",
  "restore-drill: the members are restored to a destination and restore_verified is set; it writes the restored files.": "restore-drill：把成员恢复到目标目录并设置 restore_verified；它会写出恢复的文件。",
  "expensive": "高成本",
  "Run {{mode}} verification": "运行 {{mode}} 验证",
  "Verification runs are unavailable: {{reason}}": "无法运行验证：{{reason}}",
  "the service is unreachable": "服务不可达",
  "core storage is not ready": "核心存储尚未就绪",
  "another operation is running": "另一个操作正在运行",
  "no restore point is published yet, so there is nothing to verify": "尚未发布恢复点，因此没有可验证的对象",
  "Full-bytes verification reads every repository byte.": "full-bytes 验证会读取整个仓库字节。",
  "It can take a long time on a large repository, and this browser shows no progress percentage. Continue only when you want the read to happen now.": "在较大的仓库上这可能耗时很久，而且此浏览器不显示进度百分比。只有在你希望现在就执行这次读取时才继续。",
  "Yes, read every repository byte": "确认读取整个仓库字节",
  "Full-bytes confirmation": "full-bytes 确认",
  "Restore destination on the Cairn host": "Cairn 主机上的恢复目标目录",
  "restore-drill requires a destination on the Cairn host": "restore-drill 需要 Cairn 主机上的目标目录",
  "restore-drill writes the restored members to this directory; it never writes to the repository.": "restore-drill 会把恢复出来的成员写入此目录；它绝不会写入仓库。",

  // --- the running and session-result states -----------------------------
  "Running {{mode}} verification ({{cost}}) · elapsed {{elapsed}}": "正在运行 {{mode}} 验证（{{cost}}）· 已用 {{elapsed}}",
  "metadata only; repository bytes are not read": "仅元数据；不读取仓库字节",
  "reads a deterministic sample of repository bytes": "读取确定性的仓库字节抽样",
  "reads repository bytes": "读取仓库字节",
  "restores the members to the destination": "把成员恢复到目标目录",
  "No percentage is shown because this service reports no progress.": "不显示百分比，因为此服务不报告进度。",
  "Verified just now in this browser session · {{mode}} · passed {{passed}}/{{attempted}} files · {{passedBytes}}/{{attemptedBytes}} bytes": "刚刚在本浏览器会话中验证 · {{mode}} · 通过 {{passed}}/{{attempted}} 个文件 · {{passedBytes}}/{{attemptedBytes}} 字节",
  "restore verified": "恢复已验证",
  "This service recorded no receipt for this run, so this result is only a fact about this browser session. No time and no pass can be claimed for it, and any receipt row above keeps an earlier recorded receipt.": "此服务没有为本次运行记录凭据，因此该结果只是本浏览器会话的事实。不能为它声明时间或通过；上方凭据行仍显示此前记录的凭据（如果有）。",
  "The daemon recorded a receipt for this run; the restore-point receipt above is the record.": "服务进程为本次运行记录了凭据；上方恢复点凭据行才是记录。",
  "Verification failed — {{reason}}": "验证失败 — {{reason}}",
  "This failure belongs to the {{mode}} scope.": "该失败属于 {{mode}} 范围。",
  "The daemon reported this coverage as unavailable: the bytes this mode requires could not be read. Unavailability is not a pass.": "服务进程报告此覆盖不可用：该模式所需的字节无法读取。不可用不等于通过。",
  "The run ended without a recorded result — outcome UNKNOWN.": "本次运行结束时没有已记录的结果 — 结果 UNKNOWN。",
  "Reason: {{reason}}": "原因：{{reason}}",

  // --- the doctor check ---------------------------------------------------
  "Doctor check (reads repository bytes)": "体检检查（读取仓库字节）",
  "The doctor check reads repository bytes and full-bytes-verifies the newest restore point when one is published. It runs only when you ask, and it records no verification receipt of its own.": "体检检查会读取仓库字节，并在已有恢复点时对最新恢复点做 full-bytes 验证。它只在你主动请求时运行，并且自身不记录验证凭据。",
  "Run doctor check in the verification report": "在验证报告中运行体检检查",
  "Doctor check receipt: {{result}} · {{count}} checks · read at {{time}} (this browser session)": "体检检查凭据：{{result}} · {{count}} 项检查 · 读取于 {{time}}（本浏览器会话）",
  "all core checks passed": "所有核心检查通过",
  "one or more core checks failed": "一项或多项核心检查失败",
  "The byte-reading doctor check has not been run from this report in this browser session.": "本浏览器会话尚未从本报告运行读取字节的体检检查。",
  "the doctor check did not answer in this report: {{message}}": "体检检查未在本报告中应答：{{message}}",
  "The daemon records no receipt for a doctor check; the restore-point receipt above stays unrecorded.": "服务进程不为体检检查记录凭据；上方的恢复点凭据仍保持未记录。",
  "ok": "通过",
  "failed": "失败",

  // --- placement facts (per loaded subject, never catalog truth) ----------
  "Placement facts (representation.list)": "放置事实（representation.list）",
  "Placement facts: UNKNOWN — {{reason}}": "放置事实：UNKNOWN — {{reason}}",
  "this build exposes no catalog-wide missing/mismatched/untracked placement count": "此构建没有目录级的缺失/不一致/未跟踪放置计数",
  "no subject is attached to this report, so no per-subject placement could be read; the drawer mount passes no subject from the shell in this build": "本报告没有关联任何主题，因此无法读取按主题的放置事实；此构建中抽屉挂载没有从外壳传入主题",
  "Placements over {{count}} loaded subjects: {{missing}} missing · {{unverified}} not verified · {{present}} present — a bounded client-side count, not a catalog-wide fact": "已加载 {{count}} 个主题的放置情况：缺失 {{missing}} · 未验证 {{unverified}} · 存在 {{present}} — 这是有界的客户端计数，不是目录级事实",
  "Representation {{class}} · {{fidelity}} · placement {{placement}} · verified {{verified}}": "表示 {{class}} · {{fidelity}} · 放置 {{placement}} · 已验证 {{verified}}",
  "verified not reported": "未报告验证状态",
  "Reading placement facts…": "正在读取放置事实……",
  "representation.list did not answer in this browser session: {{message}}": "本次浏览器会话中 representation.list 未应答：{{message}}",
};
