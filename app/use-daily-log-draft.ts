"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readUnfinishedWork, removeUnfinishedWork, saveUnfinishedWork } from "../lib/mobile-client";
import { draftStorageKey } from "../lib/workspace-usability";

export function useDailyLogDraft({ enabled, email, projectId, data, files, hasContent }: { enabled: boolean; email: string; projectId: string; data: Record<string, unknown>; files: File[]; hasContent: boolean }) {
  const key = draftStorageKey(email, projectId, "Daily Logs");
  const [session, setSession] = useState<{ key: string; ready: boolean; candidate: Awaited<ReturnType<typeof readUnfinishedWork>>; status: string }>({ key: "", ready: false, candidate: null, status: "" });
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const pausedKey = useRef("");
  useEffect(() => {
    if (!enabled || !email || !projectId) return;
    let cancelled = false;
    pausedKey.current = "";
    void writes.current.catch(() => undefined).then(() => readUnfinishedWork(key)).then((candidate) => {
      if (!cancelled) setSession({ key, ready: true, candidate, status: candidate ? "An Unfinished Daily Log Is Saved On This Device" : "Draft Not Yet Saved" });
    }).catch((error: unknown) => { if (!cancelled) setSession({ key, ready: false, candidate: null, status: error instanceof Error ? error.message : "Device Draft Storage Is Unavailable. Keep This Form Open Until You Submit." }); });
    return () => { cancelled = true; };
  }, [enabled, email, projectId, key]);

  const save = useCallback(async () => {
    if (!enabled || !email || !projectId || !hasContent || session.candidate || pausedKey.current === key) return true;
    if (!session.ready || session.key !== key) return false;
    setSession((current) => ({ ...current, status: "Saving Draft On This Device…" }));
    const task = writes.current.catch(() => undefined).then(() => pausedKey.current === key ? undefined : saveUnfinishedWork(key, data, files));
    writes.current = task;
    try {
      const at = await task;
      if (at) setSession((current) => current.key === key ? { ...current, status: `Draft Saved On This Device · ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` } : current);
      return true;
    } catch {
      setSession((current) => ({ ...current, status: "Draft Could Not Be Saved. Keep This Form Open And Try Again." }));
      return false;
    }
  }, [enabled, email, projectId, hasContent, session.candidate, session.ready, session.key, key, data, files]);

  useEffect(() => {
    if (!enabled || !hasContent || !session.ready || session.key !== key || session.candidate) return;
    const timer = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(timer);
  }, [enabled, hasContent, session.ready, session.key, session.candidate, key, save]);

  useEffect(() => {
    if (!enabled || !hasContent) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [enabled, hasContent]);

  async function clear() {
    pausedKey.current = key;
    await writes.current.catch(() => undefined);
    await removeUnfinishedWork(key);
  }
  async function discard() {
    try {
      await clear();
      pausedKey.current = "";
      setSession({ key, ready: true, candidate: null, status: "New Daily Log" });
    } catch { setSession((current) => ({ ...current, status: "The Saved Draft Could Not Be Removed. Try Again." })); }
  }
  function restored() { setSession((current) => ({ ...current, candidate: null, status: "Draft Restored. Review The Date And Project Before Finalizing." })); }
  return { candidate: session.key === key ? session.candidate : null, status: session.key === key ? session.status : "Checking Saved Draft…", save, clear, discard, restored };
}
