// Catalog partial: the details inspector's on-demand description action.
//
// Owner: components/DetailsPanel.tsx and scripts/e2e/description.mjs. Keys here
// are new strings only; a key may live in exactly one partial
// (`scripts/web-i18n-check.mjs` enforces it).
//
// The wording is the contract. Description generation is one explicit action
// for one subject, never an implicit step on selection or ingest. This daemon
// defines no on-demand generation operation today (`description.create` stores
// a caller-supplied body and runs no provider), so the action stays disabled
// and the reason list names every unmet gate with its exact configuration field
// or the missing `DESCRIBE_SUBJECT` capability instead of leaving a control
// that silently does nothing.

export const description: Record<string, string> = {
  "Generate a description": "生成描述",
  "Checking whether this daemon can generate a description...": "正在检查此服务是否可以生成描述……",
  "Generation is unavailable:": "暂时无法生成：",
  "Could not read the daemon's description settings and capabilities: {{message}}": "无法读取服务的描述设置与能力信息：{{message}}",
  "Descriptions are turned off in the settings (descriptions.enabled).": "设置中已关闭描述（descriptions.enabled）。",
  "On-demand generation is turned off in the settings (descriptions.generate).": "设置中已停用按需生成（descriptions.generate）。",
  "No description provider profile is selected (descriptions.provider_profile).": "尚未选择描述提供方配置（descriptions.provider_profile）。",
  "No credential reference is configured for the description provider (descriptions.credential_ref).": "描述提供方尚未配置凭据引用（descriptions.credential_ref）。",
  "This daemon does not implement on-demand description generation (no DESCRIBE_SUBJECT operation).": "此服务尚未实现按需生成描述（没有 DESCRIBE_SUBJECT 操作）。",
  "Generation runs only from this action, for this one subject; it never starts on selection or ingest.": "生成只会由此操作针对当前这一个条目发起；选择条目或保存内容都不会触发生成。",
};
