import type { MaterialListDocument, MaterialRef } from "./materialList";

export const MATERIAL_ORGANIZER_LIMITS = {
  items: 32,
  inputBytes: 128 * 1024,
  outputBytes: 512 * 1024,
} as const;

function refKey(ref: MaterialRef): string {
  return JSON.stringify([ref.content_id, ref.logical_size, ref.entry_id ?? "", ref.subject_ref ?? ""]);
}

function occurrenceCounts(document: MaterialListDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of document.items) {
    const key = refKey(item.ref);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function summarizeMaterialListCandidate(base: MaterialListDocument, candidate: MaterialListDocument) {
  const sourceCounts = occurrenceCounts(base);
  const candidateCounts = occurrenceCounts(candidate);
  let omitted = 0;
  let repeated = 0;
  for (const [key, count] of sourceCounts) omitted += Math.max(0, count - (candidateCounts.get(key) ?? 0));
  for (const [key, count] of candidateCounts) repeated += Math.max(0, count - (sourceCounts.get(key) ?? 0));
  const changedOrder = base.items.length !== candidate.items.length
    || base.items.some((item, index) => refKey(item.ref) !== refKey(candidate.items[index]?.ref ?? { content_id: "", logical_size: -1 }));
  const sourceItems = new Map<string, Array<{ label: string; context: string }>>();
  for (const item of base.items) {
    const key = refKey(item.ref);
    const rows = sourceItems.get(key) ?? [];
    rows.push({ label: item.label, context: JSON.stringify(item.context ?? {}) });
    sourceItems.set(key, rows);
  }
  const seen = new Map<string, number>();
  const changedLabels = candidate.items.some((item) => {
    const key = refKey(item.ref);
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    const source = sourceItems.get(key)?.[index];
    return Boolean(source && source.label !== item.label);
  });
  const contextSeen = new Map<string, number>();
  const changedContext = candidate.items.some((item) => {
    const key = refKey(item.ref);
    const index = contextSeen.get(key) ?? 0;
    contextSeen.set(key, index + 1);
    const source = sourceItems.get(key)?.[index];
    return Boolean(source && source.context !== JSON.stringify(item.context ?? {}));
  });
  return {
    omitted,
    repeated,
    labelsChanged: changedLabels,
    titleChanged: base.title !== candidate.title,
    orderChanged: changedOrder,
    contextChanged: changedContext,
  };
}
