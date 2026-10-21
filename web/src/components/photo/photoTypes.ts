import type { ComponentProps } from "react";
import type { FavoriteControls } from "../../lib/favorites";
import type { SearchHit } from "../../lib/types";
import type { ResultList } from "../ResultList";

export type PhotoItem = { hit: SearchHit; index: number; format: string; previewable: boolean };

export type PhotoLibraryExperienceProps = ComponentProps<typeof ResultList> & {
  onOpenHit: (hit: SearchHit) => void;
  /** App-owned focus carried across same-context page presentations. */
  focusedSubjectRef?: string;
  onFocusSubject?: (subjectRef: string) => void;
  onShowSelectionActions?: () => void;
  onSelectSubjects?: (subjects: SearchHit[], mode: "add" | "remove" | "invert") => void;
  onImageSearch?: (subjectRef: string) => void;
  onVisualTextSearch?: (description: string) => void;
  imageSearchBusy?: boolean;
  onDownloadOriginals?: (subjects: SearchHit[]) => void;
  originalTakeoutBusy?: boolean;
  loading?: boolean;
  error?: string;
  favoriteControls?: FavoriteControls;
};

export type PhotoSharedProps = Pick<PhotoLibraryExperienceProps, "command" | "locale" | "t">;
