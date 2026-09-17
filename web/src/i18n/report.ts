// Catalog partial: the selection report (Tier-1 spec §3 item 7).
//
// Owner: lib/report.ts and components/SelectionBar.tsx, asserted by
// scripts/e2e/report.mjs. These keys cover the bar action, its one-line
// description, its success/failure message, and the document's own labels —
// the document follows the operator's locale, so a Chinese operator gets a
// Chinese report from the same code path.
//
// Several chrome strings intentionally stay in other partials and are only
// referenced here, because a key may live in exactly one partial: note source
// labels and the representation states come from `descriptionKindLabel` and the
// inspector vocabulary ("User note", "Imported note", "Extracted note",
// "AI note", "Unknown note type", "Note source unavailable", "Verified exact
// bytes", "Exact copy is present but not verified", "Exact copy is missing or
// failed verification", "No authoritative exact copy reported", "Untitled
// subject", "revision {{revision}}", "Not accepted", "Body unavailable" in the
// library partial; "yes" in verification; "Saved" in settings; and
// "No published workspace is reported by this service in this browser yet."
// in duplicates). `scripts/web-i18n-check.mjs` fails on a duplicate key, so
// this partial must not redefine them.

export const report: Record<string, string> = {
  // --- the bar action -------------------------------------------------------
  "Download Markdown": "下载 Markdown",
  "Download this selection as Markdown": "将此选择下载为 Markdown",
  "Reads the selected subjects' tags, notes, representations, and protection outcomes from this daemon with bounded concurrency, then downloads one Markdown file in this browser. Nothing is uploaded and nothing is stored.": "以受限并发从本服务读取所选项目的标签、备注、表示和保护结果，然后在本浏览器中下载一个 Markdown 文件。不会上传任何内容，也不会保存任何状态。",
  "Reading {{count}} selected subjects...": "正在读取 {{count}} 个所选项目……",
  "Selection report downloaded: {{read}} of {{total}} subjects read, {{failed}} could not be read, {{skipped}} not read.": "选择报告已下载：已读取 {{read}}/{{total}} 个项目，{{failed}} 个无法读取，{{skipped}} 个未读取。",
  "Could not build the selection report: {{message}}": "无法生成选择报告：{{message}}",

  // --- the document header --------------------------------------------------
  "RestoreWeave selection report": "RestoreWeave 选择报告",
  "Generated: {{local}} ({{utc}})": "生成时间：{{local}}（{{utc}}）",
  "Selection source: {{source}}": "选择来源：{{source}}",
  "search.query results for \"{{query}}\"": "“{{query}}”的 search.query 结果",
  "the library listing (content.list)": "已加载的内容库列表（content.list）",
  "Selected subjects: {{count}}": "所选项目数：{{count}}",
  "Read scope: {{operations}}": "读取范围：{{operations}}",
  "Subjects read: {{read}} of {{total}}": "已读取的项目：{{read}}/{{total}}",
  "Subjects that could not be read: {{count}}": "无法读取的项目：{{count}}",
  "Subjects not read (this report reads at most {{cap}} subjects): {{count}}": "未读取的项目（本报告最多读取 {{cap}} 个项目）：{{count}}",
  "Built in this browser from the reads named above. A fact the daemon did not report is written as UNKNOWN with its reason. Nothing was uploaded and no daemon state was changed.": "本文件由本浏览器根据上述读取结果生成。服务未报告的事实一律标注为 UNKNOWN 并附上原因。全程没有上传，也没有改动服务端状态。",

  // --- one subject section --------------------------------------------------
  "Provenance path: {{value}}": "来源路径：{{value}}",
  "the daemon did not report a provenance path for this entry": "服务没有报告此条目的来源路径",
  "Entry type: {{value}}": "条目类型：{{value}}",
  "the daemon did not report an entry type for this entry": "服务没有报告此条目的条目类型",
  "Logical size: {{value}}": "逻辑大小：{{value}}",
  "the daemon did not report a logical size for this entry": "服务没有报告此条目的逻辑大小",
  "{{display}} ({{bytes}} bytes)": "{{display}}（{{bytes}} 字节）",
  "{{bytes}} bytes": "{{bytes}} 字节",
  "Exact identity (SHA-256): {{value}}": "精确身份（SHA-256）：{{value}}",
  "Logical length: {{value}}": "逻辑长度：{{value}}",
  "the daemon did not report a content identity for this entry": "服务没有报告此条目的内容身份",
  "the daemon did not report a logical length for this entry": "服务没有报告此条目的逻辑长度",
  // "UNKNOWN — {{reason}}" is the shared fact vocabulary and already lives in
  // the tags partial; referencing it here is intentional, not a redefinition.
  "Protection outcome (daemon): {{value}}": "保护结果（服务报告）：{{value}}",
  "Exact representation: {{value}}": "原始表示：{{value}}",
  "No representation is reported for this subject.": "服务没有报告此项目的表示。",
  "Exact representation record: {{value}}": "原始表示记录：{{value}}",
  "class:": "类别：",
  "placement:": "放置：",
  "verified:": "已校验：",
  "codec:": "编解码配置：",
  "fidelity:": "保真度：",
  "User tags: {{value}}": "用户标签：{{value}}",
  "no user tags are recorded for this subject": "此项目没有记录用户标签",
  "this subject's tags could not be read": "无法读取此项目的标签",
  "Notes:": "备注：",
  "Notes: {{value}}": "备注：{{value}}",
  "no notes are recorded for this subject": "此项目没有记录备注",
  "this subject's notes could not be read": "无法读取此项目的备注",
  "Notes could not be read in full: {{reason}}": "备注未能完整读取：{{reason}}",
  "Not one read succeeded for this subject: {{reason}}": "此项目的所有读取都失败了：{{reason}}",

  // --- read failures the document must keep visible --------------------------
  "the daemon's protection axis did not claim an outcome for this subject": "服务的保护轴没有为此项目声明任何结果",
  "the protection axis did not answer in this browser": "保护轴未在本浏览器中应答",
  "the daemon reported that this subject's note history is truncated; older revisions are not included here": "服务报告此项目的备注历史已被截断；这里不包含更早的版本",
  "the note body was not read": "未读取备注正文",
  "the daemon answered the note read for a different subject": "服务的备注读取应答属于另一个项目",
  "the daemon answered the representation read for a different subject": "服务的表示读取应答属于另一个项目",
  "this subject has no stable subject reference in the listing": "此项目在列表中没有稳定的主题引用",
  "this report reads at most {{cap}} subjects": "本报告最多读取 {{cap}} 个项目",
};
