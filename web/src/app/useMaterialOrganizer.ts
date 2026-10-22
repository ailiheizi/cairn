import { useCallback, useEffect, useRef, useState } from "react";
import type { Translator } from "../i18n";
import { command } from "./command";
import { operations } from "../lib/operations";
import { MATERIAL_ORGANIZER_LIMITS } from "../lib/materialListOrganizer";

export type MaterialOrganizerProfile = {
  profile_id: string;
  profile_digest: string;
  provider: string;
  destination: string;
  endpoint_host: string;
  model_id: string;
  model_revision: string;
  disclosed_data_classes: string[];
  allowed_subject_classes: string[];
  expiry: string;
  max_requests?: number;
  max_bytes?: number;
  max_seconds?: number;
  max_input_bytes?: number;
  max_output_bytes: number;
  timeout_ms: number;
};

type MaterialOrganizerGrant = {
  workspace_id: string;
  grant_id: string;
  profile_id: string;
  profile_digest: string;
  endpoint_host: string;
  model_id: string;
  purpose: string;
  data_classes: string[];
  subject_classes: string[];
  max_requests: number;
  max_bytes: number;
  max_seconds: number;
  expires_at: string;
  live: boolean;
  revoked?: boolean;
};

export type MaterialOrganizerSnapshot = {
  workspaceID: string;
  state: "CHECKING" | "UNAVAILABLE" | "READY";
  reason?: string;
  profile?: MaterialOrganizerProfile;
  grant?: MaterialOrganizerGrant;
};

type OrganizeResult = {
  candidate_json: string;
  base_digest: string;
  profile_id: string;
  profile_digest: string;
};

const nonempty = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const sha256ID = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonempty);

function abortError(): Error {
  const error = new Error("Request cancelled.");
  error.name = "AbortError";
  return error;
}

function profileIdentity(profile: MaterialOrganizerProfile | undefined): string {
  return profile ? JSON.stringify([profile.profile_id, profile.profile_digest, profile.endpoint_host, profile.model_id]) : "";
}

function validateProfile(value: unknown): MaterialOrganizerProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const expiry = typeof row.expiry === "string" ? row.expiry : typeof row.expires_at === "string" ? row.expires_at : "";
  if (!nonempty(row.profile_id) || !sha256ID(row.profile_digest) || !nonempty(row.provider)
    || !nonempty(row.endpoint_host) || !nonempty(row.model_id) || !nonempty(row.model_revision)
    || !stringList(row.disclosed_data_classes) || !stringList(row.allowed_subject_classes) || row.allowed_subject_classes.length === 0
    || !row.disclosed_data_classes.includes("text.material_list")
    || (row.output_schema !== undefined && row.output_schema !== "cairn.material-list.v1")
    || !Number.isSafeInteger(row.max_output_bytes) || Number(row.max_output_bytes) <= 0
    || !Number.isSafeInteger(row.timeout_ms) || Number(row.timeout_ms) <= 0
    || !expiry || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= Date.now()
    || ["max_requests", "max_bytes", "max_seconds"].some((key) => row[key] !== undefined && (!Number.isSafeInteger(row[key]) || Number(row[key]) <= 0))
    || (row.max_input_bytes !== undefined && (!Number.isSafeInteger(row.max_input_bytes) || Number(row.max_input_bytes) <= 0))) return undefined;
  if (row.expired === true || row.ready === false) return undefined;
  return {
    profile_id: row.profile_id,
    profile_digest: row.profile_digest,
    provider: row.provider,
    destination: nonempty(row.destination) ? row.destination : row.endpoint_host,
    endpoint_host: row.endpoint_host,
    model_id: row.model_id,
    model_revision: row.model_revision,
    disclosed_data_classes: [...row.disclosed_data_classes],
    allowed_subject_classes: [...row.allowed_subject_classes],
    expiry,
    ...(Number.isSafeInteger(row.max_requests) ? { max_requests: Number(row.max_requests) } : {}),
    ...(Number.isSafeInteger(row.max_bytes) ? { max_bytes: Number(row.max_bytes) } : {}),
    ...(Number.isSafeInteger(row.max_seconds) ? { max_seconds: Number(row.max_seconds) } : {}),
    ...(Number.isSafeInteger(row.max_input_bytes) ? { max_input_bytes: Number(row.max_input_bytes) } : {}),
    max_output_bytes: Number(row.max_output_bytes),
    timeout_ms: Number(row.timeout_ms),
  };
}

