"use client";

import { useEffect, useState } from "react";
import { PHOTO_UPLOAD_ACCEPT, VIDEO_UPLOAD_ACCEPT } from "../lib/photo-uploads";
import { applyDroppedFiles } from "../lib/file-drop-uploads";
import { CloseButton } from "./close-button";

function uploadKind(current: string) {
  const values = current.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!values.length) return "unrestricted";
  if (values.every((item) => item.startsWith("image/") || PHOTO_UPLOAD_ACCEPT.toLowerCase().split(",").includes(item))) return "photo";
  if (values.every((item) => item.startsWith("video/") || VIDEO_UPLOAD_ACCEPT.toLowerCase().split(",").includes(item))) return "video";
  return "files";
}

function applyPlatformUploadPolicy(input: HTMLInputElement) {
  if (input.type !== "file") return;
  if (input.dataset.formatRequired === "true") return;
  const current = input.accept.trim();
  const kind = uploadKind(current);
  if (kind === "photo" && current !== PHOTO_UPLOAD_ACCEPT) input.accept = PHOTO_UPLOAD_ACCEPT;
  else if (kind === "video" && current !== VIDEO_UPLOAD_ACCEPT) input.accept = VIDEO_UPLOAD_ACCEPT;
  else if (kind === "files") input.removeAttribute("accept");
}

export function PhotoUploadCompatibility() {
  const [error, setError] = useState("");
  useEffect(() => {
    const enhanced = new Map<HTMLLabelElement, { tabIndex: string | null; role: string | null; describedBy: string | null }>();
    function enhance(input: HTMLInputElement) {
      if (input.type !== "file") return;
      applyPlatformUploadPolicy(input);
      // Dedicated camera buttons keep capture behavior. The companion library picker is the drop target.
      if (input.hasAttribute("data-field-camera")) return;
      const label = input.labels?.[0];
      if (!label) return; // The estimate folder already owns its drop behavior; spreadsheet import is not an image upload.
      if (!enhanced.has(label)) enhanced.set(label, { tabIndex: label.getAttribute("tabindex"), role: label.getAttribute("role"), describedBy: label.getAttribute("aria-describedby") });
      const disabled = input.matches(":disabled");
      label.dataset.fileDropzone = "true";
      label.dataset.fileDropDisabled = String(disabled);
      label.dataset.fileDropHint = disabled ? "Upload Unavailable" : input.multiple ? "Drop Files Here Or Click To Browse" : "Drop A File Here Or Click To Browse";
      label.tabIndex = disabled ? -1 : 0;
      label.setAttribute("role", "button");
      label.setAttribute("aria-disabled", String(disabled));
      const describedBy = enhanced.get(label)?.describedBy;
      label.setAttribute("aria-describedby", [describedBy, "file-drop-instructions"].filter(Boolean).join(" "));
    }
    function scan(root: Document | HTMLElement) { root.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(enhance); }
    function restore(label: HTMLLabelElement) {
      const original = enhanced.get(label);
      if (!original) return;
      for (const [name, value] of [["tabindex", original.tabIndex], ["role", original.role], ["aria-describedby", original.describedBy]] as const) {
        if (value === null) label.removeAttribute(name); else label.setAttribute(name, value);
      }
      for (const name of ["data-file-dropzone", "data-file-drop-disabled", "data-file-drop-hint", "data-file-dragging", "aria-disabled"]) label.removeAttribute(name);
      enhanced.delete(label);
    }
    scan(document);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
          if (mutation.target instanceof HTMLInputElement) enhance(mutation.target);
          else scan(mutation.target); // A disabled fieldset must block drops too.
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node instanceof HTMLInputElement) enhance(node);
          scan(node);
        }
      }
      for (const label of enhanced.keys()) if (!label.isConnected || (!label.querySelector('input[type="file"]') && !label.control)) restore(label);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["accept", "disabled"] });
    const target = (event: Event) => event.target instanceof Element ? event.target.closest<HTMLLabelElement>('[data-file-dropzone="true"]') : null;
    const inputFor = (label: HTMLLabelElement | null) => label?.control instanceof HTMLInputElement && label.control.type === "file" ? label.control : label?.querySelector<HTMLInputElement>('input[type="file"]');
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes("Files");
    function clearDrag() { for (const label of enhanced.keys()) delete label.dataset.fileDragging; }
    function dragOver(event: DragEvent) {
      if (!hasFiles(event) || event.defaultPrevented) return;
      event.preventDefault(); // Never navigate away from unsaved work when a file misses its target.
      clearDrag();
      const label = target(event), input = inputFor(label);
      const allowed = input && !input.matches(":disabled");
      if (event.dataTransfer) event.dataTransfer.dropEffect = allowed ? "copy" : "none";
      if (label && allowed) label.dataset.fileDragging = "true";
    }
    function dragLeave(event: DragEvent) {
      const label = target(event);
      if (label && (!(event.relatedTarget instanceof Node) || !label.contains(event.relatedTarget))) delete label.dataset.fileDragging;
    }
    function drop(event: DragEvent) {
      clearDrag();
      if (!hasFiles(event) || event.defaultPrevented) return;
      event.preventDefault();
      const input = inputFor(target(event));
      if (!input || !event.dataTransfer) return;
      event.stopPropagation();
      if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) {
        setError("Choose Files Instead Of A Folder."); return;
      }
      setError(applyDroppedFiles(input, event.dataTransfer.files));
    }
    function keyDown(event: KeyboardEvent) {
      const label = target(event), input = inputFor(label);
      if (event.target !== label || !input || input.matches(":disabled") || !["Enter", " "].includes(event.key)) return;
      event.preventDefault(); input.click();
    }
    document.addEventListener("dragover", dragOver);
    document.addEventListener("dragleave", dragLeave);
    document.addEventListener("drop", drop);
    document.addEventListener("dragend", clearDrag);
    document.addEventListener("keydown", keyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener("dragover", dragOver);
      document.removeEventListener("dragleave", dragLeave);
      document.removeEventListener("drop", drop);
      document.removeEventListener("dragend", clearDrag);
      document.removeEventListener("keydown", keyDown);
      for (const label of enhanced.keys()) restore(label);
    };
  }, []);
  return <><span id="file-drop-instructions" className="sr-only">Drop Files Here Or Click To Browse. Press Enter Or Space To Choose Files.</span>{error ? <div className="file-drop-error" role="alert"><span>{error}</span><CloseButton aria-label="Dismiss Upload Message" onClick={() => setError("")} /></div> : null}</>;
}
