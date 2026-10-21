/** Preserve the status fallback order used by the Tags and Duplicates review surfaces. */
export function workspaceIDFromStatus(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const projection = data as {
    recent_plans?: Array<{ workspace_id?: unknown }>;
    recent_jobs?: Array<{ workspace_id?: unknown }>;
    index?: Array<{ workspace_id?: unknown }>;
  };
  const candidates = [
    projection.recent_plans?.[0]?.workspace_id,
    projection.recent_jobs?.[0]?.workspace_id,
    projection.index?.[0]?.workspace_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}
