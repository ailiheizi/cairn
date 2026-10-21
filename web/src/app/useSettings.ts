import { useMemo, useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import type { ActionFeedback, Notice } from "../lib/types";
import { providerExpiryMillis, validateDescribeProfile, type DescribeProfile } from "../lib/describeAuthorization";
import { formatBytes } from "../lib/format";

// The settings dialog's durable configuration flow.
//
// The draft is browser state; only `config.update` writes a persisted
// configuration, and it is written against the digest the dialog loaded. A
// restart-required answer stays visible instead of being reported as applied.

export type EgressFacts = {
  state: "IDLE" | "LOADING" | "READY" | "UNAVAILABLE";
  reason?: string;
  modelsRoot: string;
  profiles: any[];
  describeState: "IDLE" | "AVAILABLE" | "UNAVAILABLE";
  describeReason?: string;
  describeProfiles: any[];
  grants: any[];
};

export type SettingsFlow = {
  configData: any;
  configDraft: any;
  configLoading: boolean;
  configDirty: boolean;
  semanticInstall: ActionFeedback;
  imageInstall: ActionFeedback;
  installImageBundle: (archivePath: string) => Promise<void>;
  searchRebuild: ActionFeedback;
  egressFacts: EgressFacts;
  egressAction: ActionFeedback;
  loadSettings: () => Promise<void>;
  loadEgressFacts: () => Promise<void>;
  authorizeProfile: (profile: any) => Promise<void>;
  authorizeDescribeProfile: (profile: unknown) => Promise<void>;
  revokeGrant: (grantId: string) => Promise<void>;
  saveSettings: () => Promise<void>;
  reloadSettings: () => void;
  installSemanticBundle: () => Promise<void>;
  rebuildSearch: (requestedWorkspaceID?: string) => Promise<ActionFeedback>;
  setConfigField: (section: string, field: string, value: unknown) => void;
  setRepositoryProfile: (profile: string) => void;
  canLeaveSettings: () => boolean;
  resetSemanticActions: () => void;
};

export function useSettings({ t, settingsOpen, workspaceID, semanticInstallAvailable, imageInstallAvailable, searchRebuildAvailable, refreshCapabilities, notify }: {
  t: Translator;
  settingsOpen: boolean;
  workspaceID: string;
  semanticInstallAvailable: boolean;
  imageInstallAvailable: boolean;
  searchRebuildAvailable: boolean;
  refreshCapabilities: () => Promise<void>;
  notify: (notice: Notice | undefined) => void;
}): SettingsFlow {
  const [configData, setConfigData] = useState<any>();
  const [configDraft, setConfigDraft] = useState<any>();
  const [configLoading, setConfigLoading] = useState(false);
  const [semanticInstall, setSemanticInstall] = useState<ActionFeedback>({ state: "IDLE" });
  const [imageInstall, setImageInstall] = useState<ActionFeedback>({ state: "IDLE" });
  const [searchRebuild, setSearchRebuild] = useState<ActionFeedback>({ state: "IDLE" });
  const searchRebuildRequest = useRef(0);
  const searchRebuildInFlight = useRef(false);
  const [egressFacts, setEgressFacts] = useState<EgressFacts>({ state: "IDLE", modelsRoot: "", profiles: [], describeState: "IDLE", describeProfiles: [], grants: [] });
  const [egressAction, setEgressAction] = useState<ActionFeedback>({ state: "IDLE" });
  const workspaceRef = useRef(workspaceID);
  const egressFactsRequest = useRef(0);
  workspaceRef.current = workspaceID;
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
      notify({ kind: "success", text: response.data?.restart_required ? t("Settings saved. Restart Cairn to apply them.") : t("Settings saved.") });
    } catch (error) {
      notify({ kind: "error", text: error instanceof Error ? error.message : t("Could not save settings") });
    } finally { setConfigLoading(false); }
  }
  // The image bundle installs from an archive the operator has already put on
  // this host: the daemon never downloads an image model, so the action needs a
  // path and reports the daemon's own admission (profile, digest, asset count,
  // restart) rather than a client-side summary.
  async function installImageBundle(archivePath: string) {
    const trimmed = archivePath.trim();
    if (!imageInstallAvailable || !trimmed || configDirty || configData?.restart_required) return;
    setImageInstall({ state: "RUNNING" });
    try {
      const response = await command(operations.image.bundleInstall, { archive_path: trimmed });
      const data = response.data ?? {};
      const parts = [
        t("Image bundle admitted: {{profile}}", { profile: String(data.profile_id ?? "") }),
        t("{{count}} verified assets", { count: Number(data.asset_count ?? 0) }),
      ];
      if (data.changed === false) parts.push(t("already installed"));
      if (data.restart_required) parts.push(t("restart required"));
      setImageInstall({ state: "SUCCEEDED", message: `${parts.join(" · ")}${data.destination ? ` · ${String(data.destination)}` : ""}` });
      await refreshCapabilities();
    } catch (error) {
      setImageInstall({ state: "FAILED", message: error instanceof Error ? error.message : t("Image bundle installation failed.") });
    }
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
  async function rebuildSearch(requestedWorkspaceID = workspaceID): Promise<ActionFeedback> {
    // Lexical/structured indexing is useful on its own.  Rebuilding it must
    // never be gated on the optional semantic bundle; the semantic lane can
    // remain unavailable while the exact and keyword lanes recover.
    if (!searchRebuildAvailable) return { state: "FAILED", message: t("Search rebuild is unavailable in this build.") };
    if (!requestedWorkspaceID || requestedWorkspaceID !== workspaceID) return { state: "FAILED", message: t("The saved source is not in the current workspace.") };
    if (configDirty) return { state: "FAILED", message: t("Save settings before model actions.") };
    if (configData?.restart_required) return { state: "FAILED", message: t("Restart required before model actions.") };
    if (searchRebuildInFlight.current) return { state: "FAILED", message: t("Search preparation is already running; try after it finishes.") };
    const request = ++searchRebuildRequest.current;
    searchRebuildInFlight.current = true;
    const isCurrentRequest = () => request === searchRebuildRequest.current && workspaceRef.current === requestedWorkspaceID;
    setSearchRebuild({ state: "RUNNING" });
    try {
      const response = await command(operations.search.rebuild, { workspace_id: requestedWorkspaceID });
      const data = response.data ?? {};
      const messages: string[] = [];
      if (data.semantic_state !== "AVAILABLE") {
        messages.push(t("Keyword search rebuilt; semantic search failed: {{reason}}", { reason: data.semantic_failure || t("unavailable") }));
      }
      const coverage = data.lexical_coverage;
      if (coverage?.available === false) {
        messages.push(t("Keyword field coverage is unavailable."));
      } else if (coverage?.complete === false) {
        messages.push(t("Some keyword fields are not covered."));
      }
      // Older daemons omit source_coverage. Keep that absence unknown; only a
      // present statement can report selected-source coverage degradation.
      const sourceCoverage = coverage?.source_coverage;
      if (sourceCoverage?.available === false) {
        messages.push(t("Selected text-source coverage is unavailable."));
      } else if (sourceCoverage?.complete === false) {
        messages.push(t("Some selected text sources are not indexed."));
      }
      // Semantic segment membership and selected-source/tokenizer coverage are
      // separate reports. Old daemons omit semantic_source_coverage; absence
      // remains unknown and must not create a new warning or claim of FULL.
      const semanticSourceCoverage = data.semantic_source_coverage;
      if (semanticSourceCoverage?.available === false) {
        messages.push(t("Semantic source coverage is unavailable."));
      } else if (semanticSourceCoverage?.complete === false) {
        const hasTruncated = (semanticSourceCoverage.input_truncated ?? 0) > 0;
        const hasUnknown = (semanticSourceCoverage.input_unknown ?? 0) > 0;
        if (hasTruncated) {
          messages.push(t("Some text was truncated during semantic indexing."));
        }
        if (hasUnknown) {
          messages.push(t("Semantic processing coverage is not confirmed for some text."));
        }
        if ((semanticSourceCoverage.missing ?? 0) > 0 || (semanticSourceCoverage.unavailable ?? 0) > 0) {
          messages.push(t("Some semantic sources lack complete indexing evidence."));
        } else if (!hasTruncated && !hasUnknown) {
          messages.push(t("Some semantic sources lack complete indexing evidence."));
        }
      }
      let outcome: ActionFeedback;
      if (messages.length > 0) {
        outcome = { state: "DEGRADED", message: messages.join(" · ") };
      } else if (response.status === "DEGRADED") {
        outcome = { state: "DEGRADED", message: t("Search indexes rebuilt, but a search capability is degraded.") };
      } else {
        outcome = { state: "SUCCEEDED", message: t("Search indexes rebuilt; semantic search is ready.") };
      }
      if (isCurrentRequest()) setSearchRebuild(outcome);
      await refreshCapabilities();
      return outcome;
    } catch (error) {
      const outcome: ActionFeedback = { state: "FAILED", message: error instanceof Error ? error.message : t("Search rebuild failed.") };
      if (isCurrentRequest()) setSearchRebuild(outcome);
      return outcome;
    } finally {
      if (request === searchRebuildRequest.current) {
        searchRebuildInFlight.current = false;
        if (workspaceRef.current !== requestedWorkspaceID) setSearchRebuild({ state: "IDLE" });
      }
    }
  }
  // Remote egress facts are read from the daemon, never assumed: an installed
  // provider profile and a live grant are two different things, and a build
  // without an installer or a grant store reports its own reason here.
  async function loadEgressFacts() {
    const request = ++egressFactsRequest.current;
    const requestedWorkspace = workspaceID;
    setEgressFacts((current) => ({ ...current, state: "LOADING" }));
    try {
      const [providersResult, grantsResult] = await Promise.allSettled([
        command(operations.semantic.providerList, { include_describe: true }),
        command(operations.egress.grantList, requestedWorkspace ? { workspace_id: requestedWorkspace } : {}),
      ]);
      if (request !== egressFactsRequest.current || workspaceRef.current !== requestedWorkspace) return;
      const providers = providersResult.status === "fulfilled" ? providersResult.value.data : undefined;
      const grants = grantsResult.status === "fulfilled" ? grantsResult.value.data : undefined;
      const describe = providers?.describe;
      const describeAvailable = describe?.state === "AVAILABLE" && Array.isArray(describe.profiles);
      const readErrors = [providersResult, grantsResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
      setEgressFacts({
        state: readErrors.length === 0 ? "READY" : "UNAVAILABLE",
        reason: readErrors.length ? readErrors.join(" · ") : undefined,
        modelsRoot: String(providers?.models_root ?? ""),
        profiles: Array.isArray(providers?.profiles) ? providers.profiles : [],
        describeState: describeAvailable ? "AVAILABLE" : "UNAVAILABLE",
        describeReason: describe?.state === "UNAVAILABLE"
          ? String(describe.reason ?? t("Description profile details are unavailable"))
          : describeAvailable ? undefined : providersResult.status === "rejected"
            ? (providersResult.reason instanceof Error ? providersResult.reason.message : String(providersResult.reason))
            : t("This service did not return the optional description profile details."),
        describeProfiles: Array.isArray(describe?.profiles) ? describe.profiles : [],
        grants: Array.isArray(grants?.grants) ? grants.grants : [],
      });
    } catch (error) {
      if (request !== egressFactsRequest.current || workspaceRef.current !== requestedWorkspace) return;
      setEgressFacts({
        state: "UNAVAILABLE",
        reason: error instanceof Error ? error.message : t("Egress facts are unavailable"),
        modelsRoot: "",
        profiles: [],
        describeState: "UNAVAILABLE",
        describeReason: error instanceof Error ? error.message : t("Description profile details are unavailable"),
        describeProfiles: [],
        grants: [],
      });
    }
  }
  // One authorization covers one purpose. The daemon needs the document lane
  // for a rebuild and the query lane for a search, so the action issues both
  // and names exactly what it authorized.
  async function authorizeProfile(profile: any) {
    if (!workspaceID) return;
    const requestedWorkspace = workspaceID;
    const now = Date.now();
    const profileExpiry = providerExpiryMillis(profile?.expiry);
    const declared = [profile?.max_requests, profile?.max_bytes, profile?.max_seconds];
    const dataClasses = profile?.disclosed_data_classes;
    const subjectClasses = profile?.allowed_subject_classes;
    if (profile?.expired === true || profileExpiry === undefined || profileExpiry <= now
      || declared.some((value) => typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
      || !Array.isArray(dataClasses) || !dataClasses.length || !dataClasses.every((item: unknown) => typeof item === "string" && item.trim())
      || !Array.isArray(subjectClasses) || !subjectClasses.length || !subjectClasses.every((item: unknown) => typeof item === "string" && item.trim())) {
      setEgressAction({ state: "FAILED", message: t("Installed embedding profile metadata is incomplete or expired; no grants were created.") });
      return;
    }
    const expiresAt = new Date(Math.min(now + 30 * 24 * 60 * 60 * 1000, profileExpiry)).toISOString();
    const limits = {
      max_requests: Math.min(profile.max_requests, 500),
      max_bytes: Math.min(profile.max_bytes, 256 << 20),
      max_seconds: Math.min(profile.max_seconds, 600),
    };
    setEgressAction({ state: "RUNNING" });
    const created: string[] = [];
    let grantAttempted = false;
    try {
      const shared = {
        workspace_id: requestedWorkspace,
        profile_id: String(profile?.profile_id ?? ""),
        profile_digest: String(profile?.profile_digest ?? ""),
        endpoint_host: String(profile?.endpoint_host ?? ""),
        model_id: String(profile?.model_id ?? ""),
        data_classes: dataClasses,
        subject_classes: subjectClasses,
        ...limits,
        expires_at: expiresAt,
      };
      for (const purpose of ["DOCUMENT", "QUERY"]) {
        grantAttempted = true;
        const response = await command(operations.egress.grantCreate, { ...shared, purpose });
        const grantID = String(response.data?.grant_id ?? "").trim();
        if (!grantID) throw new Error(t("The service did not confirm the {{purpose}} grant.", { purpose }));
        created.push(grantID);
      }
      setEgressAction({
        state: "SUCCEEDED",
        message: t("Authorized {{count}} grants for {{profile}} until {{date}} · {{requests}} requests · {{bytes}} · {{seconds}}s", {
          count: created.length,
          profile: String(profile?.profile_id ?? ""),
          date: expiresAt.slice(0, 10),
          requests: limits.max_requests,
          bytes: formatBytes(limits.max_bytes),
          seconds: limits.max_seconds,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("Egress authorization failed");
      setEgressAction({ state: "FAILED", message: created.length
        ? t("Created {{count}} of 2 grants before the next grant failed: {{message}}", { count: created.length, message })
        : t("Could not confirm the egress grant result: {{message}}; the grant list was refreshed to check recorded state.", { message }) });
    } finally {
      if (grantAttempted && workspaceRef.current === requestedWorkspace) await loadEgressFacts();
    }
  }
  async function authorizeDescribeProfile(value: unknown) {
    const requestedWorkspace = workspaceID;
    const validated = validateDescribeProfile(value);
    if (!requestedWorkspace || !validated.valid || validated.profile.expired
      || egressFacts.state !== "READY" || egressFacts.describeState !== "AVAILABLE"
      || configDirty || configData?.restart_required
      || configData?.config?.descriptions?.enabled !== true
      || String(configData?.config?.descriptions?.generate ?? "").trim() !== "on_demand"
      || String(configData?.config?.descriptions?.provider_profile ?? "").trim() !== validated.profile.profile_id) return;
    const profile: DescribeProfile = validated.profile;
    const currentProfile = egressFacts.describeProfiles
      .map((candidate) => validateDescribeProfile(candidate))
      .find((candidate) => candidate.valid
        && candidate.profile.profile_id === profile.profile_id
        && candidate.profile.profile_digest === profile.profile_digest
        && candidate.profile.endpoint_host === profile.endpoint_host
        && candidate.profile.model_id === profile.model_id);
    if (!currentProfile?.valid || currentProfile.profile.expired) return;
    const now = Date.now();
    const profileExpiry = Date.parse(profile.expiry);
    const expiresAt = new Date(Math.min(now + 30 * 24 * 60 * 60 * 1000, profileExpiry)).toISOString();
    const ceilings = { max_requests: 500, max_bytes: 256 << 20, max_seconds: 600 };
    const limits = {
      max_requests: Math.min(profile.max_requests, ceilings.max_requests),
      max_bytes: Math.min(profile.max_bytes, ceilings.max_bytes),
      max_seconds: Math.min(profile.max_seconds, ceilings.max_seconds),
    };
    setEgressAction({ state: "RUNNING" });
    let grantAttempted = false;
    try {
      grantAttempted = true;
      const response = await command(operations.egress.grantCreate, {
        workspace_id: requestedWorkspace,
        profile_id: profile.profile_id,
        profile_digest: profile.profile_digest,
        endpoint_host: profile.endpoint_host,
        model_id: profile.model_id,
        purpose: "DESCRIBE",
        data_classes: [...profile.disclosed_data_classes],
        subject_classes: [...profile.allowed_subject_classes],
        ...limits,
        expires_at: expiresAt,
      });
      if (workspaceRef.current !== requestedWorkspace) return;
      const grantID = String(response.data?.grant_id ?? "").trim();
      if (!grantID) throw new Error(t("The service did not confirm the description grant."));
      setEgressAction({ state: "SUCCEEDED", message: t("Authorized one DESCRIBE grant for {{profile}} until {{date}} · {{requests}} requests · {{bytes}} · {{seconds}}s", {
        profile: profile.profile_id,
        date: expiresAt.slice(0, 10),
        requests: limits.max_requests,
        bytes: formatBytes(limits.max_bytes),
        seconds: limits.max_seconds,
      }) });
    } catch (error) {
      if (workspaceRef.current !== requestedWorkspace) return;
      const message = error instanceof Error ? error.message : t("Description grant authorization failed");
      setEgressAction({ state: "FAILED", message: t("Could not confirm the DESCRIBE grant result: {{message}}; the grant list was refreshed to check recorded state.", { message }) });
    } finally {
      if (grantAttempted && workspaceRef.current === requestedWorkspace) await loadEgressFacts();
    }
  }
  async function revokeGrant(grantId: string) {
    const reason = window.prompt(t("Reason for revoking this egress grant"), t("Revoked from the settings dialog"));
    if (reason === null) return;
    setEgressAction({ state: "RUNNING" });
    try {
      await command(operations.egress.grantRevoke, {
        workspace_id: workspaceID,
        grant_id: grantId,
        reason: reason.trim() || t("Revoked from the settings dialog"),
      });
      setEgressAction({ state: "SUCCEEDED", message: t("Egress grant revoked; nothing further is sent under it.") });
      await loadEgressFacts();
    } catch (error) {
      setEgressAction({ state: "FAILED", message: error instanceof Error ? error.message : t("Egress revocation failed") });
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
    imageInstall,
    installImageBundle,
    searchRebuild,
    egressFacts,
    egressAction,
    loadSettings,
    loadEgressFacts,
    authorizeProfile,
    authorizeDescribeProfile,
    revokeGrant,
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
