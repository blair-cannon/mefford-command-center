"use client";

import { useEffect } from "react";

/** A consistent keyboard contract for existing native workspace dialogs. */
export function WorkspaceAccessibility() {
  useEffect(() => {
    const openers = new Map<HTMLElement, HTMLElement | null>();
    let outsideFocus: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = "button:not([disabled]), a[href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex='0']";
    const visible = (element: HTMLElement) => element.getClientRects().length > 0 && !element.closest("[inert], [aria-hidden='true']");
    const dialogs = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(visible);
    function reconcile() {
      for (const [dialog, opener] of openers) {
        if (!dialog.isConnected || !dialog.getClientRects().length) {
          openers.delete(dialog);
          if (opener?.isConnected && visible(opener)) opener.focus();
        }
      }
      const current = dialogs();
      for (const dialog of current) {
        if (openers.has(dialog)) continue;
        openers.set(dialog, document.activeElement instanceof HTMLElement && !dialog.contains(document.activeElement) ? document.activeElement : outsideFocus);
        if (dialog === current.at(-1) && !dialog.contains(document.activeElement)) {
          const first = dialog.querySelector<HTMLElement>("[autofocus], [data-modal-initial-focus]") || [...dialog.querySelectorAll<HTMLElement>(focusable)].find(visible);
          if (first) first.focus();
          else { dialog.tabIndex = -1; dialog.focus(); }
        }
      }
    }
    function rememberFocus(event: FocusEvent) {
      if (event.target instanceof HTMLElement && !event.target.closest('[role="dialog"][aria-modal="true"]')) outsideFocus = event.target;
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const dialog = dialogs().at(-1);
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(focusable)].filter(visible);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    const observer = new MutationObserver(reconcile);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", handleKey);
    document.addEventListener("focusin", rememberFocus);
    reconcile();
    return () => { observer.disconnect(); document.removeEventListener("keydown", handleKey); document.removeEventListener("focusin", rememberFocus); };
  }, []);
  return null;
}
