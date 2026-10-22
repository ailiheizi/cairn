import { command } from "../app/command";
import { endpoints, operations } from "./operations";
import { readBoundedOriginalResponse, sha256ContentID } from "./originalArchive";
import type { AnnotationRecord, SearchHit } from "./types";
import {
  MATERIAL_LIST_LIMITS,
  parseMaterialList,
  serializeMaterialList,
  type MaterialListDocument,
  type MaterialListGuide,
  type MaterialListItem,
  type MaterialRef,
} from "./materialList";

const canonicalContentID = /^sha256:[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function materialListSelectionEligible(hits: SearchHit[]): boolean {
  return hits.length > 0 && hits.length <= MATERIAL_LIST_LIMITS.items && hits.every((hit) =>
    hit.entry_type === "REGULAR_FILE" && Boolean(hit.subject_ref?.trim()) && Boolean(hit.entry_id?.trim())
    && /^sha256:[0-9a-f]{64}$/.test(hit.content_id ?? "")
    && (hit.logical_size === undefined || (Number.isSafeInteger(hit.logical_size) && hit.logical_size >= 0)));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

function exactIdentity(hit: SearchHit): hit is SearchHit & { content_id: string; logical_size: number } {
  return hit.entry_type === "REGULAR_FILE" && typeof hit.content_id === "string" && canonicalContentID.test(hit.content_id)
    && typeof hit.logical_size === "number" && Number.isSafeInteger(hit.logical_size) && hit.logical_size >= 0;
}

function makeRef(hit: SearchHit & { content_id: string; logical_size: number }): MaterialRef {
  return {
    content_id: hit.content_id,
    logical_size: hit.logical_size,
    ...(hit.entry_id?.trim() ? { entry_id: hit.entry_id.trim() } : {}),
    ...(hit.subject_ref?.trim() ? { subject_ref: hit.subject_ref.trim() } : {}),
  };
}

function sameHintedMaterial(a: SearchHit, b: SearchHit): boolean {
  return a.content_id === b.content_id && a.entry_type === "REGULAR_FILE"
    && (!a.entry_id || a.entry_id === b.entry_id)
    && (!a.subject_ref || a.subject_ref === b.subject_ref);
}

function resolveExactSelection(selected: SearchHit, loaded: SearchHit[]): SearchHit & { content_id: string; logical_size: number } {
  if (selected.entry_type !== "REGULAR_FILE" || typeof selected.content_id !== "string" || !canonicalContentID.test(selected.content_id)) throw new Error("Every selected material must be a regular file with an exact identity.");
  const candidates = loaded.filter((hit): hit is SearchHit & { content_id: string; logical_size: number } =>
    sameHintedMaterial(selected, hit) && exactIdentity(hit));
  if (!selected.entry_id && !selected.subject_ref && selected.logical_size === undefined && new Set(candidates.map((hit) => hit.logical_size)).size > 1) throw new Error("The selected identity has multiple lengths in the loaded scope; refresh and select an exact row.");
  const match = candidates.find((hit) => selected.entry_id && hit.entry_id === selected.entry_id)
    ?? candidates.find((hit) => selected.subject_ref && hit.subject_ref === selected.subject_ref)
    ?? candidates[0];
  if (!match || (selected.logical_size !== undefined && selected.logical_size !== match.logical_size)) throw new Error("A selected original is stale or unavailable in the loaded content scope.");
  if (selected.entry_id && match.entry_id !== selected.entry_id) throw new Error("The selected original entry changed; refresh the loaded content scope.");
  if (selected.subject_ref && match.subject_ref !== selected.subject_ref) throw new Error("The selected original subject changed; refresh the loaded content scope.");
  return match;
}

async function readOriginal(hit: SearchHit, workspaceID: string, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  if (!workspaceID.trim() || !hit.entry_id?.trim() || !exactIdentity(hit)) throw new Error("The saved original does not have a complete exact reference.");
  if (hit.logical_size > limit) throw new Error("The saved material exceeds its explicit read budget.");
  const query = new URLSearchParams({ workspace_id: workspaceID, entry_id: hit.entry_id });
  const response = await fetch(`${endpoints.download}?${query.toString()}`, { signal, credentials: "same-origin" });
  const bytes = await readBoundedOriginalResponse(response, hit.logical_size, signal);
  throwIfAborted(signal);
  if (bytes.byteLength !== hit.logical_size || await sha256ContentID(bytes) !== hit.content_id) throw new Error("The downloaded original did not match its recorded exact identity.");
  return bytes;
}

async function readAnnotations(hit: SearchHit, workspaceID: string, signal: AbortSignal): Promise<{ notes?: string; tags?: string }> {
  throwIfAborted(signal);
  if (!hit.subject_ref) throw new Error("A selected material has no subject reference for its Notes.");
  const response = await command(operations.annotation.list, { workspace_id: workspaceID, subject_ref: hit.subject_ref });
  throwIfAborted(signal);
  if (response.status !== "SUCCEEDED" || !Array.isArray(response.data?.annotations)) throw new Error(`Notes and tags could not be read for ${hit.name || "a selected material"}.`);
  const rows = response.data.annotations as Array<AnnotationRecord & { workspace_id?: string }>;
  const notes: string[] = [];
  const tags: string[] = [];
  for (const row of rows) {
    if (!row || row.workspace_id !== workspaceID || row.subject_ref !== hit.subject_ref || !["NOTE", "TAG", "PROGRESS"].includes(row.kind ?? "") || typeof row.body !== "string" || typeof row.tombstoned !== "boolean" || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision)) throw new Error(`Notes and tags were incomplete for ${hit.name || "a selected material"}.`);
    if (row.tombstoned) continue;
    if (row.kind === "NOTE") notes.push(row.body);
    if (row.kind === "TAG") tags.push(row.body);
  }
  const context: { notes?: string; tags?: string } = {};
  if (notes.length) context.notes = notes.join("\n\n");
  if (tags.length) context.tags = tags.join(", ");
  for (const value of Object.values(context)) if (encoder.encode(value).byteLength > MATERIAL_LIST_LIMITS.contextValueBytes) throw new Error(`Notes or tags exceed the material-list context budget for ${hit.name || "a selected material"}.`);
  return context;
}

async function mapBounded<T, R>(values: T[], concurrency: number, fn: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      output[index] = await fn(values[index]!, index);
    }
  }));
  return output;
}

