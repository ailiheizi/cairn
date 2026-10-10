// Catalog partial: The shared chrome vocabulary.
//
// Owner: strings reused by more than one surface (generic actions, the
// topbar's own labels, and the navigation rail). A string that only one
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
  "Cairn home": "Cairn 首页",
  "Search protected content": "搜索受保护内容",
  "Search names, notes, tags, or facts": "搜索名称、备注、标签或信息",
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
  "Navigation": "导航",
  "Open navigation": "打开导航",
  "Close navigation": "关闭导航",
  "CONTENT": "内容",
  "OPERATIONS": "操作",
  "Library": "内容库",
  "Catalog": "目录",
  "Not reported": "未报告",
  "Close": "关闭",
  "unavailable": "不可用",
  "Duplicates": "重复",
  // Verification freshness labels. `lib/format.ts` composes them and both the
  // status surface's verification fact and the verification report's receipt
  // line render them, so they live here rather than in one surface's partial.
  // The age is always computed from the daemon's own recorded time; a receipt
  // with no readable time renders no age at all.
  "verified just now": "刚刚验证",
  "verified a minute ago": "1 分钟前验证",
  "verified {{count}} minutes ago": "{{count}} 分钟前验证",
  "verified an hour ago": "1 小时前验证",
  "verified {{count}} hours ago": "{{count}} 小时前验证",
  "verified a day ago": "1 天前验证",
  "verified {{count}} days ago": "{{count}} 天前验证",
  // The same age for a recorded failure or unavailability: the record has a
  // true time, but nothing about it may read as a verification.
  "recorded just now": "刚刚记录",
  "recorded a minute ago": "记录于 1 分钟前",
  "recorded {{count}} minutes ago": "记录于 {{count}} 分钟前",
  "recorded an hour ago": "记录于 1 小时前",
  "recorded {{count}} hours ago": "记录于 {{count}} 小时前",
  "recorded a day ago": "记录于 1 天前",
  "recorded {{count}} days ago": "记录于 {{count}} 天前",
  // The one-line freshness suggestion. A suggestion, never an alarm, never a
  // health claim: it is rendered only when a recorded passing full-bytes
  // receipt exists and is older than the stated threshold.
  "The last full-bytes verification is more than 30 days old. Consider running it again when convenient.": "上次全量校验已超过 30 天，可考虑重新校验",
};
