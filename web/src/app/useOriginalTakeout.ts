import { useCallback, useEffect, useRef, useState } from "react";
import { command } from "./command";
import { endpoints, operations } from "../lib/operations";
import { materializeVerifiedArchive, ORIGINAL_ARCHIVE_LIMITS, preflightArchiveSelection, readBoundedOriginalResponse, releaseDownloadLease, validateFrozenArchiveItems, type CapturedArchiveItem, type FrozenArchiveItem, type OriginalArchiveProgress, type OriginalTakeoutFallbackSubject } from "../lib/originalArchive";
import type { SearchHit } from "../lib/types";

export type OriginalTakeoutStatus = "idle" | "planning" | "downloading" | "preparing" | "requested" | "failed" | "cancelled";
export type OriginalTakeoutState = {
  status: OriginalTakeoutStatus;
  currentFile: number;
  totalFiles: number;
  expectedBytes: number;
  receivedBytes: number;
  verifiedFiles: number;
  verifiedBytes: number;
  transferPhase?: OriginalArchiveProgress["phase"];
  currentName?: string;
  error?: string;
  requestedFilename: string;
  manifestDigest?: string;
  fallback?: { workspaceID: string; subjects: readonly OriginalTakeoutFallbackSubject[] };
};

type OriginalTakeoutAttempt = Readonly<{
  workspaceID: string;
  captured: readonly Readonly<CapturedArchiveItem>[];
}>;

const filename = "cairn-takeout.zip";
const initial: OriginalTakeoutState = { status: "idle", currentFile: 0, totalFiles: 0, expectedBytes: 0, receivedBytes: 0, verifiedFiles: 0, verifiedBytes: 0, requestedFilename: filename };
function reason(error: unknown): string { return error instanceof Error ? error.message : "The original ZIP could not be prepared."; }

function requestBrowserDownload(bytes: Uint8Array, name: string): string {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  try {
    document.body.append(anchor);
    anchor.click();
    return url;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    anchor.remove();
  }
}

async function fetchFrozenItem(workspaceID: string, item: FrozenArchiveItem, signal: AbortSignal, onBytesReceived: (bytesReceived: number) => void): Promise<Uint8Array> {
  const query = new URLSearchParams({ workspace_id: workspaceID, entry_id: item.subject_ref, filename: item.output_name });
  const response = await fetch(`${endpoints.download}?${query.toString()}`, { method: "GET", signal, credentials: "same-origin", cache: "no-store" });
  return readBoundedOriginalResponse(response, item.logical_size, signal, onBytesReceived);
}

type DownloadLease = { url: string; timer: number };
function releaseDownload(lease: DownloadLease | undefined): void {
  if (!lease) return;
  releaseDownloadLease(lease.url, lease.timer);
}

