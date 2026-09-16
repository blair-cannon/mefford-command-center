import { and, desc, eq } from "drizzle-orm";
import { commandRecords, companyMembers } from "../../../db/schema";
import { enforceOnboardingAccess } from "../../../lib/onboarding";
import { currentPerformanceQuarter, PERFORMANCE_METRIC_LIBRARY, PERFORMANCE_PROJECT_ID, PERFORMANCE_REVIEW_TYPE } from "../../../lib/performance-reviews";
import { resolveCommandActor } from "../../../lib/server-actor";

export async function GET(request: Request) {
  const actor = await resolveCommandActor(request);
  if (!actor.authenticated || !actor.email) return Response.json({ error: "Authentication Required" }, { status: 401 });
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;
  try {
    const { getDb } = await import("../../../db");
    const db = getDb();
    const [memberRows, reviewRows] = await Promise.all([
      db.select().from(companyMembers).where(eq(companyMembers.email, actor.email)).limit(1),
      db.select().from(commandRecords).where(and(eq(commandRecords.projectId, PERFORMANCE_PROJECT_ID), eq(commandRecords.recordType, PERFORMANCE_REVIEW_TYPE))).orderBy(desc(commandRecords.updatedAt)),
    ]);
    const member = memberRows[0];
    if (!member?.isActive) return Response.json({ error: "An Active Employee Record Is Required" }, { status: 403 });
    const designations = parseArray(member.designationsJson);
    const ownReviews = reviewRows.map((row) => ({ row, data: parse(row.dataJson) })).filter(({ data }) => String((data.employee as Record<string, unknown> | undefined)?.email || "").toLowerCase() === actor.email.toLowerCase());
    const currentQuarter = currentPerformanceQuarter();
    const selected = ownReviews.find(({ data }) => data.quarter === currentQuarter) || ownReviews[0];
    const data = selected?.data || {};
    const ownerReview = data.ownerReview && typeof data.ownerReview === "object" ? data.ownerReview as Record<string, unknown> : {};
    const finalized = selected?.row.status === "Finalized";
    const metrics = Array.isArray(data.metrics) ? (data.metrics as Array<Record<string, unknown>>).map((metric) => ({
      key: String(metric.key || ""),
      label: String(metric.label || "Goal"),
      category: String(metric.category || "Performance"),
      score: typeof metric.score === "number" ? metric.score : null,
      confidence: String(metric.confidence || "Insufficient"),
      detail: String(metric.detail || ""),
    })) : [];
    const roleFocus = PERFORMANCE_METRIC_LIBRARY.filter((metric) => Array.from(metric.roles as readonly string[]).includes("All") || Array.from(metric.roles as readonly string[]).some((role) => designations.includes(role))).map((metric) => ({ key: metric.key, label: metric.label, category: metric.category, description: metric.description }));
    return Response.json({
      employee: { name: member.displayName, email: member.email, designations },
      quarter: String(data.quarter || currentQuarter),
      status: selected?.row.status || "Goals Being Established",
      finalized,
      progress: selected ? {
        systemScore: typeof data.systemScore === "number" ? data.systemScore : null,
        finalScore: finalized && typeof ownerReview.finalScore === "number" ? ownerReview.finalScore : null,
        grade: finalized ? String(ownerReview.finalGrade || data.grade || "") : String(data.grade || "Developing Evidence"),
        evidenceCoverage: Number(data.evidenceCoverage || 0),
        metrics,
      } : null,
      goals: finalized ? goalLines(ownerReview.goals) : [],
      roleFocus,
      privacy: "Only your own operational summary is shown here. Owner notes, calibration reasoning, AI drafts, peer information, and other employee records remain private.",
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Your Goals Are Unavailable" }, { status: 500 });
  }
}

function goalLines(value: unknown) {
  return String(value || "").split(/\r?\n|•/).map((item) => item.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 12);
}

function parse(value: string) {
  try { const result = JSON.parse(value); return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {}; } catch { return {}; }
}

function parseArray(value: string) {
  try { const result = JSON.parse(value); return Array.isArray(result) ? result.map(String) : []; } catch { return []; }
}
