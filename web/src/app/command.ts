import { createTranslator, resolveInitialLocale } from "../i18n";
import { endpoints } from "../lib/operations";
import type { UploadOutcome } from "../lib/types";

// The one command envelope every surface uses.
//
// A surface never builds an operation name or a fetch call inline: it calls
// `command(operations.<group>.<verb>, input)` and receives the daemon's typed
// result envelope. Transport failures and invalid envelopes fail closed with a
// localized message instead of returning a partial payload.

export type Result = { status?: string; data?: any; reasons?: Array<{ message?: string }> };

export async function command(operation: string, input: unknown): Promise<Result> {
  const clientMessage = (message: string) => createTranslator(resolveInitialLocale())(message);
  let response: Response;
  try {
    response = await fetch(endpoints.command, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, input }) });
  } catch {
    throw new Error(clientMessage("Could not connect to Cairn service. Start the service, then refresh."));
  }
  const raw = await response.text();
  let payload: Result = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw) as Result;
    } catch {
      throw new Error(clientMessage(response.ok ? "Cairn returned an invalid response." : "Could not connect to Cairn service. Start the service, then refresh."));
    }
  }
  if (!response.ok || !payload.status || !["SUCCEEDED", "DEGRADED"].includes(payload.status)) {
    const reason = payload.reasons?.[0]?.message;
    if (reason) throw new Error(reason);
    if (!response.ok) throw new Error(clientMessage("Could not connect to Cairn service. Start the service, then refresh."));
    throw new Error(clientMessage("Cairn returned an invalid response."));
  }
  return payload;
}

// The bounded upload channel. Unlike a command envelope, an upload answer is
// per-file data: typed refusals (UPLOAD_TOO_LARGE, UPLOAD_TOO_MANY,
// UPLOAD_NAME_REJECTED, UPLOAD_BUSY, ...) arrive as the response body, so this
// helper returns the parsed outcome for every well-formed daemon answer and
// throws only on transport failures, the same fail-closed message as command().
// The browser reads per-file identity only from the daemon's response; it
// never computes a digest or a size of its own.
export type UploadProgress = { loaded: number; total?: number };

export type UploadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
  preserveRelativePaths?: boolean;
};

export async function uploadFiles(files: File[], options: UploadOptions = {}): Promise<UploadOutcome> {
  const clientMessage = (message: string) => createTranslator(resolveInitialLocale())(message);
  if (!files.length) throw new Error(clientMessage("Choose at least one file to upload."));
  if (options.signal?.aborted) throw uploadAbortError();
  const form = new FormData();
  if (options.preserveRelativePaths) {
    for (const file of files) {
      const relativePath = file.webkitRelativePath;
      if (!relativePath) throw new Error(clientMessage("The browser did not provide a valid relative path for every selected file."));
      form.append("relative_files", file, relativePath);
    }
  } else {
    for (const file of files) form.append("files", file, file.name);
  }
  return new Promise<UploadOutcome>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const signal = options.signal;
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", abortFromSignal);
      xhr.upload.onprogress = null;
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
    };
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };
    const failAsConnection = () => finish(() => reject(new Error(clientMessage("Could not connect to Cairn service. Start the service, then refresh."))));
    const abortFromSignal = () => {
      xhr.abort();
      finish(() => reject(uploadAbortError()));
    };

    if (signal?.aborted) {
      finish(() => reject(uploadAbortError()));
      return;
    }

    xhr.open("POST", endpoints.upload, true);
    xhr.upload.onprogress = (event) => {
      if (settled) return;
      const loaded = safeProgressBytes(event.loaded);
      if (loaded === undefined || !options.onProgress) return;
      const total = event.lengthComputable ? safeProgressBytes(event.total) : undefined;
      try {
        options.onProgress(total === undefined ? { loaded } : { loaded, total });
      } catch {
        // A view callback must not interrupt or change the upload outcome.
      }
    };
    xhr.onload = () => {
      if (settled) return;
      const raw = xhr.responseText;
      let payload: UploadOutcome = {};
      if (raw.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          finish(() => reject(new Error(clientMessage(xhr.status >= 200 && xhr.status < 300 ? "Cairn returned an invalid response." : "Could not connect to Cairn service. Start the service, then refresh."))));
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          finish(() => reject(new Error(clientMessage(xhr.status >= 200 && xhr.status < 300 ? "Cairn returned an invalid response." : "Could not connect to Cairn service. Start the service, then refresh."))));
          return;
        }
        payload = parsed as UploadOutcome;
      }
      if (Object.keys(payload).length === 0) {
        finish(() => reject(new Error(clientMessage(xhr.status >= 200 && xhr.status < 300 ? "Cairn returned an invalid response." : "Could not connect to Cairn service. Start the service, then refresh."))));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        // Request-level refusals can still carry accepted per-file rows. Keep
        // the parsed outcome intact so callers can reconcile the known subset.
        finish(() => resolve({ ...payload, reason: payload.reason ?? "UPLOAD_UNAVAILABLE", message: payload.message ?? payload.error ?? "" }));
        return;
      }
      finish(() => resolve(payload));
    };
    xhr.onerror = failAsConnection;
    xhr.onabort = () => finish(() => reject(uploadAbortError()));
    signal?.addEventListener("abort", abortFromSignal, { once: true });
    if (signal?.aborted) {
      abortFromSignal();
      return;
    }
    try {
      xhr.send(form);
    } catch {
      failAsConnection();
    }
  });
}

function safeProgressBytes(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return undefined;
  return Math.floor(value);
}

function uploadAbortError(): Error {
  const error = new Error("Upload aborted.");
  error.name = "AbortError";
  return error;
}
