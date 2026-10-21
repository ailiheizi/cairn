import { createContext, useCallback, useContext, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export type ClientBrowseDomain = "photos" | "music";

type SessionContextValue = {
  values: Record<string, unknown>;
  update: (key: string, initialValue: unknown, action: (current: unknown) => unknown) => void;
  workspaceValues: Record<string, unknown>;
  updateWorkspace: (key: string, initialValue: unknown, action: (current: unknown) => unknown) => void;
  browsePositions: BrowsePositionRegistry;
  scopeIdentity: string;
};

export type BrowsePositionBookmark = { anchor: string; offset: number; focusedAnchor?: string; signature: string };
export type BrowsePositionSlot = { signature: string; bookmark?: BrowsePositionBookmark; restorePending?: boolean; capturePaused?: boolean; capture?: (focusedAnchor?: string) => BrowsePositionBookmark | undefined; restore?: () => void };
export type BrowsePositionRegistry = { identity: string; activeSlot: string; slots: Map<string, BrowsePositionSlot> };
export type BrowsePositionToken = { identity: string; slotKey: string; signature: string };

export function createBrowsePositionRegistry(): BrowsePositionRegistry {
  return { identity: "", activeSlot: "", slots: new Map() };
}

export function captureActiveBrowsePosition(registry: BrowsePositionRegistry, focusedAnchor?: string): void {
  const slot = registry.activeSlot ? registry.slots.get(registry.activeSlot) : undefined;
  if (slot?.restorePending || slot?.capturePaused) return;
  const bookmark = slot?.capture?.(focusedAnchor);
  if (slot?.capture) {
    slot.bookmark = bookmark;
    registry.slots.delete(registry.activeSlot);
    registry.slots.set(registry.activeSlot, slot);
    trimBrowsePositionSlots(registry);
  }
}

export function restoreActiveBrowsePosition(registry: BrowsePositionRegistry): void {
  const slot = registry.activeSlot ? registry.slots.get(registry.activeSlot) : undefined;
  if (slot?.bookmark && slot.signature === slot.bookmark.signature) {
    slot.capturePaused = false;
    slot.restorePending = true;
    slot.restore?.();
  }
}

export function markActiveBrowsePositionPending(registry: BrowsePositionRegistry): void {
  const slot = registry.activeSlot ? registry.slots.get(registry.activeSlot) : undefined;
  if (slot?.bookmark && slot.signature === slot.bookmark.signature) slot.restorePending = true;
}

export function activeBrowsePositionToken(registry: BrowsePositionRegistry): BrowsePositionToken | undefined {
  const slotKey = registry.activeSlot;
  const slot = slotKey ? registry.slots.get(slotKey) : undefined;
  return slot
    ? { identity: registry.identity, slotKey, signature: slot.signature }
    : undefined;
}

export function pauseBrowsePositionToken(registry: BrowsePositionRegistry, token: BrowsePositionToken): void {
  if (registry.identity !== token.identity) return;
  const slot = registry.slots.get(token.slotKey);
  if (slot?.signature === token.signature) slot.capturePaused = true;
}

export function releaseBrowsePositionToken(registry: BrowsePositionRegistry, token: BrowsePositionToken): void {
  if (registry.identity !== token.identity) return;
  const slot = registry.slots.get(token.slotKey);
  if (slot?.signature === token.signature) slot.capturePaused = false;
}

export function restoreBrowsePositionToken(registry: BrowsePositionRegistry, token: BrowsePositionToken): boolean {
  if (registry.identity !== token.identity) return false;
  const slot = registry.slots.get(token.slotKey);
  if (!slot || slot.signature !== token.signature) return false;
  slot.capturePaused = false;
  if (registry.activeSlot && registry.activeSlot !== token.slotKey) return false;
  if (slot.bookmark?.signature !== token.signature) return false;
  slot.restorePending = true;
  slot.restore?.();
  return true;
}

function trimBrowsePositionSlots(registry: BrowsePositionRegistry) {
  while (registry.slots.size > 8) {
    const oldest = registry.slots.keys().next().value as string | undefined;
    if (!oldest) break;
    registry.slots.delete(oldest);
  }
}

const ClientBrowseSessionContext = createContext<SessionContextValue | null>(null);

/**
 * Holds only domain-page presentation choices for one host workspace/result
 * scope. Changing that identity clears the slots without remounting children,
 * so host-owned audio or other app-level resources stay mounted.
 */
export function ClientBrowseSessionProvider({ workspaceID, scopeKey, positionRegistry, children }: {
  workspaceID: string;
  scopeKey: string;
  positionRegistry?: BrowsePositionRegistry;
  children: ReactNode;
}) {
  const identity = JSON.stringify([workspaceID.trim(), scopeKey]);
  const localPositionRegistry = useRef(createBrowsePositionRegistry());
  const browsePositions = positionRegistry ?? localPositionRegistry.current;
  if (browsePositions.identity !== identity) {
    browsePositions.identity = identity;
    browsePositions.activeSlot = "";
    browsePositions.slots.clear();
  }
  const [session, setSession] = useState(() => ({ identity, values: {} as Record<string, unknown> }));
  if (session.identity !== identity) {
    // React retries this provider render before committing descendants, so a
    // new workspace/scope cannot observe the previous scope's preferences.
    setSession({ identity, values: {} });
  }
  const values = session.identity === identity ? session.values : {};
  const update = useCallback((key: string, initialValue: unknown, action: (current: unknown) => unknown) => {
    setSession((currentSession) => {
      // A callback retained by an older scope cannot update the new scope.
      if (currentSession.identity !== identity) return currentSession;
      const current = currentSession.values;
      const previous = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : initialValue;
      const next = action(previous);
      return Object.is(previous, next) && Object.prototype.hasOwnProperty.call(current, key)
        ? currentSession
        : { ...currentSession, values: { ...current, [key]: next } };
    });
  }, [identity]);
  const workspaceIdentity = workspaceID.trim();
  const [workspaceSession, setWorkspaceSession] = useState(() => ({ identity: workspaceIdentity, epoch: 0, values: {} as Record<string, unknown> }));
  if (workspaceSession.identity !== workspaceIdentity) {
    // Workspace-only view preferences survive scope/query changes, but never
    // cross the owner's active workspace boundary.
    setWorkspaceSession({ identity: workspaceIdentity, epoch: workspaceSession.epoch + 1, values: {} });
  }
  const workspaceEpoch = workspaceSession.identity === workspaceIdentity ? workspaceSession.epoch : workspaceSession.epoch + 1;
  const workspaceValues = workspaceSession.identity === workspaceIdentity ? workspaceSession.values : {};
  const updateWorkspace = useCallback((key: string, initialValue: unknown, action: (current: unknown) => unknown) => {
    setWorkspaceSession((currentSession) => {
      // A delayed callback from the previous workspace cannot repopulate the
      // newly selected workspace's transient preferences. The epoch also
      // distinguishes A -> B -> A from the original A callback's generation.
      if (currentSession.identity !== workspaceIdentity || currentSession.epoch !== workspaceEpoch) return currentSession;
      const current = currentSession.values;
      const previous = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : initialValue;
      const next = action(previous);
      return Object.is(previous, next) && Object.prototype.hasOwnProperty.call(current, key)
        ? currentSession
        : { ...currentSession, values: { ...current, [key]: next } };
    });
  }, [workspaceEpoch, workspaceIdentity]);
  const value = useMemo(() => ({ values, update, workspaceValues, updateWorkspace, browsePositions, scopeIdentity: identity }), [browsePositions, identity, update, updateWorkspace, values, workspaceValues]);
  return <ClientBrowseSessionContext.Provider value={value}>{children}</ClientBrowseSessionContext.Provider>;
}

export function useBrowsePositionRegistry(): BrowsePositionRegistry | undefined {
  return useContext(ClientBrowseSessionContext)?.browsePositions;
}

export function useBrowsePositionScopeIdentity(): string {
  return useContext(ClientBrowseSessionContext)?.scopeIdentity ?? "";
}

/**
 * A small useState-compatible slot for a page's transient browse preferences.
 * Without the host provider it falls back to ordinary component-local state.
 */
export function useClientBrowseValue<T>(domain: ClientBrowseDomain, field: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const session = useContext(ClientBrowseSessionContext);
  const [localValue, setLocalValue] = useState(initialValue);
  const key = `${domain}:${field}`;
  const inSession = session !== null && Object.prototype.hasOwnProperty.call(session.values, key);
  const value = session
    ? inSession ? session.values[key] as T : initialValue
    : localValue;

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    if (!session) {
      setLocalValue(action);
      return;
    }
    session.update(key, initialValue, (current) => typeof action === "function"
      ? (action as (previous: T) => T)(current as T)
      : action);
  }, [initialValue, key, session]);

  return [value, setValue];
}

/**
 * A transient presentation slot keyed only by the host workspace. Unlike a
 * result-scope slot, it remains stable while the user changes searches or
 * moves between first-party surfaces in that workspace.
 */
export function useWorkspaceBrowseValue<T>(field: string, initialValue: T): [T, Dispatch<SetStateAction<T>>] {
  const session = useContext(ClientBrowseSessionContext);
  const [localValue, setLocalValue] = useState(initialValue);
  const key = `workspace:${field}`;
  const inSession = session !== null && Object.prototype.hasOwnProperty.call(session.workspaceValues, key);
  const value = session
    ? inSession ? session.workspaceValues[key] as T : initialValue
    : localValue;

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    if (!session) {
      setLocalValue(action);
      return;
    }
    session.updateWorkspace(key, initialValue, (current) => typeof action === "function"
      ? (action as (previous: T) => T)(current as T)
      : action);
  }, [initialValue, key, session]);

  return [value, setValue];
}
