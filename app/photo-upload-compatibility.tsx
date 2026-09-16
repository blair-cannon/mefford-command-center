"use client";

import { useEffect } from "react";
import { PHOTO_UPLOAD_ACCEPT, VIDEO_UPLOAD_ACCEPT } from "../lib/photo-uploads";

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
  useEffect(() => {
    document.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(applyPlatformUploadPolicy);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.target instanceof HTMLInputElement) {
          applyPlatformUploadPolicy(mutation.target);
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node instanceof HTMLInputElement) applyPlatformUploadPolicy(node);
          node.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(applyPlatformUploadPolicy);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["accept"] });
    return () => observer.disconnect();
  }, []);
  return null;
}
