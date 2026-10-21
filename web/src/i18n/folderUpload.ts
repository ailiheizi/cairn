// Catalog partial for the opt-in bounded browser folder upload in SourceDrawer.
export const folderUpload: Record<string, string> = {
  "Choose folder to upload": "选择文件夹上传",
  "Folder files keep their relative paths. Empty folders are not uploaded; review the received paths before saving.": "文件夹中的文件会保留相对路径。空文件夹不会上传；请在保存前检查收到的路径。",
  "Folder drag-and-drop is not supported. Choose a folder to upload its files, or use a server folder.": "暂不支持拖放文件夹。请选择文件夹上传其中的文件，或使用服务器文件夹。",
  "Choose a folder that contains files.": "请选择包含文件的文件夹。",
  "A folder upload can contain at most 200 files.": "一次文件夹上传最多包含 200 个文件。",
  "The browser did not provide a valid relative path for every selected file.": "浏览器未能为每个所选文件提供有效的相对路径。",
  "A selected folder path exceeds 2048 UTF-8 bytes.": "所选文件夹路径超过 2048 个 UTF-8 字节。",
  "Folder paths must use safe relative slash-separated components.": "文件夹路径必须使用安全的相对路径，并以斜杠分隔各部分。",
  "A selected folder path exceeds 16 components.": "所选文件夹路径超过 16 层。",
  "A selected folder path contains an empty, dot, or dot-dot component.": "所选文件夹路径包含空部分、“.”或“..”部分。",
  "A folder path component exceeds 240 UTF-8 bytes.": "文件夹路径中的一部分超过 240 个 UTF-8 字节。",
  "A selected folder path contains a control character.": "所选文件夹路径包含控制字符。",
  "Folder path components cannot end in a dot or space.": "文件夹路径部分不能以点或空格结尾。",
  "A folder path contains a reserved device name.": "文件夹路径包含保留设备名称。",
  "The folder selection contains a duplicate relative path.": "所选文件夹中有重复的相对路径。",
};
