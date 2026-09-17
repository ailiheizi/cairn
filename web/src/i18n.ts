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

import { activity } from "./i18n/activity";
import { common } from "./i18n/common";
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

export type Locale = "en" | "zh-CN";
export type Translator = (message: string, values?: Record<string, string | number>) => string;

const chinese: Record<string, string> = {
  ...common,
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
};

export function resolveInitialLocale(): Locale {
  const stored = window.localStorage.getItem("restoreweave.locale");
  if (stored === "en" || stored === "zh-CN") return stored;
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function createTranslator(locale: Locale): Translator {
  return (message, values = {}) => {
    const template = locale === "zh-CN" ? chinese[message] ?? message : message;
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
  };
}
