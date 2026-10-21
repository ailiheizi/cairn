// Transient multi-tag editing for the shared selection surface.
export const multiTag: Record<string, string> = {
  "Add several tags": "一次添加多个标签",
  "Tag to add to the pending list": "要加入待处理列表的标签",
  "Type one complete tag": "输入一个完整标签",
  "Add to list": "加入列表",
  "Press Enter or add one complete tag. Commas stay part of the tag. Maximum {{count}} tags.": "按回车或点击加入一个完整标签。逗号仍属于标签内容。最多 {{count}} 个标签。",
  "Pending tags": "待添加标签",
  "Remove pending tag {{tag}}": "移除待添加标签 {{tag}}",
  "Queued tags will be applied to the {{count}} selected items only. Original files and Notes are left unchanged.": "待添加标签只应用到 {{count}} 个所选项目；原始文件和备注保持不变。",
  "Apply {{count}} tags to {{items}} items": "将 {{count}} 个标签应用到 {{items}} 个项目",
  "Clear pending tags": "清空待添加标签",
  "Tag {{tag}} is already in the pending list.": "标签 {{tag}} 已在待添加列表中。",
  "You can queue up to {{count}} tags at a time.": "每次最多可添加 {{count}} 个待处理标签。",
  "Checking {{tags}} queued tags across {{count}} selected items.": "正在检查 {{count}} 个所选项目的 {{tags}} 个待处理标签。",
  "Applied {{tagCount}} queued tags: {{completed}} of {{total}} item-tag changes confirmed.": "已应用 {{tagCount}} 个待处理标签：{{total}} 项标签变更中有 {{completed}} 项已确认。",
  "Queued tags were applied to {{completed}} of {{total}} item-tag changes before the batch paused. {{failures}}": "批量操作暂停前，{{total}} 项标签变更中已确认 {{completed}} 项。{{failures}}",
  "Further writes stopped after an uncertain or incomplete operation; readback results are shown in the confirmed count.": "操作结果不确定或未完成后，已停止后续写入；确认数量包含回读结果。",
};
