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
  "Preview failed": "预览失败",
  "Preview not provided for this format": "此格式没有预览",
  "Preview size limit reached": "已达到预览大小上限",
  "Original content unavailable": "原始内容不可用",
  "No preview": "无预览",
  "The original content is currently unavailable; preview or download may not be possible.": "当前无法读取原始内容，预览或下载可能不可用。",
  "The filename suffix suggests {{kind}} content. This preview does not open that format. Try Download original in Details to open it in your own app.": "文件名后缀提示它可能是{{kind}}内容。此处不预览该格式；可尝试在详情中使用“下载原始文件”，再用自己的应用打开。",
  "This file type is not previewed here. Try Download original in Details to open it in your own app.": "此处不预览该文件类型。可尝试在详情中使用“下载原始文件”，再用自己的应用打开。",
  "audio": "音频",
  "video": "视频",
  "archive": "压缩包",
  "Text preview is limited to 64 KiB. Try Download original in Details to open the full file.": "文本预览上限为 64 KiB。可尝试在详情中下载原始文件，再打开完整文件。",
  "Image thumbnails are limited to 1 MiB. Try Download original in Details to inspect the full image.": "图片缩略图上限为 1 MiB。可尝试在详情中下载原始文件，再查看完整图片。",
  "Image inspection is limited to 8 MiB. Try Download original in Details to inspect the full image.": "图片检查上限为 8 MiB。可尝试在详情中下载原始文件，再查看完整图片。",
  "The preview size could not be verified.": "无法确认预览文件大小。",
  "The content could not be decoded safely.": "无法安全解码内容。",
  "Preview could not be loaded.": "无法加载预览。",
  "Content preview": "内容预览",
  "Tiny image": "极小图片",
  "Select one or more results or save the last submitted keyword query, freeze the membership, then write and verify it in an explicit server directory.": "选择一项或多项结果，或保存最近一次已提交的关键词查询，冻结成员关系，再将内容写入明确的服务器目录并校验。",
};