export function useOriginalTakeout(workspaceID: string) {
  const [state, setState] = useState<OriginalTakeoutState>(initial);
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const downloadRef = useRef<DownloadLease | undefined>(undefined);
  const attemptRef = useRef<OriginalTakeoutAttempt | undefined>(undefined);
  const workspaceRef = useRef(workspaceID);
  workspaceRef.current = workspaceID;

  const cancel = useCallback(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    setState((current) => ({ ...current, status: "cancelled", error: undefined, currentName: undefined, transferPhase: undefined, fallback: undefined }));
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    attemptRef.current = undefined;
    setState(initial);
  }, []);

  const runAttempt = useCallback(async (attempt: OriginalTakeoutAttempt) => {
    if (["planning", "downloading", "preparing"].includes(state.status) || (requestRef.current && !requestRef.current.signal.aborted)) return;
    if (attemptRef.current !== attempt || attempt.workspaceID !== workspaceID || attempt.workspaceID !== workspaceRef.current) return;
    const request = ++generationRef.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    const currentWorkspace = attempt.workspaceID;
    // The attempt stays immutable across retries; each execution gets its own
    // local array for the existing frozen-manifest validator.
    const captured: CapturedArchiveItem[] = attempt.captured.map((item) => ({ ...item }));
    setState({ ...initial, status: "planning", totalFiles: captured.length });
    try {
      const response = await command(operations.export.plan, {
        subjects: captured.map((item) => item.subject_ref),
        representation: "exact",
      });
      if (request !== generationRef.current || currentWorkspace !== workspaceRef.current) return;
      const data = response.data;
      if (!data || typeof data.manifest_id !== "string" || !data.manifest_id || typeof data.manifest_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(data.manifest_digest)) {
        throw new Error("The exact export plan did not return a valid frozen manifest.");
      }
      const items = validateFrozenArchiveItems(data.items, captured);
      if (items.length !== data.subject_count) throw new Error("The frozen export count did not match its items.");
      const plannedBytes = items.reduce((sum, item) => sum + item.logical_size, 0);
      if (plannedBytes > ORIGINAL_ARCHIVE_LIMITS.totalBytes) throw new Error("The frozen export exceeds the 64 MiB ZIP limit.");
      setState({ ...initial, status: "downloading", totalFiles: items.length, expectedBytes: plannedBytes, manifestDigest: data.manifest_digest });
      let lastProgressAt = 0;
      const zip = await materializeVerifiedArchive(items, async (item, onBytesReceived) => {
        if (controller.signal.aborted || request !== generationRef.current || currentWorkspace !== workspaceRef.current) throw new DOMException("Cancelled", "AbortError");
        return fetchFrozenItem(currentWorkspace, item, controller.signal, onBytesReceived);
      }, controller.signal, (progress) => {
        if (controller.signal.aborted || request !== generationRef.current || currentWorkspace !== workspaceRef.current) return;
        const now = performance.now();
        const mustPublish = progress.phase !== "transferring" || progress.receivedBytes === plannedBytes || now - lastProgressAt >= 250;
        if (!mustPublish) return;
        lastProgressAt = now;
        setState((current) => request === generationRef.current && currentWorkspace === workspaceRef.current && !controller.signal.aborted
          ? { ...current, status: "downloading", currentFile: progress.currentFile, totalFiles: items.length, currentName: progress.currentName, transferPhase: progress.phase, receivedBytes: progress.receivedBytes, verifiedFiles: progress.verifiedFiles, verifiedBytes: progress.verifiedBytes }
          : current);
      });
      if (controller.signal.aborted || request !== generationRef.current || currentWorkspace !== workspaceRef.current) return;
      setState((current) => request === generationRef.current && currentWorkspace === workspaceRef.current && !controller.signal.aborted
        ? { ...current, status: "preparing", currentFile: items.length, currentName: undefined }
        : current);
      if (controller.signal.aborted || request !== generationRef.current || currentWorkspace !== workspaceRef.current) return;
      const url = requestBrowserDownload(zip, filename);
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(url);
        if (downloadRef.current?.url === url) downloadRef.current = undefined;
      }, 60_000);
      downloadRef.current = { url, timer };
      if (requestRef.current === controller) requestRef.current = undefined;
      if (attemptRef.current === attempt) attemptRef.current = undefined;
      setState((current) => request === generationRef.current && currentWorkspace === workspaceRef.current && !controller.signal.aborted
        ? { ...current, status: "requested", currentFile: items.length, totalFiles: items.length, currentName: undefined, transferPhase: "verified", expectedBytes: plannedBytes, receivedBytes: plannedBytes, verifiedFiles: items.length, verifiedBytes: plannedBytes, manifestDigest: data.manifest_digest }
        : current);
    } catch (error) {
      if (request !== generationRef.current || currentWorkspace !== workspaceRef.current) return;
      const cancelled = controller.signal.aborted;
      controller.abort(error);
      if (requestRef.current === controller) requestRef.current = undefined;
      setState((current) => request === generationRef.current && currentWorkspace === workspaceRef.current
        ? { ...current, status: cancelled ? "cancelled" : "failed", totalFiles: captured.length, currentName: undefined, transferPhase: undefined, error: cancelled ? undefined : reason(error) }
        : current);
    }
  }, [state.status, workspaceID]);

  const start = useCallback(async (hits: SearchHit[]) => {
    if (["planning", "downloading", "preparing"].includes(state.status) || (requestRef.current && !requestRef.current.signal.aborted)) return;
    attemptRef.current = undefined;
    setState(initial);
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    const preflight = preflightArchiveSelection(hits);
    if (!preflight.ok) {
      setState({ ...initial, status: "failed", totalFiles: Array.isArray(hits) ? hits.length : 0, error: preflight.reason, fallback: preflight.refusal === "budget" && preflight.fallbackSubjects ? { workspaceID, subjects: preflight.fallbackSubjects } : undefined });
      return;
    }
    const captured = Object.freeze(preflight.captured.map((item) => Object.freeze({ ...item })));
    const attempt = Object.freeze({ workspaceID, captured });
    attemptRef.current = attempt;
    await runAttempt(attempt);
  }, [runAttempt, state.status, workspaceID]);

  const retry = useCallback(async () => {
    const attempt = attemptRef.current;
    if (!attempt || attempt.workspaceID !== workspaceID || !["failed", "cancelled"].includes(state.status)) return;
    await runAttempt(attempt);
  }, [runAttempt, state.status, workspaceID]);

  useEffect(() => {
    workspaceRef.current = workspaceID;
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    attemptRef.current = undefined;
    setState(initial);
  }, [workspaceID]);
  useEffect(() => () => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
  }, []);

  const retryAvailable = Boolean(attemptRef.current && attemptRef.current.workspaceID === workspaceID && ["failed", "cancelled"].includes(state.status));
  return { ...state, start, cancel, reset, retry, retryAvailable };
}
