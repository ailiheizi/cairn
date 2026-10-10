import { LoaderCircle, Star } from "lucide-react";
import type { Translator } from "../i18n";
import type { SearchHit } from "../lib/types";
import type { FavoriteControls } from "../lib/favorites";
import "./FavoriteButton.css";

export function FavoriteButton({ hit, controls, t }: { hit: SearchHit; controls?: FavoriteControls; t: Translator }) {
  if (!controls) return null;
  const subjectRef = hit.subject_ref?.trim() ?? "";
  const known = controls.status === "ready";
  const active = known && controls.isFavorite(subjectRef);
  const pending = controls.isBusy(subjectRef);
  const name = hit.name?.trim() || t("Untitled subject");
  const label = pending ? t("Updating favorite for {{name}}", { name })
    : !known ? t(controls.status === "loading" ? "Loading tags and favorites…" : "Favorite status is unavailable")
    : active ? t("Remove {{name}} from favorites", { name }) : t("Add {{name}} to favorites", { name });
  return <button type="button" className={`favorite-action${active ? " is-favorite" : ""}`} aria-label={label} title={label}
    aria-pressed={known ? active : undefined} aria-busy={pending} disabled={!known || !controls.writable || !subjectRef || pending}
    onClick={(event) => { event.stopPropagation(); controls.onToggle(hit); }}>
    {pending ? <LoaderCircle aria-hidden="true" /> : <Star aria-hidden="true" />}
  </button>;
}
