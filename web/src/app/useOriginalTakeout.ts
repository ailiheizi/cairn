import { useCallback, useEffect, useRef, useState } from "react";
import { command } from "./command";
import { endpoints, operations } from "../lib/operations";
import { captureArchiveSelection, materializeVerifiedArchive, ORIGINAL_ARCHIVE_LIMITS, readBoundedOriginalResponse, releaseDownloadLease, validateFrozenArchiveItems, type CapturedArchiveItem, type FrozenArchiveItem } from "../lib/originalArchive";
import type { SearchHit } from "../lib/types";

export type OriginalTakeoutStatus = "idle" | "planning" | "downloading" | "preparing" | "requested" | "failed" | "cancelled";
export type OriginalTakeoutState = {
  status: OriginalTakeoutStatus;
  currentFile: number;
  totalFiles: number;
  currentName?: string;
  error?: string;
  requestedFilename: string;
  manifestDigest?: string;
};

const filename = "restoreweave-takeout.zip";
const initial: OriginalTakeoutState = { status: "idle", currentFile: 0, totalFiles: 0, requestedFilename: filename };
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

async function fetchFrozenItem(workspaceID: string, item: FrozenArchiveItem, signal: AbortSignal): Promise<Uint8Array> {
  const query = new URLSearchParams({ workspace_id: workspaceID, entry_id: item.subject_ref, filename: item.output_name });
  const response = await fetch(`${endpoints.download}?${query.toString()}`, { method: "GET", signal, credentials: "same-origin", cache: "no-store" });
  return readBoundedOriginalResponse(response, item.logical_size, signal);
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
  const workspaceRef = useRef(workspaceID);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    setState((current) => ({ ...current, status: "cancelled", error: undefined, currentName: undefined }));
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    setState(initial);
  }, []);

  const start = useCallback(async (hits: SearchHit[]) => {
    if (["planning", "downloading", "preparing"].includes(state.status)) return;
    const request = ++generationRef.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    const currentWorkspace = workspaceRef.current;
    let captured: CapturedArchiveItem[] = [];
    try {
      captured = captureArchiveSelection(hits);
      setState({ ...initial, status: "planning", totalFiles: captured.length });
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
      setState({ ...initial, status: "downloading", totalFiles: items.length, manifestDigest: data.manifest_digest });
      const zip = await materializeVerifiedArchive(items, async (item) => {
        if (controller.signal.aborted || request !== generationRef.current || currentWorkspace !== workspaceRef.current) throw new DOMException("Cancelled", "AbortError");
        return fetchFrozenItem(currentWorkspace, item, controller.signal);
      }, controller.signal, (index, name) => {
        if (request === generationRef.current && currentWorkspace === workspaceRef.current) setState((current) => ({ ...current, status: "downloading", currentFile: index, totalFiles: items.length, currentName: name }));
      });
      if (controller.signal.aborted || request !== generationRef.current || currentWorkspace !== workspaceRef.current) return;
      setState((current) => ({ ...current, status: "preparing", currentFile: items.length, currentName: undefined }));
      if (controller.signal.aborted || request !== generationRef.current || currentWorkspace !== workspaceRef.current) return;
      const url = requestBrowserDownload(zip, filename);
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(url);
        if (downloadRef.current?.url === url) downloadRef.current = undefined;
      }, 60_000);
      downloadRef.current = { url, timer };
      requestRef.current = undefined;
      setState({ ...initial, status: "requested", currentFile: items.length, totalFiles: items.length, manifestDigest: data.manifest_digest });
    } catch (error) {
      if (request !== generationRef.current || currentWorkspace !== workspaceRef.current) return;
      const cancelled = controller.signal.aborted;
      controller.abort(error);
      requestRef.current = undefined;
      setState({ ...initial, status: cancelled ? "cancelled" : "failed", totalFiles: captured.length, error: cancelled ? undefined : reason(error) });
    }
  }, [state.status]);

  useEffect(() => {
    workspaceRef.current = workspaceID;
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
    setState(initial);
  }, [workspaceID]);
  useEffect(() => () => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = undefined;
    releaseDownload(downloadRef.current);
    downloadRef.current = undefined;
  }, []);

  return { ...state, start, cancel, reset };
}
