import { useMemo } from "react";
import { Calendar } from "lucide-react";
import type { Translator } from "../i18n";
import { monthTimelineBuckets } from "../lib/format";
import type { SearchHit } from "../lib/types";

// Timeline browse: a compact month-bucketed strip above the library grid,
// computed entirely in this browser from the loaded listing's row times.
//
// The scope is the loaded listing, and the label says so ("over N loaded
// subjects"). When no row carries a usable modification time — the daemon's
// content.list projection carries none in this build — the strip renders
// nothing at all: absent, never zero-filled.

export function TimelineStrip({ t, items, activeMonth, onToggleMonth }: {
  t: Translator;
  items: SearchHit[];
  activeMonth: string;
  onToggleMonth: (month: string) => void;
}) {
  const buckets = useMemo(() => monthTimelineBuckets(items), [items]);
  if (buckets.length === 0) return null;
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count));
  return <section className="timeline-strip" aria-label={t("Browse by month")}>
    <div className="timeline-heading"><Calendar size={15} /><span>{t("Browse by month")}</span><small>{t("Month counts over {{count}} loaded subjects", { count: items.length })}</small></div>
    <div className="timeline-buckets">{buckets.map((bucket) => {
      const active = activeMonth === bucket.key;
      const label = t("{{count}} items in {{month}}", { count: bucket.count, month: bucket.key });
      return <button type="button" key={bucket.key} className={`timeline-bucket ${active ? "active" : ""}`} data-month={bucket.key} data-count={bucket.count} aria-pressed={active} title={label} aria-label={label} onClick={() => onToggleMonth(bucket.key)}>
        <span className="timeline-bar" style={{ height: `${Math.max(6, Math.round((bucket.count / maxCount) * 40))}px` }} />
        <span className="timeline-month">{bucket.key}</span>
        <b className="timeline-count">{bucket.count}</b>
      </button>;
    })}</div>
  </section>;
}
