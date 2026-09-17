import { useMemo, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import type { ActionFeedback, Notice } from "../lib/types";

// The settings dialog's durable configuration flow.
//
// The draft is browser state; only `config.update` writes a persisted
// configuration, and it is written against the digest the dialog loaded. A
// restart-required answer stays visible instead of being reported as applied.

export type SettingsFlow = {
  configData: any;
  configDraft: any;
  configLoading: boolean;
  configDirty: boolean;
  semanticInstall: ActionFeedback;
  searchRebuild: ActionFeedback;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  reloadSettings: () => void;
  installSemanticBundle: () => Promise<void>;
  rebuildSearch: () => Promise<void>;
  setConfigField: (section: string, field: string, value: unknown) => void;
  setRepositoryProfile: (profile: string) => void;
  canLeaveSettings: () => boolean;
  resetSemanticActions: () => void;
};

export function useSettings({ t, settingsOpen, workspaceID, semanticInstallAvailable, searchRebuildAvailable, refreshCapabilities, notify }: {
  t: Translator;
  settingsOpen: boolean;
  workspaceID: string;
  semanticInstallAvailable: boolean;
  searchRebuildAvailable: boolean;
  refreshCapabilities: () => Promise<void>;
  notify: (notice: Notice | undefined) => void;
}): SettingsFlow {
  const [configData, setConfigData] = useState<any>();
  const [configDraft, setConfigDraft] = useState<any>();
  const [configLoading, setConfigLoading] = useState(false);
  const [semanticInstall, setSemanticInstall] = useState<ActionFeedback>({ state: "IDLE" });
  const [searchRebuild, setSearchRebuild] = useState<ActionFeedback>({ state: "IDLE" });
  const configDirty = useMemo(() => Boolean(configDraft && configData?.config && JSON.stringify(configDraft) !== JSON.stringify(configData.config)), [configDraft, configData]);

  async function loadSettings() {
    setConfigLoading(true);
    try {
      const response = await command(operations.config.get, {});
      setConfigData(response.data); setConfigDraft(structuredClone(response.data?.config ?? {}));
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not load settings") });
    } finally { setConfigLoading(false); }
  }
  async function saveSettings() {
    if (!configData?.config_digest || !configDraft) return;
    setConfigLoading(true); notify(undefined);
    try {
      const response = await command(operations.config.update, { expected_config_digest: configData.config_digest, config: configDraft });
      setConfigData(response.data); setConfigDraft(structuredClone(response.data?.config ?? {}));
      notify({ kind: "success", text: response.data?.restart_required ? t("Settings saved. Restart RestoreWeave to apply them.") : t("Settings saved.") });
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not save settings") });
    } finally { setConfigLoading(false); }
  }
  async function installSemanticBundle() {
    if (!semanticInstallAvailable || configDirty || configData?.restart_required) return;
    setSemanticInstall({ state: "RUNNING" });
    try {
      await command(operations.semantic.bundleInstall, {});
      setSemanticInstall({ state: "SUCCEEDED", message: t("BGE installed. Restart the service to activate it.") });
      await refreshCapabilities();
    } catch (error) {
      setSemanticInstall({ state: "FAILED", message: error instanceof Error ? error.message : t("BGE installation failed.") });
    }
  }
  async function rebuildSearch() {
    // Lexical/structured indexing is useful on its own.  Rebuilding it must
    // never be gated on the optional semantic bundle; the semantic lane can
    // remain unavailable while the exact and keyword lanes recover.
    if (!searchRebuildAvailable || !workspaceID || configDirty || configData?.restart_required) return;
    setSearchRebuild({ state: "RUNNING" });
    try {
      const response = await command(operations.search.rebuild, { workspace_id: workspaceID });
      const data = response.data ?? {};
      if (data.semantic_state === "AVAILABLE" && response.status === "DEGRADED") {
        const coverage = data.lexical_coverage;
        const coverageMessage = coverage?.available === false
          ? t("Search indexes rebuilt; semantic search is ready, but keyword field coverage is unavailable.")
          : t("Search indexes rebuilt; semantic search is ready, but some keyword fields are not covered.");
        setSearchRebuild({ state: "DEGRADED", message: coverageMessage });
      } else if (data.semantic_state !== "AVAILABLE") {
        setSearchRebuild({ state: "DEGRADED", message: t("Keyword search rebuilt; semantic search failed: {{reason}}", { reason: data.semantic_failure || t("unavailable") }) });
      } else {
        setSearchRebuild({ state: "SUCCEEDED", message: t("Search indexes rebuilt; semantic search is ready.") });
      }
      await refreshCapabilities();
    } catch (error) {
      setSearchRebuild({ state: "FAILED", message: error instanceof Error ? error.message : t("Search rebuild failed.") });
    }
  }
  function setConfigField(section: string, field: string, value: unknown) {
    setConfigDraft((current: any) => current ? { ...current, [section]: { ...current[section], [field]: value } } : current);
  }
  function setRepositoryProfile(profile: string) {
    setConfigDraft((current: any) => current ? {
      ...current,
      storage: {
        ...current.storage,
        repository_profile: profile,
        compression_profile: profile === "local-zstd-v1" ? "zstd-v1" : "identity-v1",
      },
    } : current);
  }
  function reloadSettings() {
    if (configDirty && !window.confirm(t("Discard unsaved settings?"))) return;
    void loadSettings();
  }
  function canLeaveSettings() { return !settingsOpen || !configDirty || window.confirm(t("Discard unsaved settings?")); }
  function resetSemanticActions() {
    setSemanticInstall({ state: "IDLE" });
    setSearchRebuild({ state: "IDLE" });
  }

  return {
    configData,
    configDraft,
    configLoading,
    configDirty,
    semanticInstall,
    searchRebuild,
    loadSettings,
    saveSettings,
    reloadSettings,
    installSemanticBundle,
    rebuildSearch,
    setConfigField,
    setRepositoryProfile,
    canLeaveSettings,
    resetSemanticActions,
  };
}
