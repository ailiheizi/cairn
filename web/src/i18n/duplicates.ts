// Catalog partial: the duplicate-group review surface (Tier-1 spec §3 item 4).
//
// Owner: components/DuplicatesSurface.tsx and scripts/e2e/duplicates.mjs. The
// keys are exactly the strings that surface renders: the scope label that
// bounds the grouping to the loaded workspace listing, the per-member facts
// (path, logical size, entry type, protection outcome, representation,
// placement), the non-destructive review controls (selection, tag, note, copy
// path), and the loading/empty/blocked/partial states.
//
// A few chrome strings intentionally stay in other partials and are only
// referenced here, because they name an action another surface owns and a key
// may live in exactly one partial: "WORKSPACE" (common), "Original path",
// "Logical size", "Protection", "Tags", "Notes", "{{count}} selected",
// "Deselect {{name}}", "Add tag", "Add note" (library), and the
// "UNAVAILABLE" state label "Unavailable" (status).
// `scripts/web-i18n-check.mjs` fails on a duplicate key, so this partial must
// not redefine them.

export const duplicates: Record<string, string> = {
  // --- surface chrome and the scope label -----------------------------------
  "Duplicate groups": "重复分组",
  "Duplicate groups over {{count}} loaded subjects": "已加载 {{count}} 个主题中的重复分组",
  "Groups are computed in this browser from the workspace listing the daemon returned. The daemon's duplicate-group filter can answer one group's members, but this build cannot enumerate duplicate groups catalog-wide.": "分组是本浏览器根据服务返回的工作区列表计算得出的。服务的 duplicate-group 过滤器可以回答某一组的成员，但此构建无法列出全目录范围的重复分组。",
  "Listing read at {{time}} (this browser)": "列表读取于 {{time}}（本浏览器）",
  "The workspace listing has not been read in this browser yet": "本浏览器尚未读取工作区列表",
  "Refresh duplicate groups": "刷新重复分组",
  "Reading the workspace listing…": "正在读取工作区列表……",

  // --- the review contract --------------------------------------------------
  "Each member is a separate subject that happens to share the same exact bytes: the same SHA-256 content identity and the same logical length. Removing one subject does not touch the bytes the other members point at, and this view cannot delete, move, or merge anything.": "每个成员都是各自独立的主题，只是恰好共享相同的精确字节：相同的 SHA-256 内容身份和相同的逻辑长度。移除其中一个主题不会触及其他成员所指向的字节，而本视图也无法删除、移动或合并任何内容。",
  "This review offers selection, tags, notes, and path copying only. It has no delete, no move, no merge, and no keep-one action.": "此审阅只提供选择、标签、备注和复制路径。它没有删除、没有移动、没有合并，也没有“保留其中一个”的操作。",
  "Duplicate groups are read from the workspace listing this service returns; no grouping is ever inferred from similarity.": "重复分组读取自服务返回的工作区列表；任何分组都不会依据相似度来推断。",

  // --- one group ------------------------------------------------------------
  "Exact identity {{digest}} · logical length {{bytes}}": "精确身份 {{digest}} · 逻辑长度 {{bytes}}",
  "{{count}} members": "{{count}} 个成员",
  "The daemon's duplicate-group filter confirms all {{count}} rendered members of this group.": "服务的 duplicate-group 过滤器确认了本组已呈现的全部 {{count}} 个成员。",
  "The daemon's duplicate-group filter reports {{daemon}} subjects; this listing renders {{rendered}}.": "服务的 duplicate-group 过滤器报告了 {{daemon}} 个主题；本列表呈现了 {{rendered}} 个。",
  "The daemon's duplicate-group filter could not confirm this group: {{message}}": "服务的 duplicate-group 过滤器无法确认本组：{{message}}",
  "Member facts are not read for this group yet.": "尚未读取本组的成员事实。",
  "Reading member facts…": "正在读取成员事实……",
  "Read member facts": "读取成员事实",
  "Member facts could not be read: {{message}}": "无法读取成员事实：{{message}}",

  // --- one member -----------------------------------------------------------
  "Member {{index}} of group {{group}}": "第 {{group}} 组的第 {{index}} 个成员",
  "Select {{name}} for tagging": "选择 {{name}} 以便添加标签",
  "Selected": "已选择",
  "Open details": "打开详情",
  "Close details": "关闭详情",
  "Copy path": "复制路径",
  "Path copied": "已复制路径",
  "The path could not be copied; the full path is shown on the member.": "无法复制路径；完整路径仍显示在成员卡片上。",
  "Entry type": "条目类型",
  "Representation": "表示",
  "Note for {{name}}": "{{name}} 的备注",
  "Note added to this member.": "已为此成员添加备注。",
  "No durable note is recorded for this member.": "此成员尚未记录持久备注。",
  "The note could not be saved: {{message}}": "无法保存备注：{{message}}",
  "Allow note text before the note can be added.": "请先填写备注内容再添加。",
  "Tag for the selected members": "为所选成员添加标签",
  "Tag added to every selected member.": "已为所有所选成员添加标签。",
  "Tag added to {{added}} of {{total}} selected members. The other writes failed: {{reason}}": "已为 {{total}} 个所选成员中的 {{added}} 个添加标签。其余写入失败：{{reason}}",
  "Tagging applies to selected members only and changes no bytes.": "添加标签只作用于所选成员，不会改变任何字节。",

  // --- per-member facts -----------------------------------------------------
  "Exact representation: class {{class}} · fidelity {{fidelity}} · verified {{verified}} · codec {{codec}}": "精确表示：类别 {{class}} · 保真度 {{fidelity}} · 已验证 {{verified}} · 编解码 {{codec}}",
  "Placement": "物理放置",
  "Reading the member's representation…": "正在读取成员的表示……",
  "No representation is recorded for this member.": "此成员未记录任何表示。",
  "Representation read failed: {{message}}": "读取表示失败：{{message}}",
  "Protection: {{label}} ({{token}})": "保护：{{label}}（{{token}}）",
  "Exact protected": "已精确保护",
  "Exact fallback (bytes still exact)": "精确回退（字节仍精确）",
  "External replayable": "外部可重放",
  "Link only, unprotected": "仅链接，未受保护",
  "Explicitly unprotected": "明确未受保护",
  "Blocked": "已阻止",
  "Not claimed by the daemon's protection axis": "服务的保护轴未声明",
  "The protection axis could not be read: {{reason}}": "无法读取保护轴：{{reason}}",
  "the daemon did not report a protection generation for this workspace": "服务没有为此工作区报告保护代",
  "Placement: {{label}} ({{token}})": "放置：{{label}}（{{token}}）",
  "Present in the repository": "存在于仓库中",
  "Missing from the repository": "在仓库中缺失",
  "Unknown — the daemon did not probe this content": "未知——服务没有探测此内容",

  // --- partial listing ------------------------------------------------------
  "Some member facts could not be read": "部分成员事实无法读取",
  "Partial listing: {{count}} member fact reads failed; each affected fact shows UNKNOWN with its own reason.": "列表不完整：{{count}} 个成员事实读取失败；每个受影响的事实都会连同原因显示为 UNKNOWN。",
  "The durable tags and notes could not be read, so member tags and notes are shown as unavailable: {{message}}": "无法读取持久标签和备注，因此成员标签和备注显示为不可用：{{message}}",

  // --- empty and blocked ----------------------------------------------------
  "No duplicate groups over {{count}} loaded subjects": "已加载 {{count}} 个主题中没有重复分组",
  "This is not proof that no duplicates exist catalog-wide. The listing the daemon returned for this workspace contains {{count}} subjects and no exact-identity group of two or more was found among them.": "这不能证明全目录不存在重复。服务为此工作区返回的列表包含 {{count}} 个主题，其中没有找到两个或以上的精确身份分组。",
  "Duplicate groups are not readable right now": "当前无法读取重复分组",
  "No published workspace is reported by this service in this browser yet.": "此服务尚未在本浏览器中报告任何已发布的工作区。",
};
