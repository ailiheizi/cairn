// Catalog partial: the details inspector's on-demand description action.
//
// Owner: components/DetailsPanel.tsx and scripts/e2e/description.mjs. Keys here
// are new strings only; a key may live in exactly one partial
// (`scripts/web-i18n-check.mjs` enforces it).
//
// The wording is the contract. Description generation is one explicit action
// for one subject, never an implicit step on selection or ingest. The action
// runs only when the daemon implements `description.generate`, its own
// configuration gates pass, and a live DESCRIBE egress grant exists; the one
// confirmation step names exactly what will be sent before anything leaves.

export const description: Record<string, string> = {
  "Matched sources": "匹配来源",
  "{{count}} returned segments": "已返回 {{count}} 个片段",
  "Matched-source pages": "匹配来源分页",
  "Showing {{first}}–{{last}} of {{total}} segments · Page {{page}} of {{pages}}": "显示第 {{first}}–{{last}} 个，共 {{total}} 个片段 · 第 {{page}} / {{pages}} 页",
  "Previous segments": "上一组片段",
  "Next segments": "下一组片段",
  "Source unavailable": "来源不可用",
  "This source segment was returned without a text excerpt.": "已返回此来源片段，但没有文本摘录。",
  "Generate a description": "生成描述",
  "Checking description availability...": "正在检查描述生成功能是否可用……",
  "Could not check description availability right now.": "目前无法检查描述生成功能是否可用。",
  "Turn on descriptions in Settings.": "请在设置中开启描述。",
  "On-demand descriptions are turned off in Settings.": "设置中已关闭按需生成描述。",
  "Choose a description provider in Settings.": "请在设置中选择描述提供方。",
  "Configure credentials for the description provider in Settings.": "请在设置中配置描述提供方的凭据。",
  "Description generation unavailable on this service.": "此服务暂不支持生成描述。",
  "Authorize description requests before sending content.": "发送内容前，请先授权描述请求。",
  "Why is description generation unavailable?": "为什么无法生成描述？",
  "Generation is unavailable:": "暂时无法生成：",
  "Could not read the daemon's description settings and capabilities: {{message}}": "无法读取服务的描述设置与能力信息：{{message}}",
  "Descriptions are turned off in the settings (descriptions.enabled).": "设置中已关闭描述（descriptions.enabled）。",
  "On-demand generation is turned off in the settings (descriptions.generate).": "设置中已停用按需生成（descriptions.generate）。",
  "No description provider profile is selected (descriptions.provider_profile).": "尚未选择描述提供方配置（descriptions.provider_profile）。",
  "No credential reference is configured for the description provider (descriptions.credential_ref).": "描述提供方尚未配置凭据引用（descriptions.credential_ref）。",
  "No available description generation operation is advertised (DESCRIBE_SUBJECT).": "当前服务未公布可用的描述生成操作（DESCRIBE_SUBJECT）。",
  "No live egress grant covers description generation (egress.grant.list).": "没有处于有效期的出口授权覆盖描述生成（egress.grant.list）。",
  "Generation runs only from this action, for this one subject; it never starts on selection or ingest.": "生成只会由此操作针对当前这一个条目发起；选择条目或保存内容都不会触发生成。",
  "Send one description request for this subject to the model provider?": "向模型提供方发送一次针对当前条目的描述请求？",
  "What is sent: this subject's extracted text": "发送内容：此条目的已提取文本",
  "; because this is an image file, its image bytes may be sent": "；由于这是图像文件，其图像字节也可能被发送",
  ". Private notes and other descriptions are never sent.": "。私人备注与其他描述永远不会被发送。",
  "Provider: {{profile}} ({{digest}}) at {{host}}": "提供方：{{profile}}（{{digest}}），位于 {{host}}",
  "Model: {{model}} · purpose DESCRIBE · egress grant {{grant}}": "模型：{{model}} · 用途 DESCRIBE · 出口授权 {{grant}}",
  "Send to the model provider": "发送给模型提供方",
  "Generation failed: {{message}}": "生成失败：{{message}}",
  "Accept": "接受",
  "Edit before accepting": "接受前编辑",
  "Edit description before accepting": "接受前编辑描述",
  "Cancel edit": "取消编辑",
  "Generated description did not match this subject.": "生成的描述与当前条目不匹配。",
  "Enter a description before accepting it.": "请先填写描述再接受。",
  "Accepted description did not match the saved successor.": "已接受的描述与保存的后续版本不匹配。",
  "The description was saved, but the service reported a degraded result.": "描述已保存，但服务报告了降级结果。",
  "Unsaved edits": "有未保存的修改",
  "Save reviewed changes": "保存审核后的修改",
  "Finish or cancel the current review before generating another note.": "请先完成或取消当前审核，再生成另一条备注。",
  "Loading current descriptions…": "正在加载当前描述……",
  "Current descriptions are unavailable: {{message}}": "当前描述不可用：{{message}}",
};
