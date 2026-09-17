import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Check, ChevronRight, Download as DownloadIcon, FileText, HardDrive, KeyRound, LoaderCircle, RefreshCw, Save, Search, Server, ShieldCheck, Sparkles, X } from "lucide-react";
import type { Locale, Translator } from "../i18n";
import type { SettingsFlow } from "../app/useSettings";
import type { ActionFeedback, Notice, SettingsSection } from "../lib/types";

// The settings dialog.
//
// One category at a time: the left list is the category index, the right pane
// keeps the heading, copy, and controls of that section. Switching categories
// never remounts the draft, because the draft lives in the settings flow, not
// in a section. Only `config.update` persists a configuration.

function ConfigGroup({ title, copy, children }: { title: string; copy: string; children: ReactNode }) { return <section className="config-group"><div className="config-group-heading"><h4>{title}</h4><p>{copy}</p></div>{children}</section>; }
function ConfigHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) { return <div className="config-heading"><p className="eyebrow">{eyebrow}</p><h3>{title}</h3><p>{copy}</p></div>; }
function ConfigOptions({ value, options, onChange }: { value?: string; options: Array<{ value: string; title: string; state: string; copy: string }>; onChange: (value: string) => void }) { return <div className="config-options" role="radiogroup">{options.map((option) => { const selected = value === option.value; return <button type="button" className={`config-option ${selected ? "selected" : ""}`} role="radio" aria-checked={selected} key={option.value} onClick={() => onChange(option.value)}><span className="option-check">{selected ? <Check size={15} /> : null}</span><span className="option-title"><strong>{option.title}</strong><em>{option.state}</em></span><small>{option.copy}</small></button>; })}</div>; }
function ConfigInput({ label, value, placeholder, disabled = false, wide = false, onChange }: { label: string; value?: string; placeholder?: string; disabled?: boolean; wide?: boolean; onChange: (value: string) => void }) { return <label className={`config-field ${wide ? "wide" : ""}`}><span>{label}</span><input value={value ?? ""} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>; }
function ConfigSelect({ label, value, options, disabled = false, onChange }: { label: string; value?: string; options: Array<{ value: string; label: string }>; disabled?: boolean; onChange: (value: string) => void }) { return <label className="config-field"><span>{label}</span><select value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>; }
function ConfigReadonly({ label, value, t, mono = false, wide = false }: { label: string; value?: string; t: Translator; mono?: boolean; wide?: boolean }) { return <div className={`config-field readonly ${wide ? "wide" : ""}`}><span>{label}</span><strong className={mono ? "mono" : ""}>{value || t("Not reported")}</strong></div>; }
function ConfigToggle({ label, copy, checked, disabled = false, wide = false, onChange }: { label: string; copy: string; checked: boolean; disabled?: boolean; wide?: boolean; onChange: (value: boolean) => void }) { return <label className={`toggle-field ${disabled ? "disabled" : ""} ${wide ? "wide" : ""}`}><span className="toggle-copy"><strong>{label}</strong><small>{copy}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i /></label>; }
function ConfigNotice({ kind = "info", children }: { kind?: "info" | "warning"; children: ReactNode }) { return <div className={`config-notice ${kind}`}>{children}</div>; }

