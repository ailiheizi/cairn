import { createTranslator, resolveInitialLocale } from "../i18n";
import { endpoints } from "../lib/operations";

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
