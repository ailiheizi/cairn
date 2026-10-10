import { useSyncExternalStore } from "react";
import type { AppearanceMode, AppearancePreference, BuiltInThemeID, InterfaceId, ThemeID } from "../lib/appearance";
import type { PresentationPackageRefusal } from "../lib/presentationPackages";
import { getPresentationPackageState, PRESENTATION_APP_VERSION, subscribePresentationPackages } from "../lib/presentationPackages";
import type { Translator } from "../i18n";
import { interfaceCatalog } from "../lib/interfaceCatalog";
import "../styles/appearance.css";

const appearanceModes: AppearanceMode[] = ["system", "light", "dark"];

// The three compiled palettes. Their labels and descriptions stay catalog keys;
// an installed package supplies its own name as data.
const builtInThemes: Array<{ id: BuiltInThemeID; swatches: string[]; label: string; description: string }> = [
  { id: "slate", swatches: ["#edf1f3", "#687d8a", "#263744"], label: "Slate", description: "Neutral and clear" },
  { id: "paper", swatches: ["#f3ecdf", "#9a7040", "#493a28"], label: "Warm paper", description: "Warm and soft" },
  { id: "indigo", swatches: ["#efedfa", "#776bb7", "#302d4c"], label: "Deep indigo", description: "Deep and calm" },
];

/**
 * One refusal code to one honest sentence plus its data. A refusal is never
 * silent: every code an admitted-or-refused decision can produce is rendered
 * here, in the interface, in both locales.
 */
function describeRefusal(refusal: PresentationPackageRefusal, t: Translator): string {
  switch (refusal.code) {
    case "index-schema": return t("The presentation package index has an unsupported schema: {{detail}}", { detail: refusal.detail });
    case "index-entry": return t("The package index lists an entry that is not a plain JSON file name: {{detail}}", { detail: refusal.detail });
    case "schema": return t("Unsupported presentation package schema: {{detail}}", { detail: refusal.detail });
    case "manifest": return t("The presentation package manifest is invalid: {{detail}}", { detail: refusal.detail });
    case "id": return t("Invalid presentation package id: {{detail}}", { detail: refusal.detail });
    case "collision": return t("This presentation package id is already in use: {{detail}}", { detail: refusal.detail });
    case "host-range": return t("The application version {{version}} is outside this package's declared host range {{detail}}", { version: PRESENTATION_APP_VERSION, detail: refusal.detail });
    case "host-range-syntax": return t("The declared host range is not a supported range: {{detail}}", { detail: refusal.detail });
    case "token-key": return t("Token is not an admitted design token: {{detail}}", { detail: refusal.detail });
    case "token-value": return t("Token value could escape a CSS declaration and is refused: {{detail}}", { detail: refusal.detail });
    case "read": return t("The listed presentation package could not be read: {{detail}}", { detail: refusal.detail });
  }
}

export function AppearancePreferences({ preference, onChange, onReset, t }: {
  preference: AppearancePreference;
  onChange: (preference: AppearancePreference) => void;
  onReset: () => void;
  t: Translator;
}) {
  // The one admission result the client already holds. This surface lists and
  // reports packages; it never reads, parses or applies a package document
  // itself, and it cannot admit anything the pure admission function refused.
  const packages = useSyncExternalStore(subscribePresentationPackages, getPresentationPackageState, getPresentationPackageState);
  const themeOptions: Array<{ id: ThemeID; swatches: readonly string[]; name: string; note: string }> = [
    ...builtInThemes.map((theme) => ({ id: theme.id, swatches: theme.swatches, name: t(theme.label), note: t(theme.description) })),
    ...packages.admitted.map((presentationPackage) => ({
      id: presentationPackage.id,
      swatches: presentationPackage.swatches,
      name: presentationPackage.name,
      note: t("Installed theme package"),
    })),
  ];

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
            name="cairn-interface"
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
            name="cairn-appearance-mode"
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
        {themeOptions.map((theme) => <label className="appearance-theme-option" key={theme.id}>
          <input
            type="radio"
            name="cairn-theme-palette"
            value={theme.id}
            checked={preference.themeId === theme.id}
            onChange={() => changeTheme(theme.id)}
          />
          <span className="appearance-theme-card">
            <span className="appearance-swatches" aria-hidden="true">
              {theme.swatches.map((color, index) => <i key={`${index}-${color}`} style={{ backgroundColor: color }} />)}
            </span>
            <strong>{theme.name}</strong>
            <small>{theme.note}</small>
          </span>
        </label>)}
      </div>
      {packages.admitted.length === 0 && <p className="appearance-storage-note">
        {packages.loaded
          ? t("No presentation package is installed. Optional theme packages are JSON design-token documents placed under the served web root.")
          : t("Checking for installed presentation packages...")}
      </p>}
    </details>

    {packages.refusals.length > 0 && <div className="appearance-package-refusals" role="status">
      <h4>{t("Refused presentation packages")}</h4>
      {packages.refusals.map((refusal, index) => <p className="appearance-storage-note" key={`${index}-${refusal.source}`}>
        <strong>{refusal.id || refusal.source}</strong>
        <span> · {refusal.id ? `${refusal.source} · ` : ""}{describeRefusal(refusal, t)}</span>
      </p>)}
    </div>}

    <p className="appearance-storage-note">{t("This preference is stored in this browser only. It does not change Cairn service settings or your content.")}</p>
  </section>;
}
