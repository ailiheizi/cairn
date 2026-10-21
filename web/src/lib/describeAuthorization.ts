/** Validated public metadata for one installed DESCRIBE profile. */
export type DescribeProfile = {
  profile_id: string;
  profile_digest: string;
  provider: string;
  api_style: string;
  endpoint_host: string;
  model_id: string;
  model_revision: string;
  output_schema: string;
  destination: string;
  expiry: string;
  disclosed_data_classes: string[];
  allowed_subject_classes: string[];
  max_requests: number;
  max_bytes: number;
  max_seconds: number;
  audit_required: boolean;
  expired: boolean;
};

export type DescribeProfileValidation =
  | { valid: true; profile: DescribeProfile }
  | { valid: false; reason: string };

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(nonempty);
const describeDataClasses = new Set(["text.subject_context", "image.bytes"]);
const describeSubjectClasses = new Set(["EXACT_PROTECTED", "EXACT_FALLBACK", "EXTERNAL_REPLAYABLE"]);

export function providerExpiryMillis(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : undefined;
}

/** Fail closed on malformed profile metadata; credentials are never projected. */
export function validateDescribeProfile(value: unknown, now = Date.now()): DescribeProfileValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "The installed description profile metadata is not an object." };
  }
  const row = value as Record<string, unknown>;
  const requiredStrings = ["profile_id", "provider", "api_style", "endpoint_host", "model_id", "model_revision", "output_schema", "destination", "expiry"];
  if (requiredStrings.some((key) => !nonempty(row[key]))) {
    return { valid: false, reason: "The installed description profile is missing required identity or scope fields." };
  }
  if (row.api_style !== "openai-chat-completions-v1" || row.output_schema !== "cairn.online-describe-output.v1") {
    return { valid: false, reason: "The installed description profile is missing required identity or scope fields." };
  }
  if (typeof row.profile_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.profile_digest)) {
    return { valid: false, reason: "The installed description profile has an invalid digest." };
  }
  if (!stringList(row.disclosed_data_classes) || !stringList(row.allowed_subject_classes)) {
    return { valid: false, reason: "The installed description profile has invalid disclosure scope." };
  }
  if (row.disclosed_data_classes.some((item) => !describeDataClasses.has(item))
    || row.allowed_subject_classes.some((item) => !describeSubjectClasses.has(item))) {
    return { valid: false, reason: "The installed description profile has invalid disclosure scope." };
  }
  if (!positiveSafeInteger(row.max_requests) || !positiveSafeInteger(row.max_bytes) || !positiveSafeInteger(row.max_seconds)) {
    return { valid: false, reason: "The installed description profile has invalid grant budgets." };
  }
  if (typeof row.audit_required !== "boolean" || typeof row.expired !== "boolean") {
    return { valid: false, reason: "The installed description profile has invalid status metadata." };
  }
  const expiryMs = providerExpiryMillis(row.expiry);
  if (expiryMs === undefined) {
    return { valid: false, reason: "The installed description profile has an invalid expiry." };
  }
  return {
    valid: true,
    profile: {
      profile_id: row.profile_id as string,
      profile_digest: row.profile_digest,
      provider: row.provider as string,
      api_style: row.api_style as string,
      endpoint_host: row.endpoint_host as string,
      model_id: row.model_id as string,
      model_revision: row.model_revision as string,
      output_schema: row.output_schema as string,
      destination: row.destination as string,
      expiry: row.expiry as string,
      disclosed_data_classes: [...row.disclosed_data_classes],
      allowed_subject_classes: [...row.allowed_subject_classes],
      max_requests: row.max_requests,
      max_bytes: row.max_bytes,
      max_seconds: row.max_seconds,
      audit_required: row.audit_required,
      expired: row.expired || expiryMs <= now,
    },
  };
}

export function sameDescribeProfileIdentity(left: any, right: any): boolean {
  return Boolean(left && right
    && left.profile_id === right.profile_id
    && left.profile_digest === right.profile_digest
    && left.endpoint_host === right.endpoint_host
    && left.model_id === right.model_id);
}
