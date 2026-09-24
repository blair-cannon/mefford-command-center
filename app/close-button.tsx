"use client";

import type { ButtonHTMLAttributes } from "react";

type CloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "dangerouslySetInnerHTML">;

/** One close control for workspaces, dialogs, and dismissible messages. */
export function CloseButton({ className = "", type = "button", "aria-label": label = "Close", ...props }: CloseButtonProps) {
  return <button {...props} type={type} aria-label={label} className={`ui-close-button ${className}`.trim()}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  </button>;
}
