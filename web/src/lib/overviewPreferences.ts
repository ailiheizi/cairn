export const OVERVIEW_PREFERENCE_VERSION = 1 as const;
export const OVERVIEW_BLOCK_IDS = ["photos", "music", "videos", "materials"] as const;
export type OverviewBlockID = (typeof OVERVIEW_BLOCK_IDS)[number];
export type OverviewPreviewCount = 1 | 3 | 6;

export type OverviewBlockPreference = {
  id: OverviewBlockID;
  visible: boolean;
  count: OverviewPreviewCount;
};

export type OverviewPreferences = {
  version: typeof OVERVIEW_PREFERENCE_VERSION;
  heading: string;
  blocks: OverviewBlockPreference[];
  photoShare: number;
};

export const DEFAULT_OVERVIEW_HEADING = "Your private space";
export const DEFAULT_OVERVIEW_PHOTO_SHARE = 2 / 3;
export const MIN_OVERVIEW_PHOTO_SHARE = 0.35;
export const MAX_OVERVIEW_PHOTO_SHARE = 0.75;

export const DEFAULT_OVERVIEW_PREFERENCES: OverviewPreferences = {
  version: OVERVIEW_PREFERENCE_VERSION,
  heading: "",
  blocks: [
    { id: "photos", visible: true, count: 3 },
    { id: "music", visible: true, count: 3 },
    { id: "videos", visible: true, count: 3 },
    { id: "materials", visible: true, count: 3 },
  ],
  photoShare: DEFAULT_OVERVIEW_PHOTO_SHARE,
};

const MAX_HEADING_LENGTH = 80;
const VALID_COUNTS: readonly number[] = [1, 3, 6];
const failedPersistencePreferences = new Map<string, OverviewPreferences>();

function boundedPhotoShare(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_OVERVIEW_PHOTO_SHARE;
  return Math.max(MIN_OVERVIEW_PHOTO_SHARE, Math.min(MAX_OVERVIEW_PHOTO_SHARE, value));
}

function boundedHeading(value: unknown): string {
  if (typeof value !== "string") return "";
  const bounded = Array.from(value).slice(0, MAX_HEADING_LENGTH).join("");
  return bounded.trim() ? bounded : "";
}

export function cloneOverviewPreferences(value: OverviewPreferences = DEFAULT_OVERVIEW_PREFERENCES): OverviewPreferences {
  return { version: OVERVIEW_PREFERENCE_VERSION, heading: value.heading, blocks: value.blocks.map((block) => ({ ...block })), photoShare: boundedPhotoShare(value.photoShare) };
}

export function normalizeOverviewPreferences(value: unknown): OverviewPreferences {
  if (!value || typeof value !== "object") return cloneOverviewPreferences();
  const source = value as { version?: unknown; heading?: unknown; blocks?: unknown; photoShare?: unknown };
  if (source.version !== OVERVIEW_PREFERENCE_VERSION || !Array.isArray(source.blocks)) return cloneOverviewPreferences();
  const byID = new Map<OverviewBlockID, OverviewBlockPreference>();
  for (const entry of source.blocks) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as { id?: unknown; visible?: unknown; count?: unknown };
    if (!OVERVIEW_BLOCK_IDS.includes(item.id as OverviewBlockID) || byID.has(item.id as OverviewBlockID)) continue;
    const id = item.id as OverviewBlockID;
    byID.set(id, {
      id,
      visible: typeof item.visible === "boolean" ? item.visible : true,
      count: VALID_COUNTS.includes(item.count as number) ? item.count as OverviewPreviewCount : 3,
    });
  }
  const blocks = [...byID.values()];
  for (const fallback of DEFAULT_OVERVIEW_PREFERENCES.blocks) {
    if (!byID.has(fallback.id)) blocks.push({ ...fallback });
  }
  return { version: OVERVIEW_PREFERENCE_VERSION, heading: boundedHeading(source.heading), blocks, photoShare: boundedPhotoShare(source.photoShare) };
}

function storageKey(workspaceID: string): string {
  return `cairn:overview-home:v${OVERVIEW_PREFERENCE_VERSION}:${encodeURIComponent(workspaceID)}`;
}

export type OverviewPreferenceRead = { preferences: OverviewPreferences; persistenceAvailable: boolean };

export function readOverviewPreferences(workspaceID: string): OverviewPreferenceRead {
  const key = storageKey(workspaceID);
  const inMemory = failedPersistencePreferences.get(key);
  if (inMemory) return { preferences: cloneOverviewPreferences(inMemory), persistenceAvailable: false };
  try {
    if (typeof window === "undefined" || !window.localStorage) return { preferences: cloneOverviewPreferences(), persistenceAvailable: false };
    const saved = window.localStorage.getItem(key);
    if (!saved) return { preferences: cloneOverviewPreferences(), persistenceAvailable: true };
    try {
      return { preferences: normalizeOverviewPreferences(JSON.parse(saved)), persistenceAvailable: true };
    } catch {
      return { preferences: cloneOverviewPreferences(), persistenceAvailable: true };
    }
  } catch {
    return { preferences: cloneOverviewPreferences(), persistenceAvailable: false };
  }
}

export function writeOverviewPreferences(workspaceID: string, value: OverviewPreferences): boolean {
  const key = storageKey(workspaceID);
  const normalized = normalizeOverviewPreferences(value);
  try {
    if (typeof window === "undefined" || !window.localStorage) throw new Error("Browser storage is unavailable");
    window.localStorage.setItem(key, JSON.stringify(normalized));
    failedPersistencePreferences.delete(key);
    return true;
  } catch {
    failedPersistencePreferences.set(key, cloneOverviewPreferences(normalized));
    return false;
  }
}
