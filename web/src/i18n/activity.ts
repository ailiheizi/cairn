// Catalog partial: The activity surface (Tier-1 spec §2).
//
// Owner: components/ActivitySurface.tsx and scripts/e2e/activity.mjs. The keys
// are exactly the strings that surface renders: the durable job states, the
// cancel and reconciliation paths, the retained run log, and the blocked and
// empty states.
//
// Two keys intentionally stay in `i18n/sources.ts` and are only referenced
// here, because the action they name is the same action the source drawer
// owns: "Check protection result" and "Checking protection result...". A key
// may live in exactly one partial, so this partial must not redefine them.
//
// Keys are the English message; values are the zh-CN translation. Every key
// lives in exactly one partial; `web/src/i18n.ts` merges them and keeps the
// public t()/Translator/Locale contract. `scripts/web-i18n-check.mjs` proves
// the split lost and duplicated nothing.

export const activity: Record<string, string> = {
  "Activity": "活动",
  "Durable jobs": "持久作业",
  "Job {{job_id}}": "作业 {{job_id}}",
  "Job kind reported by the service": "服务报告的作业类型",
  "Refresh job list": "刷新作业列表",
  "Reading durable jobs…": "正在读取持久作业……",
  "Job rows and run logs are read from the service. This view never infers a state, and the only action it can ask for is a bounded cancellation.": "作业行和运行日志都读取自服务。此视图不会推断状态，唯一能请求的操作是有边界的取消。",
  "Job list read at {{time}} (this browser)": "作业列表读取于 {{time}}（本浏览器）",
  "The durable job list has not been read in this browser yet": "本浏览器尚未读取持久作业列表",
  "Durable jobs are not readable right now": "当前无法读取持久作业",
  "Cannot read durable jobs while the service is unreachable.": "服务不可达时无法读取持久作业。",
  "The durable job list could not be read: {{message}}": "无法读取持久作业列表：{{message}}",
  "UNKNOWN — the service status projection has not answered in this browser yet": "UNKNOWN — 服务状态投影尚未在本浏览器中应答",
  "no durable job is recorded in the service status projection yet": "服务状态投影中尚未记录任何持久作业",
  "{{count}} durable jobs recorded · newest job: {{state}}": "已记录 {{count}} 个持久作业 · 最新作业：{{state}}",
  "No durable job is recorded yet": "尚未记录任何持久作业",
  "Saving a source, restoring a snapshot, and exporting each record a durable job here, with its retained run log and its final state.": "保存来源、恢复快照和导出都会在此记录一个持久作业，包括保留的运行日志和最终状态。",

  // The durable job states, exactly as the daemon reports them.
  "Queued": "排队中",
  "Running": "运行中",
  "Running · {{elapsed}}": "运行中 · {{elapsed}}",
  "Waiting for approval": "等待批准",
  "Completed": "已完成",
  "Completed {{time}}": "已完成 {{time}}",
  "Failed": "失败",
  "Failed — {{error}}": "失败——{{error}}",
  "Cancelled": "已取消",
  "Cancelled — published snapshots were not rolled back": "已取消——已发布的快照没有被回滚",
  "Unknown outcome": "结果未知",
  "Unknown outcome — needs reconciliation": "结果未知——需要核对",
  "UNKNOWN — not reported by this build": "UNKNOWN — 此构建未报告",
  "This build does not describe the reported job state {{state}}; it is shown as UNKNOWN rather than as a healthy value.": "此构建不认识服务报告的作业状态 {{state}}；它显示为 UNKNOWN，而不会显示为健康值。",
  "Elapsed since the daemon last updated this row at {{time}}.": "自服务记载的最后更新 {{time}} 起已用时间。",
  "Updated {{time}}": "更新于 {{time}}",
  "Attempt {{attempt}} of {{max}}": "第 {{attempt}} 次尝试，共 {{max}} 次",
  "Attempts: {{value}}": "尝试次数：{{value}}",
  "Checkpoint recorded": "已记录检查点",
  "No checkpoint recorded": "未记录检查点",
  "Plan {{plan_id}}": "方案 {{plan_id}}",
  "No plan is linked to this job": "此作业没有关联的方案",

  // Cancel, and its one honest note.
  "Cancel job": "取消作业",
  "Cancel job {{job_id}}": "取消作业 {{job_id}}",
  "Cancelling…": "正在取消……",
  "Cancellation asked — the run may still finish": "已请求取消——本次运行仍可能完成",
  "The cancellation request did not answer: {{message}}": "取消请求没有得到应答：{{message}}",

  // Continuation by reconciliation, never by a rerun.
  "An unknown outcome is continued by reading the plan the daemon already recorded. This row offers no rerun and no second write.": "结果未知时，改为读取服务已记录的方案。此行不提供重新运行，也不提供第二次写入。",
  "Recorded plan state: {{state}}": "已记录的方案状态：{{state}}",
  "Plan digest: {{digest}}": "方案摘要：{{digest}}",
  "Applied: {{value}}": "已应用：{{value}}",
  "APPLIED": "已应用",
  "NOT APPLIED": "未应用",
  "The recorded plan could not be read: {{message}}": "无法读取已记录的方案：{{message}}",
  "This job row reports no plan or workspace, so no recorded plan can be read.": "此作业行没有报告方案或工作区，因此无法读取已记录的方案。",

  // The retained run log.
  "Retained run log": "保留的运行日志",
  "Reading the retained run log…": "正在读取保留的运行日志……",
  "Job state in the latest daemon response: {{state}}": "最新服务响应中的作业状态：{{state}}",
  "The run log could not be read: {{message}}": "无法读取运行日志：{{message}}",
  "No run-log event is recorded for this job yet.": "此作业尚未记录任何运行日志事件。",
  "Next event sequence: {{sequence}} · waiting for the daemon to report the next page": "下一个事件序号：{{sequence}} · 正在等待服务报告下一页",
  "This run is terminal; no further log pages are read.": "本次运行已终止；不再读取后续日志页。",
  "This job row reports no workspace, so its retained log cannot be read.": "此作业行没有报告工作区，因此无法读取保留的日志。",
  "Use the arrow keys to move between job rows, Enter to expand the retained run log, and Escape to return to the navigation rail.": "使用方向键在作业行之间移动，按 Enter 展开保留的运行日志，按 Escape 返回导航栏。",
};
