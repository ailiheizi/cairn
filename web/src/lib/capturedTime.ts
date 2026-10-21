const capturedUTCNano = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

/**
 * Parse the exact UTC RFC3339Nano timestamp emitted for captured source times.
 * Invalid/normalized dates and Go's zero time stay unknown. Fractional
 * nanoseconds are retained by callers as text; this numeric projection is
 * intentionally millisecond precision for browser sorting and month buckets.
 */
export function capturedModificationTimeMillis(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = capturedUTCNano.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  if (year === 1 && month === 1 && day === 1 && hour === 0 && minute === 0 && second === 0 && !/[1-9]/.test(fraction)) {
    return undefined;
  }

  // Date.UTC maps years 0..99 into 1900..1999, so construct from the epoch
  // and set the full UTC year explicitly. Verify every component afterwards
  // because Date setters normalize invalid calendar values.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second) return undefined;

  const milliseconds = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  date.setUTCMilliseconds(milliseconds);
  const result = date.getTime();
  return Number.isFinite(result) ? result : undefined;
}
