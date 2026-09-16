"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type CommandAssistantProps = {
  activeTarget: string;
  projectId: string;
  projectName: string;
  permissionLocked?: boolean;
};

type AssistantSource = {
  id: string;
  label: string;
  kind: "Project" | "Record" | "File" | "Policy";
  title: string;
  detail: string;
  href: string;
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AssistantSource[];
};

const startingMessage: AssistantMessage = {
  id: "assistant-boundary",
  role: "assistant",
  content:
    "I can help find, explain, summarize, compare, calculate, draft, and prepare work. I cannot submit, approve, sign, pay, publish, run payroll, change records, or bypass the normal Command Center workflow.",
};

function clientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function CommandAssistant({
  activeTarget,
  projectId,
  projectName,
  permissionLocked = false,
}: CommandAssistantProps) {
  const [configured, setConfigured] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([startingMessage]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conversationId] = useState(clientId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (permissionLocked) return;
    let cancelled = false;
    fetch("/api/assistant", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { configured?: boolean };
        if (!cancelled) setConfigured(response.ok && data.configured === true);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [permissionLocked]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [busy, messages]);

  const suggestedPrompts = useMemo(
    () => [
      `Summarize what matters on ${activeTarget}.`,
      `Help me prepare the next step for ${projectName || "this work"}.`,
      "What information is missing before I use the normal workflow?",
    ],
    [activeTarget, projectName],
  );

  if (permissionLocked) return null;

  async function sendMessage(prompt = draft) {
    const content = prompt.trim();
    if (!content || busy) return;
    const userMessage: AssistantMessage = {
      id: clientId(),
      role: "user",
      content,
    };
    const priorMessages = messages.filter(
      (message) => message.id !== startingMessage.id,
    );
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          history: priorMessages.slice(-10).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          conversationId,
          activeTarget,
          projectId,
          projectName,
        }),
      });
      const result = (await response.json()) as {
        answer?: string;
        sources?: AssistantSource[];
        error?: string;
      };
      if (!response.ok || !result.answer) {
        throw new Error(result.error || "The assistant could not answer.");
      }
      setMessages((current) => [
        ...current,
        {
          id: clientId(),
          role: "assistant",
          content: result.answer!,
          sources: result.sources || [],
        },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The assistant is temporarily unavailable. No action was taken.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`assistant-launcher${configured ? "" : " connection-required"}`}
        onClick={() => setOpen(true)}
        aria-label="Open Command Center AI Assistant"
        aria-expanded={open}
        aria-controls="command-assistant-panel"
        data-placement="topbar-reserved-slot"
      >
        <span aria-hidden="true">✦</span>
        <b>{configured ? "Ask AI" : "Connect AI"}</b>
      </button>
      {open ? (
        <div
          className="assistant-layer"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setOpen(false)
          }
        >
          <section
            id="command-assistant-panel"
            className="assistant-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-assistant-title"
          >
            <header className="assistant-header">
              <div className="assistant-mark" aria-hidden="true">✦</div>
              <div>
                <span>{configured ? "POWERED BY OPENAI · HELP ONLY" : "OPENAI CONNECTION REQUIRED"}</span>
                <h2 id="command-assistant-title">Command Center AI</h2>
                <small>{activeTarget} · {projectName || "Company-wide"}</small>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close Assistant">×</button>
            </header>

            <div className="assistant-boundary">
              <strong>No approvals or actions</strong>
              <span>All official work stays in the normal Command Center workflow.</span>
            </div>

            <div className="assistant-conversation" aria-live="polite">
              {!configured ? <article className="assistant-message assistant"><span>AI</span><p>The Command Center assistant is installed, permission-aware, and ready, but the production OpenAI API key is not connected. A Company Owner or IT Administrator must add the real key in IT &amp; Integrations. Search and every normal Command Center workflow remain available.</p></article> : null}
              {messages.map((message) => (
                <article
                  className={`assistant-message ${message.role}`}
                  key={message.id}
                >
                  <span>{message.role === "assistant" ? "AI" : "YOU"}</span>
                  <p>{message.content}</p>
                  {message.sources?.length ? (
                    <div className="assistant-sources" aria-label="Command Center sources">
                      {message.sources.map((source) =>
                        source.href ? (
                          <a
                            key={source.id}
                            href={source.href}
                            target={source.kind === "File" ? "_blank" : undefined}
                            rel={source.kind === "File" ? "noreferrer" : undefined}
                            title={source.detail}
                          >
                            {source.label} · {source.title}
                          </a>
                        ) : (
                          <span key={source.id}>{source.label} · {source.title}</span>
                        ),
                      )}
                    </div>
                  ) : null}
                </article>
              ))}
              {busy ? (
                <article className="assistant-message assistant thinking">
                  <span>AI</span>
                  <p>Reviewing your accessible Command Center sources…</p>
                </article>
              ) : null}
              {error ? <div className="assistant-error">{error}</div> : null}
              <div ref={endRef} />
            </div>

            {configured && messages.length === 1 ? (
              <div className="assistant-prompts">
                {suggestedPrompts.map((prompt) => (
                  <button key={prompt} onClick={() => void sendMessage(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}

            {configured ? <form
              className="assistant-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <label htmlFor="command-assistant-input">Ask for help</label>
              <div>
                <textarea
                  id="command-assistant-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder="Ask, compare, calculate, summarize, or draft…"
                  maxLength={4000}
                  rows={2}
                />
                <button type="submit" disabled={busy || !draft.trim()}>
                  Send
                </button>
              </div>
              <small>AI can make mistakes. Open cited records before relying on an answer.</small>
            </form> : <div className="assistant-connection-card"><strong>Connection Needed</strong><span>No fake responses and no hidden fallback are used. Configure the production OpenAI credential, then this same corner assistant becomes live immediately.</span></div>}
          </section>
        </div>
      ) : null}
    </>
  );
}
