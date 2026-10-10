import type { AppearanceMode, AppearancePreference, InterfaceId, ThemeID } from "../lib/appearance";
import type { Translator } from "../i18n";
import { interfaceCatalog } from "../lib/interfaceCatalog";
import "../styles/appearance.css";

const appearanceModes: AppearanceMode[] = ["system", "light", "dark"];
const themes: Array<{ id: ThemeID; swatches: string[] }> = [
  { id: "slate", swatches: ["#edf1f3", "#687d8a", "#263744"] },
  { id: "paper", swatches: ["#f3ecdf", "#9a7040", "#493a28"] },
  { id: "indigo", swatches: ["#efedfa", "#776bb7", "#302d4c"] },
];

export function AppearancePreferences({ preference, onChange, onReset, t }: {
  preference: AppearancePreference;
  onChange: (preference: AppearancePreference) => void;
  onReset: () => void;
  t: Translator;
}) {
  const changeAppearance = (appearance: AppearanceMode) => onChange({ ...preference, appearance });
  const changeTheme = (themeId: ThemeID) => onChange({ ...preference, themeId });
  const changeInterface = (interfaceId: InterfaceId) => onChange({ ...preference, interfaceId });

  return <section className="appearance-preferences" aria-labelledby="appearance-title">
    <div className="appearance-heading">
      <div>
        <h3 id="appearance-title">{t("Interface")}</h3>
        <p>{t("Choose your interface. Changes apply immediately in this browser.")}</p>
      </div>
      <button className="appearance-reset" type="button" onClick={onReset}>{t("Reset to default")}</button>
    </div>

    <fieldset className="appearance-fieldset interface-fieldset">
      <legend>{t("Choose your interface")}</legend>
      <div className="interface-options">
        {interfaceCatalog.map((definition) => <label className="interface-option" key={definition.id}>
          <input
            type="radio"
            name="restoreweave-interface"
            value={definition.id}
            checked={preference.interfaceId === definition.id}
            onChange={() => changeInterface(definition.id)}
          />
          <span className="interface-card">
            <span className={`interface-preview interface-preview-${definition.preview}`} aria-hidden="true">
              {definition.preview === "workspace" ? <>
                <span className="workspace-preview-topbar"><i /><i /><i /></span>
                <span className="workspace-preview-body">
                  <i className="workspace-preview-rail" />
                  <i className="workspace-preview-list" />
                  <i className="workspace-preview-detail" />
                </span>
              </> : <>
                <i className="showcase-preview-nav" />
                <span className="showcase-preview-main">
                  <span className="showcase-preview-heading"><i /><i /></span>
                  <span className="showcase-preview-tiles"><i /><i /><i /><i /></span>
                </span>
              </>}
            </span>
            <strong>{t(definition.label)}</strong>
            <small>{t(definition.description)}</small>
          </span>
        </label>)}
      </div>
    </fieldset>

    <fieldset className="appearance-fieldset">
      <legend>{t("Color mode")}</legend>
      <div className="appearance-mode-options">
        {appearanceModes.map((mode) => <label className="appearance-mode-option" key={mode}>
          <input
            type="radio"
            name="restoreweave-appearance-mode"
            value={mode}
            checked={preference.appearance === mode}
            onChange={() => changeAppearance(mode)}
          />
          <span>{t(mode === "system" ? "Use device setting" : mode === "light" ? "Light" : "Dark")}</span>
        </label>)}
      </div>
    </fieldset>

    <details className="appearance-colors">
      <summary>{t("Colors")}</summary>
      <div className="appearance-theme-options">
        {themes.map((theme) => <label className="appearance-theme-option" key={theme.id}>
          <input
            type="radio"
            name="restoreweave-theme-palette"
            value={theme.id}
            checked={preference.themeId === theme.id}
            onChange={() => changeTheme(theme.id)}
          />
          <span className="appearance-theme-card">
            <span className="appearance-swatches" aria-hidden="true">
              {theme.swatches.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
            </span>
            <strong>{t(theme.id === "slate" ? "Slate" : theme.id === "paper" ? "Warm paper" : "Deep indigo")}</strong>
            <small>{t(theme.id === "slate" ? "Neutral and clear" : theme.id === "paper" ? "Warm and soft" : "Deep and calm")}</small>
          </span>
        </label>)}
      </div>
    </details>

    <p className="appearance-storage-note">{t("This preference is stored in this browser only. It does not change RestoreWeave service settings or your content.")}</p>
  </section>;
}