export async function createMaterialList(subjects: SearchHit[], catalogItems: SearchHit[], workspaceID: string, signal: AbortSignal): Promise<MaterialListDocument> {
  throwIfAborted(signal);
  if (!Array.isArray(subjects) || subjects.length > MATERIAL_LIST_LIMITS.items) throw new Error("A material list can contain at most 200 selected items.");
  if (!workspaceID.trim()) throw new Error("The active workspace is unavailable.");
  const resolved = subjects.map((hit) => resolveExactSelection(hit, catalogItems));
  const items: MaterialListItem[] = await mapBounded(resolved, 3, async (hit) => {
    const context = await readAnnotations(hit, workspaceID, signal);
    return { ref: makeRef(hit), label: hit.name?.trim() || "Untitled material", ...(Object.keys(context).length ? { context } : {}) };
  });
  throwIfAborted(signal);
  const title = "Material list";
  const doc: MaterialListDocument = { format: "cairn.material-list.v1", title, items };
  serializeMaterialList(doc);
  return doc;
}

export async function buildMaterialListGuide(name: string, body: string, source?: MaterialRef): Promise<MaterialListGuide> {
  if (typeof name !== "string" || !name.trim() || typeof body !== "string") throw new Error("A guide needs a name and UTF-8 text.");
  const bytes = encoder.encode(body);
  if (bytes.byteLength > MATERIAL_LIST_LIMITS.guideBytes) throw new Error("The guide exceeds the 64 KiB limit.");
  const guide: MaterialListGuide = {
    name: name.trim(), body, content_id: await sha256ContentID(bytes), logical_size: bytes.byteLength,
    ...(source ? { source: { ...source } } : {}),
  };
  const probe: MaterialListDocument = { format: "cairn.material-list.v1", title: "Guide validation", guide, items: [] };
  serializeMaterialList(probe);
  return guide;
}

