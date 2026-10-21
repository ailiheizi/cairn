import type { AudioTrack } from "./audioPlayback";
import { playableMusicTrack } from "./musicMetadata";
import type { SearchHit } from "./types";
import {
  resolveMaterialList,
  type MaterialListDocument,
  type ResolvedMaterial,
} from "./materialList";

export type MaterialListAction = "play" | "queue" | "download" | "export";

export type MaterialListActionProjection = {
  resolved: ResolvedMaterial[];
  tracks: AudioTrack[];
  originals: SearchHit[];
  unavailableCount: number;
  omittedAudioCount: number;
  repeatedOriginalCount: number;
  ready: boolean;
};

const canonicalContentID = /^sha256:[0-9a-f]{64}$/;

function completeOccurrence(row: ResolvedMaterial): row is ResolvedMaterial & { hit: SearchHit } {
  const hit = row.hit;
  return row.state === "AVAILABLE" && !!hit
    && hit.entry_type === "REGULAR_FILE"
    && typeof hit.content_id === "string" && canonicalContentID.test(hit.content_id)
    && typeof hit.logical_size === "number" && Number.isSafeInteger(hit.logical_size) && hit.logical_size >= 0
    && hit.content_id === row.item.ref.content_id && hit.logical_size === row.item.ref.logical_size
    && typeof hit.entry_id === "string" && !!hit.entry_id.trim()
    && typeof hit.subject_ref === "string" && !!hit.subject_ref.trim();
}

export function projectMaterialListActions(
  document: MaterialListDocument,
  catalogItems: SearchHit[],
  workspaceID: string,
): MaterialListActionProjection {
  const initiallyResolved = resolveMaterialList(document, catalogItems);
  const resolved = initiallyResolved.map((row): ResolvedMaterial => completeOccurrence(row)
    ? row
    : {
      item: row.item,
      ...(row.hit ? { hit: row.hit } : {}),
      state: "UNAVAILABLE",
      reason: row.reason ?? "A complete exact file target is unavailable in the loaded content scope.",
    });

  const completeRows = resolved.filter(completeOccurrence);
  const tracks = workspaceID.trim()
    ? completeRows.flatMap((row) => {
      const track = playableMusicTrack(row.hit, workspaceID);
      return track ? [track] : [];
    })
    : [];

  const seenEntries = new Set<string>();
  const seenSubjects = new Set<string>();
  const originals: SearchHit[] = [];
  let repeatedOriginalCount = 0;
  for (const row of completeRows) {
    const entryID = row.hit.entry_id!.trim();
    const subjectRef = row.hit.subject_ref!.trim();
    const repeated = seenEntries.has(entryID) || seenSubjects.has(subjectRef);
    seenEntries.add(entryID);
    seenSubjects.add(subjectRef);
    if (repeated) {
      repeatedOriginalCount += 1;
      continue;
    }
    originals.push(row.hit);
  }

  const unavailableCount = resolved.filter((row) => row.state !== "AVAILABLE").length;
  const omittedAudioCount = completeRows.length - tracks.length;
  const ready = document.items.length > 0 && !!workspaceID.trim() && unavailableCount === 0;
  return { resolved, tracks, originals, unavailableCount, omittedAudioCount, repeatedOriginalCount, ready };
}
