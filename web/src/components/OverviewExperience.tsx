import { ArrowRight, Check, File, Image as ImageIcon, Music2, Play, Plus } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { AudioTrack } from "../lib/audioPlayback";
import { formatBytes } from "../lib/format";
import { playableMusicTrack, type MusicMetadataState } from "../lib/musicMetadata";
import { OVERVIEW_SECTION_LIMIT, projectOverviewSections, type OverviewRow, type OverviewSection } from "../lib/overviewComposition";
import type { LibraryPageMode, SearchHit } from "../lib/types";
import type { Locale, Translator } from "../i18n";
import type { FavoriteControls } from "../lib/favorites";
import { FavoriteButton } from "./FavoriteButton";
import "./OverviewExperience.css";

export type OverviewExperienceProps = {
  hits: SearchHit[];
  t: Translator;
  workspaceID: string;
  locale?: Locale;
  selectedRef: string;
  selectionRefs: string[];
  tagsBySubject: Map<string, string[]>;
  metadata?: MusicMetadataState;
  favoriteControls?: FavoriteControls;
  photoDestination?: LibraryPageMode;
  musicDestination?: LibraryPageMode;
  renderThumbnail: (hit: SearchHit) => ReactNode;
  onToggleSelection: (index: number) => void;
  onSelectSubjects?: (subjects: SearchHit[], mode: "add" | "remove") => void;
  onOpenHit: (hit: SearchHit) => void;
  onNavigate: (mode: "content" | LibraryPageMode) => void;
  onPlayTrack?: (track: AudioTrack) => void;
  onQueueTrack?: (track: AudioTrack) => void;
  onPlayTracks?: (tracks: AudioTrack[]) => void;
};

