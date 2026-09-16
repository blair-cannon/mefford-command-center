"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { authorizedShortcuts, type WorkActor, type WorkTool } from "../lib/workspace-usability";

const iconPaths: Record<string, string> = {
  home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  work: "M9 5h11v15H4V5h2m3-2h6v4H9ZM8 12l2 2 5-5M8 18h8",
  project: "M3 21V7h8v14M11 11h10v10M6 10h2m-2 4h2m-2 4h2m6-4h3m-3 4h3M8 7V3h8v8",
  calendar: "M4 5h16v16H4ZM4 10h16M8 3v4m8-4v4M8 14h2m4 0h2m-8 4h2",
  file: "M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6m-6 4h6",
  chart: "M4 3v18h17M8 17v-5m5 5V8m5 9V4",
  money: "M12 3v18m5-14c-1-3-10-3-10 1s10 4 10 8-9 4-10 1",
  people: "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m14-10a4 4 0 0 0 0-8m6 18v-3a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6ZM8 12l3 3 5-6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  grid: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
  camera: "M3 7h4l2-3h6l2 3h4v14H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  bell: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4",
  help: "M9 8a3 3 0 1 1 5 3l-2 1v3m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  pin: "m9 3 6 0-1 6 4 4H6l4-4Zm3 10v8",
};

export function WorkIcon({ target, name }: { target?: string; name?: string }) {
  const value = target || "";
  const kind = name || (/My Work|Approval|Daily|Review|Quality/.test(value) ? "work"
    : /Calendar|Schedule|Meeting|Quarterly|L10/.test(value) ? "calendar"
    : /Safety/.test(value) ? "shield" : /Contact|People|Team|Employee|Vendor/.test(value) ? "people"
    : /Accounting|Budget|Payable|Billing|Cash|Ledger|WIP|Accounts/.test(value) ? "money"
    : /Health|Dashboard|Funnel|Report/.test(value) ? "chart"
    : /Project Overview/.test(value) ? "project" : /Guide/.test(value) ? "help"
    : /Admin|Settings|Integrations/.test(value) ? "settings" : "file");
  return <svg className="work-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[kind] || iconPaths.file} /></svg>;
}

export function WorkspaceNavigation({ actor, active, tools, onNavigate, workCount, projectActive = false }: { actor: WorkActor; active: string; tools: WorkTool[]; onNavigate: (target: string) => void; workCount: number; projectActive?: boolean }) {
  const [allTools, setAllTools] = useState(false);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[] | null>(null);
  const storageKey = `mefford-work-tools:${actor.email || "employee"}`;
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      queueMicrotask(() => setSaved(Array.isArray(stored) && stored.every((value) => typeof value === "string") ? stored : null));
    } catch { queueMicrotask(() => setSaved(null)); }
  }, [storageKey]);
  const shortcuts = authorizedShortcuts(actor, tools, saved);
  const pinned = shortcuts.map((item) => item.target);
  const primary = ["My Work", "Project Overview", "Dashboard", "Owner Approvals", "Employee Portal"].flatMap((target) => {
    if (target === "Employee Portal" && !actor.permissionLocked) return [];
    const tool = tools.find((item) => item.target === target);
    return tool ? [{ ...tool, label: target === "Project Overview" ? "Projects" : tool.label }] : [];
  });
  const filtered = tools.filter((tool) => `${tool.label} ${tool.group}`.toLowerCase().includes(query.toLowerCase()));
  const groups = [...new Set(filtered.map((tool) => tool.group))];
  function pin(target: string) {
    const next = pinned.includes(target) ? pinned.filter((item) => item !== target) : [...pinned, target];
    setSaved(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Current-session personalization still works. */ }
  }
  function open(target: string) { onNavigate(target); setAllTools(false); setQuery(""); }
  function toolButton(tool: WorkTool) {
    const selected = active === tool.target || (tool.label === "Projects" && projectActive);
    return <button className={`nav-item${selected ? " active" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => open(tool.target)}><WorkIcon target={tool.target} /><span>{tool.label}</span>{tool.target === "My Work" && workCount > 0 ? <b className="nav-count">{workCount}</b> : null}</button>;
  }
  return <>
    <nav className="main-nav task-navigation" aria-label="Command Center Tools">
      <div className="everyday-tools">{primary.map((tool) => <div key={tool.target}>{toolButton(tool)}</div>)}</div>
      <button className="all-tools-link" aria-haspopup="dialog" onClick={() => setAllTools(true)}><WorkIcon name="grid" />All Tools</button>
    </nav>
    {allTools ? createPortal(<div className="tool-directory-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setAllTools(false); }}>
      <section className="tool-directory" role="dialog" aria-modal="true" aria-labelledby="tool-directory-title" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setAllTools(false); } }}>
        <header><h2 id="tool-directory-title">All Tools</h2><button className="directory-close" onClick={() => setAllTools(false)}>Close</button></header>
        <label className="tool-search"><WorkIcon name="search" /><input data-modal-initial-focus type="search" aria-label="Find A Tool" placeholder="Find A Tool…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {!query && shortcuts.length ? <section className="directory-pinned"><h3>Pinned Tools</h3><div>{shortcuts.map((tool) => <div key={tool.target}>{toolButton(tool)}</div>)}</div></section> : null}
        <div className="tool-directory-groups">{groups.map((group) => <section className="tool-group" key={group}><h3>{group}</h3>{filtered.filter((tool) => tool.group === group).map((tool) => <div className="tool-with-pin" key={tool.target}>{toolButton(tool)}{tool.target !== "My Work" ? <button className="pin-tool" aria-label={`${pinned.includes(tool.target) ? "Unpin" : "Pin"} ${tool.label}`} aria-pressed={pinned.includes(tool.target)} onClick={() => pin(tool.target)}><WorkIcon name="pin" /></button> : null}</div>)}</section>)}</div>
        {!filtered.length ? <p className="tool-empty">No Matching Tools</p> : null}
      </section>
    </div>, document.body) : null}
  </>;
}

export function EverydayWork({ tools, onNavigate, projectName, projectNumber, onDailyLog, onPhoto }: { tools: WorkTool[]; onNavigate: (target: string) => void; projectName?: string; projectNumber?: string; onDailyLog?: () => void; onPhoto?: () => void }) {
  return <section className="everyday-work" aria-label="Your Everyday Tools">
    <div className="everyday-work-heading"><h2>Your Tools</h2>{projectNumber ? <button onClick={() => onNavigate("Project Overview")}><WorkIcon name="project" /><strong>{projectName}</strong><span>{projectNumber}</span></button> : null}</div>
    <div className="everyday-work-actions">{tools.filter((tool) => tool.target !== "My Work").map((tool) => <button key={tool.target} onClick={() => tool.target === "Daily Logs" && onDailyLog ? onDailyLog() : onNavigate(tool.target)}><WorkIcon target={tool.target} /><span>{tool.target === "Daily Logs" ? "Add Daily Log" : tool.label}</span></button>)}{onPhoto && tools.some((tool) => tool.target === "Daily Logs") ? <button onClick={onPhoto}><WorkIcon name="camera" /><span>Add Photo</span></button> : null}</div>
  </section>;
}
