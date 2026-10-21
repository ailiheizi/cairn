import { useCallback, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import { useBrowsePositionRegistry, useBrowsePositionScopeIdentity, type BrowsePositionBookmark } from "./ClientBrowseSession";

type Options = {
  slotKey: string;
  signature: string;
  containerRef: RefObject<HTMLElement | null>;
  ready?: boolean;
  restoreKey?: unknown;
  anchorSelector?: string;
  onUnresolved?: (bookmark: BrowsePositionBookmark) => boolean | void;
  resetOnMissing?: boolean;
};

function findScroller(container: HTMLElement): HTMLElement | null {
  for (let parent = container.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight + 1) return parent;
  }
  return null;
}

function viewBounds(container: HTMLElement) {
  const scroller = findScroller(container);
  if (!scroller) return { scroller, top: 0, bottom: window.innerHeight };
  const rect = scroller.getBoundingClientRect();
  return { scroller, top: rect.top, bottom: rect.bottom };
}

function findAnchor(container: HTMLElement, selector: string, preferred?: string): HTMLElement | undefined {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(selector));
  if (preferred) {
    const exact = candidates.find((node) => node.dataset.subjectRef === preferred || node.dataset.browseKey === preferred);
    if (exact) return exact;
  }
  const bounds = viewBounds(container);
  return candidates.find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  });
}

function findVisibleAnchor(container: HTMLElement, selector: string): HTMLElement | undefined {
  const bounds = viewBounds(container);
  const rect = container.getBoundingClientRect();
  const top = Math.max(bounds.top, rect.top) + 1;
  const bottom = Math.min(bounds.bottom, rect.bottom);
  if (top >= bottom) return undefined;
  const left = Math.max(0, rect.left);
  const right = Math.min(window.innerWidth, rect.right);
  const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
  for (const y of [top, Math.min(bottom - 1, top + 24), Math.min(bottom - 1, top + 56)]) {
    for (const fraction of [0.2, 0.5, 0.8]) {
      const x = left + Math.max(1, right - left) * fraction;
      for (const node of document.elementsFromPoint(x, y)) {
        if (!container.contains(node)) continue;
        const match = node instanceof HTMLElement ? node.closest<HTMLElement>(selector) : node.parentElement?.closest<HTMLElement>(selector);
        if (match && container.contains(match) && selectors.some((candidate) => match.matches(candidate))) return match;
      }
    }
  }
  const fallback = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return fallback.find((node) => {
    const itemRect = node.getBoundingClientRect();
    return itemRect.bottom > bounds.top && itemRect.top < bounds.bottom;
  });
  return undefined;
}

function anchorIdentity(node: HTMLElement): string {
  return node.dataset.subjectRef?.trim() || node.dataset.browseKey?.trim() || "";
}

function adjustScrollToAnchor(container: HTMLElement, node: HTMLElement, offset: number) {
  const bounds = viewBounds(container);
  const delta = node.getBoundingClientRect().top - bounds.top - offset;
  if (Math.abs(delta) < 1) return;
  if (bounds.scroller) bounds.scroller.scrollTop += delta;
  else window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
}

