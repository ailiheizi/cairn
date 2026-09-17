// Catalog partial: the tags surface (Tier-1 spec §3 item 8).
//
// Owner: components/TagsSurface.tsx and scripts/e2e/tags.mjs. The keys are
// exactly the strings that surface renders: the durable tag vocabulary and its
// subject counts, the per-subject tag record facts, the add/remove controls,
// the previewed rename/merge path with its partial-failure report, and the
// loading/empty/blocked states.
//
// A number of keys intentionally stay in other partials and are only
// referenced here, because the concept they name already belongs to the
// surface that owns it and a key may live in exactly one partial: "WORKSPACE"
// and "Library" (common), "Tags" (library), "UNKNOWN — not reported by this
// build" (activity), and the protection vocabulary the duplicate review owns —
// "Protection: {{label}} ({{token}})", "Exact protected",
// "Exact fallback (bytes still exact)", "External replayable",
// "Link only, unprotected", "Explicitly unprotected", "Blocked",
// "Unavailable", "Not claimed by the daemon's protection axis",
// "the daemon did not report a protection generation for this workspace", and
// "No published workspace is reported by this service in this browser yet."
// `scripts/web-i18n-check.mjs` fails on a duplicate key, so this partial must
// not redefine them.

export const tags: Record<string, string> = {
  // --- surface chrome, the scope label, and the truth note ------------------
  "{{tags}} tags over {{subjects}} subjects with a live record": "{{tags}} 个标签，覆盖 {{subjects}} 个带有存续记录的主题",
  "Refresh tag vocabulary": "刷新标签词汇表",
  "Reading the durable tag vocabulary…": "正在读取持久标签词汇表……",
  "Tag vocabulary read at {{time}} (this browser)": "标签词汇表读取于 {{time}}（本浏览器）",
  "The tag vocabulary has not been read in this browser yet": "本浏览器尚未读取标签词汇表",
  "Every row here is a durable TAG annotation record the daemon returned for this workspace. The name is the stored body, shown exactly as recorded; this surface never normalizes, lowercases, or merges two names, and it applies no machine suggestion.": "此处的每一行都是服务为此工作区返回的持久 TAG 注释记录。名称就是存储的正文，按记录原样显示；本表面绝不规范化、转为小写或合并两个名称，也不会应用任何机器建议。",
  "A rename or merge is a previewed sequence of per-subject writes: the new name is added, then the old record is deleted. Nothing is rewritten in place, and the preview lists every subject before any write is issued.": "重命名或合并是一系列按主题、经预览的写入：先添加新名称，再删除旧记录。不会就地改写任何内容，并且预览会在发出任何写入之前列出每个主题。",

  // --- the empty and blocked states ----------------------------------------
  "No live tag is recorded in this workspace yet": "此工作区尚未记录任何存续标签",
  "This list reads the daemon's live TAG annotation records only: a name appears while at least one subject carries it, and a deleted tag is tombstoned instead of being kept as an empty row. Adding a tag to a subject in the library inspector, in the duplicate review, or in this surface's per-subject controls creates the first record.": "此列表只读取服务的存续 TAG 注释记录：只要至少一个主题带有某个名称，该名称就会出现；被删除的标签会置为墓碑，而不会保留为空行。在内容库检查器、重复项审阅或本表面的单主题操作中为某个主题添加标签，就会创建第一条记录。",
  "Tags are not readable right now": "当前无法读取标签",
  "The durable tag vocabulary could not be read: {{message}}": "无法读取持久标签词汇表：{{message}}",

  // --- the tag list and its filter -----------------------------------------
  "Filter tag names": "筛选标签名称",
  "Filter by substring": "按子字符串筛选",
  "Showing {{shown}} of {{total}} tags. Filtering matches a substring of the stored name; it never rewrites or merges a name.": "显示 {{total}} 个标签中的 {{shown}} 个。筛选按存储名称的子字符串匹配；它绝不改写或合并名称。",
  "No stored tag name contains this substring. Nothing was rewritten or merged by filtering.": "没有任何存储的标签名称包含此子字符串。筛选没有改写或合并任何内容。",
  "Tag names with their subject counts": "标签名称及其主题数量",
  "Use the arrow keys to move between tags, Enter to open a tag's subjects, and Escape to return to the navigation rail.": "使用方向键在标签之间移动，按 Enter 打开标签的主题，按 Escape 返回导航栏。",
  "Tag {{name}}, {{count}} subjects": "标签 {{name}}，{{count}} 个主题",
  "{{count}} subject": "{{count}} 个主题",
  "{{count}} subjects": "{{count}} 个主题",

  // --- one tag's subjects ---------------------------------------------------
  "Select a tag to see the subjects that carry it and the per-subject controls.": "选择一个标签以查看带有它的主题以及针对单个主题的操作。",
  "{{count}} subject carries this tag": "{{count}} 个主题带有此标签",
  "{{count}} subjects carry this tag": "{{count}} 个主题带有此标签",
  "This name has no live record left; the applied record below names every subject the change touched.": "此名称已不再有存续记录；下方的已应用记录列出了本次变更涉及的每个主题。",
  "This tag name is the stored body. The identity of a tag row is that exact name plus the subject's own record, so two names that differ only in case stay two separate rows.": "此标签名称就是存储的正文。标签行的身份是该确切名称加上主题自身的记录，因此仅大小写不同的两个名称保持为两行。",
  "The workspace listing could not be read, so names and provenance paths are shown as UNKNOWN: {{message}}": "无法读取工作区列表，因此名称和出处路径显示为 UNKNOWN：{{message}}",
  "Subjects carrying {{name}}": "带有 {{name}} 的主题",
  "Subject {{name}}": "主题 {{name}}",
  "Record {{annotation_id}} · revision {{revision}}": "记录 {{annotation_id}} · 修订 {{revision}}",
  "Protection: reading the daemon's protection axis…": "保护：正在读取服务的保护轴……",
  "Protection: UNKNOWN — {{reason}}": "保护：UNKNOWN — {{reason}}",
  "UNKNOWN — {{reason}}": "UNKNOWN — {{reason}}",
  "Subject reference": "主题引用",
  "Tag record": "标签记录",
  "Record revision": "记录修订号",
  "Record updated at": "记录更新于",
  "Protection state": "保护状态",
  "Provenance path": "出处路径",
  "Open in library": "在内容库中打开",
  "The library opens through this shell's navigation rail, and this build's library applies no inbound tag filter, so this tag's subject set stays listed here.": "内容库通过此外壳的导航栏打开，此构建的内容库不应用入口标签筛选，因此该标签的主题集合仍在本页面列出。",
  "The library view was opened through the navigation rail. This build's library has no inbound tag filter, so this tag's subject set stays listed here.": "已通过导航栏打开内容库视图。此构建的内容库不接受标签作为入口筛选，因此该标签的主题集合仍在本页面列出。",
  "The library view could not be opened from this surface in this build.": "在此构建中无法从本表面打开内容库视图。",
  "The shell handed this subject to the library view.": "外壳已将此主题交给内容库视图。",

  // --- add and remove one subject's tag ------------------------------------
  "Remove tag from this subject": "从此主题移除此标签",
  "Remove this tag from this subject": "从此主题移除此标签",
  "This record reports no annotation id or revision, so it cannot be changed from here.": "此记录没有报告注释 ID 或修订号，因此无法在此处更改。",
  "Tag removed from {{name}}; the record {{annotation_id}} is tombstoned, not rewritten.": "已从 {{name}} 移除标签；记录 {{annotation_id}} 被置为墓碑，而不是被改写。",
  "The tag was not removed: {{message}}": "未能移除标签：{{message}}",
  "Add this tag to one subject": "将此标签添加到某个主题",
  "Subject": "主题",
  "Select a subject": "选择主题",
  "Subject to add {{name}} to": "要添加 {{name}} 的主题",
  "Add tag to {{name}}": "为 {{name}} 添加标签",
  "Every subject in the loaded listing already carries this tag, so there is nothing to add. The daemon would return the existing record anyway.": "已加载列表中的每个主题都已带有此标签，因此没有可添加的对象。服务无论如何都会返回已存在的记录。",
  "Tag added to {{name}} ({{annotation_id}}).": "已为 {{name}} 添加标签（{{annotation_id}}）。",
  "The daemon reports that {{name}} already carries this tag; the existing record {{annotation_id}} is unchanged.": "服务报告 {{name}} 已带有此标签；现有记录 {{annotation_id}} 未发生变化。",
  "The tag was not added: {{message}}": "未能添加标签：{{message}}",

  // --- the previewed rename / merge ----------------------------------------
  "Rename or merge this tag": "重命名或合并此标签",
  "Rename or merge {{name}}": "重命名或合并 {{name}}",
  "Both are the same operation: add the new name to each subject, then delete the old record. The preview lists exactly which records change before anything is written, and what was applied stays visible afterwards.": "两者是同一个操作：为每个主题添加新名称，然后删除旧记录。预览会在任何写入之前列出确切会变化的记录，已应用的内容在此之后仍然可见。",
  "New name (an existing name merges into it)": "新名称（与已有名称相同即合并到其中）",
  "New tag name": "新标签名称",
  "New name for {{name}}": "{{name}} 的新名称",
  "Preview the change": "预览此变更",
  "Tag names are stored exactly as written; remove the leading or trailing whitespace before previewing.": "标签名称按原样存储；请在预览前去掉开头或结尾的空白。",
  "Preview only — {{count}} subjects and their records would change. No write has been issued yet.": "仅为预览——将有 {{count}} 个主题及其记录发生变化。尚未发出任何写入。",
  "{{from}} → {{to}}": "{{from}} → {{to}}",
  "The tag's subject count changed after this preview was built; preview again before applying.": "此预览生成后标签的主题数量发生了变化；请在应用前重新预览。",
  "Confirm and apply to {{count}} subjects": "确认并应用到 {{count}} 个主题",
  "Discard the preview": "放弃该预览",

  // --- what was applied, and what failed -----------------------------------
  "{{changed}} of {{requested}} subjects changed; {{failed}} failed and are listed below with their own reasons. A failed subject is left unchanged or carries both names, exactly as listed — this is not a clean rename.": "已变更 {{changed}} 个主题，共 {{requested}} 个；{{failed}} 个失败，并在下方连同各自原因列出。失败的主题保持未变或同时带有两个名称，与列表完全一致——这不是一次干净的重命名。",
  "All {{changed}} subjects changed.": "全部 {{changed}} 个主题已完成变更。",
  "The change was applied, but the tag vocabulary could not be read back: refresh to see the daemon's current records.": "变更已应用，但无法读回标签词汇表：请刷新以查看服务的当前记录。",
  "Applied record — {{changed}} of {{requested}} subjects changed, {{failed}} failed.": "已应用记录——{{changed}} 个主题已变更，共 {{requested}} 个，{{failed}} 个失败。",
  "This was not a clean rename": "这不是一次干净的重命名",
  "The subjects below were left unchanged or carry both names, exactly as each row states. No rollback is attempted or claimed.": "下列主题保持未变或同时带有两个名称，与每一行的说明完全一致。此处不尝试也不声称回滚。",
  "Every subject listed below now carries the new name and no longer carries the old one.": "下列每个主题现在都带有新名称，且不再带有旧名称。",
  "Changed: {{from}} removed, {{to}} added (record {{annotation_id}})": "已变更：移除 {{from}}，添加 {{to}}（记录 {{annotation_id}}）",
  "Left unchanged: nothing was written; {{from}} is still recorded, and the new name was not added.": "保持未变：没有写入任何内容；{{from}} 仍被记录，且未添加新名称。",
  "Not clean: {{to}} was added (record {{annotation_id}}), and {{from}} is still recorded on this subject.": "不干净：已添加 {{to}}（记录 {{annotation_id}}），且此主题上仍记录着 {{from}}。",
  "Reason reported by the service: {{message}}": "服务报告的原因：{{message}}",
  "Only the subjects listed here were written. Every other subject keeps its previous records; the reverse change is available below and is again previewed before it is applied.": "仅写入了此处列出的主题。其他每个主题保留此前的记录；下方提供反向变更，并且在应用前同样会先预览。",
  "Subjects the change did not complete for": "变更未完成的主题",
  "{{name}} ({{subject_ref}}) was not changed: {{reason}}": "{{name}}（{{subject_ref}}）未变更：{{reason}}",
  "Prepare the reverse change": "准备反向变更",
  "The reverse change is prepared below. Preview it, then confirm it to restore the previous name on the subjects that changed.": "反向变更已在下方准备好。请先预览，然后确认，以便在已变更的主题上恢复此前的名称。",
};
