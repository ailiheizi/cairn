import { capturedModificationTimeMillis } from "./capturedTime";

export type PhotoTimelinePeriod =
  | { kind: "all" }
  | { kind: "unknown" }
  | { kind: "year"; year: number }
  | { kind: "month"; year: number; month: number };

export type PhotoTimelineBucket = { year: number; month: number; count: number };

/** Derive a calendar bucket only from the captured source modification fact. */
export function photoTimelineParts(value: unknown): { year: number; month: number } | undefined {
  const millis = capturedModificationTimeMillis(value);
  if (millis === undefined) return undefined;
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) return undefined;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** Keep the browse preference small and reject malformed persisted values. */
export function parsePhotoTimelinePeriod(value: unknown): PhotoTimelinePeriod {
  if (value === "unknown") return { kind: "unknown" };
  if (typeof value !== "string") return { kind: "all" };
  const yearMatch = /^year:(-?\d{1,6})$/.exec(value);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return isValidCalendarBucket(year, 1) ? { kind: "year", year } : { kind: "all" };
  }
  const monthMatch = /^month:(-?\d{1,6})-(0[1-9]|1[0-2])$/.exec(value);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    return isValidCalendarBucket(year, month) ? { kind: "month", year, month } : { kind: "all" };
  }
  return { kind: "all" };
}

export function photoTimelinePeriodValue(period: PhotoTimelinePeriod): string {
  if (period.kind === "unknown") return "unknown";
  if (period.kind === "year") return `year:${period.year}`;
  if (period.kind === "month") return `month:${period.year}-${String(period.month).padStart(2, "0")}`;
  return "all";
}

function isValidCalendarBucket(year: number, month: number): boolean {
  if (!Number.isInteger(year) || month < 1 || month > 12) return false;
  const date = photoTimelineCalendarDate(year, month);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
}

export function matchesPhotoTimelinePeriod(value: unknown, period: PhotoTimelinePeriod): boolean {
  const parts = photoTimelineParts(value);
  if (period.kind === "all") return true;
  if (period.kind === "unknown") return parts === undefined;
  if (!parts) return false;
  return parts.year === period.year && (period.kind === "year" || parts.month === period.month);
}

export function photoTimelineCalendarDate(year: number, month = 1): Date {
  // Avoid Date.UTC's special 1900 offset for years 0 through 99.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

export function photoTimelineMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}
