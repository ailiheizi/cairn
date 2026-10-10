import type { Translator } from "../i18n";
import { allLibraryPageIds, enabledLibraryPageGroups, type LibraryViewId } from "../lib/libraryViews";

export function LibraryViewPreferences({ t, enabledViewIds, onEnabledChange }: {
  t: Translator;
  enabledViewIds: ReadonlySet<LibraryViewId>;
  onEnabledChange: (id: LibraryViewId, enabled: boolean) => void;
}) {
  const groups = enabledLibraryPageGroups(allLibraryPageIds);
  return <fieldset className="library-view-preferences">
    <legend>{t("Library views")}</legend>
    <p className="library-view-preferences-note">{t("Choose which bundled presentations appear within each Library section. These preferences are stored in this browser only.")}</p>
    <div className="library-view-preference-list">
      {groups.map((group) => <section className="library-view-preference-group" key={group.root.id} aria-label={t(group.root.label)}>
        <h4>{t(group.root.label)}</h4>
        {group.presentations.map((view) => <label className="library-view-preference-row" key={view.id}>
          <span className="library-view-preference-copy">
            <strong>{t(view.presentationLabel ?? view.label)}</strong>
            <small>{t(view.description || view.label)}</small>
          </span>
          <input
            className="library-view-preference-toggle"
            type="checkbox"
            checked={enabledViewIds.has(view.id)}
            onChange={(event) => onEnabledChange(view.id, event.currentTarget.checked)}
          />
        </label>)}
      </section>)}
    </div>
  </fieldset>;
}
