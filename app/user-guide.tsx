"use client";

import { useMemo, useState } from "react";
import guide from "../content/user-guide.json";

type GuideChapter = (typeof guide.chapters)[number];

function chapterMatches(chapter: GuideChapter, query: string) {
  if (!query) return true;
  const searchable = [chapter.title, chapter.audience, chapter.purpose, ...chapter.steps, ...chapter.notes].join(" ").toLowerCase();
  return searchable.includes(query.toLowerCase());
}

export function UserGuideWorkspace() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(guide.chapters[0].id);
  const chapters = useMemo(() => guide.chapters.filter((chapter) => chapterMatches(chapter, query.trim())), [query]);

  function openChapter(chapter: GuideChapter) {
    setActiveId(chapter.id);
    window.requestAnimationFrame(() => document.getElementById(`guide-${chapter.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return <div className="user-guide-workspace">
    <section className="user-guide-heading">
      <div><p className="eyebrow orange-text">COMMAND CENTER REFERENCE</p><h1>User Guide</h1><span>Step-by-step instructions based on the current Mefford workflows, controls, and role boundaries.</span></div>
      <aside><small>MANUAL VERSION</small><strong>{guide.version}</strong><button onClick={() => window.print()}>Print / Save PDF</button></aside>
    </section>

    <section className="user-guide-search">
      <label><span>Search the manual</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Example: award estimate, weather, journal entry, temporary vendor" /></label>
      <strong>{chapters.length} of {guide.chapters.length} chapters</strong>
    </section>

    <div className="user-guide-layout">
      <aside className="user-guide-index" aria-label="User guide chapters">
        <header><small>TABLE OF CONTENTS</small><strong>{guide.title}</strong></header>
        {chapters.map((chapter) => <button key={chapter.id} className={activeId === chapter.id ? "active" : ""} onClick={() => openChapter(chapter)}><span>{chapter.title.split(".")[0]}</span><b>{chapter.title.replace(/^\d+\.\s*/, "")}</b></button>)}
      </aside>

      <main className="user-guide-chapters">
        {chapters.length ? chapters.map((chapter) => <article id={`guide-${chapter.id}`} key={chapter.id} className={activeId === chapter.id ? "active" : ""} onMouseEnter={() => setActiveId(chapter.id)}>
          <header><div><small>{chapter.audience}</small><h2>{chapter.title}</h2><p>{chapter.purpose}</p></div><span>{chapter.steps.length} STEPS</span></header>
          <ol>{chapter.steps.map((step, index) => <li key={`${chapter.id}-${index}`}><b>{index + 1}</b><span>{step}</span></li>)}</ol>
          <section><strong>Operating notes</strong>{chapter.notes.map((note, index) => <p key={`${chapter.id}-note-${index}`}>{note}</p>)}</section>
        </article>) : <section className="user-guide-empty"><strong>No matching instructions</strong><span>Try a section name, record type, status, or task.</span><button onClick={() => setQuery("")}>Clear Search</button></section>}
      </main>
    </div>
  </div>;
}
