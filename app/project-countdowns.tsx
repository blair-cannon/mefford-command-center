"use client";

import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { completionDateLabel, countdownProjects, projectCountdown, type CountdownProject } from "../lib/project-countdowns";

export const DASHBOARD_DISPLAY_URL = "https://mefford-dashboard-display.jordan-mefor-1272.chatgpt.site/?dashboard=countdowns";

function useCountdownClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      setNow(Date.now());
      timer = setTimeout(update, 60_000 - Date.now() % 60_000 + 30);
    };
    timer = setTimeout(update, 0);
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  return now;
}

function CompletionClock({ project, milestone, now, compact = false }: { project: CountdownProject; milestone: "substantial" | "final"; now: number | null; compact?: boolean }) {
  const state = projectCountdown(project, milestone, now ?? 0);
  const label = milestone === "substantial" ? "Substantial Completion" : "Final Completion";
  const hasClock = state.status === "counting" || state.status === "overdue";
  const status = state.status === "complete" ? "Complete" : state.status === "cancelled" ? "Cancelled" : "Date Not Set";
  return <span className={`completion-clock ${state.status}${compact ? " compact" : ""}`}>
    <span className="completion-clock-label">{label}</span>
    {hasClock ? <span className="completion-digits" aria-label={now === null ? "Loading Countdown" : `${state.days} Days, ${state.hours} Hours, ${state.minutes} Minutes ${state.status === "overdue" ? "Overdue" : "Remaining"}`}>
      {([state.days, state.hours, state.minutes] as const).map((value, index) => <Fragment key={index}>{index > 0 && !compact ? <span className="completion-colon" aria-hidden="true">:</span> : null}<span className="completion-digit" aria-hidden="true"><b>{now === null ? "—" : String(value).padStart(2, "0")}</b><small>{compact ? ["d", "h", "m"][index] : ["Days", "Hours", "Minutes"][index]}</small></span></Fragment>)}
    </span> : <strong className="completion-clock-state">{status}</strong>}
    {state.deadline !== null ? <span className="completion-date">{state.status === "overdue" && now !== null ? <b>Overdue · </b> : state.status === "complete" ? "Target · " : null}{completionDateLabel(state.deadline, project.timeZone, !compact)}</span> : null}
  </span>;
}

export function ProjectCompletionCountdowns({ project }: { project: CountdownProject }) {
  const now = useCountdownClock();
  return <section className="project-completion-countdowns" aria-label="Project Completion Countdowns">
    <article><CompletionClock project={project} milestone="substantial" now={now} /></article>
    <article><CompletionClock project={project} milestone="final" now={now} /></article>
  </section>;
}

export function CompanyCompletionCountdowns<T extends CountdownProject>({ projects, onOpenProject }: { projects: T[]; onOpenProject: (project: T) => void }) {
  const now = useCountdownClock();
  const ordered = countdownProjects(projects);
  return <section className="company-completion-countdowns" aria-labelledby="company-completion-title">
    <header><h2 id="company-completion-title">Project Completion</h2><span>{ordered.length} Project{ordered.length === 1 ? "" : "s"} · Nearest Deadline First</span></header>
    <div className="completion-register-head" aria-hidden="true"><span>Project</span><span>Substantial Completion</span><span>Final Completion</span></div>
    <div className="completion-register">
      {ordered.map(project => <button type="button" className="completion-register-row" key={project.number} onClick={() => onOpenProject(project)} aria-label={`Open ${project.name} Project Overview`}>
        <span className="completion-project"><strong>{project.name}</strong><small>{project.number}{project.status !== "Active" ? ` · ${project.status}` : ""}</small></span>
        <CompletionClock project={project} milestone="substantial" now={now} compact />
        <CompletionClock project={project} milestone="final" now={now} compact />
      </button>)}
      {!ordered.length ? <p className="completion-empty">No Projects To Display</p> : null}
    </div>
  </section>;
}

export function CompletionDisplayBoard({ projects }: { projects: CountdownProject[] }) {
  const now = useCountdownClock();
  const ordered = countdownProjects(projects);
  return <section className="completion-display-board" aria-label="All Project Completion Countdowns" style={{ "--completion-row-count": Math.max(1, ordered.length) } as CSSProperties}>
    <div className="completion-display-head" aria-hidden="true"><span>All Projects</span><span>Substantial Completion</span><span>Final Completion</span></div>
    <div className="completion-display-rows">{ordered.map(project => <article className="completion-display-row" key={project.number}>
      <div className="completion-project"><strong>{project.name}</strong><small>{project.number}{project.status !== "Active" ? ` · ${project.status}` : ""}</small><small>{project.site}</small></div>
      <CompletionClock project={project} milestone="substantial" now={now} />
      <CompletionClock project={project} milestone="final" now={now} />
    </article>)}</div>
    {!ordered.length ? <p className="completion-empty">No Projects To Display</p> : null}
    <footer><span>Countdowns Update Automatically</span><span>{ordered.length} Project{ordered.length === 1 ? "" : "s"} · Read Only</span></footer>
  </section>;
}
