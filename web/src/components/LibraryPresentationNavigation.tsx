import type { Translator } from "../i18n";
import { Home, Image, LayoutGrid, Music2, Video } from "lucide-react";
import { enabledLibraryPageGroups, type LibraryPageId } from "../lib/libraryViews";
import type { LibraryPageMode, ViewMode } from "../lib/types";

/**
 * `complete` is the combined navigation (domains, aggregate layouts and the
 * active domain's presentations). `domains` keeps only the top-level
 * Library/Photos/Music capsule for the host chrome. `presentations` keeps
 * only the active domain's alternative renderers for a focused page, and
 * renders nothing when that domain has no
 * alternative. `layouts` is the ordinary Library's on-demand file/aggregate
 * layout choice. The variant changes presentation only; registry grouping,
 * selected target and enabled/disabled fallback stay identical.
 */
export type LibraryPresentationNavigationVariant = "complete" | "domains" | "presentations" | "layouts";

/** Top-level content domains with their current in-domain renderer choices. */
export function LibraryPresentationNavigation({ t, mode, enabledPageIds, onNavigate, variant = "complete" }: {
  t: Translator;
  mode: ViewMode;
  enabledPageIds: ReadonlySet<LibraryPageId>;
  onNavigate: (mode: "content" | LibraryPageMode) => void;
  variant?: LibraryPresentationNavigationVariant;
}) {
  const groups = enabledLibraryPageGroups(enabledPageIds);
  const domains = groups.filter((group) => group.root.navigationKind !== "layout");
  const home = groups.find((group) => group.root.id === "cairn:overview");
  const layouts = groups.filter((group) => group.root.navigationKind === "layout" && group !== home);
  const activeGroup = domains.find((group) => group.presentations.some((page) => page.mode === mode));
  const libraryActive = mode === "content" || layouts.some((group) => group.presentations.some((page) => page.mode === mode));

  function targetFor(group: (typeof groups)[number]): LibraryPageMode {
    const current = group.presentations.find((page) => page.mode === mode);
    if (current) return current.mode;
    const root = group.presentations.find((page) => page.id === group.root.id);
    return (root ?? group.presentations[0]!).mode;
  }

  function destinationIcon(mode: string, layout = false) {
    if (mode === "photos") return <Image size={15} aria-hidden="true" />;
    if (mode === "music") return <Music2 size={15} aria-hidden="true" />;
    if (mode === "page:cairn:videos") return <Video size={15} aria-hidden="true" />;
    if (layout) return <LayoutGrid size={15} aria-hidden="true" />;
    return <LayoutGrid size={15} aria-hidden="true" />;
  }

  const domainButtons = <div className="library-presentation-navigation__domains" role="group" aria-label={t("Content apps")}>
    {home && <button type="button" className={`library-presentation-navigation__domain ${mode === targetFor(home) ? "is-active" : ""}`} data-domain="cairn:overview" aria-current={mode === targetFor(home) ? "page" : undefined} aria-pressed={mode === targetFor(home)} onClick={() => onNavigate(targetFor(home))}><Home size={15} aria-hidden="true" /><span>{t("Private space")}</span></button>}
    <button type="button" className={`library-presentation-navigation__domain library-presentation-navigation__domain--library ${libraryActive ? "is-active" : ""}`} aria-current={libraryActive ? "page" : undefined} aria-pressed={libraryActive} onClick={() => onNavigate("content")}><LayoutGrid size={15} aria-hidden="true" /><span>{t("Library")}</span></button>
    {domains.map((group) => {
      const active = group === activeGroup;
      return <button type="button" key={group.root.id} className={`library-presentation-navigation__domain ${active ? "is-active" : ""}`} data-domain={group.root.id} aria-current={active ? "page" : undefined} aria-pressed={active} onClick={() => onNavigate(targetFor(group))}>{destinationIcon(group.root.mode)}<span>{t(group.root.label)}</span></button>;
    })}
  </div>;
  const layoutButtons = layouts.length > 0 && <div className="library-presentation-navigation__layouts" role="group" aria-label={t("Library layouts")}>
    {layouts.map((group) => {
      const active = group.presentations.some((page) => page.mode === mode);
      return <button type="button" key={group.root.id} className={`library-presentation-navigation__presentation ${active ? "is-active" : ""}`} data-layout={group.root.id} aria-current={active ? "page" : undefined} aria-pressed={active} onClick={() => onNavigate(targetFor(group))}>{destinationIcon(group.root.mode, true)}<span>{t(group.root.label)}</span></button>;
    })}
  </div>;
  // A domain keeps its alternative renderers beside the wall. A single enabled
  // renderer (Music, or Photos with Exhibition off) is not a choice, so a
  // focused page renders no permanent bar for it. The focused variant names the
  // nav itself, so the inner group drops the duplicate label there.
  const presentations = activeGroup?.presentations ?? [];
  function presentationButtons(labelled: boolean) {
    if (presentations.length <= 1) return null;
    return <div className="library-presentation-navigation__presentations" role="group" aria-label={labelled ? t("Display style") : undefined}>
      {presentations.map((page) => <button type="button" key={page.id} className={`library-presentation-navigation__presentation ${page.mode === mode ? "is-active" : ""}`} data-presentation={page.id} aria-pressed={page.mode === mode} onClick={() => onNavigate(page.mode)}>{t(page.presentationLabel ?? page.label)}</button>)}
    </div>;
  }

  if (variant === "presentations") {
    if (presentations.length <= 1) return null;
    return <nav className="library-presentation-navigation library-presentation-navigation--presentations" aria-label={t("Display style")}>{presentationButtons(false)}</nav>;
  }
  if (variant === "domains") {
    return <nav className="library-presentation-navigation library-presentation-navigation--domains" aria-label={t("App destinations")}>{domainButtons}</nav>;
  }
  if (variant === "layouts") {
    return <nav className="library-presentation-navigation library-presentation-navigation--layouts" aria-label={t("Library layouts")}>
      <div className="library-presentation-navigation__layouts" role="group" aria-label={t("Library layouts")}>
        <button type="button" className={`library-presentation-navigation__presentation ${mode === "content" ? "is-active" : ""}`} aria-current={mode === "content" ? "page" : undefined} aria-pressed={mode === "content"} onClick={() => onNavigate("content")}><Home size={15} aria-hidden="true" /><span>{t("File view")}</span></button>
        {layouts.map((group) => {
          const active = group.presentations.some((page) => page.mode === mode);
          return <button type="button" key={group.root.id} className={`library-presentation-navigation__presentation ${active ? "is-active" : ""}`} data-layout={group.root.id} aria-current={active ? "page" : undefined} aria-pressed={active} onClick={() => onNavigate(targetFor(group))}>{destinationIcon(group.root.mode, true)}<span>{t(group.root.label)}</span></button>;
        })}
      </div>
    </nav>;
  }
  return <nav className="library-presentation-navigation library-presentation-navigation--complete" aria-label={t("App destinations")}>{domainButtons}{layoutButtons}{presentationButtons(true)}</nav>;
}
