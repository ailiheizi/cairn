import { useCallback, useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { favoriteAnnotations, FAVORITE_TAG } from "../lib/favorites";
import type { FavoriteControls } from "../lib/favorites";
import type { LibraryFlow } from "./useLibrary";
import type { AnnotationRecord, Notice, SearchHit } from "../lib/types";

export type FavoriteMutationPlan =
  | { kind: "add"; subjectRef: string }
  | { kind: "remove"; subjectRef: string; annotations: Array<{ annotationID: string; expectedRevision: number }> };

/** Plan only against the current, complete workspace tag read. */
export function planFavoriteMutation(records: AnnotationRecord[], subjectRef: string): FavoriteMutationPlan {
  const normalized = subjectRef.trim();
  if (!normalized) throw new Error("A stable subject reference is required.");
  const matches = favoriteAnnotations(records, normalized);
  if (!matches.length) return { kind: "add", subjectRef: normalized };
  const annotations = matches.map((record) => {
    const annotationID = record.annotation_id?.trim();
    const expectedRevision = record.revision;
    if (!annotationID || !Number.isSafeInteger(expectedRevision) || (expectedRevision ?? 0) < 1) {
      throw new Error("Favorite tag identity or revision is unavailable.");
    }
    return { annotationID, expectedRevision: expectedRevision as number };
  });
  return { kind: "remove", subjectRef: normalized, annotations };
}

export function useFavorites({ t, workspaceID, library, annotationStorageReady, catalogStorageMessage, busy, setBusy, notify, refreshCapabilities }: {
  t: Translator;
  workspaceID: string;
  library: LibraryFlow;
  annotationStorageReady: boolean;
  catalogStorageMessage: string;
  busy: boolean;
  setBusy: (value: boolean) => void;
  notify: (notice: Notice | undefined) => void;
  refreshCapabilities: () => Promise<void>;
}): FavoriteControls {
  const [busySubjects, setBusySubjects] = useState<Record<string, boolean>>({});
  const mutationInFlightRef = useRef(new Set<string>());
  const currentWorkspaceID = useRef(workspaceID);
  currentWorkspaceID.current = workspaceID;
  const stateInScope = Boolean(workspaceID && library.tagVocabularyWorkspaceID === workspaceID);
  const status: FavoriteControls["status"] = !stateInScope || library.tagStatus === "loading"
    ? "loading"
    : library.tagStatus === "ready" ? "ready" : "unavailable";
  const writable = annotationStorageReady && !busy && status === "ready";

  const isFavorite = useCallback((subjectRef: string) => stateInScope && favoriteAnnotations(library.workspaceTags, subjectRef).length > 0, [library.workspaceTags, stateInScope]);
  const isBusy = useCallback((subjectRef: string) => Boolean(busySubjects[subjectRef.trim()]), [busySubjects]);
  const onToggle = useCallback((hit: SearchHit) => {
    const subjectRef = hit.subject_ref?.trim() ?? "";
    if (!subjectRef) {
      notify({ kind: "error", text: t("This item has no stable subject reference.") });
      return;
    }
    if (!workspaceID || !annotationStorageReady) {
      notify({ kind: "error", text: !annotationStorageReady ? catalogStorageMessage : t("Favorite status is unavailable") });
      return;
    }
    const operationKey = `${workspaceID}\u0000${subjectRef}`;
    if (busy || busySubjects[subjectRef] || mutationInFlightRef.current.size > 0) return;
    if (status !== "ready" || !stateInScope) {
      notify({ kind: "warning", text: t("Tags and favorites could not be read. Retry before editing them.") });
      return;
    }

    const operationWorkspaceID = workspaceID;
    const snapshot = library.workspaceTags;
    mutationInFlightRef.current.add(operationKey);
    setBusySubjects((items) => ({ ...items, [subjectRef]: true }));
    setBusy(true);
    notify({ kind: "warning", text: t("Updating favorite for {{name}}", { name: hit.name?.trim() || subjectRef }) });
    void (async () => {
      let mutationDegraded = false;
      let mutationPartial = false;
      try {
        const plan = planFavoriteMutation(snapshot, subjectRef);
        if (plan.kind === "add") {
          const response = await command(operations.annotation.upsert, {
            workspace_id: operationWorkspaceID,
            subject_ref: plan.subjectRef,
            kind: "TAG",
            body: FAVORITE_TAG,
            expected_revision: 0,
          });
          mutationDegraded = response.status === "DEGRADED";
        } else {
          for (let index = 0; index < plan.annotations.length; index += 1) {
            const annotation = plan.annotations[index];
            try {
              const response = await command(operations.annotation.delete, {
                workspace_id: operationWorkspaceID,
                annotation_id: annotation.annotationID,
                expected_revision: annotation.expectedRevision,
              });
              mutationDegraded ||= response.status === "DEGRADED";
            } catch (error) {
              mutationPartial = index > 0;
              throw error;
            }
          }
        }

        if (currentWorkspaceID.current !== operationWorkspaceID) return;
        const reread = await library.reloadTagVocabulary(operationWorkspaceID);
        if (currentWorkspaceID.current !== operationWorkspaceID) return;
        if (reread.status !== "ready" || reread.workspaceID !== operationWorkspaceID) {
          notify({ kind: "error", text: t("Tags and favorites could not be read. Retry before editing them.") });
          return;
        }
        library.syncTagCoverage(subjectRef, reread.records);
        await refreshCapabilities();
        if (currentWorkspaceID.current !== operationWorkspaceID) return;
        if (mutationDegraded || mutationPartial) {
          notify({ kind: "warning", text: t("Favorite changed, but the operation was partial or degraded. The tag list was refreshed.") });
        } else {
          notify({ kind: "success", text: t(hasFavorite(reread.records, subjectRef) ? "Added to favorites." : "Removed from favorites.") });
        }
      } catch (error) {
        if (currentWorkspaceID.current === operationWorkspaceID) {
          // Even when the write failed, reconcile before allowing another edit.
          const reread = await library.reloadTagVocabulary(operationWorkspaceID).catch(() => undefined);
          if (currentWorkspaceID.current !== operationWorkspaceID) return;
          if (reread?.status === "ready" && reread.workspaceID === operationWorkspaceID) library.syncTagCoverage(subjectRef, reread.records);
          const reason = error instanceof Error ? error.message : String(error);
          const prefix = mutationPartial ? t("Favorite update was partial.") : t("Could not update favorite.");
          notify({ kind: mutationPartial ? "warning" : "error", text: `${prefix} ${reason}` });
        }
      } finally {
        mutationInFlightRef.current.delete(operationKey);
        setBusySubjects((items) => { const next = { ...items }; delete next[subjectRef]; return next; });
        setBusy(false);
      }
    })();
  }, [annotationStorageReady, busy, busySubjects, catalogStorageMessage, isFavorite, library, notify, refreshCapabilities, setBusy, stateInScope, status, t, workspaceID]);

  return { status, writable, isFavorite: (subjectRef) => isFavorite(subjectRef), isBusy, onToggle };
}

function hasFavorite(records: AnnotationRecord[], subjectRef: string): boolean {
  return favoriteAnnotations(records, subjectRef).length > 0;
}
