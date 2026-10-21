import { useState } from "react";
import type { Translator } from "../i18n";

// Unsaved note, tag, and reviewed-description drafts, plus the shared guard
// that keeps detail edits from being discarded silently.
//
// Drafts are browser state only. They become durable when the operator saves
// them through the daemon; nothing here is a durable record.

export type LibraryDraftsFlow = {
  descriptionDraft: { key: string; body: string; originalBody: string } | null;
  beginDescriptionDraft: (key: string, body: string) => void;
  updateDescriptionDraft: (key: string, expectedBody: string, body: string) => void;
  rebaseDescriptionDraft: (key: string, expectedBody: string, nextKey: string, acceptedBody: string) => void;
  clearDescriptionDraft: (key: string, expectedBody?: string) => void;
  noteDraft: string;
  setNoteDraft: (value: string) => void;
  tagDraft: string;
  setTagDraft: (value: string) => void;
  editingNoteID: string;
  setEditingNoteID: (value: string) => void;
  editingBody: string;
  setEditingBody: (value: string) => void;
  editingOriginalBody: string;
  setEditingOriginalBody: (value: string) => void;
  detailDraftFingerprint: () => string;
  detailDraftIsDirty: () => boolean;
  canLeaveDetailDrafts: () => boolean;
  discardDetailDrafts: () => void;
};

export function useLibraryDrafts({ t }: { t: Translator }): LibraryDraftsFlow {
  const [noteDraft, setNoteDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [editingNoteID, setEditingNoteID] = useState("");
  const [editingBody, setEditingBody] = useState("");
  const [editingOriginalBody, setEditingOriginalBody] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState<LibraryDraftsFlow["descriptionDraft"]>(null);

  function beginDescriptionDraft(key: string, body: string) {
    setDescriptionDraft((current) => current?.key === key ? current : { key, body, originalBody: body });
  }
  function updateDescriptionDraft(key: string, expectedBody: string, body: string) {
    setDescriptionDraft((current) => current?.key === key && current.body === expectedBody ? { ...current, body } : current);
  }
  function rebaseDescriptionDraft(key: string, expectedBody: string, nextKey: string, acceptedBody: string) {
    setDescriptionDraft((current) => current?.key === key && current.body === expectedBody
      ? null
      : current?.key === key ? { key: nextKey, body: current.body, originalBody: acceptedBody } : current);
  }
  function clearDescriptionDraft(key: string, expectedBody?: string) {
    setDescriptionDraft((current) => current?.key === key && (expectedBody === undefined || current.body === expectedBody) ? null : current);
  }

  function detailDraftIsDirty() {
    const editingChanged = Boolean(editingNoteID) && editingBody !== editingOriginalBody;
    const descriptionChanged = Boolean(descriptionDraft && descriptionDraft.body !== descriptionDraft.originalBody);
    return Boolean(noteDraft.trim() || tagDraft.trim() || editingChanged || descriptionChanged);
  }
  function detailDraftFingerprint() {
    return JSON.stringify([noteDraft, tagDraft, editingNoteID, editingBody, editingOriginalBody, descriptionDraft]);
  }
  function canLeaveDetailDrafts() {
    return !detailDraftIsDirty() || window.confirm(t("Discard unsaved note changes?"));
  }
  function discardDetailDrafts() {
    setNoteDraft(""); setTagDraft(""); setEditingNoteID(""); setEditingBody(""); setEditingOriginalBody(""); setDescriptionDraft(null);
  }

  return {
    descriptionDraft,
    beginDescriptionDraft,
    updateDescriptionDraft,
    rebaseDescriptionDraft,
    clearDescriptionDraft,
    noteDraft,
    setNoteDraft,
    tagDraft,
    setTagDraft,
    editingNoteID,
    setEditingNoteID,
    editingBody,
    setEditingBody,
    editingOriginalBody,
    setEditingOriginalBody,
    detailDraftFingerprint,
    detailDraftIsDirty,
    canLeaveDetailDrafts,
    discardDetailDrafts,
  };
}
