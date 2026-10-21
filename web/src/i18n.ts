// The one translation surface.
//
// Its public API is unchanged: `Locale`, `Translator`, `resolveInitialLocale`,
// and `createTranslator` are still the whole contract every caller uses. What
// changed is the storage: each browser surface owns its own catalog partial
// under `web/src/i18n/`, and this module merges them.
//
// A partial owns exactly one surface's strings. Adding a key means adding it to
// the partial of the surface that renders it, never to this file; moving a key
// between partials is a presentation change, not a translation change.
// `scripts/web-i18n-check.mjs` proves the split kept every key exactly once.

import { appearance } from "./i18n/appearance";
import { libraryViews } from "./i18n/libraryViews";
import { activity } from "./i18n/activity";
import { common } from "./i18n/common";
import { description } from "./i18n/description";
import { drawers } from "./i18n/drawers";
import { duplicates } from "./i18n/duplicates";
import { library } from "./i18n/library";
import { settings } from "./i18n/settings";
import { searchops } from "./i18n/searchops";
import { report } from "./i18n/report";
import { sources } from "./i18n/sources";
import { status } from "./i18n/status";
import { tags } from "./i18n/tags";
import { verification } from "./i18n/verification";
import { viewer } from "./i18n/viewer";
import { photoExperience } from "./i18n/photoExperience";
import { musicExperience } from "./i18n/musicExperience";
import { queueExperience } from "./i18n/queueExperience";
import { musicBrowseExperience } from "./i18n/musicBrowseExperience";
import { exhibitionExperience } from "./i18n/exhibitionExperience";
import { savedRetrieval } from "./i18n/savedRetrieval";
import { originalTakeout } from "./i18n/originalTakeout";
import { resultScope } from "./i18n/resultScope";
import { overviewExperience } from "./i18n/overviewExperience";
import { favorites } from "./i18n/favorites";
import { photoDaily } from "./i18n/photoDaily";
import { musicDaily } from "./i18n/musicDaily";
import { textPreviewDaily } from "./i18n/textPreviewDaily";
import { intakeDaily } from "./i18n/intakeDaily";
import { photoTakeout } from "./i18n/photoTakeout";
import { musicTakeout } from "./i18n/musicTakeout";
import { selectionDaily } from "./i18n/selectionDaily";
import { searchFilters } from "./i18n/searchFilters";
import { savedRetrievalDaily } from "./i18n/savedRetrievalDaily";
import { globalPaste } from "./i18n/globalPaste";
import { photoReview } from "./i18n/photoReview";
import { musicPlayerDaily } from "./i18n/musicPlayerDaily";
import { notesDaily } from "./i18n/notesDaily";
import { detailNavigation } from "./i18n/detailNavigation";
import { intakeContinuation } from "./i18n/intakeContinuation";
import { multiTag } from "./i18n/multiTag";
import { describeSetup } from "./i18n/describeSetup";
import { folderUpload } from "./i18n/folderUpload";
import { documentSearch } from "./i18n/documentSearch";
import { ocrSearch } from "./i18n/ocrSearch";
import { photoSlideshow } from "./i18n/photoSlideshow";
import { immersiveMusic } from "./i18n/immersiveMusic";
import { visualSearch } from "./i18n/visualSearch";
import { materialList } from "./i18n/materialList";

import { photoVerticalPolish } from "./i18n/photoVerticalPolish";

import { musicVerticalPolish } from "./i18n/musicVerticalPolish";

import { verticalMedia } from "./i18n/verticalMedia";

import { playerVerticalPolish } from "./i18n/playerVerticalPolish";

export type Locale = "en" | "zh-CN";
export type Translator = (message: string, values?: Record<string, string | number>) => string;

const chinese: Record<string, string> = {
  ...playerVerticalPolish,
  ...verticalMedia,
  ...musicVerticalPolish,
  ...photoVerticalPolish,
  ...common,
  ...appearance,
  ...libraryViews,
  ...status,
  ...library,
  ...sources,
  ...drawers,
  ...settings,
  ...viewer,
  ...activity,
  ...verification,
  ...duplicates,
  ...tags,
  ...searchops,
  ...report,
  ...description,
  ...photoExperience,
  ...musicExperience,
  ...savedRetrieval,
  ...queueExperience,
  ...musicBrowseExperience,
  ...exhibitionExperience,
  ...originalTakeout,
  ...resultScope,
  ...overviewExperience,
  ...favorites,
  ...photoDaily,
  ...musicDaily,
  ...textPreviewDaily,
  ...intakeDaily,
  ...photoTakeout,
  ...musicTakeout,
  ...selectionDaily,
  ...searchFilters,
  ...savedRetrievalDaily,
  ...globalPaste,
  ...photoReview,
  ...musicPlayerDaily,
  ...notesDaily,
  ...detailNavigation,
  ...intakeContinuation,
  ...multiTag,
  ...describeSetup,
  ...folderUpload,
  ...documentSearch,
  ...ocrSearch,
  ...photoSlideshow,
  ...immersiveMusic,
  ...visualSearch,
  ...materialList,
};

export function resolveInitialLocale(): Locale {
  const stored = window.localStorage.getItem("cairn.locale");
  if (stored === "en" || stored === "zh-CN") return stored;
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function createTranslator(locale: Locale): Translator {
  return (message, values = {}) => {
    const template = locale === "zh-CN" ? chinese[message] ?? message : message;
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
  };
}
