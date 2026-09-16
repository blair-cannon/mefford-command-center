"use client";

import { authorizedProjectAreas } from "../lib/project-workspace";
import type { WorkTool } from "../lib/workspace-usability";
import { WorkIcon } from "./workspace-navigation";

export function ProjectWorkspace({ tools, area, onAreaChange, onNavigate, onSummary, onSettings, onNewProject }: {
  tools: WorkTool[];
  area: string;
  onAreaChange: (area: string) => void;
  onNavigate: (target: string) => void;
  onSummary: () => void;
  onSettings?: () => void;
  onNewProject?: () => void;
}) {
  const areas = authorizedProjectAreas(tools);
  const current = areas.find((item) => item.id === area) || areas[0];
  const index = areas.findIndex((item) => item.id === current?.id);
  return <section className="project-workspace-home" aria-labelledby="project-workspace-heading">
    <header className="project-workspace-heading"><h1 id="project-workspace-heading">Project Workspace</h1><div className="project-workspace-utilities">
      {tools.some((tool) => tool.target === "Documents") ? <button onClick={() => onNavigate("Documents")}><WorkIcon name="file" />Project Files</button> : null}
      <button onClick={onSummary}><WorkIcon name="chart" />Project Summary</button>
      {onSettings ? <button onClick={onSettings}><WorkIcon name="settings" />Project Information</button> : null}
    </div></header>
    <label className="project-work-area-picker">Work Area<select value={current?.id || ""} onChange={(event) => onAreaChange(event.target.value)}>{areas.map((item, position) => <option value={item.id} key={item.id}>{position + 1}. {item.label}</option>)}</select></label>
    <nav className="project-work-areas" aria-label="Project Work Areas">{areas.map((item, position) => <button key={item.id} aria-current={current?.id === item.id ? "step" : undefined} aria-controls="project-area-tools" onClick={() => onAreaChange(item.id)}><span aria-hidden="true">{position + 1}</span>{item.label}</button>)}</nav>
    {current ? <section className="project-area-panel" id="project-area-tools" aria-labelledby="project-area-heading">
      <h2 id="project-area-heading">{current.label}</h2>
      <div className="project-area-tools">{current.tools.map((tool) => <button key={tool.target} onClick={() => onNavigate(tool.target)}><WorkIcon target={tool.target} /><span>{tool.label}</span><span aria-hidden="true">→</span></button>)}</div>
      <div className="project-area-navigation"><button disabled={index <= 0} onClick={() => onAreaChange(areas[index - 1].id)}>← Back</button>{index < areas.length - 1 ? <button onClick={() => onAreaChange(areas[index + 1].id)}>Next: {areas[index + 1].label} →</button> : null}</div>
    </section> : <p>No Project Tools Available For Your Access.</p>}
    {onNewProject ? <button className="project-new-job" onClick={onNewProject}>＋ Start New Job</button> : null}
  </section>;
}
