import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
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
import { useAppearance } from "./app/useAppearance";
import { useLibraryViews } from "./app/useLibraryViews";
import { bootstrapAppearance } from "./lib/appearance";
import { isLibraryViewEnabled, libraryPageForMode, libraryPageRoot } from "./lib/libraryViews";
import { useCompactLayout } from "./app/useCompactLayout";
import { useLibraryDrafts } from "./app/useLibraryDrafts";
import { useLibrary } from "./app/useLibrary";
import { useDetails } from "./app/useDetails";
import { useSelection } from "./app/useSelection";
import { useSources } from "./app/useSources";
import { useRestore } from "./app/useRestore";
import { useExport } from "./app/useExport";
import { useAudioPlayback } from "./app/useAudioPlayback";
import { useMusicMetadata } from "./app/useMusicMetadata";
import { useFavorites } from "./app/useFavorites";
import { useOriginalTakeout } from "./app/useOriginalTakeout";
import { resolveArchiveSelectionSizes } from "./lib/originalArchive";
import { AudioPlayer } from "./components/AudioPlayer";
import { OriginalTakeoutStatus } from "./components/OriginalTakeoutStatus";
import { TopBar } from "./components/TopBar";
import { InterfaceRenderBoundary } from "./components/InterfaceRenderBoundary";
import { WorkspaceRail, WorkspaceRailPanel } from "./components/WorkspaceRail";
import { StatusPanel } from "./components/StatusPanel";
import { LibrarySurface } from "./components/LibrarySurface";
import { LibraryPresentationNavigation } from "./components/LibraryPresentationNavigation";
import { ActivitySurface } from "./components/ActivitySurface";
import { DuplicatesSurface } from "./components/DuplicatesSurface";
import { TagsSurface } from "./components/TagsSurface";
import { NotesSurface } from "./components/NotesSurface";
import { DetailsPanel } from "./components/DetailsPanel";
import { SourceDrawer } from "./components/SourceDrawer";
import { RestoreDrawer } from "./components/RestoreDrawer";
import { ExportDrawer } from "./components/ExportDrawer";
import { VerificationDrawer } from "./components/VerificationDrawer";
import { SettingsDialog } from "./components/SettingsDialog";
import "./styles/index.css";
import "antd/dist/reset.css";
import type { LibraryPageMode, Notice, SearchHit, SnapshotSummary, SourceSummary } from "./lib/types";

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
  const presentationFallbackNoticeRef = useRef<Notice | undefined>(undefined);
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
  const [workspaceID, setWorkspaceID] = useState(() => window.localStorage.getItem("cairn.workspace_id") ?? "");
  const workspaceIDRef = useRef(workspaceID);
  workspaceIDRef.current = workspaceID;
  // Selection is a second, explicit concept on top of the one details subject:
  // `selected` means "whose details are open", while the batch selection lives
  // in the selection flow.
  const [selected, setSelected] = useState<SearchHit>();
  // A page's browsing focus is separate from Details and batch selection.
  const [focusedSubjectRef, setFocusedSubjectRef] = useState("");
  useEffect(() => { setFocusedSubjectRef(""); }, [workspaceID]);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
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
  const notesRailRef = useRef<HTMLButtonElement | null>(null);
  const activityRailRef = useRef<HTMLButtonElement | null>(null);
  const t = useMemo(() => createTranslator(locale), [locale]);
  function showPresentationFallbackNotice(text: string) {
    const fallback: Notice = { kind: "warning", text };
    presentationFallbackNoticeRef.current = fallback;
    setNotice(fallback);
  }
  function clearPresentationFallbackNotice() {
    const fallback = presentationFallbackNoticeRef.current;
    presentationFallbackNoticeRef.current = undefined;
    if (fallback) setNotice((current) => current === fallback ? undefined : current);
  }

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
    ? t("Could not connect to Cairn service. Start the service, then refresh.")
    : !statusData
      ? t("Core storage status unavailable")
      : t("Service connected, but core storage is unavailable: {{component}}", { component: coreStorageComponent || t("Core storage status unavailable") });
  const catalogStorageMessage = !isConnected
    ? t("Could not connect to Cairn service. Start the service, then refresh.")
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

  function rememberWorkspace(value: unknown) { if (typeof value === "string" && value.trim()) { setWorkspaceID(value); window.localStorage.setItem("cairn.workspace_id", value); } }
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
    window.localStorage.removeItem("cairn.workspace_id");
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

    // The shell needs the authenticated identity of the newest restore point —
    // its ref, its workspace and its recorded verification receipt — to compose
    // the first screen. It does not read the entry counts, file counts, logical
    // bytes or protection mix, and the daemon has to assemble every manifest
    // entry of every publication to report those. Asking for the bounded
    // identity projection keeps that full-library walk on the surfaces that
    // actually display it (`snapshot.list` without a projection from the status
    // disclosure and the verification report), instead of spending it here
    // before the library listing is even requested.
    const [capabilityResult, snapshotResult] = await Promise.allSettled([command(operations.capability.list, {}), command(operations.snapshot.list, { projection: "identity" })]);
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
  const appearance = useAppearance();
  const libraryViews = useLibraryViews();
  const drafts = useLibraryDrafts({ t });
  const library = useLibrary({ t, locale, workspaceID, refreshGenerationRef, viewMode: view.viewMode, presentationMode: view.presentationMode, setViewMode: view.setViewMode, setPresentationMode: view.setPresentationMode, sortField: view.sortField, sortDirection: view.sortDirection, setQuery, setLastExecutedQuery, setSelected, setBusy, notify: setNotice, canLeaveDetailDrafts: drafts.canLeaveDetailDrafts, discardDetailDrafts: drafts.discardDetailDrafts });
  const details = useDetails({ t, workspaceID, selected, setSelected, drafts, library, setViewMode: view.setViewMode, annotationStorageReady, catalogStorageMessage, refreshCapabilities, setBusy, notify: setNotice });
  const selection = useSelection({ t, workspaceID, hits: library.hits, renderedHits: library.renderedHits, selected, details, library, annotationStorageReady, catalogStorageMessage, refreshCapabilities, setBusy, notify: setNotice, libraryListRef });
  const sources = useSources({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, isUnavailable, busy, setBusy, notify: setNotice, refresh, refreshGenerationRef, lastPlannedSource: recents.lastPlannedSource, rememberLastSourcePath: recents.rememberLastSourcePath, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, closeDrawers: () => { setRestoreOpen(false); setExportOpen(false); setSettingsOpen(false); }, setAddOpen, library, rememberWorkspace });
  const restore = useRestore({ t, snapshotRef, isConnected, coreStorageReady, coreStorageMessage, isUnavailable, busy, setBusy, notify: setNotice, pushRecentDestination: recents.pushRecentDestination, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, closeDrawers: () => { setAddOpen(false); sources.setRecheckSourceRef(""); setExportOpen(false); setSettingsOpen(false); }, setRestoreOpen });
  const exportFlow = useExport({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, exportOpen, viewMode: view.viewMode, lastExecutedQuery, setQuery, setLastExecutedQuery, selected, setSelected, setViewMode: view.setViewMode, selection, library, drafts, setBusy, notify: setNotice, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, canLeaveDetailDrafts: drafts.canLeaveDetailDrafts, closeOtherDrawers: () => { setAddOpen(false); sources.setRecheckSourceRef(""); setRestoreOpen(false); setSettingsOpen(false); }, setExportOpen });
  const search = useSearch({ t, query, setQuery, setLastExecutedQuery, workspaceID, isConnected, catalogHealthy, catalogStorageMessage, drawerOpen, settingsOpen, setBusy, notify: setNotice, markConnected: () => setStatus("Connected"), recents, drafts, canLeaveSettings: settings.canLeaveSettings, exportFlow, library, setSelected, setViewMode: view.setViewMode });
  const topBarSearch = {
    ...search,
    async runSearch(event?: Parameters<typeof search.runSearch>[0], explicitQuery?: string) {
      const succeeded = await search.runSearch(event, explicitQuery);
      if (succeeded) completeUserNavigation();
      return succeeded;
    },
    pickRecentSearch(value: string) {
      search.handleSearchFieldChange(value);
      void search.runSearch(undefined, value).then((succeeded) => { if (succeeded) completeUserNavigation(); });
    },
  };
  const audioPlayback = useAudioPlayback(workspaceID);
  // Recorded audio facts feed exactly two presentations: the Music page and the
  // mixed Content overview. Neither is the screen an operator gets by default,
  // and `audio.list` walks every admitted processor artifact the workspace
  // holds, so reading it before the library listing turns a page nobody opened
  // into a request that competes with the first screen. The read starts when
  // one of those pages is actually selected; the Music page already reports the
  // read as "Loading recorded audio facts" and keeps filenames and tags
  // visible, so a deferred read is shown as pending rather than as absent
  // facts. Details still reads the same projection on demand for one subject.
  const audioFactsPresentation = view.presentationMode === "music" || view.presentationMode === "page:cairn:overview";
  const musicMetadata = useMusicMetadata(audioFactsPresentation ? workspaceID : "", library.libraryItems, command);
  const favoriteControls = useFavorites({ t, workspaceID, library, annotationStorageReady, catalogStorageMessage, busy, setBusy, notify: setNotice, refreshCapabilities });
  const originalTakeout = useOriginalTakeout(workspaceID);
  const originalTakeoutBusy = ["planning", "downloading", "preparing"].includes(originalTakeout.status);
  const presentationRoot = libraryPageForMode(view.presentationMode);
  const presentationRootKey = presentationRoot ? libraryPageRoot(presentationRoot)?.id ?? presentationRoot.id : "content";
  // Only the active library projection may select immersive/focused chrome. A
  // workspace view (sources/activity/tags/notes/duplicates) keeps its normal
  // shell even when a domain presentation is still remembered, so the focused
  // host header can never mount the same rail the frame or panel already owns.
  const activePresentationPage = (view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag" || Boolean(libraryPageForMode(view.viewMode))) ? libraryPageForMode(view.presentationMode) : undefined;
  // Page metadata controls the content frame and rail ownership. Every host
  // destination shares the same header; management screens belong to Library
  // even when a domain presentation is remembered.
  const focusedChrome = activePresentationPage?.composition === "focused";
  const headerDestination = activePresentationPage || view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag" || view.viewMode === "path" ? view.presentationMode : "content";
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [presentationRootKey]);

  // Hiding a library lens changes presentation only. Keep the inspected subject
  // and its unsaved Notes intact while restoring the shared loaded listing.
  useEffect(() => {
    if (isLibraryViewEnabled(view.presentationMode, libraryViews.enabledViewIds)) return;
    view.setPresentationMode("content");
    selection.clearSelection();
    showPresentationFallbackNotice(t("This presentation is disabled. Showing all types for the same results."));
  }, [view.presentationMode, libraryViews.enabledViewIds]);

  // The URL hash is a browser-local deep link over the library's projection
  // state (view mode, including the photo/music lenses, submitted search text,
  // active tag facets, and timeline month). It is read once on mount and restored after the daemon's
  // first content listing arrived — restoring a search re-runs that query, so
  // the restored view is always derived from the daemon, never from the hash.
  // Every later change replaces the hash (replaceState, never pushState), so
  // a refresh lands where the user was without spamming session history.
  const pendingHashView = useRef(parseHashView(window.location.hash));
  const [hashViewApplied, setHashViewApplied] = useState(false);
  const [hashRestoreComplete, setHashRestoreComplete] = useState(!pendingHashView.current.mode);
  const hashRestoreFailedRef = useRef(false);
  const hashRestoreSupersededRef = useRef(false);
  const [hashRestoreFailed, setHashRestoreFailed] = useState(false);
  const scopeRestoring = !hashRestoreComplete && !hashRestoreFailed && Boolean(pendingHashView.current.mode);
  useEffect(() => {
    if (hashViewApplied) return;
    if (hashRestoreSupersededRef.current) { setHashViewApplied(true); return; }
    const pending = pendingHashView.current;
    if (!pending.mode) { setHashViewApplied(true); setHashRestoreComplete(true); return; }
    if (!isConnected) return;
    if ((pending.mode === "search" || pending.mode === "content" || pending.mode === "tag" || libraryPageForMode(pending.mode)) && !library.libraryLoaded) return;
    setHashViewApplied(true);
    const requestedPresentation = pending.presentation;
    const presentationUnavailable = pending.invalidPresentation || Boolean(requestedPresentation && libraryPageForMode(requestedPresentation) && !isLibraryViewEnabled(requestedPresentation, libraryViews.enabledViewIds));
    if (requestedPresentation && libraryPageForMode(requestedPresentation)) {
      view.setPresentationMode(isLibraryViewEnabled(requestedPresentation, libraryViews.enabledViewIds) ? requestedPresentation as "content" | LibraryPageMode : "content");
    }
    if (pending.mode === "search") {
      const text = pending.q.trim();
      if (!text) {
        markHashRestoreFailed();
        setNotice((current) => current ?? { kind: "error", text: t("Your view could not be restored. The original link is retained; search again or choose a view.") });
        return;
      }
      setQuery(text);
      const restoringWorkspace = workspaceID;
      const restoringGeneration = refreshGenerationRef.current;
      void search.runSearch(undefined, text).then((succeeded) => {
        if (hashRestoreSupersededRef.current) return;
        const stillCurrent = workspaceIDRef.current === restoringWorkspace && restoringGeneration === refreshGenerationRef.current;
        if (succeeded && stillCurrent) {
          library.setActiveTags(pending.tags);
          library.setActiveTimelineMonth(pending.month);
          hashRestoreFailedRef.current = false;
          setHashRestoreFailed(false);
          setHashRestoreComplete(true);
        } else {
          markHashRestoreFailed();
          if (stillCurrent) setNotice((current) => current ?? { kind: "error", text: t("Your view could not be restored. The original link is retained; search again or choose a view.") });
        }
        if (presentationUnavailable && succeeded && stillCurrent) showPresentationFallbackNotice(t("This presentation is unavailable. Showing all types for the same results."));
      });
      return;
    }
    if (pending.mode === "content" || pending.mode === "tag") {
      library.restoreLibraryHashView(pending.mode, pending.tags, pending.month);
      setHashRestoreComplete(true);
      if (presentationUnavailable) showPresentationFallbackNotice(t("This presentation is unavailable. Showing all types for the same results."));
      return;
    }
    if (libraryPageForMode(pending.mode)) { openLibrarySurface(pending.mode as LibraryPageMode); setHashRestoreComplete(true); return; }
    view.setViewMode(pending.mode);
    setHashRestoreComplete(true);
  }, [hashViewApplied, isConnected, library.libraryLoaded]);
  useEffect(() => {
    if (!hashRestoreComplete) return;
    const mode = libraryPageForMode(view.viewMode) ? "content" : view.viewMode;
    writeHashView({ mode, presentation: view.presentationMode, q: lastExecutedQuery, tags: library.activeTags, month: library.activeTimelineMonth });
  }, [hashRestoreComplete, lastExecutedQuery, library.activeTags, library.activeTimelineMonth, view.viewMode, view.presentationMode]);
  function completeUserNavigation() {
    hashRestoreSupersededRef.current = true;
    hashRestoreFailedRef.current = false;
    setHashRestoreFailed(false);
    setHashRestoreComplete(true);
    clearPresentationFallbackNotice();
  }
  function markHashRestoreFailed() {
    hashRestoreFailedRef.current = true;
    setHashRestoreFailed(true);
  }

  useEffect(() => { void refresh(); }, []);
  // The panel exists only below the compact boundary. A resize across it
  // closes the panel instead of leaving a stale open flag behind.
  useEffect(() => { if (!compactLayout) setRailOpen(false); }, [compactLayout]);
  // A selected subject that leaves the current listing is dropped instead of
  // being kept as a hidden member of the batch. Reordering (sorting) keeps the
  // same subjects and therefore the same selection.
  useEffect(() => {
    const visible = new Set(library.renderedHits.map((hit) => hit.subject_ref?.trim()).filter((value): value is string => Boolean(value)));
    selection.setSelectionRefs((current) => {
      const next = current.filter((subjectRef) => visible.has(subjectRef));
      return next.length === current.length ? current : next;
    });
  }, [library.renderedHits]);
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
    window.localStorage.setItem("cairn.locale", locale);
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
  function handleLibraryFileDrop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const directory = Array.from(event.dataTransfer.items).some((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.();
      return entry?.isDirectory === true;
    });
    if (directory) { setNotice({ kind: "warning", text: t("Folder drops are not supported. Choose individual files or use a server folder.") }); return; }
    if (!event.dataTransfer.files.length) return;
    if (isUnavailable) { setNotice({ kind: "error", text: t("Start the Cairn service before previewing this source.") }); return; }
    if (!coreStorageReady) { setNotice({ kind: "error", text: coreStorageMessage }); return; }
    if (drawerOpen || settingsOpen || busy || sources.planAction !== "IDLE" || sources.planCheckBusy) {
      setNotice({ kind: "warning", text: t("Finish the current source operation before uploading files.") });
      return;
    }
    setPendingUploadFiles(Array.from(event.dataTransfer.files));
    setNotice(undefined);
    sources.openAdd();
  }
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
    completeUserNavigation();
  }
  function openLibrarySurface(mode: "content" | LibraryPageMode) {
    const availableMode = isLibraryViewEnabled(mode, libraryViews.enabledViewIds) ? mode : "content";
    const currentPage = libraryPageForMode(view.presentationMode);
    const nextPage = libraryPageForMode(availableMode);
    const sameDomain = currentPage && nextPage && libraryPageRoot(currentPage)?.id === libraryPageRoot(nextPage)?.id;
    if ((view.viewMode === "search" || view.viewMode === "tag") && availableMode === "content") {
      if (view.presentationMode !== "content" && !drafts.canLeaveDetailDrafts()) return;
      if (view.presentationMode !== "content") { drafts.discardDetailDrafts(); selection.clearSelection(); }
      view.setPresentationMode("content");
      completeUserNavigation();
      return;
    }
    if (sameDomain) { view.setPresentationMode(availableMode); completeUserNavigation(); return; }
    if (view.viewMode === "search" || view.viewMode === "tag") {
      if (!drafts.canLeaveDetailDrafts()) return;
      drafts.discardDetailDrafts();
      selection.clearSelection();
      view.setPresentationMode(availableMode);
      completeUserNavigation();
      return;
    }
    if (library.showLibrarySurface(availableMode)) { view.setPresentationMode(availableMode); selection.clearSelection(); completeUserNavigation(); }
  }
  // The rail has one Library destination; its internal views stay local to the
  // already-loaded set, while a true return from other workspaces reloads it.
  function openLibrary(event: { currentTarget: EventTarget | null }) {
    if (libraryPageForMode(view.viewMode)) { openLibrarySurface("content"); return; }
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
    // The rail badge describes the library, so it shows the daemon's exact
    // total once a page has reported one, never the number of entries that
    // happen to be loaded in this browser.
    libraryCount={library.libraryTotal || library.libraryItems.length}
    sourceCount={sources.sources.length}
    onLibrary={selectRailView((event) => openLibrary(event))}
    onSources={selectRailView(library.showSourcesSurface)}
    onActivity={selectRailView(openActivity)}
    onDuplicates={selectRailView(() => view.setViewMode("duplicates"))}
    onTags={selectRailView(() => view.setViewMode("tags"))}
    onNotes={selectRailView(() => view.setViewMode("notes"))}
    activityRef={activityRailRef}
    duplicatesRef={duplicatesRailRef}
    tagsRef={tagsRailRef}
    notesRef={notesRailRef}
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

  return <div className="app-shell client-host">
    <InterfaceRenderBoundary
      interfaceId={appearance.preference.interfaceId}
      immersive={activePresentationPage?.chrome === "immersive"}
      focused={focusedChrome}
      onFallbackToWorkspace={() => appearance.updatePreference({ ...appearance.preference, interfaceId: "workspace" })}
      onOpenSettings={(trigger) => openSettings(trigger)}
      header={<TopBar
        t={t}
        onHome={() => openLibrarySurface("content")}
        query={query}
        busy={busy}
        status={status}
        statusData={statusData}
        capabilities={capabilities}
        isConnected={isConnected}
        coreStorageReady={coreStorageReady}
        catalogHealthy={catalogHealthy}
        snapshotRef={snapshotRef}
        search={topBarSearch}
        compact={compactLayout}
        focused={focusedChrome}
        destinationHeader
        presentationNavigation={<LibraryPresentationNavigation t={t} mode={headerDestination} enabledPageIds={libraryViews.enabledViewIds} onNavigate={openLibrarySurface} variant="domains" />}
        navigation={rail}
        onOpenRail={openRail}
        railTriggerRef={railTriggerRef}
        onRefresh={() => void refresh()}
        onOpenRestore={(trigger) => restore.openRestore(trigger)}
        onOpenAdd={(_, trigger) => addSource(trigger)}
        onOpenSettings={(trigger) => openSettings(trigger)}
        onOpenVerification={(trigger) => { rememberDrawerTrigger(trigger); setVerificationOpen(true); }}
        onOpenActivity={openActivity}
        canLeaveSettings={settings.canLeaveSettings}
      />}
      navigation={rail}
      content={<>
        {view.viewMode === "duplicates" ? <DuplicatesSurface t={t} /> : view.viewMode === "tags" ? <TagsSurface t={t} /> : view.viewMode === "notes" ? <NotesSurface
          t={t}
          locale={locale}
          workspaceID={workspaceID}
          onOpenSubject={(hit) => void details.loadDetails(hit)}
        /> : view.viewMode === "activity" ? <ActivitySurface
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
          enabledViews={libraryViews.enabledViewIds}
          onLibraryView={openLibrarySurface}
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
          scopeRestoring={scopeRestoring}
          scopeRestoreFailed={hashRestoreFailed}
          originalTakeoutBusy={originalTakeoutBusy}
          onDownloadOriginals={(subjects) => { void originalTakeout.start(resolveArchiveSelectionSizes(subjects, library.libraryItems)); }}
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
          onFocusSearch={() => search.focusSearchField()}
          libraryListRef={libraryListRef}
          onPlayTrack={(track) => void audioPlayback.play(track)}
          onQueueTrack={audioPlayback.addToQueue}
          onPlayTracks={(tracks) => { void audioPlayback.playQueue(tracks); }}
          musicMetadata={musicMetadata}
          favoriteControls={favoriteControls}
          musicQueueControls={{ count: audioPlayback.queue.length, addTracks: (tracks) => { audioPlayback.addTracksToQueue(tracks); }, addNext: (track) => { audioPlayback.addNextToQueue(track); }, show: audioPlayback.showQueue }}
          focusedSubjectRef={focusedSubjectRef}
          onFocusSubject={setFocusedSubjectRef}
          retrievalFlow={exportFlow}
        />}
      </>}
      details={selected && <DetailsPanel
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
      compact={compactLayout}
      detailActive={Boolean(selected)}
      empty={showFirstSource}
      t={t}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={handleLibraryFileDrop}
    />
    <AudioPlayer playback={audioPlayback} t={t} onOpenDetails={(track) => { const hit = library.libraryItems.find((item) => item.entry_id === track.entryID); if (hit) void details.loadDetails(hit); }} />
    <OriginalTakeoutStatus takeout={originalTakeout} t={t} />
    {compactLayout && !focusedChrome && railOpen && railPanel}
    {settingsOpen && <SettingsDialog
      t={t}
      locale={locale}
      settings={settings}
      appearance={appearance}
      libraryViews={libraryViews}
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
      pendingFiles={pendingUploadFiles}
      onPendingFilesConsumed={() => setPendingUploadFiles([])}
      onStaged={() => void refresh()}
      onClose={sources.closeAdd}
      onDone={() => { sources.closeAdd(); openLibrarySurface("content"); reloadLibrary(); }}
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

bootstrapAppearance();
const rootElement = document.getElementById("root")! as HTMLElement & { cairnRoot?: ReturnType<typeof createRoot> };
const root = rootElement.cairnRoot ?? createRoot(rootElement);
rootElement.cairnRoot = root;
root.render(<App />);
