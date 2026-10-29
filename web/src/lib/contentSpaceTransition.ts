import { flushSync } from "react-dom";

export type ContentSpaceKey = "home" | "library" | "photos" | "music" | "videos";

type NativeViewTransition = {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition: () => void;
};

type TransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => NativeViewTransition;
};

type ActiveTransition = {
  transition: NativeViewTransition;
  source: HTMLElement;
  sourceName: string;
  target?: HTMLElement;
  targetName: string;
};

let generation = 0;
let activeTransition: ActiveTransition | undefined;
let homeReturnOrigin: Exclude<ContentSpaceKey, "home"> | undefined;

function targetFor(key: ContentSpaceKey): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(`[data-content-space-target="${key}"]`) ?? undefined;
}

function originFor(key: Exclude<ContentSpaceKey, "home">): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(`[data-content-space-origin="${key}"]`) ?? undefined;
}

function destinationFor(key: ContentSpaceKey): HTMLElement | undefined {
  if (key === "home" && homeReturnOrigin) return originFor(homeReturnOrigin) ?? targetFor("home");
  return targetFor(key);
}

function setSharedName(element: HTMLElement): void {
  element.style.setProperty("view-transition-name", "cairn-content-space");
}

function restoreSharedName(element: HTMLElement | undefined, previous: string): void {
  if (!element) return;
  if (previous) element.style.setProperty("view-transition-name", previous);
  else element.style.removeProperty("view-transition-name");
}

function focusTarget(target: HTMLElement | undefined): void {
  if (!target?.isConnected) return;
  const focusable = target.matches("button:not([disabled]), [href], [tabindex]")
    ? target
    : target.querySelector<HTMLElement>("button:not([disabled]), [href], [tabindex]") ?? target;
  focusable.focus({ preventScroll: true });
}

function clearActive(record: ActiveTransition): void {
  restoreSharedName(record.source, record.sourceName);
  restoreSharedName(record.target, record.targetName);
  if (activeTransition === record) {
    delete document.documentElement.dataset.contentSpaceTransition;
    activeTransition = undefined;
  }
}

function skipActiveTransition(): void {
  if (!activeTransition) return;
  const record = activeTransition;
  try { record.transition.skipTransition(); } catch { /* it may already have finished */ }
  clearActive(record);
}

/**
 * Wrap one explicit UI navigation in a same-document shared-element transition.
 * Programmatic/hash restoration must keep using its existing immediate handler.
 */
export function transitionContentSpace(update: () => void, source: HTMLElement | undefined, destination: ContentSpaceKey, origin?: Exclude<ContentSpaceKey, "home"> | null): void {
  const doc = document as TransitionDocument;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const targetNow = destinationFor(destination);

  if (destination === "home") {
    if (origin === null) homeReturnOrigin = undefined;
  } else if (origin) {
    homeReturnOrigin = origin;
  }

  const sourceElement = source?.isConnected ? source : undefined;
  if (!doc.startViewTransition || reducedMotion || !sourceElement || sourceElement === targetNow) {
    skipActiveTransition();
    const token = ++generation;
    update();
    requestAnimationFrame(() => {
      if (generation === token) focusTarget(destinationFor(destination));
    });
    return;
  }

  skipActiveTransition();
  const token = ++generation;
  const sourceName = sourceElement.style.getPropertyValue("view-transition-name");
  setSharedName(sourceElement);
  document.documentElement.dataset.contentSpaceTransition = "active";

  let applied = false;
  let record: ActiveTransition | undefined;
  try {
    let transition: NativeViewTransition | undefined;
    transition = doc.startViewTransition(() => {
      if (token !== generation || applied) return;
      applied = true;
      flushSync(update);
      const target = destinationFor(destination);
      if (!target || target === sourceElement) return;
      const targetName = target.style.getPropertyValue("view-transition-name");
      setSharedName(target);
      if (!transition) return;
      record = { transition, source: sourceElement, sourceName, target, targetName };
      activeTransition = record;
    });
    if (!transition) throw new Error("View transition did not start");
    record ??= { transition, source: sourceElement, sourceName, targetName: "" };
    activeTransition = record;
    void transition.ready.catch(() => {
      if (token === generation && record) clearActive(record);
    });
    void transition.finished.then(() => {
      if (token !== generation || !record) return;
      focusTarget(destinationFor(destination));
      clearActive(record);
    }, () => {
      if (token === generation && record) clearActive(record);
    });
  } catch {
    if (!applied && token === generation) {
      applied = true;
      update();
    }
    if (record) clearActive(record);
    else restoreSharedName(sourceElement, sourceName);
    if (token === generation) delete document.documentElement.dataset.contentSpaceTransition;
    requestAnimationFrame(() => { if (token === generation) focusTarget(destinationFor(destination)); });
  }
}
