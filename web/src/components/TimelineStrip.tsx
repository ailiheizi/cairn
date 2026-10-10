import { useMemo } from "react";
import { Calendar, ChevronRight } from "lucide-react";
import type { Translator } from "../i18n";
import { monthTimelineBuckets } from "../lib/format";
import type { SearchHit } from "../lib/types";

// Timeline browse: a browser-local month projection over the loaded listing.
// The compact disclosure keeps the header dense; its popup states the loaded
// scope and never invents a month when no row has a usable modification time.
export function TimelineStrip({ t, items, activeMonth, onToggleMonth }: {
  t: Translator;
  items: SearchHit[];
  activeMonth: string;
  onToggleMonth: (month: string) => void;
}) {
  const buckets = useMemo(() => monthTimelineBuckets(items), [items]);
  if (buckets.length === 0) return null;
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count));
  return <details className="timeline-control">
    <summary className="timeline-control-summary"><Calendar size={14} /><span>{t("Browse by month")}</span><ChevronRight size={14} aria-hidden="true" /></summary>
    <section className="timeline-strip" aria-label={t("Browse by month")}>
      <div className="timeline-heading"><small>{t("Month counts over {{count}} loaded subjects", { count: items.length })}</small></div>
      <div className="timeline-buckets">{buckets.map((bucket) => {
        const active = activeMonth === bucket.key;
        const label = t("{{count}} items in {{month}}", { count: bucket.count, month: bucket.key });
        return <button type="button" key={bucket.key} className={`timeline-bucket ${active ? "active" : ""}`} data-month={bucket.key} data-count={bucket.count} aria-pressed={active} title={label} aria-label={label} onClick={() => onToggleMonth(bucket.key)}>
          <span className="timeline-bar" style={{ height: `${Math.max(6, Math.round((bucket.count / maxCount) * 40))}px` }} />
          <span className="timeline-month">{bucket.key}</span>
          <b className="timeline-count">{bucket.count}</b>
        </button>;
      })}</div>
    </section>
  </details>;
}
