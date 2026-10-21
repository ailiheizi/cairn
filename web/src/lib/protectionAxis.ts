export const PROTECTION_OUTCOMES = [
  "EXACT_PROTECTED",
  "EXACT_FALLBACK",
  "EXTERNAL_REPLAYABLE",
  "LINK_ONLY_UNPROTECTED",
  "EXPLICITLY_UNPROTECTED",
  "BLOCKED",
  "UNAVAILABLE",
] as const;

export type ProtectionOutcome = typeof PROTECTION_OUTCOMES[number];

type SearchEnvelope = { data?: unknown; reasons?: Array<{ message?: string }> };

export type ProtectionAxisProjection = {
  bySubject: Map<string, ProtectionOutcome>;
  answered: boolean;
  reason: string;
};

/** True only when the daemon returned a successful lexical generation component. */
export function lexicalProtectionAxisAnswered(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const components = (data as { components?: unknown }).components;
  return Array.isArray(components) && components.some((component: unknown) => {
    if (!component || typeof component !== "object") return false;
    const row = component as { dimension?: unknown; status?: unknown; index_generation_ref?: unknown };
    return row.dimension === "lexical-metadata-fts" && row.status === "SUCCEEDED" && Boolean(row.index_generation_ref);
  });
}

/** Share interpretation of the daemon's per-outcome queries; callers retain query scope and UI state. */
export function projectProtectionAxis(
  settled: readonly PromiseSettledResult<SearchEnvelope>[],
  outcomes: readonly ProtectionOutcome[],
  rejectedMessage: (reason: unknown) => string,
  unavailableReason: string,
): ProtectionAxisProjection {
  const bySubject = new Map<string, ProtectionOutcome>();
  let answered = false;
  let reason = "";
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      if (!reason) reason = rejectedMessage(result.reason);
      return;
    }
    if (lexicalProtectionAxisAnswered(result.value.data)) answered = true;
    else if (!reason) reason = String(result.value.reasons?.[0]?.message ?? "");
    const hits = result.value.data && typeof result.value.data === "object"
      ? (result.value.data as { hits?: unknown }).hits
      : undefined;
    for (const hit of Array.isArray(hits) ? hits : []) {
      if (!hit || typeof hit !== "object") continue;
      const subjectRef = String((hit as { subject_ref?: unknown }).subject_ref ?? "").trim();
      const outcome = outcomes[index];
      if (subjectRef && outcome && !bySubject.has(subjectRef)) bySubject.set(subjectRef, outcome);
    }
  });
  return { bySubject, answered, reason: reason || unavailableReason };
}
