import type { MouseEvent as ReactMouseEvent } from "react";
import { Image as ImageIcon, MoreHorizontal } from "lucide-react";
import { PhotoThumbnail } from "../PhotoThumbnail";
import { FavoriteButton } from "../FavoriteButton";
import { capturedModificationTimeMillis } from "../../lib/capturedTime";
import { downloadOriginal } from "../../lib/contentDownload";
import type { FavoriteControls } from "../../lib/favorites";
import { formatBytes } from "../../lib/format";
import type { PhotoItem, PhotoSharedProps } from "./photoTypes";

type Props = {
  item: PhotoItem;
  position: number;
  current: boolean;
  selected: boolean;
  tags: string[];
  selectedTags: string[];
  tagStatus: "ready" | "loading" | "unavailable";
  photoSort: "library" | "filename" | "size" | "modified";
  imageSearchBusy: boolean;
  command: PhotoSharedProps["command"];
  locale: PhotoSharedProps["locale"];
  workspaceID: string;
  t: PhotoSharedProps["t"];
  favoriteControls?: FavoriteControls;
  onFocusSubject?: (subjectRef: string) => void;
  onActivate: (event: ReactMouseEvent<HTMLElement>) => void;
  onSelectRange: () => void;
  onToggleSelection: () => void;
  onOpenDetails: (item: PhotoItem) => void;
  onToggleTag: (tag: string) => void;
  onImageSearch?: (subjectRef: string) => void;
};

