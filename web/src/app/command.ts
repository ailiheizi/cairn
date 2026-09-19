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
    throw new Error(clientMessage("Could not connect to RestoreWeave service. Start the service, then refresh."));
  }
  const raw = await response.text();
  let payload: Result = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw) as Result;
    } catch {
      throw new Error(clientMessage(response.ok ? "RestoreWeave returned an invalid response." : "Could not connect to RestoreWeave service. Start the service, then refresh."));
    }
  }
  if (!response.ok || !payload.status || !["SUCCEEDED", "DEGRADED"].includes(payload.status)) {
    const reason = payload.reasons?.[0]?.message;
    if (reason) throw new Error(reason);
    if (!response.ok) throw new Error(clientMessage("Could not connect to RestoreWeave service. Start the service, then refresh."));
    throw new Error(clientMessage("RestoreWeave returned an invalid response."));
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
export async function uploadFiles(files: File[]): Promise<UploadOutcome> {
  const clientMessage = (message: string) => createTranslator(resolveInitialLocale())(message);
  if (!files.length) throw new Error(clientMessage("Choose at least one file to upload."));
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  let response: Response;
  try {
    response = await fetch(endpoints.upload, { method: "POST", body: form });
  } catch {
    throw new Error(clientMessage("Could not connect to RestoreWeave service. Start the service, then refresh."));
  }
  const raw = await response.text();
  let payload: UploadOutcome = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw) as UploadOutcome;
    } catch {
      throw new Error(clientMessage("RestoreWeave returned an invalid response."));
    }
  }
  if (Object.keys(payload).length === 0) {
    throw new Error(clientMessage(response.ok ? "RestoreWeave returned an invalid response." : "Could not connect to RestoreWeave service. Start the service, then refresh."));
  }
  if (!response.ok) {
    // Request-level refusals arrive as {error, reason}; a refused-but-parsed
    // request may still carry per-file skip rows. Normalize into the same
    // outcome shape so the caller renders one honest failure either way and
    // never drops an already-reported per-file reason.
    return { ...payload, reason: payload.reason ?? "UPLOAD_UNAVAILABLE", message: payload.message ?? payload.error ?? "" };
  }
  return payload;
}
