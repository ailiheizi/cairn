import type { ComponentProps } from "react";
import type { ResultList } from "../ResultList";
import type { AudioTrack } from "../../lib/audioPlayback";
import { playableMusicTrack, type MusicMetadataState, type MusicTrackFacts } from "../../lib/musicMetadata";
import type { MusicCurrentPlayback, MusicQueueControls } from "../../lib/musicQueueControls";
import type { FavoriteControls } from "../../lib/favorites";
import type { LibraryPageMode, SearchHit } from "../../lib/types";
import { uniqueSubjectHits } from "../../lib/subjectHits";

type ResultListProps = ComponentProps<typeof ResultList>;
export type MusicLibraryProps = Pick<ResultListProps, "hits" | "libraryListRef" | "selectionCount" | "rovingRow" | "selectedRef" | "selectionRefs" | "identityCounts" | "tagsBySubject" | "viewMode" | "locale" | "t" | "command" | "workspaceID" | "onRowClick" | "onToggleSelection" | "onKeyDown"> & {
  focusedSubjectRef?: string;
  focusRequest?: number;
  onFocusSubject?: (subjectRef: string) => void;
  onPlayTrack: (track: AudioTrack) => void;
  onQueueTrack: (track: AudioTrack) => void;
  onPlayTracks?: (tracks: AudioTrack[]) => void;
  onSelectSubjects?: (subjects: SearchHit[], mode: "add" | "remove" | "invert") => void;
  onCreateMaterialList?: (subjects: SearchHit[]) => void;
  materialListCreationDisabled?: boolean;
  onNavigate?: (mode: "content" | LibraryPageMode) => void;
  onDownloadOriginals?: (subjects: SearchHit[]) => void;
  originalTakeoutBusy?: boolean;
  metadata?: MusicMetadataState;
  favoriteControls?: FavoriteControls;
  queueControls?: MusicQueueControls;
};
export type MusicRow = { hit: MusicLibraryProps["hits"][number]; index: number; facts?: MusicTrackFacts };
export type MusicGroup = { key: string; label: string; rows: MusicRow[]; artist?: string; album?: string };
export const NO_FILENAME_EXTENSION = "__no_filename_extension__";

export function filenameFormatToken(name: string | undefined): string {
  const filename = (name || "").split(/[\\/]/).pop() || "";
  const dot = filename.lastIndexOf(".");
  return dot <= 0 || dot === filename.length - 1 ? NO_FILENAME_EXTENSION : filename.slice(dot + 1).toLocaleLowerCase("en-US");
}

export function musicRowSelectionKey(row: MusicRow): string {
  const subject = row.hit.subject_ref?.trim() || "";
  const entry = row.hit.entry_id || "";
  return subject || entry ? `${subject}\u0000${entry}` : `loaded-row-${row.index}`;
}

export function buildGroups(rows: MusicRow[], keyFor: (row: MusicRow) => string, labelFor: (row: MusicRow) => string): MusicGroup[] {
  const grouped = new Map<string, MusicGroup>();
  for (const row of rows) {
    const key = keyFor(row);
    let group = grouped.get(key);
    if (!group) {
      group = { key, label: labelFor(row), rows: [], artist: row.facts?.artist, album: row.facts?.album };
      grouped.set(key, group);
    }
    group.rows.push(row);
  }
  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export const uniqueMusicHits = uniqueSubjectHits;

export function matchesCurrentPlayback(hit: SearchHit, current: MusicCurrentPlayback, workspaceID?: string): boolean {
  return Boolean(workspaceID && current.workspaceID === workspaceID && hit.entry_type === "REGULAR_FILE" &&
    hit.entry_id === current.entryID && hit.content_id === current.contentID && hit.logical_size === current.logicalSize &&
    /^sha256:[a-f0-9]{64}$/.test(current.contentID) && Number.isSafeInteger(current.logicalSize) && current.logicalSize >= 0);
}

export function playbackStatusText(status: MusicCurrentPlayback["status"] | undefined, t: MusicLibraryProps["t"]): string {
  switch (status) {
    case "loading": return t("Loading and verifying original");
    case "starting": return t("Starting audio…");
    case "playing": return t("Now playing");
    case "paused": return t("Paused");
    case "error": return t("Playback failed. Open Details to download the original.");
    default: return "";
  }
}

export function runQueueMenuAction(menu: HTMLDetailsElement | null, action: () => void) {
  action();
  if (!menu) return;
  menu.open = false;
  requestAnimationFrame(() => menu.querySelector("summary")?.focus());
}

export function shuffleTracks<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function groupDurationSummary(rows: readonly MusicRow[], t: MusicLibraryProps["t"], locale?: string): string {
  const durations = rows.flatMap((row) => Number.isSafeInteger(row.facts?.durationMS) && (row.facts?.durationMS ?? 0) > 0 ? [row.facts!.durationMS!] : []);
  const totalMS = durations.reduce((sum, duration) => sum + duration, 0);
  const missingCount = rows.length - durations.length;
  const seconds = Math.floor(totalMS / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const formatted = hours > 0 ? `${number(hours)}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${number(minutes)}:${String(remainder).padStart(2, "0")}`;
  return missingCount ? t("Known duration {{duration}} · {{count}} tracks missing duration", { duration: formatted, count: missingCount }) : t("Total duration {{duration}}", { duration: formatted });
}

export function formatMusicDuration(durationMS: number, locale?: string): string {
  const seconds = Math.floor(durationMS / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const whole = (value: number) => new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: 2 }).format(value);
  return hours > 0
    ? `${new Intl.NumberFormat(locale, { useGrouping: false }).format(hours)}:${whole(minutes)}:${whole(remainder)}`
    : `${new Intl.NumberFormat(locale, { useGrouping: false }).format(minutes)}:${whole(remainder)}`;
}
