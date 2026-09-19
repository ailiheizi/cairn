import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createTranslator, resolveInitialLocale } from "./i18n";
import type { Locale } from "./i18n";
import { command } from "./app/command";
import { endpoints, operations } from "./lib/operations";
import { parseHashView, writeHashView } from "./lib/hashView";
import { isTextEntryTarget, useSearch } from "./app/useSearch";
import { useSettings } from "./app/useSettings";
import { useRecents } from "./app/useRecents";
import { useViewMode } from "./app/useViewMode";
import { useCompactLayout } from "./app/useCompactLayout";
import { useLibraryDrafts } from "./app/useLibraryDrafts";
import { useLibrary } from "./app/useLibrary";
import { useDetails } from "./app/useDetails";
import { useSelection } from "./app/useSelection";
import { useSources } from "./app/useSources";
import { useRestore } from "./app/useRestore";
import { useExport } from "./app/useExport";
import { TopBar } from "./components/TopBar";
import { WorkspaceRail, WorkspaceRailPanel } from "./components/WorkspaceRail";
import { StatusPanel } from "./components/StatusPanel";
import { LibrarySurface } from "./components/LibrarySurface";
import { ActivitySurface } from "./components/ActivitySurface";
import { DuplicatesSurface } from "./components/DuplicatesSurface";
import { TagsSurface } from "./components/TagsSurface";
import { DetailsPanel } from "./components/DetailsPanel";
import { SourceDrawer } from "./components/SourceDrawer";
import { RestoreDrawer } from "./components/RestoreDrawer";
import { ExportDrawer } from "./components/ExportDrawer";
import { VerificationDrawer } from "./components/VerificationDrawer";
import { SettingsDialog } from "./components/SettingsDialog";
import "./styles/index.css";
import "antd/dist/reset.css";
import type { Notice, SearchHit, SnapshotSummary, SourceSummary } from "./lib/types";

// The application shell.
//
// It owns the root wiring only: the locale, the one notice and busy flag, the
// query text, the service projection, the open-surface flags, and the two
// document-level keyboard contracts (drawer focus trap and the search
// shortcut). Every surface reads its own state from an `app/` flow and renders
// from `components/`; no surface reaches into another surface's state.

const semanticDimension = "semantic-embedding";
const lexicalDimension = "lexical-metadata-fts";
const semanticProvider = "query.semantic.onnx-bge-zvec.v1";