function matchingGrant(value: unknown, workspaceID: string, profile: MaterialOrganizerProfile): MaterialOrganizerGrant | undefined {
  if (!Array.isArray(value)) return undefined;
  const row = value.find((candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const grant = candidate as Record<string, unknown>;
    const dataClasses = grant.data_classes;
    const subjectClasses = grant.subject_classes;
    return grant.workspace_id === workspaceID && grant.live === true && grant.revoked !== true
      && String(grant.purpose ?? "").toUpperCase() === "ORGANIZE"
      && grant.profile_id === profile.profile_id && grant.profile_digest === profile.profile_digest
      && grant.endpoint_host === profile.endpoint_host && grant.model_id === profile.model_id
      && stringList(dataClasses) && dataClasses.includes("text.material_list")
      && stringList(subjectClasses) && subjectClasses.length > 0
      && subjectClasses.every((subjectClass) => profile.allowed_subject_classes.includes(subjectClass))
      && Number.isSafeInteger(grant.max_requests) && Number(grant.max_requests) > 0
      && Number.isSafeInteger(grant.max_bytes) && Number(grant.max_bytes) > 0
      && Number.isSafeInteger(grant.max_seconds) && Number(grant.max_seconds) > 0
      && typeof grant.expires_at === "string" && Number.isFinite(Date.parse(grant.expires_at)) && Date.parse(grant.expires_at) > Date.now()
      && nonempty(grant.grant_id);
  }) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    workspace_id: String(row.workspace_id),
    grant_id: String(row.grant_id),
    profile_id: String(row.profile_id),
    profile_digest: String(row.profile_digest),
    endpoint_host: String(row.endpoint_host),
    model_id: String(row.model_id),
    purpose: String(row.purpose),
    data_classes: [...row.data_classes as string[]],
    subject_classes: [...row.subject_classes as string[]],
    max_requests: Number(row.max_requests),
    max_bytes: Number(row.max_bytes),
    max_seconds: Number(row.max_seconds),
    expires_at: String(row.expires_at),
    live: true,
    revoked: row.revoked === true,
  };
}

