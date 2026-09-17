import { useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { renderedColumnCount } from "../lib/format";
import type { DetailsFlow } from "./useDetails";
import type { LibraryFlow } from "./useLibrary";
import type { Notice, SearchHit } from "../lib/types";

// The batch selection over the rendered library listing.
//
// Selection is a second, explicit concept on top of the one details subject:
// it says which subjects a batch action acts on. It is never membership,
// ownership, or authority to delete bytes.

export type SelectionFlow = {
  selectionRefs: string[];
  setSelectionRefs: (value: string[] | ((current: string[]) => string[])) => void;
  selectionAnchor: string;
  setSelectionAnchor: (value: string) => void;
  rovingIndex: number;
  setRovingIndex: (value: number) => void;
  selectionTagDraft: string;
  setSelectionTagDraft: (value: string) => void;
  selectionSubjects: SearchHit[];
  rovingRow: number;
  toggleSelectionAt: (index: number) => void;
  extendSelectionTo: (index: number) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  applySelectionTag: () => Promise<void>;
  handleLibraryKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

export function useSelection({ t, workspaceID, hits, renderedHits, selected, details, library, annotationStorageReady, catalogStorageMessage, refreshCapabilities, setBusy, notify, libraryListRef }: {
  t: Translator;
  workspaceID: string;
  hits: SearchHit[];
  renderedHits: SearchHit[];
  selected: SearchHit | undefined;
  details: DetailsFlow;
  library: LibraryFlow;
  annotationStorageReady: boolean;
  catalogStorageMessage: string;
  refreshCapabilities: () => Promise<void>;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  libraryListRef: RefObject<HTMLDivElement | null>;
}): SelectionFlow {
  const [selectionRefs, setSelectionRefs] = useState<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState("");
  const [rovingIndex, setRovingIndex] = useState(0);
  const [selectionTagDraft, setSelectionTagDraft] = useState("");

  const selectionSubjects = useMemo(() => {
    const byRef = new Map<string, SearchHit>();
    for (const hit of hits) {
      const subjectRef = hit.subject_ref?.trim();
      if (subjectRef && !byRef.has(subjectRef)) byRef.set(subjectRef, hit);
    }
    return selectionRefs.map((subjectRef) => byRef.get(subjectRef)).filter((hit): hit is SearchHit => Boolean(hit));
  }, [hits, selectionRefs]);
  const rovingRow = renderedHits.length ? Math.min(rovingIndex, renderedHits.length - 1) : 0;

  // Selection helpers read the rendered order, so a range or a keyboard step
  // follows exactly the tiles the user sees after sorting or switching layout.
  function selectionRefAt(index: number) { return renderedHits[index]?.subject_ref?.trim() ?? ""; }
  function toggleSelectionAt(index: number) {
    const subjectRef = selectionRefAt(index);
    if (!subjectRef) return;
    setSelectionAnchor(subjectRef);
    setSelectionRefs((current) => current.includes(subjectRef) ? current.filter((value) => value !== subjectRef) : [...current, subjectRef]);
  }
  function extendSelectionTo(index: number) {
    const subjectRef = selectionRefAt(index);
    if (!subjectRef) return;
    const anchorIndex = selectionAnchor ? renderedHits.findIndex((hit) => hit.subject_ref?.trim() === selectionAnchor) : -1;
    if (anchorIndex < 0) { toggleSelectionAt(index); return; }
    const range = renderedHits.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index))
      .map((hit) => hit.subject_ref?.trim() ?? "")
      .filter((value): value is string => Boolean(value));
    setSelectionRefs((current) => {
      const next = [...current];
      for (const value of range) if (!next.includes(value)) next.push(value);
      return next;
    });
  }
  function selectAllVisible() {
    const refs = [...new Set(renderedHits.map((hit) => hit.subject_ref?.trim() ?? "").filter((value): value is string => Boolean(value)))];
    setSelectionRefs(refs);
    setSelectionAnchor(refs.at(-1) ?? "");
  }
  function clearSelection() { setSelectionRefs([]); setSelectionAnchor(""); }

  // One tab stop for the whole list, with a roving tabindex: arrow keys move
  // focus between the tiles, Space toggles the focused tile, Enter opens its
  // details, and Cmd/Ctrl+A selects every visible item.
  function handleLibraryKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const tile = target?.closest<HTMLElement>("[data-result-index]");
    if (!tile) return;
    const current = Number(tile.dataset.resultIndex ?? "-1");
    if (!Number.isInteger(current) || current < 0 || current >= renderedHits.length) return;
    const last = renderedHits.length - 1;
    const moveFocus = (next: number) => {
      setRovingIndex(next);
      libraryListRef.current?.querySelector<HTMLElement>(`[data-result-index="${next}"] .result-open-copy`)?.focus();
    };
    if (event.key === "ArrowRight") { event.preventDefault(); moveFocus(Math.min(current + 1, last)); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); moveFocus(Math.max(current - 1, 0)); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const columns = renderedColumnCount(libraryListRef.current);
      moveFocus(event.key === "ArrowDown" ? Math.min(current + columns, last) : Math.max(current - columns, 0));
      return;
    }
    if (event.key === "Home") { event.preventDefault(); moveFocus(0); return; }
    if (event.key === "End") { event.preventDefault(); moveFocus(last); return; }
    if (event.key === " ") { event.preventDefault(); toggleSelectionAt(current); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectAllVisible(); }
  }

  // One tag body is applied to every selected subject with sequential
  // annotation.upsert calls. Partial success is reported as partial: earlier
  // successes are refreshed from the daemon and never discarded, and every
  // failure keeps its own reason.
  async function applySelectionTag() {
    const body = selectionTagDraft.trim();
    const targets = selectionSubjects;
    if (!body || !workspaceID || targets.length === 0) return;
    if (!annotationStorageReady) { notify({ kind: "error", text: catalogStorageMessage }); return; }
    setBusy(true); notify(undefined);
    const succeeded: string[] = [];
    const failures: Array<{ name: string; message: string }> = [];
    const recordedAnnotations: any[] = [];
    for (const hit of targets) {
      const subjectRef = hit.subject_ref?.trim() ?? "";
      const label = hit.name?.trim() || subjectRef || t("Untitled subject");
      if (!subjectRef) { failures.push({ name: label, message: t("This item has no stable subject reference.") }); continue; }
      try {
        const response = await command(operations.annotation.upsert, { workspace_id: workspaceID, subject_ref: subjectRef, kind: "TAG", body, expected_revision: 0 });
        succeeded.push(subjectRef);
        if (response.data?.annotation?.annotation_id) recordedAnnotations.push(response.data.annotation);
      } catch (error) {
        failures.push({ name: label, message: error instanceof Error ? error.message : t("Could not save tag") });
      }
    }
    if (succeeded.length) {
      const detailRef = selected?.subject_ref?.trim() ?? "";
      const detailAnnotation = detailRef ? recordedAnnotations.find((item) => item?.subject_ref?.trim() === detailRef) : undefined;
      if (detailAnnotation) details.setAnnotations((items) => items.some((item) => item.annotation_id === detailAnnotation.annotation_id) ? items : [...items, detailAnnotation]);
      const tags = await library.loadTagVocabulary(workspaceID);
      for (const subjectRef of succeeded) library.syncTagCoverage(subjectRef, tags);
      await refreshCapabilities();
    }
    if (failures.length === 0) {
      setSelectionTagDraft("");
      notify({ kind: "success", text: t("Tag \"{{tag}}\" added to {{count}} selected items.", { tag: body, count: succeeded.length }) });
    } else {
      const failureText = failures.map((failure) => `${failure.name}: ${failure.message}`).join("; ");
      if (succeeded.length) {
        notify({ kind: "warning", text: t("Tag \"{{tag}}\" added to {{succeeded}} of {{total}} selected items. Not added: {{failures}}", { tag: body, succeeded: succeeded.length, total: targets.length, failures: failureText }) });
      } else {
        notify({ kind: "error", text: t("Could not add the tag to any selected item. Not added: {{failures}}", { failures: failureText }) });
      }
    }
    setBusy(false);
  }

  return {
    selectionRefs,
    setSelectionRefs,
    selectionAnchor,
    setSelectionAnchor,
    rovingIndex,
    setRovingIndex,
    selectionTagDraft,
    setSelectionTagDraft,
    selectionSubjects,
    rovingRow,
    toggleSelectionAt,
    extendSelectionTo,
    selectAllVisible,
    clearSelection,
    applySelectionTag,
    handleLibraryKeyDown,
  };
}
