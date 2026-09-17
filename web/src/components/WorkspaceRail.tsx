import { Activity, Copy, HardDrive, Home, Tags } from "lucide-react";
import type { RefObject } from "react";
import type { Translator } from "../i18n";

// The desktop workspace rail: the workspace views.
//
// The rail is navigation only. Selecting a view changes the browser's own
// projection; it never changes what is stored or published. Readiness facts
// live in the one trusted status disclosure (`StatusPanel`) instead of being
// duplicated here as bare dots. The activity entry keeps a ref so the activity
// view can hand focus back to it when Escape is pressed.

export function WorkspaceRail({ t, viewMode, hasActiveFilters, libraryCount, sourceCount, onLibrary, onSources, onActivity, onDuplicates, onTags, activityRef, duplicatesRef, tagsRef }: {
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
  activityRef?: RefObject<HTMLButtonElement | null>;
  duplicatesRef?: RefObject<HTMLButtonElement | null>;
  tagsRef?: RefObject<HTMLButtonElement | null>;
}) {
  return <aside className="workspace-sidebar" aria-label={t("Workspace navigation")}>
    <div className="workspace-sidebar-group">
      <p className="workspace-sidebar-label">{t("WORKSPACE")}</p>
      <button type="button" className={`workspace-nav-item ${viewMode === "content" && !hasActiveFilters ? "active" : ""}`} onClick={onLibrary}><Home size={16} /><span>{t("Library")}</span><small>{libraryCount || 0}</small></button>
      <button type="button" className={`workspace-nav-item ${viewMode === "sources" ? "active" : ""}`} onClick={onSources}><HardDrive size={16} /><span>{t("Sources")}</span><small>{sourceCount}</small></button>
      <button type="button" ref={duplicatesRef} data-view="duplicates" className={`workspace-nav-item ${viewMode === "duplicates" ? "active" : ""}`} onClick={onDuplicates}><Copy size={16} /><span>{t("Duplicates")}</span></button>
      <button type="button" ref={tagsRef} data-view="tags" className={`workspace-nav-item ${viewMode === "tags" ? "active" : ""}`} onClick={onTags}><Tags size={16} /><span>{t("Tags")}</span></button>
      <button type="button" ref={activityRef} data-view="activity" className={`workspace-nav-item ${viewMode === "activity" ? "active" : ""}`} onClick={onActivity}><Activity size={16} /><span>{t("Activity")}</span></button>
    </div>
  </aside>;
}
