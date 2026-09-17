// Catalog partial: The shared chrome vocabulary.
//
// Owner: strings reused by more than one surface (generic actions, the
// topbar's own labels, and the workspace navigation). A string that only one
// surface renders belongs in that surface's partial, not here.
//
// Keys are the English message; values are the zh-CN translation. Every key
// lives in exactly one partial; `web/src/i18n.ts` merges them and keeps the
// public t()/Translator/Locale contract. `scripts/web-i18n-check.mjs` proves
// the split lost and duplicated nothing.

export const common: Record<string, string> = {
  "Request failed": "请求失败",
  "Not built": "未建立",
  "Retry": "重试",
  "RestoreWeave home": "RestoreWeave 首页",
  "Search protected content": "搜索受保护内容",
  "Search": "搜索",
  "Restore latest snapshot": "恢复最新快照",
  "Restore": "恢复",
  "Add content": "添加内容",
  "Add source": "添加来源",
  "Refresh service status": "刷新服务状态",
  "Open settings": "打开设置",
  "Dismiss notice": "关闭提示",
  "Available": "可用",
  "Unknown": "未知",
  "Cancel": "取消",
  "Save": "保存",
  "Workspace navigation": "工作区导航",
  "Open workspace navigation": "打开工作区导航",
  "Close workspace navigation": "关闭工作区导航",
  "WORKSPACE": "工作区",
  "OPERATIONS": "操作",
  "Library": "内容库",
  "Catalog": "目录",
  "Not reported": "未报告",
  "Close": "关闭",
  "unavailable": "不可用",
};
