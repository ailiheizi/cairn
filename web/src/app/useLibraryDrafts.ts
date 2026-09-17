import { useState } from "react";
import type { Translator } from "../i18n";

// Unsaved note and tag drafts of the one details subject, plus the guard that
// keeps them from being discarded silently.
//
// Drafts are browser state only. They become durable when the operator saves
// them as an `Annotation` through the daemon; nothing here is a durable record.

export type LibraryDraftsFlow = {
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

  function detailDraftIsDirty() {
    const editingChanged = Boolean(editingNoteID) && editingBody !== editingOriginalBody;
    return Boolean(noteDraft.trim() || tagDraft.trim() || editingChanged);
  }
  function canLeaveDetailDrafts() {
    return !detailDraftIsDirty() || window.confirm(t("Discard unsaved note changes?"));
  }
  function discardDetailDrafts() {
    setNoteDraft(""); setTagDraft(""); setEditingNoteID(""); setEditingBody(""); setEditingOriginalBody("");
  }

  return {
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
    detailDraftIsDirty,
    canLeaveDetailDrafts,
    discardDetailDrafts,
  };
}
