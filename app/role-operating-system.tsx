"use client";

import { useCallback, useEffect, useState } from "react";
import { type OperatingDoctrine } from "../lib/operating-doctrine";

type Metric = { label: string; value: string; risk?: boolean };
type Scorecard = {
  doctrine: OperatingDoctrine;
  metrics: Metric[];
  status: "Critical" | "Needs Attention" | "On Track";
  signalCount: number;
};
type DoctrineResponse = {
  scorecards: Scorecard[];
  error?: string;
};
type PortfolioMetric = {
  label: string;
  value: string;
};

export function RoleOperatingSystem({
  onNavigate,
  portfolioMetrics = [],
}: {
  onNavigate: (target: string, projectId?: string) => void;
  portfolioMetrics?: PortfolioMetric[];
}) {
  const [data, setData] = useState<DoctrineResponse | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/operating-doctrine", { cache: "no-store" });
      const result = (await response.json()) as DoctrineResponse;
      if (!response.ok) throw new Error(result.error || "The operating scorecards could not be loaded.");
      setData(result);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The operating scorecards could not be loaded.");
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = window.setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  return (
    <section className="dashboard-role-status" aria-label="Live company metrics">
      {error ? <div className="operating-data-warning">Dashboard Metrics Unavailable</div> : null}
      <div className="dashboard-role-grid">
        {portfolioMetrics.length ? (
          <article className="dashboard-role-card dashboard-portfolio-card" aria-label="Active Portfolio">
            <div className="dashboard-portfolio-metrics">
              {portfolioMetrics.map((metric) => (
                <span key={metric.label}>
                  <b title={metric.label}>{metric.label}</b>
                  <strong className="dashboard-portfolio-value" title={metric.value}>{metric.value}</strong>
                </span>
              ))}
            </div>
          </article>
        ) : null}
        {(data?.scorecards || []).map((scorecard) => (
          <button
            type="button"
            key={scorecard.doctrine.role}
            className={`dashboard-role-card ${scorecard.status.toLowerCase().replaceAll(" ", "-")}`}
            aria-label={`${scorecard.doctrine.role}: ${scorecard.status}`}
            onClick={() => onNavigate(scorecard.doctrine.defaultTarget)}
          >
            <header>
              <strong title={scorecard.doctrine.role}>{scorecard.doctrine.role}</strong>
            </header>
            <div>
              {scorecard.metrics.slice(0, scorecard.doctrine.role === "Sales" ? 3 : 2).map((metric) => (
                <span key={metric.label} className={metric.risk ? "risk" : ""}>
                  <b title={metric.label}>{metric.label}</b>
                  <strong title={metric.value}>{metric.value}</strong>
                </span>
              ))}
            </div>
            <footer><span>{scorecard.signalCount} Open Actions</span><b>→</b></footer>
          </button>
        ))}
        {!data?.scorecards.length && !error ? <div className="dashboard-role-loading">Loading Dashboard Metrics…</div> : null}
      </div>
    </section>
  );
}
