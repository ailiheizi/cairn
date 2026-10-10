export const musicExperience: Record<string, string> = {
  "Music library": "音乐库", "Play and organize original audio files from your library.": "播放并整理音乐库中的原始音频文件。",
  "Track names come from original filenames. Metadata and artwork are shown only when real facts are available.": "曲目名称来自原始文件名。仅在存在真实信息时显示元数据和封面。",
  "Playback and format details": "播放与格式说明", "Play {{name}}": "播放 {{name}}", "Playback requires a known original of at most 32 MiB": "播放需要已知且不超过 32 MiB 的原件", "This audio format is not supported for browser playback. Open Details to download the original.": "浏览器不支持播放此音频格式。请打开详情下载原件。", "Add to queue": "加入队列", "Add {{name}} to queue": "将 {{name}} 加入队列", "Queue ({{count}})": "队列（{{count}}）", "Listening queue": "播放队列", "Clear queue": "清空队列", "Stop playback before removing the current track": "请先停止播放，再从队列移除当前曲目。", "Remove from queue": "从队列移除", "Queue is empty": "队列为空", "Previous track": "上一首", "Next track": "下一首", "Play": "播放", "Pause": "暂停", "Stop": "停止", "Seek": "进度", "Volume": "音量", "Music player": "音乐播放器", "Nothing playing": "未在播放", "Loading and verifying original": "正在读取并校验原件", "Original audio": "原始音频", "Details / Download original": "详情 / 下载原件", "No audio tracks in the loaded listing": "当前列表中没有音频曲目",
  // Playback failure outcomes. AudioPlayer.tsx maps each typed playback error
  // code to one of these English sentences before t(); the sentence is the
  // message key, so English renders it unchanged and zh-CN resolves it here.
  // Keep every key byte-identical to PLAYBACK_ERROR_TEXTS in AudioPlayer.tsx.
  "The original has no verified identity information.": "缺少原件身份信息",
  "The original is larger than the 32 MiB playback limit.": "原件超过 32 MiB 播放上限",
  "The original length does not match the recorded length.": "原件长度与记录不符",
  "The original failed its SHA-256 verification.": "原件 SHA-256 校验失败",
  "The download returned no original data.": "下载没有返回原件数据",
  "The browser blocked playback. Choose Play again to allow it.": "浏览器阻止了自动播放，请再次点击播放。",
  "This original could not be played.": "无法播放此音频原件",
  "The original could not be downloaded (HTTP {{status}}).": "无法下载原件（HTTP {{status}}）。",
  "Playback failed. Open Details to download the original.": "播放失败。请打开详情下载原件。",
};