export function PhotoCard(props: Props) {
  const { item, position, current, selected, tags, selectedTags, tagStatus, photoSort, imageSearchBusy, command, locale, workspaceID, t, favoriteControls, onFocusSubject } = props;
  const { hit } = item;
  const name = hit.name || hit.path?.split(/[\\/]/).at(-1) || t("Untitled subject");
  const thumbAllowed = item.previewable;
  const deferUntilVisible = position >= 48 && (hit.logical_size == null || hit.logical_size <= (1 << 20));
  const canDownloadOriginal = Boolean(workspaceID.trim()) && hit.entry_type === "REGULAR_FILE" && Boolean(hit.subject_ref?.trim()) && Boolean(hit.entry_id?.trim()) && /^sha256:[0-9a-f]{64}$/.test(hit.content_id ?? "");
  const imageSearchName = (hit.name || hit.path?.split(/[\\/]/).at(-1) || "").trim().toLowerCase();
  const imageQueryFile = hit.entry_type === "REGULAR_FILE" && (imageSearchName.endsWith(".jpg") || imageSearchName.endsWith(".jpeg") || imageSearchName.endsWith(".png"));
  const canSearchByImage = Boolean(workspaceID.trim()) && imageQueryFile && Boolean(hit.subject_ref?.trim()) && Boolean(hit.entry_id?.trim()) && /^sha256:[0-9a-f]{64}$/.test(hit.content_id ?? "");
  const modifiedMillis = capturedModificationTimeMillis(hit.modified_at);
  const modificationTimeLabel = modifiedMillis === undefined ? t("Recorded modification time unavailable") : t("Recorded modification time: {{time}}", { time: new Date(modifiedMillis).toLocaleString(locale || undefined) });
  const modifiedSortValue = photoSort === "modified" ? modifiedMillis === undefined ? t("Unknown modification time") : new Date(modifiedMillis).toLocaleDateString(locale || undefined) : "";
  const closeDisclosure = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const disclosure = event.currentTarget.closest("details");
    if (!disclosure) return;
    disclosure.open = false;
    disclosure.querySelector<HTMLElement>("summary")?.focus();
  };
  return <article className={`photo-card ${current ? "is-current" : ""} ${selected ? "is-selected" : ""} ${item.previewable ? "has-preview" : "has-fallback"}`} key={hit.subject_ref ?? hit.entry_id ?? `${name}-${item.index}`} data-result-index={item.index} data-original-index={item.index} data-subject-ref={hit.subject_ref ?? ""}>
    <button type="button" className="photo-card__image" aria-label={t("Open {{name}}", { name })} onFocus={() => hit.subject_ref && onFocusSubject?.(hit.subject_ref)} onClick={props.onActivate}>
      {thumbAllowed ? <PhotoThumbnail command={command} locale={locale} workspaceId={workspaceID} entryId={hit.entry_id} subjectRef={hit.subject_ref} contentId={hit.content_id} name={name} logicalSize={hit.logical_size} deferUntilVisible={deferUntilVisible} /> : <span className="photo-card__unsupported"><ImageIcon size={26} /><small>{item.format === "unknown" ? t("Unknown format") : item.format.toUpperCase()}</small><small>{t("Thumbnail not loaded")}</small></span>}
    </button>
    <div className="photo-card__caption"><div><button type="button" title={name} className="result-open-copy photo-card__name" aria-label={t("Open {{name}}", { name })} onFocus={() => hit.subject_ref && onFocusSubject?.(hit.subject_ref)} onClick={props.onActivate}>{name}</button><small title={modificationTimeLabel}>{item.format === "unknown" ? t("Unknown format") : item.format.toUpperCase()}{hit.logical_size != null ? ` · ${formatBytes(hit.logical_size)}` : ""}{photoSort === "modified" && <> · {modifiedMillis === undefined ? <span aria-label={modificationTimeLabel}>{modifiedSortValue}</span> : <time dateTime={hit.modified_at} aria-label={modificationTimeLabel}>{modifiedSortValue}</time>}</>}</small></div>
      <div className="photo-card__caption-actions">
        <span className="photo-card__favorite" onKeyDown={(event) => event.stopPropagation()} onFocusCapture={() => hit.subject_ref && onFocusSubject?.(hit.subject_ref)}><FavoriteButton hit={hit} controls={favoriteControls} t={t} /></span>
        <label className="photo-card__select"><input type="checkbox" checked={selected} disabled={!hit.subject_ref} aria-label={t(selected ? "Deselect {{name}}" : "Select {{name}}", { name })} onKeyDown={(event) => { if (event.key === " " && event.shiftKey) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) props.onSelectRange(); } }} onChange={(event) => { const nativeEvent = event.nativeEvent as MouseEvent; if (nativeEvent.shiftKey) { props.onSelectRange(); return; } props.onToggleSelection(); }} /></label>
      </div>
    </div>
    <div className="photo-card__foot">
      {hit.subject_ref ? (tags.length > 0 ? <div className="photo-card__tags" role="group" aria-label={t("Tags")}>{tags.map((tag) => {
        const active = selectedTags.includes(tag);
        return <button type="button" className="photo-card__tag" key={tag} aria-label={t("Filter by tag {{tag}}", { tag })} aria-pressed={active} title={tag} disabled={tagStatus !== "ready"} onFocus={() => onFocusSubject?.(hit.subject_ref!)} onClick={(event) => { event.preventDefault(); event.stopPropagation(); props.onToggleTag(tag); }}>{tag}</button>;
      })}</div> : null) : <span>{t("Details unavailable")}</span>}
      <div className="photo-card__actions">
        <button type="button" aria-label={t("Open details for {{name}}", { name })} onClick={() => props.onOpenDetails(item)}>{t("Details")}</button>
        <details className="photo-card__more-actions" onKeyDown={(event) => { event.stopPropagation(); if (event.key !== "Escape") return; event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector<HTMLElement>("summary")?.focus(); }}>
          <summary aria-label={t("More actions")} title={t("More actions")}><MoreHorizontal size={15} aria-hidden="true" /></summary>
          <div className="photo-card__more-menu">
            {props.onImageSearch && imageQueryFile && <button type="button" disabled={!canSearchByImage || imageSearchBusy} onClick={(event) => { event.stopPropagation(); if (canSearchByImage && hit.subject_ref) props.onImageSearch?.(hit.subject_ref); closeDisclosure(event); }}>{t("Search by this image")}</button>}
            <button type="button" disabled={!canDownloadOriginal} onClick={(event) => { event.stopPropagation(); if (canDownloadOriginal && hit.entry_id) downloadOriginal(workspaceID, hit.entry_id, name || "download.bin"); closeDisclosure(event); }}>{t("Download original")}</button>
          </div>
        </details>
      </div>
    </div>
  </article>;
}