export function useBrowsePosition({ slotKey, signature, containerRef, ready = true, restoreKey, anchorSelector = "[data-subject-ref], [data-browse-key]", onUnresolved, resetOnMissing = true }: Options) {
  const registry = useBrowsePositionRegistry();
  const scopeIdentity = useBrowsePositionScopeIdentity();
  const fullSignature = JSON.stringify([scopeIdentity, signature]);
  const existingSlot = registry?.slots.get(slotKey);
  if (existingSlot && existingSlot.signature !== fullSignature) {
    // Local query/group/sort changes invalidate the old anchor immediately;
    // returning to an earlier-looking filter must not revive a stale position.
    existingSlot.bookmark = undefined;
    existingSlot.restorePending = false;
    existingSlot.capturePaused = false;
    existingSlot.signature = fullSignature;
  }
  const latest = useRef({ signature: fullSignature, containerRef, anchorSelector, ready, onUnresolved, resetOnMissing });
  latest.current = { signature: fullSignature, containerRef, anchorSelector, ready, onUnresolved, resetOnMissing };
  const resetContext = `${slotKey}\u0000${fullSignature}`;
  const lastResetContext = useRef("");
  const pendingResizeObserver = useRef<ResizeObserver | null>(null);
  const retryRestoreRef = useRef<() => void>(() => {});

  const capture = useCallback((requestedFocusAnchor?: string): BrowsePositionBookmark | undefined => {
    const { containerRef: ref, anchorSelector: selector, signature: currentSignature } = latest.current;
    const container = ref.current;
    if (!container) return undefined;
    const node = findVisibleAnchor(container, selector);
    const anchor = node && anchorIdentity(node);
    if (!node || !anchor) return undefined;
    const bounds = viewBounds(container);
    const active = document.activeElement;
    const focusedNode = active instanceof HTMLElement ? active.closest<HTMLElement>(selector) : null;
    const requestedNode = requestedFocusAnchor ? findAnchor(container, selector, requestedFocusAnchor) : undefined;
    const requestedIdentity = requestedNode && anchorIdentity(requestedNode) === requestedFocusAnchor ? requestedFocusAnchor : "";
    const focusedAnchor = requestedIdentity || (focusedNode && container.contains(focusedNode) ? anchorIdentity(focusedNode) : "");
    return { anchor, offset: node.getBoundingClientRect().top - bounds.top, focusedAnchor: focusedAnchor || undefined, signature: currentSignature };
  }, []);

  const captureNow = useCallback(() => {
    if (!registry || registry.identity !== scopeIdentity) return;
    const slot = registry.slots.get(slotKey);
    if (slot?.restorePending || slot?.capturePaused) return;
    const bookmark = capture();
    if (slot?.signature === latest.current.signature) slot.bookmark = bookmark;
  }, [capture, registry, scopeIdentity, slotKey]);

  const resetTop = useCallback(() => {
    const container = latest.current.containerRef.current;
    const scroller = container ? findScroller(container) : null;
    if (scroller) scroller.scrollTop = 0;
    else window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const restore = useCallback(() => {
    if (!registry) return;
    const slot = registry.slots.get(slotKey);
    const bookmark = slot?.bookmark;
    if (!slot || slot.capturePaused || !slot.restorePending || slot.signature !== latest.current.signature || !bookmark || bookmark.signature !== latest.current.signature || !latest.current.ready) return;
    const container = latest.current.containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (!container.isConnected || container.getClientRects().length === 0 || rect.width <= 0 || rect.height <= 0) {
      if (typeof ResizeObserver !== "undefined" && !pendingResizeObserver.current) {
        const observer = new ResizeObserver(() => {
          const current = latest.current.containerRef.current;
          const currentRect = current?.getBoundingClientRect();
          if (!current || !current.isConnected || current.getClientRects().length === 0 || !currentRect || currentRect.width <= 0 || currentRect.height <= 0) return;
          observer.disconnect();
          pendingResizeObserver.current = null;
          retryRestoreRef.current();
        });
        pendingResizeObserver.current = observer;
        observer.observe(container);
      }
      return;
    }
    const node = findAnchor(container, latest.current.anchorSelector, bookmark.anchor);
    if (!node || anchorIdentity(node) !== bookmark.anchor) {
      const pending = latest.current.onUnresolved?.(bookmark);
      if (pending !== true) {
        pendingResizeObserver.current?.disconnect();
        pendingResizeObserver.current = null;
        slot.bookmark = undefined;
        slot.restorePending = false;
        if (latest.current.resetOnMissing) resetTop();
      }
      return;
    }
    adjustScrollToAnchor(container, node, bookmark.offset);
    pendingResizeObserver.current?.disconnect();
    pendingResizeObserver.current = null;
    if (bookmark.focusedAnchor) {
      const focusedNode = findAnchor(container, latest.current.anchorSelector, bookmark.focusedAnchor);
      const focusTarget = focusedNode && anchorIdentity(focusedNode) === bookmark.focusedAnchor
        ? focusedNode.matches("button, a, [tabindex]:not([tabindex='-1'])")
          ? focusedNode
          : focusedNode.querySelector<HTMLElement>(".result-open-copy, .photo-card__image") ??
            focusedNode.querySelector<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")
        : undefined;
      focusTarget?.focus({ preventScroll: true });
    }
    slot.restorePending = false;
  }, [registry, resetTop, slotKey]);
  retryRestoreRef.current = restore;

  useLayoutEffect(() => {
    if (!registry || !latest.current.ready) return undefined;
    const registeredIdentity = registry.identity;
    if (registeredIdentity !== scopeIdentity) return undefined;
    let slot = registry.slots.get(slotKey);
    if (slot && slot.signature !== latest.current.signature) {
      slot.bookmark = undefined;
      slot.restorePending = false;
      slot.capturePaused = false;
      slot.signature = latest.current.signature;
    }
    if (!slot) slot = { signature: latest.current.signature };
    slot.capture = capture;
    slot.restore = restore;
    registry.slots.delete(slotKey);
    registry.slots.set(slotKey, slot);
    while (registry.slots.size > 8) {
      const oldest = registry.slots.keys().next().value as string | undefined;
      if (!oldest) break;
      registry.slots.delete(oldest);
    }
    registry.activeSlot = slotKey;
    let frame = 0;
    const onScroll = () => {
      if (registry.identity !== registeredIdentity) return;
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; captureNow(); });
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
      pendingResizeObserver.current?.disconnect();
      pendingResizeObserver.current = null;
      const current = registry.slots.get(slotKey);
      if (current?.capture === capture) {
        current.capture = undefined;
        current.restore = undefined;
        if (current.signature === fullSignature && current.bookmark?.signature === fullSignature) {
          current.restorePending = true;
        }
      }
      if (registry.activeSlot === slotKey) registry.activeSlot = "";
    };
  }, [capture, captureNow, registry, restore, scopeIdentity, fullSignature, slotKey, ready]);

  useLayoutEffect(() => {
    if (!registry || !latest.current.ready) return;
    const slot = registry.slots.get(slotKey);
    if (slot?.restorePending) {
      lastResetContext.current = resetContext;
      restore();
      return;
    }
    if (latest.current.resetOnMissing && lastResetContext.current !== resetContext) {
      lastResetContext.current = resetContext;
      resetTop();
    }
  }, [ready, registry, restore, restoreKey, resetContext, resetTop, signature, slotKey]);

  return { capture: captureNow, restore };
}