function App() {
  const [locale, setLocale] = useState<Locale>(resolveInitialLocale);
  const [notice, setNotice] = useState<Notice>();
  const [busy, setBusy] = useState(false);
  // The query text and the last submitted query live in the shell because the
  // search field, the library heading, and the export drawer all describe the
  // same submitted query.
  const [query, setQuery] = useState("");
  const [lastExecutedQuery, setLastExecutedQuery] = useState("");
  const [status, setStatus] = useState("Checking service");
  const [statusData, setStatusData] = useState<any>();
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [snapshotRef, setSnapshotRef] = useState("");
  const [workspaceID, setWorkspaceID] = useState(() => window.localStorage.getItem("restoreweave.workspace_id") ?? "");
  // Selection is a second, explicit concept on top of the one details subject:
  // `selected` means "whose details are open", while the batch selection lives
  // in the selection flow.
  const [selected, setSelected] = useState<SearchHit>();
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // The verification report is a fourth modal drawer. Its trigger lives in the
  // trusted status panel; the drawer itself is the verification surface's file.
  const [verificationOpen, setVerificationOpen] = useState(false);
  // The workspace rail is inline above the compact boundary and a modal panel
  // below it. The shell owns the flag, exactly like the drawer flags; the
  // panel itself is the rail surface's own host.
  const [railOpen, setRailOpen] = useState(false);
  const compactLayout = useCompactLayout();
  const refreshGenerationRef = useRef(0);
  // Capture the invoking control before React changes the surface. This keeps
  // close/escape dismissal predictable when a page-level surface unmounts the
  // normal library controls.
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const railTriggerRef = useRef<HTMLButtonElement | null>(null);
  const libraryListRef = useRef<HTMLDivElement | null>(null);
  // The activity view hands focus back to the rail entry it was opened from.
  const duplicatesRailRef = useRef<HTMLButtonElement | null>(null);
  const tagsRailRef = useRef<HTMLButtonElement | null>(null);
  const activityRailRef = useRef<HTMLButtonElement | null>(null);
  const t = useMemo(() => createTranslator(locale), [locale]);

  const lexicalReady = useMemo(() => capabilities.some((item) => item.kind === "index-dimension" && item.id === lexicalDimension && item.state === "AVAILABLE"), [capabilities]);
  const semanticReady = useMemo(() => capabilities.some((item) => item.kind === "index-dimension" && item.id === semanticDimension && item.source === semanticProvider && item.state === "AVAILABLE"), [capabilities]);
  const semanticBundleCapability = useMemo(() => capabilities.find((item) => item.kind === "model-bundle" && item.id === "bge-small-zh-v1.5"), [capabilities]);
  const semanticBundleReady = useMemo(() => {
    return semanticBundleCapability?.state === "AVAILABLE";
  }, [semanticBundleCapability]);
  const semanticBundleRestartRequired = useMemo(() => semanticBundleReady && /restart required before semantic worker\/index use/i.test(String(semanticBundleCapability?.notes ?? "")), [semanticBundleCapability, semanticBundleReady]);
  const semanticBundleOperatorProvided = useMemo(() => /operator-provided/i.test(String(semanticBundleCapability?.source ?? "")), [semanticBundleCapability]);
  const semanticInstallAvailable = useMemo(() => capabilities.some((item) => item.kind === "operation" && item.id === "semantic.bundle.install" && item.state === "AVAILABLE"), [capabilities]);
  // The image bundle installs from a local archive and is only implemented when
  // the daemon is configured with an installer, so the control follows the
  // daemon rather than the browser.
  const imageInstallAvailable = useMemo(() => capabilities.some((item) => item.kind === "operation" && item.id === "image.bundle.install" && item.state === "AVAILABLE"), [capabilities]);
  const imageBundle = useMemo(() => {
    const entry = capabilities.find((item) => item.kind === "index-dimension" && item.id === "multimodal-clip");
    return { state: entry ? String(entry.state ?? "") : "", reason: String(entry?.notes ?? "").trim() };
  }, [capabilities]);
  const searchRebuildAvailable = useMemo(() => capabilities.some((item) => item.kind === "operation" && item.id === "search.rebuild" && item.state === "AVAILABLE"), [capabilities]);
  const isConnected = status === "Connected";
  const isUnavailable = status === "Unavailable";
  const catalogHealthy = statusData?.catalog?.ok === true;
  const repositoryHealthy = statusData?.repository?.ok === true;
  const annotationStorageReady = isConnected && catalogHealthy;
  const coreStorageReady = isConnected && catalogHealthy && repositoryHealthy;
  const coreStorageComponent = [
    !catalogHealthy ? t("Catalog unavailable") : "",
    !repositoryHealthy ? t("Repository unavailable") : "",
  ].filter(Boolean).join("; ");
  const coreStorageMessage = !isConnected
    ? t("Could not connect to RestoreWeave service. Start the service, then refresh.")
    : !statusData
      ? t("Core storage status unavailable")
      : t("Service connected, but core storage is unavailable: {{component}}", { component: coreStorageComponent || t("Core storage status unavailable") });
  const catalogStorageMessage = !isConnected
    ? t("Could not connect to RestoreWeave service. Start the service, then refresh.")
    : !statusData
      ? t("Core storage status unavailable")
      : t("Service connected, but catalog is unavailable.");
  const repositoryPath = statusData?.repository?.path || t("Configured content repository");
  // Settings is a full page in the document flow. Only the add, restore,
  // export, verification, and workspace-rail surfaces participate in the modal
  // focus trap and body lock.
  const drawerOpen = addOpen || restoreOpen || exportOpen || verificationOpen || (compactLayout && railOpen);
  const drawerKind = addOpen ? "add" : restoreOpen ? "restore" : exportOpen ? "export" : verificationOpen ? "verification" : railOpen ? "rail" : "closed";

  async function refreshCapabilities() {
    try {
      const response = await command(operations.capability.list, {});
      setCapabilities(response.data?.capabilities ?? []);
    } catch {
      setCapabilities([]);
    }
  }

  function rememberWorkspace(value: unknown) { if (typeof value === "string" && value.trim()) { setWorkspaceID(value); window.localStorage.setItem("restoreweave.workspace_id", value); } }
  function rememberDrawerTrigger(trigger?: EventTarget | null) {
    drawerTriggerRef.current = trigger instanceof HTMLElement
      ? trigger
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }

  // Cross-surface resets. A stale catalog projection must be cleared together,
  // so the shell owns the one ordered composition of each flow's reset.
  function resetCatalogProjection() {
    setLastExecutedQuery("");
    setSnapshotRef("");
    library.resetLibraryProjection();
    details.resetDetailProjection();
    sources.resetSourceProjection();
    restore.resetRestoreProjection();
  }
  function clearCatalogBackedState() {
    setWorkspaceID("");
    window.localStorage.removeItem("restoreweave.workspace_id");
    resetCatalogProjection();
  }
  function clearRepositoryDependentState() {
    setSnapshotRef("");
    sources.resetSourceProjection();
    restore.resetRestoreProjection();
  }

  async function refresh() {
    const refreshGeneration = ++refreshGenerationRef.current;
    const isCurrentRefresh = () => refreshGenerationRef.current === refreshGeneration;
    setStatus("Checking service");
    const [healthResult, statusResult] = await Promise.allSettled([fetch(endpoints.health), command(operations.status.get, {})]);
    if (!isCurrentRefresh()) return;
    if (healthResult.status !== "fulfilled" || statusResult.status !== "fulfilled") {
      sources.setSourceProjection({ state: "DEGRADED" });
      setCapabilities([]);
      setStatusData(undefined);
      clearCatalogBackedState();
      setStatus("Unavailable");
      return;
    }
    const health = healthResult.value;
    const statusResponse = statusResult.value;
    const serviceConnected = health.ok && statusResponse.status !== "FAILED";
    const nextStatusData = statusResponse.data;
    const nextCatalogHealthy = nextStatusData?.catalog?.ok === true;
    const nextRepositoryHealthy = nextStatusData?.repository?.ok === true;
    const nextCoreStorageReady = serviceConnected && nextCatalogHealthy && nextRepositoryHealthy;
    setStatus(serviceConnected ? "Connected" : "Unavailable");
    setStatusData(nextStatusData);

    if (!serviceConnected || !nextCatalogHealthy) {
      // A reachable HTTP adapter is not evidence that its durable catalog can
      // serve content. Do not wait on catalog-backed follow-up operations
      // before exposing that failure or clearing stale browser projections.
      setCapabilities([]);
      clearCatalogBackedState();
      return;
    }

    const [capabilityResult, snapshotResult] = await Promise.allSettled([command(operations.capability.list, {}), command(operations.snapshot.list, {})]);
    if (!isCurrentRefresh()) return;
    if (capabilityResult.status === "fulfilled") setCapabilities(capabilityResult.value.data?.capabilities ?? []);
    else setCapabilities([]);
    const snapshots = snapshotResult.status === "fulfilled" ? (snapshotResult.value.data?.snapshots ?? []) as SnapshotSummary[] : [];
    const latest = snapshots.at(-1);
    if (nextCoreStorageReady && snapshotResult.status === "fulfilled") setSnapshotRef(latest?.snapshot_ref ?? "");
    else clearRepositoryDependentState();
    // A browser-local workspace id is only a convenience after an explicit
    // ingest; it is not evidence for a newly opened daemon/catalog. Refresh
    // trusts only durable state reported by this daemon.
    const activeWorkspaceID = latest?.workspace_id || nextStatusData?.recent_plans?.[0]?.workspace_id || "";
    if (activeWorkspaceID) rememberWorkspace(activeWorkspaceID);
    if (activeWorkspaceID) {
      try {
        await sources.loadSources(activeWorkspaceID, refreshGeneration, snapshots);
        await library.loadContentLibrary(activeWorkspaceID, refreshGeneration);
      } catch (error) {
        if (!isCurrentRefresh()) return;
        library.resetLibraryProjection();
        setSelected(undefined);
        setNotice({ kind: "warning", text: error instanceof Error ? t("Content library is unavailable: {{message}}", { message: error.message }) : t("Content library is unavailable.") });
      }
    } else {
      clearCatalogBackedState(); sources.setSourceProjection({ state: "READY" });
    }
  }

  const settings = useSettings({ t, settingsOpen, workspaceID, semanticInstallAvailable, imageInstallAvailable, searchRebuildAvailable, refreshCapabilities, notify: setNotice });
  const recents = useRecents();
  const view = useViewMode();
  const drafts = useLibraryDrafts({ t });
  const library = useLibrary({ t, locale, workspaceID, refreshGenerationRef, viewMode: view.viewMode, setViewMode: view.setViewMode, sortField: view.sortField, sortDirection: view.sortDirection, setQuery, setLastExecutedQuery, setSelected, setBusy, notify: setNotice, canLeaveDetailDrafts: drafts.canLeaveDetailDrafts, discardDetailDrafts: drafts.discardDetailDrafts });
  const details = useDetails({ t, workspaceID, selected, setSelected, drafts, library, setViewMode: view.setViewMode, annotationStorageReady, catalogStorageMessage, refreshCapabilities, setBusy, notify: setNotice });
  const selection = useSelection({ t, workspaceID, hits: library.hits, renderedHits: library.renderedHits, selected, details, library, annotationStorageReady, catalogStorageMessage, refreshCapabilities, setBusy, notify: setNotice, libraryListRef });
  const sources = useSources({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, isUnavailable, busy, setBusy, notify: setNotice, refresh, refreshGenerationRef, lastPlannedSource: recents.lastPlannedSource, rememberLastSourcePath: recents.rememberLastSourcePath, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, closeDrawers: () => { setRestoreOpen(false); setExportOpen(false); setSettingsOpen(false); }, setAddOpen, library, rememberWorkspace });
  const restore = useRestore({ t, snapshotRef, isConnected, coreStorageReady, coreStorageMessage, isUnavailable, busy, setBusy, notify: setNotice, pushRecentDestination: recents.pushRecentDestination, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, closeDrawers: () => { setAddOpen(false); sources.setRecheckSourceRef(""); setExportOpen(false); setSettingsOpen(false); }, setRestoreOpen });
  const exportFlow = useExport({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, exportOpen, viewMode: view.viewMode, lastExecutedQuery, setQuery, setLastExecutedQuery, selected, setSelected, setViewMode: view.setViewMode, selection, library, drafts, setBusy, notify: setNotice, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, closeOtherDrawers: () => { setAddOpen(false); sources.setRecheckSourceRef(""); setRestoreOpen(false); setSettingsOpen(false); }, setExportOpen });
  const search = useSearch({ t, query, setQuery, setLastExecutedQuery, workspaceID, isConnected, catalogHealthy, catalogStorageMessage, drawerOpen, settingsOpen, setBusy, notify: setNotice, markConnected: () => setStatus("Connected"), recents, drafts, canLeaveSettings: settings.canLeaveSettings, exportFlow, library, setSelected, setViewMode: view.setViewMode });

  // The URL hash is a browser-local deep link over the library's projection
  // state (view mode, the submitted search text, the active tag facets, the
  // timeline month). It is read once on mount and restored after the daemon's
  // first content listing arrived — restoring a search re-runs that query, so
  // the restored view is always derived from the daemon, never from the hash.
  // Every later change replaces the hash (replaceState, never pushState), so
  // a refresh lands where the user was without spamming session history.
  const pendingHashView = useRef(parseHashView(window.location.hash));
  const [hashViewApplied, setHashViewApplied] = useState(false);
  useEffect(() => {
    if (hashViewApplied) return;
    const pending = pendingHashView.current;
    if (!pending.mode) { setHashViewApplied(true); return; }
    if (!isConnected) return;
    if ((pending.mode === "search" || pending.mode === "content" || pending.mode === "tag") && !library.libraryLoaded) return;
    setHashViewApplied(true);
    if (pending.mode === "search") {
      const text = pending.q.trim();
      if (!text) return;
      setQuery(text);
      void search.runSearch(undefined, text);
      return;
    }
    if (pending.mode === "content" || pending.mode === "tag") { library.restoreLibraryHashView(pending.mode, pending.tags, pending.month); return; }
    view.setViewMode(pending.mode);
  }, [hashViewApplied, isConnected, library.libraryLoaded]);
  useEffect(() => {
    writeHashView({ mode: view.viewMode, q: lastExecutedQuery, tags: library.activeTags, month: library.activeTimelineMonth });
  }, [lastExecutedQuery, library.activeTags, library.activeTimelineMonth, view.viewMode]);

  useEffect(() => { void refresh(); }, []);
  // The panel exists only below the compact boundary. A resize across it
  // closes the panel instead of leaving a stale open flag behind.
  useEffect(() => { if (!compactLayout) setRailOpen(false); }, [compactLayout]);
  // A selected subject that leaves the current listing is dropped instead of
  // being kept as a hidden member of the batch. Reordering (sorting) keeps the
  // same subjects and therefore the same selection.
  useEffect(() => {
    const visible = new Set(library.hits.map((hit) => hit.subject_ref?.trim()).filter((value): value is string => Boolean(value)));
    selection.setSelectionRefs((current) => {
      const next = current.filter((subjectRef) => visible.has(subjectRef));
      return next.length === current.length ? current : next;
    });
  }, [library.hits]);
  // Escape clears the batch selection only when no drawer, modal viewer, or
  // settings surface owns the key; those keep their own dismiss behavior.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (drawerOpen || settingsOpen) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      selection.setSelectionRefs((current) => current.length ? [] : current);
      selection.setSelectionAnchor("");
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen, settingsOpen]);
  // Cmd/Ctrl+K focuses the one search field from anywhere in the app, and "/"
  // does the same outside a typing surface. Neither shortcut acts while a
  // drawer, the image viewer, or the settings dialog owns focus: those keep
  // their existing focus traps, and Escape keeps its existing meaning there.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (drawerOpen || settingsOpen) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        search.focusSearchField();
        return;
      }
      if (event.key === "/" && !modifier && !event.altKey && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        search.focusSearchField();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen, settingsOpen]);
  useEffect(() => {
    window.localStorage.setItem("restoreweave.locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    if (!drawerOpen) return;
    const previouslyFocused = drawerTriggerRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    document.body.classList.add("drawer-open");
    const focusFirstControl = () => {
      const drawer = document.querySelector<HTMLElement>('[aria-modal="true"]');
      // Prefer the task's first field over the dismiss button. Drawers have
      // an actionable input; falling back to a button keeps empty/error
      // states keyboard reachable.
      const firstField = drawer?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [autofocus]');
      const first = firstField ?? drawer?.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      first?.focus();
    };
    requestAnimationFrame(focusFirstControl);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (addOpen) sources.closeAdd(); else { setRailOpen(false); setSettingsOpen(false); setRestoreOpen(false); setExportOpen(false); setVerificationOpen(false); }
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = document.querySelector<HTMLElement>('[aria-modal="true"]');
      const focusable = drawer ? Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')) : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("drawer-open");
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
      drawerTriggerRef.current = null;
    };
  }, [drawerOpen, drawerKind, addOpen, sources.planAction, sources.planCheckBusy]);

  async function openLibraryEntry(hit: SearchHit) {
    if (hit.entry_type === "DIRECTORY" && (hit.entry_id || hit.subject_ref) && library.browseRootID) {
      const entryID = hit.entry_id || hit.subject_ref || "";
      const nextCrumbs = [...library.browseCrumbs, { subject_ref: hit.subject_ref || entryID, entry_id: entryID, name: hit.name || "Folder" }];
      setBusy(true);
      try { await library.loadNamespace(workspaceID, library.browseRootID, entryID, nextCrumbs); }
      catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : t("Could not open folder") }); }
      finally { setBusy(false); }
      return;
    }
    await details.loadDetails(hit);
  }
  function handleResultClick(index: number, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; preventDefault: () => void }) {
    if (event.metaKey || event.ctrlKey) { event.preventDefault(); selection.toggleSelectionAt(index); return; }
    if (event.shiftKey) { event.preventDefault(); selection.extendSelectionTo(index); return; }
    const hit = library.renderedHits[index];
    if (!hit) return;
    void (view.viewMode === "path" ? openLibraryEntry(hit) : details.loadDetails(hit));
  }
  function openSettings(trigger?: EventTarget | null) {
    if (!settings.canLeaveSettings()) return;
    // Keep the settings trigger so closing the drawer (including Escape or
    // backdrop dismissal) returns keyboard users to the control that opened
    // it, just like the add/restore drawers do.
    rememberDrawerTrigger(trigger);
    setAddOpen(false); sources.setRecheckSourceRef(""); setRestoreOpen(false); setExportOpen(false); setSettingsOpen(true); void settings.loadSettings(); void settings.loadEgressFacts();
  }
  function closeSettings() {
    if (!settings.canLeaveSettings()) return;
    setSettingsOpen(false);
    requestAnimationFrame(() => {
      // The normal topbar is unmounted while settings is open, so the saved
      // element may no longer be connected when the page returns.
      const trigger = drawerTriggerRef.current?.isConnected
        ? drawerTriggerRef.current
        : document.querySelector<HTMLElement>(".settings-trigger");
      if (trigger?.isConnected) trigger.focus();
      drawerTriggerRef.current = null;
    });
  }
  function viewSource(sourceItem: SourceSummary) { void sources.viewSource(sourceItem); }
  function recheckSource(sourceItem: SourceSummary, trigger?: EventTarget | null) { sources.openAdd(sourceItem, trigger); }
  function addSource(trigger?: EventTarget | null) { sources.openAdd(undefined, trigger); }
  // The compact workspace panel is opened from the topbar button and dismissed
  // like every other modal surface: Escape, the backdrop, or its own close
  // control. The shell's drawer effect owns the focus trap, the `drawer-open`
  // body lock, and the focus return to the button that opened it.
  function openRail(trigger?: EventTarget | null) {
    rememberDrawerTrigger(trigger);
    setAddOpen(false); sources.setRecheckSourceRef(""); setRestoreOpen(false); setExportOpen(false); setVerificationOpen(false);
    setRailOpen(true);
  }
  function closeRail() { setRailOpen(false); }
  // Selecting a view is the panel's own dismiss action: the panel closes and
  // the same handler the desktop rail uses switches the view. On a phone the
  // inspector takes over the one column a workspace view would render in, so
  // the panel's selection also leaves the inspected subject, behind the same
  // unsaved-draft guard the library, sources, and activity entries already
  // apply. Above the compact boundary none of this fires.
  function selectRailView<Args extends unknown[]>(action: (...args: Args) => void) {
    return (...args: Args) => {
      setRailOpen(false);
      if (compactLayout && selected) {
        if (!drafts.canLeaveDetailDrafts()) return;
        drafts.discardDetailDrafts();
        setSelected(undefined);
      }
      action(...args);
    };
  }
  // The activity view is one real workspace view beside the library and the
  // sources. Entering it leaves the inspected subject like the sources view
  // does, through the same unsaved-draft guard the library owns.
  function openActivity() {
    if (!drafts.canLeaveDetailDrafts()) return;
    drafts.discardDetailDrafts();
    setSelected(undefined);
    view.setViewMode("activity");
  }
  // The rail's Library entry returns from every other view mode; from the
  // activity view it restores the unfiltered content projection.
  function openLibrary(event: { currentTarget: EventTarget | null }) {
    if (view.viewMode === "activity") { library.clearLibraryFilters(); return; }
    if (library.hasActiveFilters) library.clearLibraryFilters();
    else reloadLibrary();
  }
  function reloadLibrary() { if (workspaceID) void library.loadContentLibrary(workspaceID, refreshGenerationRef.current, true); }
  // The workspace layout and the library's first-source empty state describe
  // the same condition, so the shell computes it once and passes it down.
  const showFirstSource = view.viewMode === "content" && library.libraryItems.length === 0 && sources.sources.length === 0 && sources.sourceProjection.state !== "DEGRADED";
  // One rail element, mounted either inline (above the compact boundary) or
  // inside the panel (below it). Selecting a view dismisses the panel and then
  // runs the same handler the desktop rail calls; closing an already-closed
  // panel is a no-op, so both mounts share this one element.
  const rail = <WorkspaceRail
    t={t}
    viewMode={view.viewMode}
    hasActiveFilters={library.hasActiveFilters}
    libraryCount={library.libraryItems.length}
    sourceCount={sources.sources.length}
    onLibrary={selectRailView((event) => openLibrary(event))}
    onSources={selectRailView(library.showSourcesSurface)}
    onActivity={selectRailView(openActivity)}
    onDuplicates={selectRailView(() => view.setViewMode("duplicates"))}
    onTags={selectRailView(() => view.setViewMode("tags"))}
    activityRef={activityRailRef}
    duplicatesRef={duplicatesRailRef}
    tagsRef={tagsRailRef}
  />;
  // The panel hosts that same rail element and the same trusted status
  // disclosure; it adds the dialog shell only.
  const railPanel = <WorkspaceRailPanel t={t} onClose={closeRail}>
    {rail}
    <StatusPanel
      t={t}
      status={status}
      statusData={statusData}
      capabilities={capabilities}
      onRefresh={() => void refresh()}
      onOpenVerification={(trigger) => { rememberDrawerTrigger(trigger); setRailOpen(false); setVerificationOpen(true); }}
      onOpenActivity={selectRailView(openActivity)}
    />
  </WorkspaceRailPanel>;

  return <div className="app-shell">
    <TopBar
      t={t}
      query={query}
      busy={busy}
      status={status}
      statusData={statusData}
      capabilities={capabilities}
      isConnected={isConnected}
      coreStorageReady={coreStorageReady}
      catalogHealthy={catalogHealthy}
      snapshotRef={snapshotRef}
      search={search}
      compact={compactLayout}
      onOpenRail={openRail}
      railTriggerRef={railTriggerRef}
      onRefresh={() => void refresh()}
      onOpenRestore={(trigger) => restore.openRestore(trigger)}
      onOpenAdd={(_, trigger) => addSource(trigger)}
      onOpenSettings={(trigger) => openSettings(trigger)}
      onOpenVerification={(trigger) => { rememberDrawerTrigger(trigger); setVerificationOpen(true); }}
      onOpenActivity={openActivity}
      canLeaveSettings={settings.canLeaveSettings}
    />
    <main className={`workspace ${selected ? "detail-active" : ""} ${showFirstSource ? "empty-library" : ""}`}>
      {compactLayout ? undefined : rail}
      {view.viewMode === "duplicates" ? <DuplicatesSurface t={t} /> : view.viewMode === "tags" ? <TagsSurface t={t} /> : view.viewMode === "activity" ? <ActivitySurface
        t={t}
        locale={locale}
        workspaceID={workspaceID}
        isConnected={isConnected}
        statusData={statusData}
        onExitToRail={() => activityRailRef.current?.focus()}
      /> : <LibrarySurface
        t={t}
        locale={locale}
        workspaceID={workspaceID}
        viewMode={view.viewMode}
        library={library}
        selection={selection}
        sources={sources}
        view={view}
        command={command}
        selectedRef={selected?.subject_ref ?? ""}
        showFirstSource={showFirstSource}
        recalledView={exportFlow.recalledView}
        lastExecutedQuery={lastExecutedQuery}
        sortAvailable={view.sortAvailable}
        canOpenExport={exportFlow.canOpenExport}
        isConnected={isConnected}
        isUnavailable={isUnavailable}
        coreStorageReady={coreStorageReady}
        coreStorageMessage={coreStorageMessage}
        notice={notice}
        busy={busy}
        refresh={() => void refresh()}
        onOpenAdd={addSource}
        onViewSource={viewSource}
        onRecheckSource={recheckSource}
        onRowClick={handleResultClick}
        onLibraryKeyDown={selection.handleLibraryKeyDown}
        onOpenExport={(trigger, explicitSelection) => exportFlow.openExport(trigger, explicitSelection)}
        onClearNotice={() => setNotice(undefined)}
        onImageSearch={(subjectRef) => void search.runImageSearch(subjectRef)}
        onOpenHit={(hit) => void details.loadDetails(hit)}
        libraryListRef={libraryListRef}
      />}
      {selected && <DetailsPanel
        workspaceId={workspaceID}
        hit={selected}
        annotations={details.annotations}
        representations={details.representations}
        descriptions={details.descriptions}
        descriptionsTruncated={details.descriptionsTruncated}
        mediaFacts={details.mediaFacts}
        mediaFactsState={details.mediaFactsState}
        track={details.track}
        work={details.work}
        annotationStatus={details.detailState.annotations}
        representationsStatus={details.detailState.representations}
        descriptionsStatus={details.detailState.descriptions}
        annotationMutationEnabled={annotationStorageReady && details.detailState.subjectRef === selected.subject_ref?.trim() && details.detailSubjectRef.current === selected.subject_ref?.trim() && details.detailState.annotations === "ready"}
        noteDraft={drafts.noteDraft}
        tagDraft={drafts.tagDraft}
        tagVocabulary={library.tagVocabulary}
        editingNoteID={drafts.editingNoteID}
        editingBody={drafts.editingBody}
        busy={busy}
        t={t}
        locale={locale}
        onBack={details.closeDetails}
        onExport={selected.entry_type !== "DIRECTORY" ? () => exportFlow.openExport() : undefined}
        onDraft={drafts.setNoteDraft}
        onTagDraft={drafts.setTagDraft}
        onAddTag={() => void details.saveTag()}
        onDeleteTag={(tag) => void details.deleteTag(tag)}
        onAdd={() => void details.saveNote("", drafts.noteDraft)}
        onEdit={(note) => { drafts.setEditingNoteID(note.annotation_id); drafts.setEditingBody(note.body); drafts.setEditingOriginalBody(note.body); }}
        onDeleteNote={(note) => void details.deleteNote(note)}
        onEditBody={drafts.setEditingBody}
        onSaveEdit={(note) => void details.saveNote(note.annotation_id, drafts.editingBody, note.revision, note.subject_ref)}
        onCancelEdit={() => { drafts.setEditingNoteID(""); drafts.setEditingBody(""); drafts.setEditingOriginalBody(""); }}
      />}
    </main>
    {compactLayout && railOpen && railPanel}
    {settingsOpen && <SettingsDialog
      t={t}
      locale={locale}
      settings={settings}
      workspaceID={workspaceID}
      statusData={statusData}
      notice={notice}
      lexicalReady={lexicalReady}
      semanticReady={semanticReady}
      semanticBundleReady={semanticBundleReady}
      semanticBundleRestartRequired={semanticBundleRestartRequired}
      semanticBundleOperatorProvided={semanticBundleOperatorProvided}
      semanticInstallAvailable={semanticInstallAvailable}
      imageInstallAvailable={imageInstallAvailable}
      imageBundleState={imageBundle.state}
      imageBundleReason={imageBundle.reason}
      searchRebuildAvailable={searchRebuildAvailable}
      onLocale={setLocale}
      onClose={closeSettings}
      onDismissNotice={() => setNotice(undefined)}
    />}
    {addOpen && <SourceDrawer
      t={t}
      sources={sources}
      isUnavailable={isUnavailable}
      coreStorageReady={coreStorageReady}
      coreStorageMessage={coreStorageMessage}
      notice={notice}
      repositoryPath={repositoryPath}
      onClose={sources.closeAdd}
      onDone={() => { sources.closeAdd(); reloadLibrary(); }}
    />}
    {restoreOpen && <RestoreDrawer
      t={t}
      restore={restore}
      recentRestoreDestinations={recents.recentRestoreDestinations}
      coreStorageReady={coreStorageReady}
      onClose={restore.closeRestore}
    />}
    {exportOpen && <ExportDrawer
      export={exportFlow}
      query={lastExecutedQuery}
      locale={locale}
      t={t}
      appBusy={busy}
      onClose={exportFlow.closeExport}
    />}
    {verificationOpen && <VerificationDrawer
      t={t}
      snapshotRef={snapshotRef}
      subjectRef={selected?.subject_ref}
      isConnected={isConnected}
      coreStorageReady={coreStorageReady}
      busy={busy}
      workspaceID={workspaceID}
      onRefresh={() => void refresh()}
      onClose={() => setVerificationOpen(false)}
    />}
  </div>;
}

const rootElement = document.getElementById("root")! as HTMLElement & { restoreWeaveRoot?: ReturnType<typeof createRoot> };
const root = rootElement.restoreWeaveRoot ?? createRoot(rootElement);
rootElement.restoreWeaveRoot = root;
root.render(<App />);