export function useMaterialOrganizer(workspaceID: string, t: Translator) {
  const [snapshot, setSnapshot] = useState<MaterialOrganizerSnapshot>({ workspaceID, state: "CHECKING" });
  const [authorizing, setAuthorizing] = useState(false);
  const [authorizationError, setAuthorizationError] = useState("");
  const authorizingRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async (requestedWorkspace = workspaceID): Promise<MaterialOrganizerSnapshot> => {
    const request = ++requestRef.current;
    if (!requestedWorkspace.trim()) {
      const empty = { workspaceID: requestedWorkspace, state: "UNAVAILABLE" as const, reason: t("Connect to Cairn before using a saved list.") };
      if (mountedRef.current && requestRef.current === request) setSnapshot(empty);
      return empty;
    }
    const [configResult, profileResult, grantResult] = await Promise.allSettled([
      command(operations.config.get, {}),
      command(operations.semantic.providerList, { include_organize: true }),
      command(operations.egress.grantList, { workspace_id: requestedWorkspace }),
    ]);
    if (requestRef.current !== request || requestedWorkspace !== workspaceID) return snapshotRef.current;
    const failure = [configResult, profileResult, grantResult].find((result) => result.status === "rejected");
    if (failure) {
      const reason = failure.status === "rejected" ? failure.reason : undefined;
      const unavailable = { workspaceID: requestedWorkspace, state: "UNAVAILABLE" as const, reason: t("Could not check material organizer availability: {{message}}", { message: reason instanceof Error ? reason.message : String(reason) }) };
      if (mountedRef.current) setSnapshot(unavailable);
      return unavailable;
    }
    const config = configResult.status === "fulfilled" ? configResult.value.data?.config : undefined;
    const profileListing = profileResult.status === "fulfilled" ? profileResult.value.data?.organize : undefined;
    const activeProfileID = typeof profileListing?.active_profile_id === "string" ? profileListing.active_profile_id.trim()
      : typeof config?.organizing?.provider_profile === "string" ? config.organizing.provider_profile.trim() : "";
    const profiles = Array.isArray(profileListing?.profiles) ? profileListing.profiles : [];
    const profile = profileListing?.state === "READY" && activeProfileID
      ? profiles.map(validateProfile).find((candidate: MaterialOrganizerProfile | undefined) => candidate?.profile_id === activeProfileID)
      : undefined;
    if (!profile) {
      const reason = profileListing?.state === "UNAVAILABLE"
        ? String(profileListing.reason || t("The material organizer is unavailable on this service."))
        : !activeProfileID ? t("Choose an installed organizer profile in Settings > Notes. Install its profile and credentials on the service, then restart Cairn.")
          : t("The active material organizer profile is not currently ready.");
      const unavailable = { workspaceID: requestedWorkspace, state: "UNAVAILABLE" as const, reason };
      if (mountedRef.current) setSnapshot(unavailable);
      return unavailable;
    }
    const grants = grantResult.status === "fulfilled" ? grantResult.value.data?.grants : undefined;
    const grant = matchingGrant(grants, requestedWorkspace, profile);
    const next: MaterialOrganizerSnapshot = grant
      ? { workspaceID: requestedWorkspace, state: "READY", profile, grant }
      : { workspaceID: requestedWorkspace, state: "UNAVAILABLE", profile, reason: t("No live matching ORGANIZE grant exists. Create a bounded grant here before sending material.") };
    if (mountedRef.current) setSnapshot(next);
    return next;
  }, [workspaceID, t]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh(workspaceID);
    return () => { mountedRef.current = false; requestRef.current += 1; };
  }, [refresh, workspaceID]);

  const organize = useCallback(async (documentJSON: string, baseDigest: string, grantID: string, signal: AbortSignal): Promise<OrganizeResult> => {
    if (signal.aborted) throw abortError();
    const before = snapshotRef.current;
    if (before.workspaceID !== workspaceID || before.state !== "READY" || !before.profile || !before.grant || before.grant.grant_id !== grantID) {
      throw new Error(t("The material organizer profile or live grant changed. Review availability and try again."));
    }
    const initialProfileIdentity = profileIdentity(before.profile);
    const current = await refresh(workspaceID);
    if (signal.aborted) throw abortError();
    if (current.state !== "READY" || !current.profile || !current.grant || current.grant.grant_id !== grantID
      || profileIdentity(current.profile) !== initialProfileIdentity) throw new Error(t("The material organizer profile or live grant changed. Review availability and try again."));
    const result = await command(operations.material.organize, {
      workspace_id: workspaceID,
      document_json: documentJSON,
      base_digest: baseDigest,
      egress_confirmation: {
        profile_id: current.profile.profile_id,
        profile_digest: current.profile.profile_digest,
        endpoint_host: current.profile.endpoint_host,
        model: current.profile.model_id,
        purpose: "ORGANIZE",
        grant_id: current.grant.grant_id,
      },
    }, signal);
    if (signal.aborted) throw abortError();
    const data = result.data as Record<string, unknown> | undefined;
    if (!data || typeof data.candidate_json !== "string" || data.base_digest !== baseDigest
      || data.profile_id !== current.profile.profile_id || data.profile_digest !== current.profile.profile_digest) {
      throw new Error(t("The material organizer result did not match this request."));
    }
    const latest = snapshotRef.current;
    if (latest.workspaceID !== workspaceID || !latest.profile
      || profileIdentity(latest.profile) !== initialProfileIdentity) {
      throw new Error(t("The material organizer profile changed before the result arrived."));
    }
    return data as OrganizeResult;
  }, [refresh, t, workspaceID]);

  const profileKey = profileIdentity(snapshot.profile);
  const isCurrentProfile = useCallback((identity: string) => Boolean(identity && profileIdentity(snapshotRef.current.profile) === identity), []);

  const authorizeOrganizer = useCallback(async (): Promise<MaterialOrganizerSnapshot> => {
    if (authorizingRef.current) throw new Error(t("An ORGANIZE grant request is already running."));
    const current = snapshotRef.current;
    const profile = current.workspaceID === workspaceID ? current.profile : undefined;
    if (!workspaceID.trim() || !profile || current.grant) throw new Error(t("An organizer profile is not ready for a new grant."));
    const profileExpiry = Date.parse(profile.expiry);
    if (!Number.isFinite(profileExpiry) || profileExpiry <= Date.now()) throw new Error(t("The material organizer profile has expired."));
    const maxBytes = Math.min(profile.max_bytes ?? (MATERIAL_ORGANIZER_LIMITS.inputBytes + MATERIAL_ORGANIZER_LIMITS.outputBytes), MATERIAL_ORGANIZER_LIMITS.inputBytes + MATERIAL_ORGANIZER_LIMITS.outputBytes);
    const maxSeconds = Math.min(profile.max_seconds ?? 90, 90, Math.ceil(profile.timeout_ms / 1000));
    const maxRequests = Math.min(profile.max_requests ?? 1, 1);
    if (maxRequests < 1 || maxBytes < 1 || maxSeconds < 1) throw new Error(t("The active profile does not permit a bounded ORGANIZE grant."));
    const expiresAt = new Date(Math.min(Date.now() + 24 * 60 * 60 * 1000, profileExpiry)).toISOString();
    authorizingRef.current = true;
    setAuthorizing(true);
    setAuthorizationError("");
    try {
      const response = await command(operations.egress.grantCreate, {
        workspace_id: workspaceID,
        profile_id: profile.profile_id,
        profile_digest: profile.profile_digest,
        endpoint_host: profile.endpoint_host,
        model_id: profile.model_id,
        purpose: "ORGANIZE",
        data_classes: ["text.material_list"],
        subject_classes: profile.allowed_subject_classes,
        max_requests: maxRequests,
        max_bytes: maxBytes,
        max_seconds: maxSeconds,
        expires_at: expiresAt,
      });
      const grantID = String(response.data?.grant_id ?? "").trim();
      if (!grantID) throw new Error(t("The service did not confirm the ORGANIZE grant."));
      const refreshed = await refresh(workspaceID);
      if (refreshed.state !== "READY" || refreshed.grant?.grant_id !== grantID) throw new Error(t("The grant was created but is not visible as a live matching grant yet. Refresh availability before sending."));
      return refreshed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAuthorizationError(message);
      throw error;
    } finally {
      authorizingRef.current = false;
      setAuthorizing(false);
    }
  }, [refresh, t, workspaceID]);

  return { snapshot, profileKey, refresh, organize, isCurrentProfile, authorizeOrganizer, authorizing, authorizationError };
}

export type MaterialOrganizerController = ReturnType<typeof useMaterialOrganizer>;