export function SettingsDialog({ t, locale, settings, workspaceID, statusData, notice, lexicalReady, semanticReady, semanticBundleReady, semanticBundleRestartRequired, semanticBundleOperatorProvided, semanticInstallAvailable, searchRebuildAvailable, onLocale, onClose, onDismissNotice }: {
  t: Translator;
  locale: Locale;
  settings: SettingsFlow;
  workspaceID: string;
  statusData: any;
  notice: Notice | undefined;
  lexicalReady: boolean;
  semanticReady: boolean;
  semanticBundleReady: boolean;
  semanticBundleRestartRequired: boolean;
  semanticBundleOperatorProvided: boolean;
  semanticInstallAvailable: boolean;
  searchRebuildAvailable: boolean;
  onLocale: (locale: Locale) => void;
  onClose: () => void;
  onDismissNotice: () => void;
}) {
  const { configData, configDraft: draft, configLoading: loading, configDirty: dirty, semanticInstall, searchRebuild } = settings;
  const sections: Array<{ id: SettingsSection; label: string; icon: ReactNode }> = [
    { id: "storage", label: t("Storage"), icon: <HardDrive size={17} /> },
    { id: "search", label: t("Search"), icon: <Search size={17} /> },
    { id: "descriptions", label: t("Notes"), icon: <FileText size={17} /> },
    { id: "recovery", label: t("Recovery"), icon: <ShieldCheck size={17} /> },
    { id: "service", label: t("Service"), icon: <Server size={17} /> },
  ];
  const config = draft ?? {};
  const semanticMode = config.semantic?.embedding_mode ?? "local";
  const localProfile = String(config.semantic?.local_profile || "bge-small-zh-v1.5").trim() || "bge-small-zh-v1.5";
  const pinnedLocalProfile = localProfile === "bge-small-zh-v1.5";
  const localBundleUsable = pinnedLocalProfile || semanticBundleOperatorProvided;
  const fixedBundleDownloadable = pinnedLocalProfile && !semanticBundleOperatorProvided;
  const actionBlocked = dirty || Boolean(configData?.restart_required);
  const restartRequired = Boolean(configData?.restart_required) || semanticBundleRestartRequired;
  // A successful install action is not capability admission; only an
  // admitted bundle may appear installed or usable.
  const bundleInstalled = localBundleUsable && semanticBundleReady;
  const bundleStateLabel = semanticInstall.state === "RUNNING"
    ? "Installing..."
    : !semanticBundleReady
      ? (semanticBundleOperatorProvided ? "Operator-provided bundle unavailable or verification failed" : "Model not installed or verification failed")
      : semanticBundleRestartRequired
        ? "Installed; restart required"
        : semanticReady
          ? "Installed and running"
          : "Model installed; index not ready";
  const bundleNotice = !semanticBundleReady
    ? (semanticBundleOperatorProvided
      ? "The operator-provided local embedding bundle is unavailable or failed verification. Keyword search and exact recovery remain available."
      : "The local BGE bundle is missing or failed verification. Keyword search and exact recovery remain available.")
    : semanticBundleRestartRequired
      ? "BGE installed. Restart the service to activate it."
      : semanticBundleOperatorProvided
        ? "This local embedding profile is supplied by the operator. RestoreWeave does not download or verify it here."
        : bundleInstalled
        ? "The verified local BGE bundle is installed. Semantic search becomes ready after a compatible index is opened or rebuilt."
        : "The local BGE bundle is missing or failed verification. Keyword search and exact recovery remain available.";
  const installDisabled = actionBlocked || !fixedBundleDownloadable || !semanticInstallAvailable || semanticInstall.state === "RUNNING";
  // The rebuild operation always repairs the baseline lexical projection and
  // opportunistically rebuilds semantic vectors when an admitted provider is
  // present.  Keep the action visible even when BGE is not installed so a
  // user can restore keyword search without first downloading a model.
  const rebuildVisible = searchRebuildAvailable && Boolean(workspaceID) && !restartRequired && semanticInstall.state !== "SUCCEEDED";
  const rebuildDisabled = actionBlocked || !searchRebuildAvailable || !workspaceID || searchRebuild.state === "RUNNING";
  const savedConfig = configData?.config ?? {};
  const sectionConfigParts: Record<SettingsSection, unknown[]> = {
    storage: [config.storage ?? {}, config.paths ?? {}],
    search: [config.semantic ?? {}],
    descriptions: [config.descriptions ?? {}],
    recovery: [config.recovery ?? {}],
    service: [config.api ?? {}],
  };
  const savedSectionConfigParts: Record<SettingsSection, unknown[]> = {
    storage: [savedConfig.storage ?? {}, savedConfig.paths ?? {}],
    search: [savedConfig.semantic ?? {}],
    descriptions: [savedConfig.descriptions ?? {}],
    recovery: [savedConfig.recovery ?? {}],
    service: [savedConfig.api ?? {}],
  };
  // A category is dirty when its own persisted fields differ from the saved
  // configuration. The summary and the category list read the same set, so the
  // indicator is never a decoration.
  const dirtySectionIDs = new Set(sections.filter((item) => JSON.stringify(sectionConfigParts[item.id]) !== JSON.stringify(savedSectionConfigParts[item.id])).map((item) => item.id));
  const [activeSection, setActiveSection] = useState<SettingsSection>("storage");
  const runningStateAvailable = Boolean(configData?.running_config_digest);
  const runningStateLabel = runningStateAvailable ? "Running now" : "Running state unavailable";
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.body.classList.add("drawer-open");
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("drawer-open");
    };
  }, [onClose]);
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-page" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header"><div className="settings-heading"><div><h1 id="settings-title">{t("Settings")}</h1><small className={`settings-running-state ${runningStateAvailable ? "" : "unavailable"}`}><span />{t(runningStateLabel)}</small></div></div><div className="settings-header-actions"><div className="language-switch" role="group" aria-label={t("Switch language")}><button type="button" aria-pressed={locale === "zh-CN"} title={t("Chinese")} onClick={() => onLocale("zh-CN")}>中</button><button type="button" aria-pressed={locale === "en"} title={t("English")} onClick={() => onLocale("en")}>EN</button></div><span className={`config-state ${dirty ? "dirty" : restartRequired ? "restart" : "saved"}`}>{t(dirty ? "Unsaved changes" : restartRequired ? "Restart required" : "Saved")}</span><button type="button" className="icon-button" title={t("Reload configuration")} aria-label={t("Reload configuration")} onClick={settings.reloadSettings} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={17} /></button><button ref={closeButton} type="button" className="icon-button" title={t("Close settings")} aria-label={t("Close settings")} onClick={onClose}><X size={17} /></button></div></header>
      <div className="settings-body">
      {/* One category at a time: the left list is the category index, the right
          pane keeps the existing heading, copy, and controls of that section.
          Switching categories never remounts the draft, because the draft lives
          in the parent panel, not in a section. */}
      <nav className="settings-categories" aria-label={t("Settings sections")}>
        <ul>
          {sections.map((item) => {
            const isActive = activeSection === item.id;
            const isDirty = dirtySectionIDs.has(item.id);
            return <li key={item.id}>
              <button type="button" className={`settings-category ${isActive ? "active" : ""}`} aria-current={isActive ? "true" : undefined} aria-pressed={isActive} onClick={() => setActiveSection(item.id)}>
                <span className="settings-category-icon">{item.icon}</span>
                <span className="settings-category-label">{item.label}</span>
                {isDirty && <span className="settings-category-dirty" title={t("Unsaved changes")} aria-label={t("Unsaved changes")} />}
              </button>
            </li>;
          })}
        </ul>
      </nav>
      <div ref={content} className="settings-content">
          {notice && <div className={`notice settings-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle size={16} /> : notice.kind === "warning" ? <Sparkles size={16} /> : <Check size={16} />}{notice.text}<button type="button" aria-label={t("Dismiss notice")} onClick={onDismissNotice}><X size={14} /></button></div>}
          {sections.some((item) => dirtySectionIDs.has(item.id)) && <div className="settings-change-summary" role="status"><strong>{t("Unsaved changes by category")}</strong><span>{sections.filter((item) => dirtySectionIDs.has(item.id)).map((item, index) => <span key={item.id}>{index > 0 && " · "}<button type="button" className="settings-change-link" onClick={() => setActiveSection(item.id)}>{item.label}</button></span>)}</span></div>}
          {loading && !draft ? <div className="settings-loading"><LoaderCircle className="spin" size={24} /><span>{t("Loading configuration")}</span></div> : <>
            {activeSection === "storage" && <section className="config-section"><ConfigHeading eyebrow={t("CONTENT LOCATIONS")} title={t("Storage")} copy={t("Choose the content location and storage mode.")} />
              <ConfigGroup title={t("Content location")} copy={t("The repository contains exact file bytes; changing this path does not move existing data.")}><div className="form-grid"><ConfigInput label={t("Content repository")} value={config.paths?.repository} onChange={(value) => settings.setConfigField("paths", "repository", value)} wide /></div></ConfigGroup>
              <ConfigGroup title={t("Storage plan")} copy={t("Choose how exact file bytes are stored. Both options keep SHA-256 whole-file deduplication.")}><ConfigOptions value={config.storage?.repository_profile} onChange={settings.setRepositoryProfile} options={[{ value: "directory-cas-dev-v1", title: t("Directory CAS"), state: t("Development"), copy: t("Stores exact bytes without compression. Best for inspection and compatibility tests.") }, { value: "local-zstd-v1", title: t("Local zstd"), state: t("Candidate"), copy: t("Keeps exact recovery while compressing each unique whole file.") }]} /><p className="current-policy" aria-label={t("Current storage policy")}>{t("Compression")}: <strong>{config.storage?.compression_profile || t("Unknown")}</strong> · {t("Default storage mode")}: <strong>STORE_EXACT</strong></p></ConfigGroup>
              <ConfigGroup title={t("Protection exception")} copy={t("LINK_ONLY remains visibly unprotected until it is independently reacquired and verified.")}><div className="form-grid"><ConfigToggle label={t("Allow explicit link-only plans")} copy={t("The user must still confirm that bytes are not stored locally.")} checked={Boolean(config.storage?.allow_link_only)} onChange={(value) => settings.setConfigField("storage", "allow_link_only", value)} wide /></div></ConfigGroup>
              <details className="config-advanced"><summary>{t("Advanced paths")}<ChevronRight size={15} /></summary><p>{t("Catalog, vector, model, and signing-material paths for operators and migrations. Signed portable recovery records live with the content repository.")}</p><div className="form-grid"><ConfigInput label={t("Catalog database")} value={config.paths?.catalog} onChange={(value) => settings.setConfigField("paths", "catalog", value)} /><ConfigInput label={t("Vector indexes")} value={config.paths?.vectors} onChange={(value) => settings.setConfigField("paths", "vectors", value)} /><ConfigInput label={t("Models")} value={config.paths?.models} onChange={(value) => settings.setConfigField("paths", "models", value)} /><ConfigInput label={t("Signing material & recovery workflow")} value={config.paths?.recovery_records} onChange={(value) => settings.setConfigField("paths", "recovery_records", value)} /></div></details>
              <ConfigNotice kind="warning">{t("Changing a repository or catalog path does not move existing data. Restart only after the target has been prepared or migrated.")}</ConfigNotice>
            </section>}
            {activeSection === "search" && <section className="config-section"><ConfigHeading eyebrow={t("DISCOVERY")} title={t("Search")} copy={t("Keyword search is always local. Semantic search uses the selected provider profile and disposable zvec generations.")} />
              <ConfigGroup title={t("Provider health")} copy={t("See what is available now before changing the provider profile.")}><div className="running-label"><span />{t("Current running state")}</div><div className="provider-status" aria-live="polite"><span><Search size={17} />{t("Keyword search")}</span><strong className={lexicalReady ? "ready" : "offline"}>{t(lexicalReady ? "Ready" : "Offline")}</strong><span><Sparkles size={17} />{t("Semantic search")}</span><strong className={semanticReady ? "ready" : "offline"}>{t(semanticReady ? "Ready" : "Offline")}</strong></div></ConfigGroup>
              <ConfigGroup title={t("Semantic provider")} copy={t("Select local BGE, an admitted online replacement, or a hybrid profile.")}><div className="running-label draft"><span />{t("Configuration to save")}</div><div className="segmented" role="group" aria-label={t("Embedding mode")}>{["local", "online", "hybrid"].map((mode) => <button className={semanticMode === mode ? "active" : ""} aria-pressed={semanticMode === mode} key={mode} onClick={() => settings.setConfigField("semantic", "embedding_mode", mode)}>{semanticMode === mode && <Check size={14} />}{t(mode === "local" ? "Local" : mode === "online" ? "Online" : "Hybrid")}</button>)}</div>
              {semanticMode !== "online" && <div className={`model-card ${semanticReady ? "ready" : bundleInstalled ? "installed" : "offline"}`}><span className="model-icon"><Sparkles size={19} /></span><div><strong>{pinnedLocalProfile ? "BAAI/bge-small-zh-v1.5" : localProfile}</strong><small>{t(semanticBundleOperatorProvided || !pinnedLocalProfile ? "Operator-provided local embedding profile" : "Pinned local ONNX embedding profile")}</small></div><span className="model-state" role="status" aria-live="polite">{t(bundleStateLabel)}</span><div className="model-meta"><span>zvec</span><span>{config.paths?.models || t("Models path not reported")}</span></div>{fixedBundleDownloadable && !bundleInstalled && <div className="model-action"><button type="button" className="primary-button compact" onClick={() => void settings.installSemanticBundle()} disabled={installDisabled}><DownloadIcon />{t(semanticInstall.state === "RUNNING" ? "Installing..." : "Download and verify fixed BGE (about 100MB model; full runtime is larger)")}</button>{actionBlocked && <small>{t(configData?.restart_required ? "Restart required before model actions." : "Save settings before model actions.")}</small>}{!semanticInstallAvailable && !actionBlocked && <small>{t("This build cannot install the local BGE bundle.")}</small>}</div>}{semanticInstall.message && <div className={`model-action-message ${semanticInstall.state === "FAILED" ? "error" : "success"}`}>{semanticInstall.message}</div>}{rebuildVisible && <div className="model-action"><button type="button" className="secondary-button compact" onClick={() => void settings.rebuildSearch()} disabled={rebuildDisabled}><RefreshCw size={14} className={searchRebuild.state === "RUNNING" ? "spin" : ""} />{t(searchRebuild.state === "RUNNING" ? "Rebuilding search indexes..." : "Rebuild search indexes")}</button>{actionBlocked && <small>{t(configData?.restart_required ? "Restart required before model actions." : "Save settings before model actions.")}</small>}{!workspaceID && <small>{t("Add a source before rebuilding search indexes.")}</small>}{!searchRebuildAvailable && !actionBlocked && workspaceID && <small>{t("Search rebuild is unavailable in this build.")}</small>}</div>}{searchRebuild.message && <div className={`model-action-message ${searchRebuild.state === "FAILED" || searchRebuild.state === "DEGRADED" ? "error" : "success"}`}>{searchRebuild.message}</div>}</div>}
              <div className="form-grid two"><ConfigReadonly label={t("Local embedding profile")} value={config.semantic?.local_profile || "bge-small-zh-v1.5"} t={t} /><ConfigReadonly label={t("Vector backend")} value={config.semantic?.vector_backend || "zvec"} t={t} />{semanticMode !== "local" && <><ConfigInput label={t("Online provider profile")} value={config.semantic?.online_profile} placeholder="installed-provider-profile" onChange={(value) => settings.setConfigField("semantic", "online_profile", value)} /><ConfigInput label={t("Credential reference")} value={config.semantic?.online_credential_ref} placeholder="keychain://restoreweave/provider" onChange={(value) => settings.setConfigField("semantic", "online_credential_ref", value)} /><ConfigToggle label={t("Send content without per-request confirmation")} copy={t("Keep off unless this provider and its data policy are explicitly trusted.")} checked={Boolean(config.semantic?.send_content_without_confirmation)} onChange={(value) => settings.setConfigField("semantic", "send_content_without_confirmation", value)} /></>}</div></ConfigGroup>
              {semanticMode === "local" ? <ConfigNotice kind={bundleInstalled ? "info" : "warning"}>{t(bundleNotice)}</ConfigNotice> : <ConfigNotice kind="warning">{t("Online and hybrid are replacement-profile selections. This build will report semantic search unavailable unless that provider is separately installed and admitted.")}</ConfigNotice>}
            </section>}
            {activeSection === "descriptions" && <section className="config-section"><ConfigHeading eyebrow={t("NOTES")} title={t("Notes")} copy={t("Notes remain durable facts; optional AI notes are added only when requested.")} />
              <ConfigGroup title={t("Notes storage")} copy={t("Your notes are always available; imported, extracted, and AI-created text appears in this same Notes list.")}><div className="form-grid two"><ConfigToggle label={t("Keep additional notes")} copy={t("Keep imported, extracted, and generated text alongside your notes.")} checked={Boolean(config.descriptions?.enabled)} onChange={(value) => { settings.setConfigField("descriptions", "enabled", value); settings.setConfigField("descriptions", "generate", value ? "on_demand" : "disabled"); if (value) settings.setConfigField("descriptions", "retain_full_text", true); }} /><ConfigSelect label={t("Generation")} value={config.descriptions?.generate} onChange={(value) => settings.setConfigField("descriptions", "generate", value)} options={[{ value: "disabled", label: t("Disabled") }, { value: "on_demand", label: t("On demand") }]} disabled={!config.descriptions?.enabled} /><ConfigInput label={t("Provider profile")} value={config.descriptions?.provider_profile} placeholder="optional-describe-profile" onChange={(value) => settings.setConfigField("descriptions", "provider_profile", value)} disabled={!config.descriptions?.enabled || config.descriptions?.generate === "disabled"} /><ConfigInput label={t("Credential reference")} value={config.descriptions?.credential_ref} placeholder="keychain://restoreweave/notes" onChange={(value) => settings.setConfigField("descriptions", "credential_ref", value)} disabled={!config.descriptions?.enabled || config.descriptions?.generate === "disabled"} /><ConfigToggle label={t("Retain full text")} copy={t("Required when model-generated notes are enabled.")} checked={Boolean(config.descriptions?.retain_full_text)} onChange={(value) => settings.setConfigField("descriptions", "retain_full_text", value)} disabled={config.descriptions?.enabled && config.descriptions?.generate !== "disabled"} /></div></ConfigGroup>
            </section>}
            {activeSection === "recovery" && <section className="config-section"><ConfigHeading eyebrow={t("SAFETY CONTRACT")} title={t("Recovery")} copy={t("Recovery settings protect the exact-byte promise and signed portable records.")} />
              <ConfigGroup title={t("Recovery authority")} copy={t("These values define the signed recovery lineage. Change them only as part of a reviewed migration.")}><div className="form-grid two"><ConfigReadonly label={t("Exact fallback")} value={t("Required")} t={t} /><ConfigReadonly label={t("Publication signing")} value={config.recovery?.publication_signing} t={t} /><ConfigInput label={t("Publication domain")} value={config.recovery?.publication_domain} onChange={(value) => settings.setConfigField("recovery", "publication_domain", value)} /><ConfigReadonly label={t("Automatic external reacquisition")} value={t("Disabled in the core profile")} t={t} /></div></ConfigGroup>
              <ConfigNotice kind="warning">{t("Changing the publication domain changes signing lineage. Do not change it for an existing repository without a reviewed migration.")}</ConfigNotice>
            </section>}
            {activeSection === "service" && <section className="config-section"><ConfigHeading eyebrow={t("DAEMON")} title={t("Service")} copy={t("Control the bounded HTTP adapter used by this browser. Authentication tokens remain environment-only and are never written here.")} />
              <ConfigGroup title={t("Web API")} copy={t("Configure the loopback adapter used by this browser client.")}><div className="form-grid two"><ConfigToggle label={t("Enable Web API")} copy={t("Required for this browser client after the next restart.")} checked={Boolean(config.api?.enabled)} onChange={(value) => settings.setConfigField("api", "enabled", value)} /><ConfigInput label={t("Listen address")} value={config.api?.listen} onChange={(value) => settings.setConfigField("api", "listen", value)} disabled={!config.api?.enabled} /></div></ConfigGroup>
              <details className="config-advanced identity-disclosure"><summary>{t("Runtime identity")}<ChevronRight size={15} /></summary><p>{t("Inspect the active and persisted configuration without exposing credentials.")}</p><div className="form-grid two"><ConfigReadonly label={t("Configuration file")} value={configData?.config_path} t={t} wide /><ConfigReadonly label={t("Running digest")} value={configData?.running_config_digest} t={t} mono /><ConfigReadonly label={t("Persisted digest")} value={configData?.config_digest} t={t} mono /><ConfigReadonly label={t("Workspace")} value={workspaceID || t("Not created")} t={t} /><ConfigReadonly label={t("Service socket")} value={statusData?.listen || t("Loopback")} t={t} /></div></details>
              <ConfigNotice><KeyRound size={15} />{t("API tokens are supplied with RESTOREWEAVE_API_TOKEN or --api-token; the WebUI never stores plaintext credentials.")}</ConfigNotice>
            </section>}
          </>}
      </div>
      </div>
      <footer className="settings-footer"><span>{t(dirty ? "Review and save your changes." : configData?.restart_required ? "Saved configuration differs from the running daemon." : "Configuration is synchronized.")}</span><button className="primary-button" onClick={() => void settings.saveSettings()} disabled={loading || !dirty}><Save size={16} />{t(loading ? "Saving..." : "Save settings")}</button></footer>
    </section>
  </div>;
}

export type { ActionFeedback };