export function OverviewExperience(props: OverviewExperienceProps) {
  const { hits, t, workspaceID, selectedRef, selectionRefs, tagsBySubject, metadata, photoDestination, musicDestination, onNavigate, onPlayTrack, onQueueTrack, onPlayTracks } = props;
  const sections = projectOverviewSections(hits);
  const scopeSubjectOccurrences = new Map<string, number>();
  for (const hit of props.hits) {
    const ref = hit.subject_ref?.trim() ?? "";
    if (ref) scopeSubjectOccurrences.set(ref, (scopeSubjectOccurrences.get(ref) ?? 0) + 1);
  }
  const sectionSelectionTargets = (rows: OverviewRow[]) => {
    const byRef = new Map<string, SearchHit[]>();
    for (const { hit } of rows) {
      const ref = hit.subject_ref?.trim() ?? "";
      if (ref) byRef.set(ref, [...(byRef.get(ref) ?? []), hit]);
    }
    const eligible = [...byRef.entries()].flatMap(([ref, matches]) => matches.length === 1 && scopeSubjectOccurrences.get(ref) === 1 ? matches : []);
    const selected = eligible.filter((hit) => selectionRefs.includes(hit.subject_ref!.trim()));
    return { eligible, selected, skipped: rows.length - eligible.length };
  };
  const sectionSelectionActions = (label: string, section: OverviewSection) => {
    if (!props.onSelectSubjects || !section.rows.length) return null;
    const targets = sectionSelectionTargets(section.rows);
    return <div className="overview-selection-block" key={label}>
      <strong>{t(label)}</strong>
      <p>{t("{{eligible}} of {{displayed}} displayed items can be selected; {{skipped}} items without one clear identity were skipped.", { eligible: targets.eligible.length, displayed: section.rows.length, skipped: targets.skipped })}</p>
      <div>
        {targets.eligible.length > 0 && <button type="button" onClick={() => props.onSelectSubjects?.(targets.eligible, "add")}>{t("Select displayed items ({{count}})", { count: targets.eligible.length })}</button>}
        {targets.selected.length > 0 && <button type="button" onClick={() => props.onSelectSubjects?.(targets.selected, "remove")}>{t("Clear displayed selection ({{count}})", { count: targets.selected.length })}</button>}
      </div>
    </div>;
  };
  const sectionSelectionBlocks = [
    photoDestination ? sectionSelectionActions("Photos in this scope", sections.photos) : null,
    musicDestination ? sectionSelectionActions("Audio in this scope", sections.audio) : null,
    sectionSelectionActions("Other content in this scope", sections.other),
  ].filter((item): item is ReactElement => Boolean(item));
  const playableRows = musicDestination && onPlayTracks
    ? sections.audio.rows.flatMap(({ hit, index }) => {
      const facts = hit.subject_ref ? metadata?.records.get(hit.subject_ref) : undefined;
      const track = playableMusicTrack(hit, workspaceID, facts);
      return track ? [{ hit, index, track }] : [];
    })
    : [];

  const sectionHeading = (icon: ReactNode, title: string, section: OverviewSection) => <div className="overview-section-heading">
    <span className="overview-section-icon" aria-hidden="true">{icon}</span>
    <div><h2>{t(title)}</h2><p>{t("Showing {{shown}} of {{total}}", { shown: section.rows.length, total: section.total })}</p></div>
  </div>;

  const selectionButton = ({ hit, index }: OverviewRow) => {
    const subjectRef = hit.subject_ref?.trim() ?? "";
    const name = hit.name?.trim() || t("Untitled subject");
    const selected = Boolean(subjectRef && selectionRefs.includes(subjectRef));
    return <button type="button" className={`overview-select ${selected ? "is-selected" : ""}`} disabled={!subjectRef} aria-pressed={selected} aria-label={t(selected ? "Deselect {{name}}" : "Select {{name}}", { name })} onClick={() => props.onToggleSelection(index)}><Check aria-hidden="true" /><span>{t(selected ? "Selected" : "Select")}</span></button>;
  };

  const openButton = (hit: SearchHit) => <button type="button" className="overview-open" aria-label={t("Open details for {{name}}", { name: hit.name || t("Untitled subject") })} onClick={() => props.onOpenHit(hit)}>{t("Details")}<ArrowRight aria-hidden="true" /></button>;
  const disabledDomain = (message: string) => <div className="overview-disabled" role="status"><p>{t(message)}</p><button type="button" onClick={() => onNavigate("content")}>{t("Show all types")}</button></div>;
  const tagsFor = (hit: SearchHit) => hit.subject_ref ? tagsBySubject.get(hit.subject_ref) ?? [] : [];

  return <section className="overview-experience" aria-label={t("Content overview")}>
    <header className="overview-heading">
      <div><p className="overview-eyebrow">{t("A cross-section of this library")}</p><h1>{t("Content overview")}</h1></div>
      <p className="overview-scope-note">{t("This overview uses the current content scope.")}</p>
    </header>
    {sectionSelectionBlocks.length > 0 && props.onSelectSubjects && <details className="overview-selection-tools">
      <summary>{t("Select displayed items")}</summary>
      <div>{sectionSelectionBlocks}</div>
    </details>}

    <section className="overview-photos" aria-label={t("Photos in this scope")} data-mounted-thumbnail-limit={OVERVIEW_SECTION_LIMIT}>
      {sectionHeading(<ImageIcon />, "Photos in this scope", sections.photos)}
      {!photoDestination ? disabledDomain("Photos pages are disabled. The images remain in the current scope.") : sections.photos.total === 0
        ? <p className="overview-empty">{t("No photos in this scope")}</p>
        : <>
          <div className="overview-photo-grid">
            {sections.photos.rows.map((row) => {
              const name = row.hit.name?.trim() || t("Untitled subject");
              return <article key={row.hit.subject_ref || row.hit.entry_id || `${row.index}`} className={`overview-photo ${selectedRef === row.hit.subject_ref ? "is-focused" : ""}`}>
                <FavoriteButton hit={row.hit} controls={props.favoriteControls} t={t} />
                <button type="button" className="overview-photo-art" aria-label={t("Open details for {{name}}", { name })} onClick={() => props.onOpenHit(row.hit)}>{props.renderThumbnail(row.hit)}</button>
                <div className="overview-row-caption"><strong title={name}>{name}</strong>{tagsFor(row.hit).length > 0 && <small>{tagsFor(row.hit).slice(0, 2).join(" · ")}</small>}</div>
                <div className="overview-row-actions">{selectionButton(row)}{openButton(row.hit)}</div>
              </article>;
            })}
          </div>
          <div className="overview-section-footer"><span>{t("Showing {{shown}} of {{total}}", { shown: sections.photos.rows.length, total: sections.photos.total })}</span><button type="button" onClick={() => onNavigate(photoDestination)}>{t("Browse photos")}<ArrowRight aria-hidden="true" /></button></div>
        </>}
    </section>

    <div className="overview-supporting-grid">
      <section className="overview-audio" aria-label={t("Audio in this scope")}>
        {sectionHeading(<Music2 />, "Audio in this scope", sections.audio)}
        {!musicDestination ? disabledDomain("Music pages are disabled. The audio remains in the current scope.") : sections.audio.total === 0
          ? <p className="overview-empty">{t("No audio in this scope")}</p>
          : <>
            {metadata?.status === "unavailable" && <p className="overview-facts-status" role="status">{t("Audio facts are unavailable; filenames and tags remain available.")}</p>}
            {metadata?.status === "loading" && <p className="overview-facts-status" role="status">{t("Loading recorded audio facts")}</p>}
            <div className="overview-audio-list">
              {sections.audio.rows.map((row) => {
                const name = row.hit.name?.trim() || t("Untitled subject");
                const facts = row.hit.subject_ref ? metadata?.records.get(row.hit.subject_ref) : undefined;
                const track = playableMusicTrack(row.hit, workspaceID, facts);
                const factLine = [facts?.title, facts?.artist, facts?.album].filter(Boolean).join(" · ");
                const fallbackLine = [!facts && metadata?.status === "ready" ? t("No recorded audio facts") : "", row.hit.logical_size != null ? formatBytes(row.hit.logical_size) : "", ...tagsFor(row.hit).slice(0, 1)].filter(Boolean).join(" · ");
                return <article key={row.hit.subject_ref || row.hit.entry_id || `${row.index}`} className={`overview-audio-row ${selectedRef === row.hit.subject_ref ? "is-focused" : ""}`}>
                  <span className="overview-audio-mark" aria-hidden="true"><Music2 /></span>
                  <div className="overview-audio-identity"><strong title={facts?.title || name}>{facts?.title || name}</strong><small>{factLine || fallbackLine}</small></div>
                  <div className="overview-audio-actions">
                    {selectionButton(row)}
                    <FavoriteButton hit={row.hit} controls={props.favoriteControls} t={t} />
                    {onQueueTrack && <button type="button" className="overview-icon-action" disabled={!track} aria-label={t("Queue {{name}}", { name })} title={t("Queue {{name}}", { name })} onClick={() => { if (track) onQueueTrack(track); }}><Plus aria-hidden="true" /></button>}
                    {onPlayTrack && <button type="button" className="overview-icon-action" disabled={!track} aria-label={t("Play {{name}}", { name })} title={t("Play {{name}}", { name })} onClick={() => { if (track) onPlayTrack(track); }}><Play aria-hidden="true" /></button>}
                    {openButton(row.hit)}
                  </div>
                </article>;
              })}
            </div>
            {playableRows.length > 0 && onPlayTracks && <button type="button" className="overview-play-set" onClick={() => onPlayTracks(playableRows.map((row) => row.track))}><Play aria-hidden="true" />{t("Play these {{count}} supported tracks", { count: playableRows.length })}</button>}
            {playableRows.length === 0 && onPlayTracks && <p className="overview-empty">{t("No supported audio in these displayed items")}</p>}
            <div className="overview-section-footer"><span>{t("Showing {{shown}} of {{total}}", { shown: sections.audio.rows.length, total: sections.audio.total })}</span><button type="button" onClick={() => onNavigate(musicDestination)}>{t("Browse music")}<ArrowRight aria-hidden="true" /></button></div>
          </>}
      </section>

      <section className="overview-other" aria-label={t("Other content in this scope")}>
        {sectionHeading(<File />, "Other content in this scope", sections.other)}
        {sections.other.total === 0 ? <p className="overview-empty">{t("No other content in this scope")}</p> : <>
          <div className="overview-other-list">
            {sections.other.rows.map((row) => {
              const name = row.hit.name?.trim() || row.hit.path?.split(/[\\/]/).at(-1) || t("Untitled subject");
              return <article key={row.hit.subject_ref || row.hit.entry_id || `${row.index}`} className={`overview-other-row ${selectedRef === row.hit.subject_ref ? "is-focused" : ""}`}>
                <span className="overview-other-mark" aria-hidden="true"><File /></span>
                <div className="overview-audio-identity"><strong title={name}>{name}</strong><small>{[row.hit.logical_size != null ? formatBytes(row.hit.logical_size) : "", ...tagsFor(row.hit).slice(0, 1)].filter(Boolean).join(" · ")}</small></div>
                <div className="overview-row-actions">{selectionButton(row)}<FavoriteButton hit={row.hit} controls={props.favoriteControls} t={t} />{openButton(row.hit)}</div>
              </article>;
            })}
          </div>
          <p className="overview-section-count">{t("Showing {{shown}} of {{total}}", { shown: sections.other.rows.length, total: sections.other.total })}</p>
        </>}
      </section>
    </div>
  </section>;
}
