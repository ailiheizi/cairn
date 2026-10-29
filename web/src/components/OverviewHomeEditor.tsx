import { Check, Plus, RotateCcw, X } from "lucide-react";
import type { Translator } from "../i18n";
import type { OverviewBlockID } from "../lib/overviewPreferences";

const BLOCK_LABELS: Record<OverviewBlockID, string> = {
  photos: "Photos",
  music: "Music",
  videos: "Videos",
  materials: "Files on Home",
};

type Props = {
  hiddenBlocks: OverviewBlockID[];
  t: Translator;
  persistenceAvailable: boolean;
  onShowSection: (id: OverviewBlockID) => void;
  onReset: () => void;
  onSave: () => void;
  onCancel: () => void;
};

export function OverviewHomeEditor(props: Props) {
  const { t, hiddenBlocks } = props;
  return <div className="private-space-edit-actions" role="toolbar" aria-label={t("Edit private space")}>
    {hiddenBlocks.length > 0 && <details className="private-space-add-menu">
      <summary aria-label={t("Add a section")} title={t("Add a section")}><Plus aria-hidden="true" /></summary>
      <div role="menu" aria-label={t("Add a section")}>
        {hiddenBlocks.map((id) => <button type="button" role="menuitem" key={id} onClick={(event) => {
          props.onShowSection(id);
          event.currentTarget.closest("details")?.removeAttribute("open");
        }}>{t(BLOCK_LABELS[id])}</button>)}
      </div>
    </details>}
    <button type="button" className="private-space-edit-icon" aria-label={t("Reset home layout")} title={t("Reset home layout")} onClick={props.onReset}><RotateCcw aria-hidden="true" /></button>
    {!props.persistenceAvailable && <span className="private-space-save-warning" role="status">{t("Browser storage is unavailable. This layout may not be available after reload.")}</span>}
    <button type="button" className="private-space-edit-icon" aria-label={t("Cancel home layout editing")} title={t("Cancel home layout editing")} onClick={props.onCancel}><X aria-hidden="true" /></button>
    <button type="button" className="private-space-edit-icon is-done" aria-label={t("Save home layout")} title={t("Save home layout")} onClick={props.onSave}><Check aria-hidden="true" /></button>
  </div>;
}