export async function readMaterialListGuideFile(hit: SearchHit, workspaceID: string, signal: AbortSignal): Promise<MaterialListGuide> {
  if (!exactIdentity(hit)) throw new Error("The selected guide file has no exact identity.");
  if (hit.logical_size > MATERIAL_LIST_LIMITS.guideBytes) throw new Error("The guide file exceeds the 64 KiB limit.");
  const bytes = await readOriginal(hit, workspaceID, MATERIAL_LIST_LIMITS.guideBytes, signal);
  let body: string;
  try { body = decoder.decode(bytes); } catch { throw new Error("The guide is not valid UTF-8 text."); }
  throwIfAborted(signal);
  return buildMaterialListGuide(hit.name?.trim() || "Skill", body, makeRef(hit));
}

export async function readMaterialListFile(hit: SearchHit, workspaceID: string, signal: AbortSignal): Promise<MaterialListDocument> {
  if (!exactIdentity(hit)) throw new Error("The selected list file has no exact identity.");
  if (hit.logical_size > MATERIAL_LIST_LIMITS.jsonBytes) throw new Error("The list file exceeds the 512 KiB limit.");
  const bytes = await readOriginal(hit, workspaceID, MATERIAL_LIST_LIMITS.jsonBytes, signal);
  let text: string;
  try { text = decoder.decode(bytes); } catch { throw new Error("The material list is not valid UTF-8 text."); }
  throwIfAborted(signal);
  const doc = parseMaterialList(text);
  if (doc.guide) {
    const guideBytes = encoder.encode(doc.guide.body);
    if (guideBytes.byteLength !== doc.guide.logical_size || await sha256ContentID(guideBytes) !== doc.guide.content_id) throw new Error("The embedded guide did not match its recorded exact identity.");
  }
  throwIfAborted(signal);
  return doc;
}

function safeStem(value: string, fallback: string): string {
  const cleaned = value.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, " ").replace(/\.\.+/gu, ".").trim().replace(/[ .]+$/gu, "").replace(/\s+/gu, " ");
  let stem = "";
  let bytes = 0;
  for (const character of cleaned || fallback) {
    const length = encoder.encode(character).byteLength;
    if (bytes + length > 200) break;
    stem += character;
    bytes += length;
  }
  const reserved = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]?|LPT[1-9¹²³]?)(?:\.|$)/iu.test(stem);
  return reserved ? `_${stem}` : stem || fallback;
}

export async function materialListFiles(doc: MaterialListDocument): Promise<File[]> {
  const listText = serializeMaterialList(doc);
  const files = [new File([listText], `${safeStem(doc.title, "Material list")}.cairn-list.json`, { type: "application/json;charset=utf-8" })];
  if (doc.guide) {
    const bytes = encoder.encode(doc.guide.body);
    if (bytes.byteLength !== doc.guide.logical_size || await sha256ContentID(bytes) !== doc.guide.content_id) throw new Error("The embedded guide no longer matches its recorded exact identity.");
    if (doc.guide.source && (doc.guide.source.content_id !== doc.guide.content_id || doc.guide.source.logical_size !== doc.guide.logical_size)) throw new Error("The embedded guide source does not match its exact identity.");
    const base = safeStem(doc.guide.name, "Skill").replace(/\.skill\.txt$/iu, "");
    files.unshift(new File([bytes], `${base}.skill.txt`, { type: "text/plain;charset=utf-8" }));
  }
  return files;
}
