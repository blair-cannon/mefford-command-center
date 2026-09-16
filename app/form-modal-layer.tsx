"use client";

import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type FormModalLayerProps = {
  children: ReactNode;
  onDismiss: () => void;
  nested?: boolean;
  parentDialogId?: string;
  className?: string;
};

/**
 * One stacking and focus contract for forms opened from inside another form.
 * Nested layers portal to the document root, suspend the parent dialog, and
 * return focus to the control that opened them after Save or Cancel closes it.
 */
export function FormModalLayer({
  children,
  onDismiss,
  nested = false,
  parentDialogId,
  className = "",
}: FormModalLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef(onDismiss);

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!nested) return;

    const opener = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const parentDialog = parentDialogId
      ? document.getElementById(parentDialogId)
      : null;
    const previousAriaHidden = parentDialog?.getAttribute("aria-hidden") ?? null;
    const previousInert = parentDialog?.inert ?? false;

    if (parentDialog) {
      parentDialog.setAttribute("aria-hidden", "true");
      parentDialog.inert = true;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    const focusFrame = window.requestAnimationFrame(() => {
      layerRef.current
        ?.querySelector<HTMLElement>(
          "[data-modal-initial-focus], input:not([type='hidden']):not([type='file']):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
        )
        ?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (parentDialog) {
        parentDialog.inert = previousInert;
        if (previousAriaHidden === null) parentDialog.removeAttribute("aria-hidden");
        else parentDialog.setAttribute("aria-hidden", previousAriaHidden);
      }
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, [nested, parentDialogId]);

  const layer = (
    <div
      ref={layerRef}
      className={`modal-layer${nested ? " nested-form-layer" : ""}${className ? ` ${className}` : ""}`}
      data-form-layer={nested ? "nested" : "base"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismissRef.current();
      }}
    >
      {children}
    </div>
  );

  if (!nested) return layer;
  if (typeof document === "undefined") return null;
  return createPortal(layer, document.body);
}
