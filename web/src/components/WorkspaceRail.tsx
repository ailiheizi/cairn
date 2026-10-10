import { Activity, Copy, HardDrive, Home, StickyNote, Tags, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import type { Translator } from "../i18n";
import { libraryPageForMode } from "../lib/libraryViews";
import type { ViewMode } from "../lib/types";

// The workspace rail: the workspace views.
//
// The rail is navigation only. Selecting a view changes the browser's own
// projection; it never changes what is stored or published. Readiness facts
// live in the one trusted status disclosure (`StatusPanel`) instead of being
// duplicated here as bare dots. The activity entry keeps a ref so the activity
// view can hand focus back to it when Escape is pressed.
//
// On a phone the rail is not rendered inline at all; the shell mounts this
// same rail element inside `WorkspaceRailPanel`, which is a modal host. The
// panel adds only the dialog shell (backdrop, close control, scroll area);
// every entry and the status disclosure inside it are the shared components,
// so the two presentations cannot drift apart.

export function WorkspaceRail({ t, viewMode, hasActiveFilters, libraryCount, sourceCount, onLibrary, onSources, onActivity, onDuplicates, onTags, onNotes, activityRef, duplicatesRef, tagsRef, notesRef }: {
  t: Translator;
  viewMode: string;
  hasActiveFilters: boolean;
  libraryCount: number;
  sourceCount: number;
  onLibrary: (event: { currentTarget: EventTarget | null }) => void;
  onSources: () => void;
  onActivity: () => void;
  onDuplicates: () => void;
  onTags: () => void;
  onNotes: () => void;
  activityRef?: RefObject<HTMLButtonElement | null>;
  duplicatesRef?: RefObject<HTMLButtonElement | null>;
  tagsRef?: RefObject<HTMLButtonElement | null>;
  notesRef?: RefObject<HTMLButtonElement | null>;
}) {
  return <aside className="workspace-sidebar" aria-label={t("Navigation")}>
    <div className="workspace-sidebar-group">
      <p className="workspace-sidebar-label">{t("ORGANIZE")}</p>
      <button type="button" className={`workspace-nav-item ${["content", "search", "tag"].includes(viewMode) || libraryPageForMode(viewMode as ViewMode) ? "active" : ""}`} onClick={onLibrary}><Home size={16} /><span>{t("Library")}</span><small>{libraryCount || 0}</small></button>
      <button type="button" ref={tagsRef} data-view="tags" className={`workspace-nav-item ${viewMode === "tags" ? "active" : ""}`} onClick={onTags}><Tags size={16} /><span>{t("Tags")}</span></button>
      <button type="button" ref={notesRef} data-view="notes" className={`workspace-nav-item ${viewMode === "notes" ? "active" : ""}`} onClick={onNotes}><StickyNote size={16} /><span>{t("Notes")}</span></button>
    </div>
    <div className="workspace-sidebar-group workspace-sidebar-group-management">
      <p className="workspace-sidebar-label">{t("MANAGE")}</p>
      <button type="button" className={`workspace-nav-item ${viewMode === "sources" ? "active" : ""}`} onClick={onSources}><HardDrive size={16} /><span>{t("Sources")}</span><small>{sourceCount}</small></button>
      <button type="button" ref={duplicatesRef} data-view="duplicates" className={`workspace-nav-item ${viewMode === "duplicates" ? "active" : ""}`} onClick={onDuplicates}><Copy size={16} /><span>{t("Duplicates")}</span></button>
      <button type="button" ref={activityRef} data-view="activity" className={`workspace-nav-item ${viewMode === "activity" ? "active" : ""}`} onClick={onActivity}><Activity size={16} /><span>{t("Activity")}</span></button>
    </div>
  </aside>;
}

// The phone presentation of the rail. It is a dialog shell only: the children
// are the same `WorkspaceRail` element and the same trusted status disclosure
// the desktop renders, so the panel has no navigation behavior of its own.
// The shell owns the focus trap, the Escape key, and the `drawer-open` body
// class, exactly as it does for the other drawers; this component owns the
// backdrop dismissal and the panel's own layout.

export function WorkspaceRailPanel({ t, onClose, children }: { t: Translator; onClose: () => void; children: ReactNode }) {
  // A backdrop press dismisses the panel. Preventing the mouse-down default
  // keeps the press from moving focus to the document body first, so the
  // shell's drawer effect returns focus to the button that opened the panel
  // on this path as well as on Escape.
  return <div className="rail-backdrop" onMouseDown={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); onClose(); }}>
    <aside className="rail-panel" role="dialog" aria-modal="true" aria-label={t("Navigation")}>
      <div className="rail-panel-head">
        <button type="button" className="icon-button rail-panel-close" aria-label={t("Close navigation")} title={t("Close navigation")} onClick={onClose}><X size={17} aria-hidden="true" /></button>
      </div>
      <div className="rail-panel-scroll">{children}</div>
    </aside>
  </div>;
}
