import type { Translator } from "../i18n";
import { enabledLibraryPageGroups, type LibraryPageId } from "../lib/libraryViews";
import type { LibraryPageMode, ViewMode } from "../lib/types";

/** Top-level content domains with their current in-domain renderer choices. */
export function LibraryPresentationNavigation({ t, mode, enabledPageIds, onNavigate }: {
  t: Translator;
  mode: ViewMode;
  enabledPageIds: ReadonlySet<LibraryPageId>;
  onNavigate: (mode: "content" | LibraryPageMode) => void;
}) {
  const groups = enabledLibraryPageGroups(enabledPageIds);
  const domains = groups.filter((group) => group.root.navigationKind !== "layout");
  const layouts = groups.filter((group) => group.root.navigationKind === "layout");
  const activeGroup = domains.find((group) => group.presentations.some((page) => page.mode === mode));

  function targetFor(group: (typeof groups)[number]): LibraryPageMode {
    const current = group.presentations.find((page) => page.mode === mode);
    if (current) return current.mode;
    const root = group.presentations.find((page) => page.id === group.root.id);
    return (root ?? group.presentations[0]!).mode;
  }

  return <nav className="library-presentation-navigation" aria-label={t("Library navigation")}>
    <div className="library-presentation-navigation__domains" role="group" aria-label={t("Content types")}>
      <button type="button" className={`library-presentation-navigation__domain ${mode === "content" ? "is-active" : ""}`} aria-pressed={mode === "content"} onClick={() => onNavigate("content")}>{t("All types")}</button>
      {domains.map((group) => {
        const active = group === activeGroup;
        return <button type="button" key={group.root.id} className={`library-presentation-navigation__domain ${active ? "is-active" : ""}`} data-domain={group.root.id} aria-pressed={active} onClick={() => onNavigate(targetFor(group))}>{t(group.root.label)}</button>;
      })}
    </div>
    {layouts.length > 0 && <div className="library-presentation-navigation__layouts" role="group" aria-label={t("Library layouts")}>
      {layouts.map((group) => <button type="button" key={group.root.id} className={`library-presentation-navigation__presentation ${group.presentations.some((page) => page.mode === mode) ? "is-active" : ""}`} data-layout={group.root.id} aria-pressed={group.presentations.some((page) => page.mode === mode)} onClick={() => onNavigate(targetFor(group))}>{t(group.root.label)}</button>)}
    </div>}
    {activeGroup && activeGroup.presentations.length > 1 && <div className="library-presentation-navigation__presentations" role="group" aria-label={t("Display style")}>
      {activeGroup.presentations.map((page) => <button type="button" key={page.id} className={`library-presentation-navigation__presentation ${page.mode === mode ? "is-active" : ""}`} data-presentation={page.id} aria-pressed={page.mode === mode} onClick={() => onNavigate(page.mode)}>{t(page.presentationLabel ?? page.label)}</button>)}
    </div>}
  </nav>;
}
