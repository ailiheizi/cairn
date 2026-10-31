import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { createRoot } from "react-dom/client";
import { createTranslator, resolveInitialLocale } from "./i18n";
import type { Locale, Translator } from "./i18n";
import { command } from "./app/command";
import { endpoints, operations } from "./lib/operations";
import { parseHashView, writeHashView } from "./lib/hashView";
import { parseSearchQuery } from "./lib/searchops";
import { isTextEntryTarget, useSearch } from "./app/useSearch";
import { useSettings } from "./app/useSettings";
import { useRecents } from "./app/useRecents";
import { useViewMode } from "./app/useViewMode";
import { captureActiveBrowsePosition, markActiveBrowsePositionPending, ClientBrowseSessionProvider, createBrowsePositionRegistry } from "./app/ClientBrowseSession";
import { useAppearance } from "./app/useAppearance";
import { useLibraryViews } from "./app/useLibraryViews";
import { bootstrapAppearance } from "./lib/appearance";
import { enabledLibraryPageGroups, isLibraryViewEnabled, libraryPageForMode, libraryPageRoot } from "./lib/libraryViews";
import { transitionContentSpace, type ContentSpaceKey } from "./lib/contentSpaceTransition";
import { useCompactLayout } from "./app/useCompactLayout";
import { useLibraryDrafts } from "./app/useLibraryDrafts";
import { useLibrary } from "./app/useLibrary";
import { useDetails } from "./app/useDetails";
import { useSelection } from "./app/useSelection";
import { useSources } from "./app/useSources";
import { useRestore } from "./app/useRestore";
import { useExport } from "./app/useExport";
import { useSavedViews } from "./app/useSavedViews";
import { useAudioPlayback } from "./app/useAudioPlayback";
import type { AudioQueueEntry } from "./lib/audioPlayback";
import { useMusicMetadata } from "./app/useMusicMetadata";
import { useFavorites } from "./app/useFavorites";
import { useOriginalTakeout } from "./app/useOriginalTakeout";
import { useMaterialOrganizer } from "./app/useMaterialOrganizer";
import { formatFacetValue, mediaClassFromSuffix } from "./lib/format";
import { resolveArchiveSelectionSizes } from "./lib/originalArchive";
import { projectMaterialListActions, type MaterialListAction } from "./lib/materialListActions";
import { downloadOriginal } from "./lib/contentDownload";
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
import { SpaceAssistant, type SpaceAssistantHandle } from "./components/SpaceAssistant";
import { MaterialListComposer } from "./components/material/MaterialListComposer";
import { MATERIAL_LIST_LIMITS, type MaterialListDocument } from "./lib/materialList";
import "./styles/index.css";
import "./components/PrivateSpaceShell.css";
import "./styles/content-space-transition.css";
import "antd/dist/reset.css";
import type { ActionFeedback, LibraryPageMode, Notice, SavedViewData, SearchHit, SnapshotSummary, SourceSummary, UploadFileRow, ViewMode } from "./lib/types";

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

type MaterialListComposerHostProps = {
  t: Translator;
  workspaceID: string;
  subjects: SearchHit[];
  catalogItems: SearchHit[];
  initialDocument?: MaterialListDocument;
  busy: boolean;
  onClose: () => void;
  onSaveFiles: (files: File[], document: MaterialListDocument, signal: AbortSignal) => boolean | Promise<boolean>;
  onPreviewResult?: (document: MaterialListDocument) => void;
};

