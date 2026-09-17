// Catalog partial: The content viewer.
//
// Owner: components/ContentPreview.tsx (which keeps its own stylesheet).
//
// Keys are the English message; values are the zh-CN translation. Every key
// lives in exactly one partial; `web/src/i18n.ts` merges them and keeps the
// public t()/Translator/Locale contract. `scripts/web-i18n-check.mjs` proves
// the split lost and duplicated nothing.

export const viewer: Record<string, string> = {
  "View full size": "查看原图",
  "Image viewer": "图片查看器",
  "Close viewer": "关闭查看器",
  "Zoom in": "放大",
  "Zoom out": "缩小",
  "Fit to window": "适应窗口",
  "Actual size": "原始尺寸",
  "{{width}} × {{height}} px": "{{width}} × {{height}} 像素",
  "Natural size unavailable": "无法获取原始尺寸",
  "Close preview": "关闭预览",
  "Reading exact content...": "正在读取精确内容……",
  "Preview unavailable": "无法预览",
  "The original content is currently unavailable for reading.": "当前无法读取原始内容。",
  "Supported: text up to 64 KiB and PNG, JPEG, GIF, or WebP up to 1 MiB. Larger files can be viewed after export.": "支持 64 KiB 以内文本和 1 MiB 以内 PNG、JPEG、GIF、WebP。更大文件请导出后查看。",
  "Supported: text up to 64 KiB and images up to 1 MiB. Larger files can be viewed after export.": "支持 64 KiB 以内文本和 1 MiB 以内图片。更大文件请导出后查看。",
  "The content could not be decoded safely.": "无法安全解码内容。",
  "Preview could not be loaded.": "无法加载预览。",
  "Content preview": "内容预览",
  "Tiny image": "极小图片",
  "Select one or more results or save the last submitted keyword query, freeze the membership, then write and verify it in an explicit server directory.": "选择一项或多项结果，或保存最近一次已提交的关键词查询，冻结成员关系，再将内容写入明确的服务器目录并校验。",
};