function MaterialListComposerHost(props: MaterialListComposerHostProps) {
  const organizer = useMaterialOrganizer(props.workspaceID, props.t);
  return <MaterialListComposer {...props} organizer={organizer} />;
}

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
  // Reopening the same subject is still a new navigation/focus request.
  const [mediaFocusRequest, setMediaFocusRequest] = useState(0);
  useEffect(() => { setFocusedSubjectRef(""); }, [workspaceID]);
  const [addOpen, setAddOpen] = useState(false);
  const addOpenRef = useRef(addOpen);
  addOpenRef.current = addOpen;
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const assistantRef = useRef<SpaceAssistantHandle>(null);
  const [materialListEditor, setMaterialListEditor] = useState<{ workspaceID: string; subjects: SearchHit[]; initialDocument?: MaterialListDocument }>();
  useEffect(() => { setMaterialListEditor(undefined); }, [workspaceID]);
  const pendingPasteFilesRef = useRef(false);
  const mainPagePasteHandlerRef = useRef<(event: ClipboardEvent) => void>(() => {});
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
  const notesReturnScopeRef = useRef<{
    workspaceID: string;
    refreshGeneration: number;
    scopeViewMode: ViewMode;
    scopeHits: SearchHit[];
    identity: string;
  } | undefined>(undefined);
  // Capture the invoking control before React changes the surface. This keeps
  // close/escape dismissal predictable when a page-level surface unmounts the
  // normal library controls.
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const railTriggerRef = useRef<HTMLButtonElement | null>(null);
  const libraryListRef = useRef<HTMLDivElement | null>(null);
  const browsePositionRegistryRef = useRef(createBrowsePositionRegistry());
  const browseSessionScopeRef = useRef("");
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
  // export, verification, material-list composer, and workspace-rail surfaces
  // participate in the modal focus trap and body lock.
  const materialListEditorOpen = Boolean(materialListEditor && materialListEditor.workspaceID === workspaceID);
  const drawerOpen = addOpen || restoreOpen || exportOpen || verificationOpen || materialListEditorOpen || (compactLayout && railOpen);
  const drawerKind = addOpen ? "add" : restoreOpen ? "restore" : exportOpen ? "export" : verificationOpen ? "verification" : materialListEditorOpen ? "material-list" : railOpen ? "rail" : "closed";

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
        if (!isCurrentRefresh()) return;
        const snapshotRows = snapshotResult.status === "fulfilled" ? snapshotResult.value.data?.snapshots : undefined;
        const confirmedEmptyBeforeFirstPublication =
          nextCoreStorageReady &&
          statusResponse.status === "SUCCEEDED" &&
          nextStatusData?.repository?.snapshots === 0 &&
          snapshotResult.status === "fulfilled" &&
          snapshotResult.value.status === "SUCCEEDED" &&
          Array.isArray(snapshotRows) &&
          snapshotRows.length === 0;
        if (confirmedEmptyBeforeFirstPublication) {
          // A cold profile with a prepared ingest plan has a real workspace but
          // no published catalog contents yet. Keep the source review and
          // workspace intact; only clear the empty library projection instead
          // of asking content.list for a namespace that does not exist yet.
          library.resetLibraryProjection();
          return;
        }
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
  const scopeViewMode: ViewMode = view.viewMode === "notes" ? notesReturnScopeRef.current?.scopeViewMode ?? "content" : view.viewMode;
  const library = useLibrary({ t, locale, workspaceID, refreshGenerationRef, viewMode: view.viewMode, scopeViewMode, presentationMode: view.presentationMode, selected, setViewMode: view.setViewMode, setPresentationMode: view.setPresentationMode, sortField: view.sortField, sortDirection: view.sortDirection, setQuery, setLastExecutedQuery, setSelected, setBusy, notify: setNotice, canLeaveDetailDrafts: drafts.canLeaveDetailDrafts, hasDetailDrafts: drafts.detailDraftIsDirty, detailDraftFingerprint: drafts.detailDraftFingerprint, discardDetailDrafts: drafts.discardDetailDrafts });
  const details = useDetails({ t, workspaceID, selected, setSelected, drafts, library, browsePositionRegistry: browsePositionRegistryRef.current, getBrowseContextIdentity: () => JSON.stringify([workspaceID, browseSessionScopeRef.current, view.viewMode, view.presentationMode]), annotationStorageReady, catalogStorageMessage, refreshCapabilities, busy, setBusy, notify: setNotice });
  const selection = useSelection({ t, workspaceID, hits: library.scopeHits, renderedHits: library.renderedHits, selected, details, library, annotationStorageReady, catalogStorageMessage, refreshCapabilities, setBusy, notify: setNotice, libraryListRef });
  const selectedIdentityRef = useRef("");
  selectedIdentityRef.current = selected ? JSON.stringify([selected.subject_ref, selected.entry_id, selected.content_id]) : "";
  const selectionRefsRef = useRef(selection.selectionRefs);
  selectionRefsRef.current = selection.selectionRefs;
  const currentViewModeRef = useRef(view.viewMode);
  currentViewModeRef.current = view.viewMode;
  const currentPresentationModeRef = useRef(view.presentationMode);
  currentPresentationModeRef.current = view.presentationMode;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const selectionChangeRef = useRef(selection.changeScopeSelection);
  selectionChangeRef.current = selection.changeScopeSelection;
  const sources = useSources({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, isUnavailable, busy, setBusy, notify: setNotice, refresh, refreshGenerationRef, lastPlannedSource: recents.lastPlannedSource, rememberLastSourcePath: recents.rememberLastSourcePath, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, closeDrawers: () => { setRestoreOpen(false); setExportOpen(false); setSettingsOpen(false); }, setAddOpen, library, rememberWorkspace });
  const sourcePlanIDRef = useRef(String(sources.plan?.plan_id ?? ""));
  sourcePlanIDRef.current = String(sources.plan?.plan_id ?? "");
  const pendingSavedSourceOpenRef = useRef<{ workspaceID: string; planID: string; uploadBatch?: { stagingDir: string; rows: UploadFileRow[]; receiptComplete: boolean } } | undefined>(undefined);
  const restore = useRestore({ t, snapshotRef, isConnected, coreStorageReady, coreStorageMessage, isUnavailable, busy, setBusy, notify: setNotice, pushRecentDestination: recents.pushRecentDestination, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, closeDrawers: () => { setAddOpen(false); sources.setRecheckSourceRef(""); setExportOpen(false); setSettingsOpen(false); }, setRestoreOpen });
  const savedViewFlow = useSavedViews({ t, workspaceID, viewMode: view.viewMode, lastExecutedQuery, library, selection, drafts, setQuery, setLastExecutedQuery, setSelected, setViewMode: view.setViewMode, setBusy, notify: setNotice, canLeaveSettings: settings.canLeaveSettings, canLeaveDetailDrafts: drafts.canLeaveDetailDrafts });
  const exportFlow = useExport({ t, workspaceID, isConnected, coreStorageReady, coreStorageMessage, exportOpen, viewMode: view.viewMode, presentationMode: view.presentationMode, lastExecutedQuery, activeTags: library.activeTags, activeSystemFacets: library.activeSystemFacets, activeTimelineMonth: library.activeTimelineMonth, selected, selection, library, savedViews: savedViewFlow, setBusy, notify: setNotice, canLeaveSettings: settings.canLeaveSettings, rememberDrawerTrigger, closeOtherDrawers: () => { setAddOpen(false); sources.setRecheckSourceRef(""); setRestoreOpen(false); setSettingsOpen(false); }, setExportOpen });
  const search = useSearch({ t, query, setQuery, setLastExecutedQuery, workspaceID, refreshGeneration: refreshGenerationRef.current, viewMode: view.viewMode, isConnected, catalogHealthy, catalogStorageMessage, drawerOpen, settingsOpen, setBusy, notify: setNotice, markConnected: () => setStatus("Connected"), recents, drafts, canLeaveSettings: settings.canLeaveSettings, exportFlow, library, setSelected, setViewMode: view.setViewMode, clearSelection: selection.clearSelection });
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
  const searchNotesTextInLibrary = (literalText: string) => {
    const text = literalText.trim();
    if (!text || !workspaceID) return;
    // The ordinary search field treats parsed predicates and malformed
    // operator attempts as grammar. Quote those Notes strings as one literal
    // phrase, using a delimiter absent from the input because searchops has no
    // escape syntax for embedded quotes.
    let query = text;
    const parsedText = parseSearchQuery(text);
    if (parsedText.predicates.length || parsedText.errors.length) {
      const quote = !text.includes('"') ? '"' : !text.includes("'") ? "'" : "";
      if (!quote) {
        setNotice({ kind: "warning", text: t("This text contains both quote marks and cannot be sent as a literal Library search.") });
        return;
      }
      query = `${quote}${text}${quote}`;
      const parsedLiteral = parseSearchQuery(query);
      if (parsedLiteral.predicates.length || parsedLiteral.errors.length) {
        setNotice({ kind: "warning", text: t("This text cannot be safely sent as a literal Library search.") });
        return;
      }
    }
    // Update the visible field and submit the explicit value in the same turn;
    // runSearch never reads the previous render's query closure here.
    search.handleSearchFieldChange(query);
    void topBarSearch.runSearch(undefined, query);
  };
  const audioPlayback = useAudioPlayback(workspaceID);
  // Recorded audio facts feed exactly two presentations: the Music page and the
  // private-space homepage. `audio.list` walks every admitted processor
  // artifact the workspace holds, so defer it until a presentation that uses
  // the facts is selected. The Music page already reports the
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
  // Only loaded content browse scopes receive the shared content-space shell.
  // Workspace views (sources/activity/Tags/Notes/duplicates) retain their own
  // frame and rail even when a domain presentation is still remembered.
  const activePresentationPage = (view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag" || Boolean(libraryPageForMode(view.viewMode))) ? libraryPageForMode(view.presentationMode) : undefined;
  // Page metadata controls the content frame and rail ownership. Every host
  // destination shares the same header; management screens belong to Library
  // even when a domain presentation is remembered.
  const focusedChrome = activePresentationPage?.composition === "focused";
  const contentSpace = view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag" || view.viewMode === "path" || Boolean(libraryPageForMode(view.viewMode));
  const privateSpaceHome = contentSpace && activePresentationPage?.id === "cairn:overview";
  const contentSpaceDestination = privateSpaceHome ? "Home" : activePresentationPage?.mediaClass === "image" ? "Photos" : activePresentationPage?.mediaClass === "audio" ? "Music" : activePresentationPage?.mediaClass === "video" ? "Videos" : "Library";
  const headerDestination = activePresentationPage || view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag" || view.viewMode === "path" ? view.presentationMode : "content";
  // Domain-page choices belong to the current shared result context, never to
  // its Photos/Music rendering. Management screens leave that context intact.
  if (view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag" || view.viewMode === "path" || libraryPageForMode(view.viewMode)) {
    browseSessionScopeRef.current = JSON.stringify([
      view.viewMode === "search" ? "search" : view.viewMode === "path" ? "path" : "library",
      view.viewMode === "search" ? lastExecutedQuery : "",
      search.visualSearchContext?.key ?? "",
      [...library.activeTags].sort(), library.activeSystemFacets,
      library.activeTimelineMonth, library.browseRootID,
      library.browseCrumbs.map((crumb) => crumb.entry_id || crumb.subject_ref),
    ]);
  }
  useEffect(() => {
    // Photos/Music own a stable subject bookmark and restore it when their
    // registered page mounts. Other host roots keep the ordinary top reset.
    if (presentationRoot?.mediaClass === "image" || presentationRoot?.mediaClass === "audio") return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [presentationRoot?.mediaClass, presentationRootKey]);

  // Hiding a library lens changes presentation only. Keep the inspected subject
  // and its unsaved Notes intact while restoring the shared loaded listing.
  useEffect(() => {
    if (isLibraryViewEnabled(view.presentationMode, libraryViews.enabledViewIds)) return;
    view.setPresentationMode("content");
    showPresentationFallbackNotice(t("This presentation is disabled. Showing all types for the same results."));
  }, [view.presentationMode, libraryViews.enabledViewIds]);

  // The URL hash is a browser-local deep link over the library's projection
  // state (view mode, including the photo/music lenses, submitted search text,
  // active tag facets, and timeline month). It is read once on mount and restored after the daemon's
  // first content listing arrived — restoring a search re-runs that query, so
  // the restored view is always derived from the daemon, never from the hash.
  // Every later change replaces the hash (replaceState, never pushState), so
  // a refresh lands where the user was without spamming session history.
  const pendingHashView = useRef(parseHashView(window.location.hash.replace(/^#/, "")
    ? window.location.hash
    : isLibraryViewEnabled("page:cairn:overview", libraryViews.enabledViewIds)
      ? "#v=content&presentation=overview"
      : ""));
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
    if (library.hasCurrentSearchIntent(workspaceID)) {
      hashRestoreSupersededRef.current = true;
      setHashViewApplied(true);
      setHashRestoreComplete(true);
      return;
    }
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
  }, [hashViewApplied, isConnected, library.hasCurrentSearchIntent, library.libraryLoaded, workspaceID]);
  useEffect(() => {
    if (!hashRestoreComplete) return;
    const mode = libraryPageForMode(view.viewMode) ? "content" : view.viewMode;
    writeHashView({ mode, presentation: view.presentationMode, q: lastExecutedQuery, tags: library.activeTags, month: library.activeTimelineMonth });
  }, [hashRestoreComplete, lastExecutedQuery, library.activeTags, library.activeTimelineMonth, view.viewMode, view.presentationMode]);
  const navigationEpochRef = useRef(0);
  function completeUserNavigation() {
    navigationEpochRef.current += 1;
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
        if (assistantRef.current && document.querySelector(".cairn-content-space")) assistantRef.current.focus(); else search.focusSearchField();
        return;
      }
      if (event.key === "/" && !modifier && !event.altKey && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        if (assistantRef.current && document.querySelector(".cairn-content-space")) assistantRef.current.focus(); else search.focusSearchField();
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
      const requestedInitialFocus = drawer?.querySelector<HTMLElement>('[data-drawer-initial-focus="true"]');
      const firstField = requestedInitialFocus ?? drawer?.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [autofocus]');
      const first = firstField ?? drawer?.querySelector<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      first?.focus();
    };
    requestAnimationFrame(focusFirstControl);
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (materialListEditorOpen) setMaterialListEditor(undefined);
        else if (addOpen) sources.closeAdd(); else { setRailOpen(false); setSettingsOpen(false); setRestoreOpen(false); setExportOpen(false); setVerificationOpen(false); }
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
  }, [drawerOpen, drawerKind, addOpen, materialListEditorOpen, sources.planAction, sources.planCheckBusy]);

  function mediaDestinationForHit(hit: SearchHit) {
    if (hit.entry_type !== "REGULAR_FILE") return undefined;
    const mediaClass = mediaClassFromSuffix(formatFacetValue(hit));
    if (!mediaClass) return undefined;
    const group = enabledLibraryPageGroups(libraryViews.enabledViewIds).find(candidate => candidate.root.navigationKind !== "layout" && candidate.root.mediaClass === mediaClass);
    return group?.presentations.find(page => page.id === group.root.id)?.mode ?? group?.presentations[0]?.mode;
  }
  function searchEntryHint(hit: SearchHit) {
    return mediaDestinationForHit(hit) && !library.scopeHits.some(item => item.subject_ref === hit.subject_ref)
      ? t("Opens this search in its dedicated page") : undefined;
  }
  async function inspectFloatingMatch(hit: SearchHit): Promise<boolean> {
    const subject = hit.subject_ref?.trim();
    if (!subject || busy || drawerOpen || settingsOpen || sourceIntakeIsPending() || !isConnected || !coreStorageReady) return false;
    const requestedWorkspace = workspaceID;
    if (selected?.subject_ref?.trim() === subject) {
      if (selected.entry_id !== hit.entry_id || selected.content_id !== hit.content_id
        || (selected.logical_size != null && hit.logical_size != null && selected.logical_size !== hit.logical_size)) return false;
      // Refresh only the explicitly requested search evidence. Keep live Notes
      // and unsaved edits in the existing subject-bound inspector lifecycle.
      setSelected({ ...selected, segments: hit.segments });
      return true;
    }
    await details.loadDetails(hit);
    return workspaceIDRef.current === requestedWorkspace && details.detailSubjectRef.current === subject;
  }
  async function openLibraryEntry(hit: SearchHit, resultQuery?: string) {
    if (hit.entry_type === "REGULAR_FILE" && hit.name?.toLowerCase().endsWith(".cairn-list.json")) { assistantRef.current?.openList(hit); return; }
    if (hit.entry_type === "REGULAR_FILE") {
      const destination = mediaDestinationForHit(hit);
      if (destination && hit.subject_ref) {
        if (library.scopeHits.some(item => item.subject_ref === hit.subject_ref)) {
          openLibrarySurfaceAnimated(destination, hit); return;
        }
        if (resultQuery?.trim()) {
          let fresh: SearchHit | undefined;
          let accepted = false;
          let cancelled = false;
          const navigationEpoch = navigationEpochRef.current;
          const requestedWorkspace = workspaceID;
          const ok = await search.runSearch(undefined, resultQuery, undefined, hits => {
            if (navigationEpochRef.current !== navigationEpoch || workspaceIDRef.current !== requestedWorkspace) { cancelled = true; return false; }
            accepted = true;
            fresh = hits.find(candidate => candidate.subject_ref === hit.subject_ref
              && candidate.content_id === hit.content_id && candidate.logical_size === hit.logical_size);
            return Boolean(fresh);
          });
          if (cancelled) return;
          if (!ok || !fresh) {
            if (accepted) setNotice({ kind: "warning", text: t("This result changed or is no longer returned. Search again; your previous view is unchanged.") });
            return false;
          }
          setQuery(resultQuery.trim());
          openLibrarySurfaceAnimated(destination, fresh); return;
        }
      }
    }
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
    void openLibraryEntry(hit);
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
  function materialListActionsDisabledReason() {
    if (!workspaceID || !isConnected) return t("Connect to Cairn before using a saved list.");
    if (isUnavailable) return t("Start the Cairn service before using a saved list.");
    if (!coreStorageReady || !library.libraryLoaded) return coreStorageMessage || t("The content library is not ready for saved-list actions.");
    if (drawerOpen || settingsOpen) return t("Close the current panel before using a saved list.");
    if (sourceIntakeIsPending() || originalTakeoutBusy) return t("Wait until the current operation finishes before using a saved list.");
    return "";
  }
  async function recallFloatingSavedSearch(saved: SavedViewData): Promise<boolean | undefined> {
    if (busy || drawerOpen || settingsOpen || sourceIntakeIsPending() || !isConnected
      || !coreStorageReady || saved.scope !== workspaceID) return false;
    completeUserNavigation();
    const epoch = navigationEpochRef.current, requestedWorkspace = workspaceID;
    const outcome = await savedViewFlow.recallSavedView(saved, () => navigationEpochRef.current === epoch && workspaceIDRef.current === requestedWorkspace);
    if (outcome.kind === "stale" || navigationEpochRef.current !== epoch || workspaceIDRef.current !== requestedWorkspace) return undefined;
    if (outcome.kind === "failure") throw new Error(outcome.message);
    view.setPresentationMode("content");
    return true;
  }
  async function browseFloatingSearch(text: string): Promise<boolean | undefined> {
    if (busy || drawerOpen || settingsOpen || sourceIntakeIsPending() || !isConnected || !coreStorageReady || !workspaceID) return false;
    completeUserNavigation();
    const epoch = navigationEpochRef.current, requestedWorkspace = workspaceID;
    let superseded = false;
    const succeeded = await search.runSearch(undefined, text, undefined, () => {
      if (navigationEpochRef.current !== epoch || workspaceIDRef.current !== requestedWorkspace) { superseded = true; return false; }
      return true;
    });
    if (superseded || navigationEpochRef.current !== epoch || workspaceIDRef.current !== requestedWorkspace) return undefined;
    if (!succeeded) return false;
    setQuery(text.trim());
    view.setPresentationMode("content");
    return true;
  }
  function useMaterialList(document: MaterialListDocument, action: MaterialListAction, trigger?: EventTarget | null) {
    const capturedWorkspaceID = workspaceID;
    if (!capturedWorkspaceID || workspaceIDRef.current !== capturedWorkspaceID) return;
    const blockedReason = materialListActionsDisabledReason();
    if (blockedReason) { setNotice({ kind: "warning", text: blockedReason }); return; }
    if (!settings.canLeaveSettings()) return;
    const projection = projectMaterialListActions(document, library.libraryItems, capturedWorkspaceID);
    if (!projection.ready || projection.unavailableCount > 0) {
      setNotice({ kind: "warning", text: t("Whole-list actions are unavailable while {{count}} item(s) are unresolved in the loaded scope.", { count: projection.unavailableCount }) });
      return;
    }
    if (action === "play" || action === "queue") {
      if (!projection.tracks.length) {
        setNotice({ kind: "warning", text: t("No supported audio is available in this list.") });
        return;
      }
      const result = action === "play" ? audioPlayback.playQueue(projection.tracks) : audioPlayback.addTracksToQueue(projection.tracks);
      if (result.reason === "queue-limit") setNotice({ kind: "warning", text: t("The queue limit is 1,000 entries; existing queue and playback were left unchanged.") });
      else if (result.reason === "no-supported-tracks") setNotice({ kind: "warning", text: t("No tracks from this set could be queued; the current queue and playback were left unchanged.") });
      return;
    }
    if (!projection.originals.length) {
      setNotice({ kind: "warning", text: t("No original files are available for this list action.") });
      return;
    }
    const originals = resolveArchiveSelectionSizes(projection.originals, library.libraryItems);
    if (action === "download") {
      void originalTakeout.start(originals);
      return;
    }
    exportFlow.openExport(trigger, originals);
  }
  function openMaterialListEditor(subjects: SearchHit[], initialDocument?: MaterialListDocument) {
    if (!workspaceID || !isConnected || isUnavailable || !coreStorageReady || !library.libraryLoaded
      || drawerOpen || settingsOpen || sourceIntakeIsPending()) {
      const message = !workspaceID || !isConnected
        ? t("Connect to Cairn before saving text as a file.")
        : isUnavailable
          ? t("Start the Cairn service before saving text as a file.")
          : !coreStorageReady || !library.libraryLoaded
            ? coreStorageMessage || t("The content library is not ready for saving text as a file.")
            : drawerOpen || settingsOpen
              ? t("Close the current panel before opening the text file composer.")
              : t("Wait until the current operation finishes before opening the text file composer.");
      setNotice({ kind: "warning", text: message });
      return;
    }
    if (!settings.canLeaveSettings() || !drafts.canLeaveDetailDrafts()) return;
    if (drafts.detailDraftIsDirty()) drafts.discardDetailDrafts();
    rememberDrawerTrigger();
    setMaterialListEditor({ workspaceID, subjects: [...subjects], ...(initialDocument ? { initialDocument } : {}) });
  }
  function saveQueueAsMaterialList(queue: AudioQueueEntry[]) {
    if (!queue.length) return;
    if (queue.length > MATERIAL_LIST_LIMITS.items) {
      setNotice({ kind: "warning", text: t("A material list can contain at most 200 selected items; no list was created.") });
      return;
    }
    const subjects: SearchHit[] = [];
    for (const occurrence of queue) {
      const hint = occurrence.sourceHit;
      if (occurrence.workspaceID !== workspaceID || !hint?.subject_ref?.trim()) {
        setNotice({ kind: "warning", text: t("The queue contains an occurrence that cannot be matched to the current loaded catalog; no list was created.") });
        return;
      }
      const exact = library.libraryItems.find((hit) => hit.entry_type === "REGULAR_FILE"
        && hit.entry_id === occurrence.entryID && hit.content_id === occurrence.contentID
        && hit.logical_size === occurrence.logicalSize && hit.subject_ref === hint.subject_ref);
      if (!exact) {
        setNotice({ kind: "warning", text: t("The queue contains an occurrence that cannot be matched to the current loaded catalog; no list was created.") });
        return;
      }
      subjects.push(exact);
    }
    openMaterialListEditor(subjects);
  }
  function saveMaterialListFiles(files: File[], capturedWorkspaceID: string) {
    if (workspaceIDRef.current !== capturedWorkspaceID || !files.length || !isConnected || isUnavailable || !coreStorageReady
      || settingsOpen || addOpen || restoreOpen || exportOpen || verificationOpen || sourceIntakeIsPending()) {
      setNotice({ kind: "warning", text: t("Finish the current source operation before uploading files.") });
      return false;
    }
    setMaterialListEditor(undefined);
    pendingPasteFilesRef.current = true;
    setPendingUploadFiles(files);
    setNotice(undefined);
    sources.openAdd();
    return true;
  }
  function notesTextFileEntryDisabledReason() {
    if (!isConnected) return t("Connect to Cairn before saving text as a file.");
    if (isUnavailable) return t("Start the Cairn service before saving text as a file.");
    if (!coreStorageReady) return coreStorageMessage || t("The content library is not ready for saving text as a file.");
    if (drawerOpen) return t("Close the current panel before opening the text file composer.");
    if (sourceIntakeIsPending()) return t("Wait until the current operation finishes before opening the text file composer.");
    return "";
  }
  function openNotesTextFileComposer(trigger?: EventTarget | null) {
    const blockedReason = notesTextFileEntryDisabledReason();
    if (blockedReason) { setNotice({ kind: "warning", text: blockedReason }); return; }
    sources.openAdd(undefined, trigger, {
      openTextComposer: true,
      beforeOpen: () => {
        if (!drafts.canLeaveDetailDrafts()) return false;
        if (drafts.detailDraftIsDirty()) drafts.discardDetailDrafts();
        return true;
      },
    });
  }
  function sourceIntakeIsPending() {
    const completedPlan = sources.planAction === "SUCCEEDED"
      && sources.plan?.state === "SUCCEEDED"
      && !sources.plan.awaiting_confirmation
      && sources.plan.executable !== true;
    return busy || (sources.planAction !== "IDLE" && !completedPlan)
      || sources.planCheckBusy || Boolean(sources.plan && !completedPlan)
      || sources.pastedTextDraft.locked || sources.pastedTextDraft.receiving
      || sources.uploadDraft.receiving || sources.uploadDraft.files.length > 0 || sources.uploadDraft.rows.length > 0
      || pendingPasteFilesRef.current || pendingUploadFiles.length > 0;
  }
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
    if (drawerOpen || settingsOpen || sourceIntakeIsPending()) {
      setNotice({ kind: "warning", text: t("Finish the current source operation before uploading files.") });
      return;
    }
    pendingPasteFilesRef.current = true;
    setPendingUploadFiles(Array.from(event.dataTransfer.files));
    setNotice(undefined);
    sources.openAdd();
  }
  function handleMainPagePaste(event: ClipboardEvent) {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const files = Array.from(clipboardData.files);
    if (!files.length) return;
    const target = event.target;
    if (isTextEntryTarget(target) || (target instanceof HTMLElement && target.closest('dialog, [role="dialog"]'))) return;
    const libraryMainView = view.viewMode === "content" || view.viewMode === "path" || view.viewMode === "search" || view.viewMode === "tag" || Boolean(libraryPageForMode(view.viewMode));
    if (!libraryMainView || drawerOpen || settingsOpen || document.querySelector('[aria-modal="true"]')) return;

    event.preventDefault();
    event.stopPropagation();
    const directory = Array.from(clipboardData.items).some((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.();
      return entry?.isDirectory === true;
    });
    if (directory) { setNotice({ kind: "warning", text: t("Folders cannot be pasted. Choose individual files or use a server folder.") }); return; }
    if (isUnavailable) { setNotice({ kind: "error", text: t("Start the Cairn service before previewing this source.") }); return; }
    if (!coreStorageReady) { setNotice({ kind: "error", text: coreStorageMessage }); return; }
    if (sourceIntakeIsPending()) {
      setNotice({ kind: "warning", text: t("Finish the current source operation before pasting files.") });
      return;
    }
    pendingPasteFilesRef.current = true;
    setPendingUploadFiles(files);
    setNotice(undefined);
    sources.openAdd();
  }
  mainPagePasteHandlerRef.current = handleMainPagePaste;
  useEffect(() => {
    const listener = (event: ClipboardEvent) => mainPagePasteHandlerRef.current(event);
    document.addEventListener("paste", listener);
    return () => document.removeEventListener("paste", listener);
  }, []);
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
    library.cancelSearchIntent();
    drafts.discardDetailDrafts();
    setSelected(undefined);
    view.setViewMode("activity");
    completeUserNavigation();
  }
  function openLibrarySurface(mode: "content" | LibraryPageMode) {
    captureActiveBrowsePosition(browsePositionRegistryRef.current);
    const availableMode = isLibraryViewEnabled(mode, libraryViews.enabledViewIds) ? mode : "content";
    const currentLoadedScope = view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag" || view.viewMode === "path" || Boolean(libraryPageForMode(view.viewMode));
    if (currentLoadedScope) {
      if (libraryPageForMode(view.viewMode) || availableMode !== view.presentationMode) {
        markActiveBrowsePositionPending(browsePositionRegistryRef.current);
      }
      if (libraryPageForMode(view.viewMode)) view.setViewMode("content");
      view.setPresentationMode(availableMode);
      completeUserNavigation();
      return;
    }
    if (library.showLibrarySurface(availableMode)) { view.setPresentationMode(availableMode); selection.clearSelection(); completeUserNavigation(); }
  }
  function contentSpaceKeyForMode(mode: "content" | LibraryPageMode): ContentSpaceKey | undefined {
    if (mode === "content") return "library";
    const page = libraryPageForMode(mode);
    if (page?.id === "cairn:overview") return "home";
    if (page?.mediaClass === "image") return "photos";
    if (page?.mediaClass === "audio") return "music";
    if (page?.mediaClass === "video") return "videos";
    return undefined;
  }
  function currentContentSpaceKey(): ContentSpaceKey | undefined {
    if (libraryPageForMode(view.viewMode)) return contentSpaceKeyForMode(view.viewMode as LibraryPageMode);
    if (view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag" || view.viewMode === "path") return contentSpaceKeyForMode(view.presentationMode);
    return undefined;
  }
  function openLibrarySurfaceAnimated(mode: "content" | LibraryPageMode, focusHit?: SearchHit) {
    if (focusHit && (!settings.canLeaveSettings() || !drafts.canLeaveDetailDrafts())) return;
    const navigate = () => {
      if (focusHit) { drafts.discardDetailDrafts(); setSelected(undefined); setFocusedSubjectRef(focusHit.subject_ref?.trim() || ""); setMediaFocusRequest(request => request + 1); }
      openLibrarySurface(mode);
    };
    const effectiveMode = isLibraryViewEnabled(mode, libraryViews.enabledViewIds) ? mode : "content";
    const destination = contentSpaceKeyForMode(effectiveMode);
    const current = currentContentSpaceKey();
    if (!destination || !current || destination === current) { navigate(); return; }
    const focusedOrigin = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-content-space-origin]") ?? undefined
      : undefined;
    const destinationOrigin = current === "home" && destination !== "home"
      ? document.querySelector<HTMLElement>(`[data-content-space-origin="${destination}"]`) ?? undefined
      : undefined;
    const source = destinationOrigin ?? focusedOrigin ?? document.querySelector<HTMLElement>(`[data-content-space-target="${current}"]`) ?? undefined;
    const originValue = destinationOrigin?.dataset.contentSpaceOrigin ?? focusedOrigin?.dataset.contentSpaceOrigin;
    const origin = destination === "home" ? undefined : originValue && ["library", "photos", "music", "videos"].includes(originValue) ? originValue as Exclude<ContentSpaceKey, "home"> : destination;
    transitionContentSpace(navigate, source, destination, origin);
  }
  // The rail has one Library destination; its internal views stay local to the
  // already-loaded set, while a true return from other workspaces reloads it.
  function openLibrary(event: { currentTarget: EventTarget | null }) {
    if (libraryPageForMode(view.viewMode) || ((view.viewMode === "content" || view.viewMode === "search" || view.viewMode === "tag") && view.presentationMode !== "content")) { openLibrarySurface("content"); return; }
    if (view.viewMode === "path") {
      if (workspaceID) void library.loadContentLibrary(workspaceID, refreshGenerationRef.current, true, true);
      return;
    }
    if (view.viewMode === "activity") { library.clearLibraryFilters(); return; }
    if (library.hasActiveFilters) library.clearLibraryFilters();
    else reloadLibrary();
  }
  function openWorkspaceMode(mode: "duplicates" | "tags" | "notes") {
    if (!drafts.canLeaveDetailDrafts()) return;
    if (mode === "notes" && view.viewMode !== "notes") {
      const scopeHits = library.scopeHits.map((hit) => ({ ...hit }));
      const scopeViewMode: ViewMode = view.viewMode === "search" || view.viewMode === "path" || view.viewMode === "tag" || view.viewMode === "content" ? view.viewMode : "content";
      const identity = JSON.stringify([workspaceID, refreshGenerationRef.current, scopeViewMode, scopeHits.map(notesHitIdentity)]);
      notesReturnScopeRef.current = { workspaceID, refreshGeneration: refreshGenerationRef.current, scopeViewMode, scopeHits, identity };
    }
    library.cancelSearchIntent();
    drafts.discardDetailDrafts();
    selection.clearSelection();
    view.setViewMode(mode);
    completeUserNavigation();
  }
  function notesHitIdentity(hit: SearchHit) {
    const logicalSize = typeof hit.logical_size === "number" && Number.isFinite(hit.logical_size) ? hit.logical_size : null;
    return [hit.subject_ref?.trim() ?? "", hit.entry_id?.trim() ?? "", hit.content_id?.trim() ?? "", hit.entry_type?.trim().toUpperCase() ?? "", logicalSize] as [string, string, string, string, number | null];
  }
  function notesScopeMatchesCurrentScope() {
    const captured = notesReturnScopeRef.current;
    if (!captured || captured.workspaceID !== workspaceIDRef.current || captured.refreshGeneration !== refreshGenerationRef.current) return false;
    const signature = (hits: SearchHit[]) => JSON.stringify(hits.map(notesHitIdentity));
    return signature(captured.scopeHits) === signature(library.scopeHits)
      && captured.identity === JSON.stringify([captured.workspaceID, captured.refreshGeneration, captured.scopeViewMode, captured.scopeHits.map(notesHitIdentity)]);
  }
  function notesScopeIsCurrent(identity: string) {
    const captured = notesReturnScopeRef.current;
    return Boolean(captured && captured.identity === identity && captured.workspaceID === workspaceIDRef.current
      && captured.refreshGeneration === refreshGenerationRef.current && view.viewMode === "notes"
      && notesScopeMatchesCurrentScope() && !busyRef.current && !scopeRestoring);
  }
  function changeNotesScopeSelection(hits: SearchHit[], mode: "add" | "remove", identity: string) {
    if (!notesScopeIsCurrent(identity)) return;
    const captured = notesReturnScopeRef.current!;
    const bySubject = new Map<string, SearchHit[]>();
    for (const hit of captured.scopeHits) {
      const ref = hit.subject_ref?.trim() ?? "";
      if (ref) bySubject.set(ref, [...(bySubject.get(ref) ?? []), hit]);
    }
    const safeHits: SearchHit[] = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      const ref = hit.subject_ref?.trim() ?? "";
      const matches = bySubject.get(ref) ?? [];
      const identityTuple = notesHitIdentity;
      const tuple = identityTuple(hit);
      if (!ref || seen.has(ref) || matches.length !== 1 || !tuple[1] || !/^sha256:[0-9a-f]{64}$/.test(tuple[2]) || tuple[3] !== "REGULAR_FILE"
        || !identityTuple(matches[0]).every((value, index) => value === tuple[index])) continue;
      seen.add(ref);
      safeHits.push(matches[0]);
    }
    selectionChangeRef.current(safeHits, mode);
  }
  function returnFromNotesToLibrary(identity: string) {
    if (!notesScopeIsCurrent(identity) || !drafts.canLeaveDetailDrafts()) return;
    const captured = notesReturnScopeRef.current!;
    view.setViewMode(captured.scopeViewMode);
    view.setPresentationMode("content");
    completeUserNavigation();
  }
  async function prepareSearchForSavedSource(requestedWorkspaceID: string, requestedPlanID: string): Promise<ActionFeedback> {
    const plan = sources.plan;
    if (!workspaceID || requestedWorkspaceID !== workspaceID
      || plan?.workspace_id !== requestedWorkspaceID
      || plan?.plan_id !== requestedPlanID
      || sources.planAction !== "SUCCEEDED"
      || sources.planCheckBusy
      || plan?.state !== "SUCCEEDED"
      || plan?.awaiting_confirmation === true) {
      return { state: "FAILED", message: t("The saved source is no longer the current confirmed plan.") };
    }
    if (busy) return { state: "FAILED", message: t("Another operation is still running. Try again after it finishes.") };
    return settings.rebuildSearch(requestedWorkspaceID);
  }
  function reloadLibrary() { if (workspaceID) void library.loadContentLibrary(workspaceID, refreshGenerationRef.current, true); }
  async function viewSavedSource(uploadBatch?: { stagingDir: string; rows: UploadFileRow[]; receiptComplete: boolean }) {
    if (busy) {
      const plan = sources.plan;
      const planID = typeof plan?.plan_id === "string" ? plan.plan_id : "";
      const confirmed = sources.planAction === "SUCCEEDED"
        && !sources.planCheckBusy
        && plan?.state === "SUCCEEDED"
        && plan?.awaiting_confirmation !== true
        && Boolean(workspaceID)
        && plan?.workspace_id === workspaceID
        && Boolean(plan?.root_id)
        && Boolean(planID);
      if (confirmed) {
        // The successful apply can still be refreshing the shared library.
        // Preserve this explicit navigation intent and open the saved source
        // once that refresh releases the host busy flag.
        pendingSavedSourceOpenRef.current = { workspaceID, planID, uploadBatch };
        return;
      }
      setNotice({ kind: "warning", text: t("The source operation is still finishing. Try opening it again shortly.") });
      return;
    }
    if (sources.sourceBarState === "UP_TO_DATE") {
      sources.closeAdd(); openLibrarySurface("content");
      reloadLibrary();
      return;
    }
    const plan = sources.plan;
    const confirmed = sources.planAction === "SUCCEEDED"
      && !sources.planCheckBusy
      && plan?.state === "SUCCEEDED"
      && plan?.awaiting_confirmation !== true;
    if (!confirmed) {
      setNotice({ kind: "warning", text: t("This save is not confirmed yet. Check its status before opening the source.") });
      return;
    }
    const planWorkspaceID = typeof plan?.workspace_id === "string" ? plan.workspace_id : "";
    const rootID = typeof plan?.root_id === "string" ? plan.root_id : "";
    if (!workspaceID || planWorkspaceID !== workspaceID || !rootID) {
      sources.closeAdd(); openLibrarySurface("content");
      reloadLibrary();
      setNotice({ kind: "warning", text: t("The save is confirmed, but its source could not be opened. Showing all content.") });
      return;
    }
    const planID = typeof plan?.plan_id === "string" ? plan.plan_id : "";
    if (!planID) {
      sources.closeAdd(); openLibrarySurface("content");
      reloadLibrary();
      setNotice({ kind: "warning", text: t("The save is confirmed, but its source could not be opened. Showing all content.") });
      return;
    }
    const batchMatchesPlan = Boolean(uploadBatch && uploadBatch.stagingDir.trim() && uploadBatch.stagingDir.trim() === sources.source.trim());
    const capturedRefreshGeneration = refreshGenerationRef.current;
    const detailDraftFingerprint = drafts.detailDraftFingerprint();
    const capturedViewMode = view.viewMode;
    const capturedPresentationMode = view.presentationMode;
    const capturedSelectedIdentity = selectedIdentityRef.current;
    const capturedSelectionRefs = JSON.stringify(selectionRefsRef.current);
    const capturedSearchIntentVersion = library.searchIntentVersion();
    const stillThisSavedBatch = () => addOpenRef.current
      && workspaceIDRef.current === planWorkspaceID
      && refreshGenerationRef.current === capturedRefreshGeneration
      && sourcePlanIDRef.current === planID
      && currentViewModeRef.current === capturedViewMode
      && currentPresentationModeRef.current === capturedPresentationMode
      && JSON.stringify(selectionRefsRef.current) === capturedSelectionRefs
      && selectedIdentityRef.current === capturedSelectedIdentity
      && library.searchIntentVersion() === capturedSearchIntentVersion;
    if (uploadBatch && !drafts.canLeaveDetailDrafts()) return;
    if (uploadBatch && !uploadBatch.receiptComplete) {
      setNotice({ kind: "warning", text: t("The original upload report was incomplete. Opening the saved source; select files manually.") });
    } else if (uploadBatch && batchMatchesPlan) {
      setBusy(true);
      try {
        const savedHits = await library.resolveSavedUploadBatch(planWorkspaceID, rootID, uploadBatch.rows, () => stillThisSavedBatch() && drafts.detailDraftFingerprint() === detailDraftFingerprint);
        if (!stillThisSavedBatch() || drafts.detailDraftFingerprint() !== detailDraftFingerprint) return;
        if (!drafts.canLeaveDetailDrafts()) return;
        drafts.discardDetailDrafts();
        setQuery("");
        setLastExecutedQuery("");
        library.setHits(savedHits);
        library.setJustSavedBatch(true);
        library.setBrowseRootID("");
        library.setBrowseCrumbs([]);
        library.setActiveTags([]);
        library.setActiveSystemFacets({ type: "", format: "", dedup: "", tags: "", index: "" });
        library.setActiveTimelineMonth("");
        selection.clearSelection();
        selection.setSelectionRefs(savedHits.map((hit) => hit.subject_ref!).filter(Boolean));
        selection.setSelectionAnchor(savedHits.at(-1)?.subject_ref ?? "");
        setSelected(undefined);
        view.setPresentationMode("content");
        view.setViewMode("path");
        sources.closeAdd();
        sources.clearUploadDraft();
        completeUserNavigation();
        return;
      } catch {
        if (!stillThisSavedBatch() || drafts.detailDraftFingerprint() !== detailDraftFingerprint) return;
        setNotice({ kind: "warning", text: t("The full saved upload could not be matched to its receipt. Opening the source; select files manually.") });
      } finally { setBusy(false); }
    } else if (uploadBatch) {
      setNotice({ kind: "warning", text: t(batchMatchesPlan ? "The full saved upload could not be matched to its receipt. Opening the source; select files manually." : "The saved upload no longer matches this source. Opening the source instead.") });
    }
    const stillThisSavedSource = () => addOpenRef.current && workspaceIDRef.current === planWorkspaceID && sourcePlanIDRef.current === planID;
    setBusy(true);
    try {
      const opened = await library.loadNamespace(planWorkspaceID, rootID, "", [], stillThisSavedSource);
      if (!opened || !stillThisSavedSource()) return;
      selection.clearSelection();
      view.setPresentationMode("content");
      sources.closeAdd();
      sources.clearUploadDraft();
      completeUserNavigation();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : t("Could not open source content") });
    } finally { setBusy(false); }
  }
  useEffect(() => {
    const pending = pendingSavedSourceOpenRef.current;
    if (!pending) return;
    if (!addOpen || !addOpenRef.current) {
      pendingSavedSourceOpenRef.current = undefined;
      return;
    }
    if (busy) return;
    pendingSavedSourceOpenRef.current = undefined;
    if (pending.workspaceID !== workspaceID || pending.planID !== sourcePlanIDRef.current) return;
    void viewSavedSource(pending.uploadBatch);
  }, [addOpen, busy, workspaceID, sources.plan?.plan_id]);
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
    onDuplicates={selectRailView(() => openWorkspaceMode("duplicates"))}
    onTags={selectRailView(() => openWorkspaceMode("tags"))}
    onNotes={selectRailView(() => openWorkspaceMode("notes"))}
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

  return <ClientBrowseSessionProvider workspaceID={workspaceID} scopeKey={browseSessionScopeRef.current} positionRegistry={browsePositionRegistryRef.current}><div className={`app-shell client-host${contentSpace ? " cairn-content-space" : ""}`}>
    <InterfaceRenderBoundary
      interfaceId={appearance.preference.interfaceId}
      immersive={activePresentationPage?.chrome === "immersive"}
      focused={focusedChrome}
      contentSpace={contentSpace}
      onFallbackToWorkspace={() => appearance.updatePreference({ ...appearance.preference, interfaceId: "workspace" })}
      onOpenSettings={(trigger) => openSettings(trigger)}
      header={<TopBar
        t={t}
        onHome={() => openLibrarySurfaceAnimated(isLibraryViewEnabled("page:cairn:overview", libraryViews.enabledViewIds) ? "page:cairn:overview" : "content")}
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
        contentSpace={contentSpace}
        currentDestinationLabel={contentSpaceDestination}
        onOpenAssistant={() => assistantRef.current?.focus()}
        onOpenLibrary={() => openLibrarySurfaceAnimated("content")}
        presentationNavigation={<LibraryPresentationNavigation t={t} mode={headerDestination} enabledPageIds={libraryViews.enabledViewIds} onNavigate={openLibrarySurfaceAnimated} variant="domains" />}
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
          hostScopeHits={notesReturnScopeRef.current?.scopeHits ?? []}
          scopeIdentity={notesReturnScopeRef.current?.identity ?? ""}
          scopeAvailable={notesScopeMatchesCurrentScope()}
          busy={busy}
          scopeRestoring={scopeRestoring}
          selectionRefs={selection.selectionRefs}
          onChangeScopeSelection={changeNotesScopeSelection}
          onReturnToLibrary={returnFromNotesToLibrary}
          onSearchLibrary={searchNotesTextInLibrary}
          onSaveTextAsFile={openNotesTextFileComposer}
          saveTextAsFileDisabledReason={notesTextFileEntryDisabledReason()}
          notice={notice}
          onClearNotice={() => setNotice(undefined)}
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
          onLibraryView={openLibrarySurfaceAnimated}
          library={library}
          catalogItems={library.libraryItems}
          selection={selection}
          sources={sources}
          view={view}
          command={command}
          selectedRef={selected?.subject_ref ?? ""}
          showFirstSource={showFirstSource}
          recalledView={exportFlow.recalledView}
          lastExecutedQuery={lastExecutedQuery}
          keywordBrowse={search.keywordBrowse}
          onRunKeywordBrowseAction={() => void search.runKeywordBrowseAction()}
          canReturnToRanked={search.canReturnToRanked}
          onReturnToRanked={() => search.returnToRanked()}
          onInvalidateKeywordBrowse={search.invalidateKeywordBrowse}
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
          onCreateMaterialList={(subjects) => openMaterialListEditor(resolveArchiveSelectionSizes(subjects, library.libraryItems))}
          onUseMaterialList={useMaterialList}
          onEditMaterialList={(document) => openMaterialListEditor([], document)}
          materialListActionsDisabled={Boolean(materialListActionsDisabledReason())}
          materialListActionsDisabledReason={materialListActionsDisabledReason()}
          materialListCreationDisabled={!workspaceID || !isConnected || isUnavailable || !coreStorageReady || !library.libraryLoaded || drawerOpen || settingsOpen || sourceIntakeIsPending()}
          refresh={() => void refresh()}
          onOpenAdd={addSource}
          onViewSource={viewSource}
          onRecheckSource={recheckSource}
          onRowClick={handleResultClick}
          onLibraryKeyDown={selection.handleLibraryKeyDown}
          onOpenExport={(trigger, explicitSelection) => exportFlow.openExport(trigger, explicitSelection)}
          onClearNotice={() => setNotice(undefined)}
          onImageSearch={search.runImageSearch}
          onVisualTextSearch={search.runVisualTextSearch}
          visualSearchContext={search.visualSearchContext}
          onReturnToAllPhotos={library.clearSearchScope}
          onOpenHit={(hit) => void details.loadDetails(hit)}
          onFocusSearch={() => contentSpace ? assistantRef.current?.focus() : search.focusSearchField()}
          libraryListRef={libraryListRef}
          onPlayTrack={(track) => void audioPlayback.play(track)}
          onQueueTrack={audioPlayback.addToQueue}
          onPlayTracks={(tracks) => { void audioPlayback.playQueue(tracks); }}
          musicMetadata={musicMetadata}
          favoriteControls={favoriteControls}
          musicQueueControls={{
            count: audioPlayback.queue.length,
            addTracks: (tracks) => { audioPlayback.addTracksToQueue(tracks); },
            addNext: (track) => { audioPlayback.addNextToQueue(track); },
            addNextTracks: (tracks) => { audioPlayback.addNextTracksToQueue(tracks); },
            show: audioPlayback.showQueue,
            currentPlayback: audioPlayback.track
              && audioPlayback.track.workspaceID === workspaceID
              && /^sha256:[a-f0-9]{64}$/.test(audioPlayback.track.contentID)
              && Number.isSafeInteger(audioPlayback.track.logicalSize)
              && audioPlayback.track.logicalSize >= 0
              ? {
                workspaceID: audioPlayback.track.workspaceID,
                entryID: audioPlayback.track.entryID,
                contentID: audioPlayback.track.contentID,
                logicalSize: audioPlayback.track.logicalSize,
                name: audioPlayback.track.name,
                artworkURL: audioPlayback.artworkURL,
                status: audioPlayback.error ? "error"
                  : audioPlayback.loading ? "loading"
                    : audioPlayback.starting ? "starting"
                      : audioPlayback.url ? audioPlayback.playing ? "playing" : "paused"
                        : "error",
              }
              : undefined,
            toggleCurrentPlayback: () => {
              if (!audioPlayback.url || audioPlayback.loading || audioPlayback.starting || audioPlayback.audioRef.current?.src !== audioPlayback.url) return;
              void audioPlayback.toggle();
            },
          }}
          focusedSubjectRef={focusedSubjectRef}
          focusRequest={mediaFocusRequest}
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
        descriptionsTotal={details.descriptionsTotal}
        descriptionsPagePending={details.descriptionsPagePending}
        descriptionsPageError={details.descriptionsPageError}
        onLoadMoreDescriptions={() => { void details.loadMoreDescriptions(); }}
        onRefreshDescriptions={() => { void details.refreshDescriptions(); }}
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
        descriptionDraft={drafts.descriptionDraft}
        onBeginDescriptionDraft={drafts.beginDescriptionDraft}
        onUpdateDescriptionDraft={drafts.updateDescriptionDraft}
        onRebaseDescriptionDraft={drafts.rebaseDescriptionDraft}
        onClearDescriptionDraft={drafts.clearDescriptionDraft}
        busy={busy}
        navigation={details.navigation}
        t={t}
        locale={locale}
        onBack={details.closeDetails}
        onExport={selected.entry_type !== "DIRECTORY" ? () => exportFlow.openExport() : undefined}
        catalogItems={library.libraryItems}
        onEditMaterialList={(document) => openMaterialListEditor([], document)}
        onUseMaterialList={useMaterialList}
        materialListActionsDisabled={Boolean(materialListActionsDisabledReason())}
        materialListActionsDisabledReason={materialListActionsDisabledReason()}
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
    <SpaceAssistant key={workspaceID} ref={assistantRef} t={t} workspaceID={workspaceID} active={contentSpace && !settingsOpen}
      blocked={drawerOpen || settingsOpen} busy={busy} playbackActive={Boolean(audioPlayback.track)}
      catalogItems={library.libraryItems} selectedItems={selection.selectionSubjects} notice={notice?.text}
      onSearch={(text, onResults) => search.runSearch(undefined, text, onResults)}
      savedViews={savedViewFlow} onRecallSavedSearch={recallFloatingSavedSearch}
      onBrowseSearch={browseFloatingSearch}
      onInspect={inspectFloatingMatch}
      onOpen={(hit, resultQuery) => openLibraryEntry(hit, resultQuery)} entryHint={searchEntryHint} onUse={useMaterialList}
      onOrganize={(document) => openMaterialListEditor([], document)}
      onSaveFiles={(files) => saveMaterialListFiles(files, workspaceID)} />
    <AudioPlayer playback={audioPlayback} t={t} onSaveQueueAsMaterialList={saveQueueAsMaterialList} onOpenDetails={(track) => {
      const matchesTrack = (hit: SearchHit | undefined): hit is SearchHit => Boolean(
        track.workspaceID === workspaceID && hit && hit.entry_type === "REGULAR_FILE" && hit.subject_ref?.trim() &&
        hit.entry_id === track.entryID && hit.content_id === track.contentID && hit.logical_size === track.logicalSize,
      );
      const hit = [...library.renderedHits, ...library.libraryItems, track.sourceHit].find(matchesTrack);
      if (!hit) {
        setNotice({ kind: "error", text: t("Current track details are unavailable in the current library scope.") });
        return false;
      }
      // Keep the host draft guard and detail loading behavior in the existing
      // flow; opening Details does not alter the verified player Blob.
      void details.loadDetails(hit);
      return true;
    }} />
    <OriginalTakeoutStatus takeout={originalTakeout} t={t} workspaceID={workspaceID} exportOpen={exportOpen} fallbackActionsReady={Boolean(workspaceID && isConnected && coreStorageReady)} fallbackActionsMessage={coreStorageMessage} onOpenServerExport={(subjects, trigger) => exportFlow.openExport(trigger, subjects)} onDownloadOriginal={(entryID, filename) => downloadOriginal(workspaceID, entryID, filename)} />
    {compactLayout && !contentSpace && !focusedChrome && railOpen && railPanel}
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
    {materialListEditorOpen && materialListEditor && <div className="settings-backdrop" style={{ zIndex: 42 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setMaterialListEditor(undefined); }}>
      <MaterialListComposerHost
        t={t}
        workspaceID={materialListEditor.workspaceID}
        subjects={materialListEditor.subjects}
        catalogItems={library.libraryItems}
        initialDocument={materialListEditor.initialDocument}
        busy={busy}
        onClose={() => setMaterialListEditor(undefined)}
        onPreviewResult={(document) => { setMaterialListEditor(undefined); assistantRef.current?.showResult(document); }}
        onSaveFiles={(files, document, signal) => workspaceIDRef.current === materialListEditor.workspaceID
          ? assistantRef.current?.reviewSave(document, files, signal) ?? false : false}
      />
    </div>}
    {addOpen && <SourceDrawer
      t={t}
      sources={sources}
      isUnavailable={isUnavailable}
      coreStorageReady={coreStorageReady}
      coreStorageMessage={coreStorageMessage}
      notice={notice}
      repositoryPath={repositoryPath}
      workspaceID={workspaceID}
      busy={busy}
      searchRebuildAvailable={searchRebuildAvailable}
      onPrepareSearch={prepareSearchForSavedSource}
      pendingFiles={pendingUploadFiles}
      initialTextComposerOpen={sources.openTextComposerRequested}
      onPendingFilesConsumed={() => { setPendingUploadFiles([]); pendingPasteFilesRef.current = false; }}
      onStaged={() => void refresh()}
      onClose={() => { pendingSavedSourceOpenRef.current = undefined; sources.closeAdd(); }}
      onDone={(uploadBatch) => { void viewSavedSource(uploadBatch); }}
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
      workspaceID={workspaceID}
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
  </div></ClientBrowseSessionProvider>;
}

bootstrapAppearance();
const rootElement = document.getElementById("root")! as HTMLElement & { cairnRoot?: ReturnType<typeof createRoot> };
const root = rootElement.cairnRoot ?? createRoot(rootElement);
rootElement.cairnRoot = root;
root.render(<App />);
