import { salesOpportunityValue } from "../../../lib/sales-opportunity-value";
import { loadSalesContracts } from "../../../lib/sales-contract-server";
import { opportunityContract, signedSalesRecords, withSalesContract, type SalesContract } from "../../../lib/sales-contract";
import { validateDashboardSession } from "../../../lib/dashboard-display-auth";
import { dashboardRevision } from "../../../lib/dashboard-live";
import { PROFITABILITY_FLOOR_BASIS_POINTS } from "../../../lib/operating-doctrine";
import { isPhotoUpload } from "../../../lib/photo-uploads";
import { isContractedActiveProject } from "../../../lib/contracted-projects";

type ProjectRow = {
  contractAuthorized?: boolean;
  number: string;
  name: string;
  status: string;
  site: string;
  project_type: string;
  owner_contract_status: string;
  contract_amount: string;
  current_contract_amount: string;
  start_date: string;
  substantial_date: string;
  final_date: string;
  project_manager: string;
  superintendent: string;
  updated_at: string;
};

type RecordRow = {
  project_id: string;
  id: string;
  record_type: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  record_date: string | null;
  data_json: string;
  updated_at: string;
};

type PhotoRow = {
  id: number;
  project_id: string;
  name: string;
  category: string;
  content_type: string;
  created_at: string;
};

type WipForecastRow = {
  project_id: string;
  period_id: string;
  forecast_profit_cents: number;
  projected_margin_basis_points: number;
  status: string;
  updated_at: string;
};

type DisplayTone = "good" | "warn" | "risk" | "brand";
type DisplayRow = { id: string; title: string; subtitle: string; status: string; value?: string };
type Metric = { label: string; value: string; detail: string; tone?: DisplayTone; progress?: number; rows: DisplayRow[] };
type VisualPoint = { id?: string; label: string; value: number; display: string; tone?: DisplayTone; meta?: string; secondary?: number };
type Visual = { id: string; kind: "bars" | "donut" | "funnel" | "heatmap" | "line" | "timeline" | "progress"; title: string; subtitle: string; points: VisualPoint[] };
type Story = { headline: string; explanation: string; question: string; decisionLabel: string; sceneSeconds: number };
type DisplayPhoto = { id: number; url: string; project: string; caption: string };
type Review = { id: string; rating: number; stars: string; respondent: string; project: string; milestone: string; comment: string; photoUrls: string[]; displayConsent: boolean; displaySeconds: 5 | 30; responseDate: string };
type Dashboard = {
  id: string;
  title: string;
  eyebrow: string;
  metrics: Metric[];
  visuals: Visual[];
  story: Story;
  photos: DisplayPhoto[];
  sections: Array<{ title: string; rows: DisplayRow[] }>;
  reviews?: Review[];
};

const FINAL_STATUSES = new Set(["Closed", "Complete", "Completed", "Executed", "Approved", "Rejected", "Void", "Cancelled", "Awarded", "Lost"]);
const DASHBOARD_RECORD_TYPES = [
  "Sales Opportunities", "Sales Goals", "Schedule", "Daily Logs", "RFIs", "Submittals", "Change Orders", "Safety",
  "Quality Items", "Quality Inspections", "Selections", "Purchase Orders", "Subcontracts", "Bid Packages", "Budget Control",
  "Project Health Daily Snapshots", "Project Health Events", "Marketing Campaigns", "Marketing Content", "Marketing Newsletter",
  "Marketing Analytics Snapshot", "Marketing Customer Survey Request", "Marketing Customer Survey Response", "Integration Health",
];

export async function GET(request: Request) {
  if (!await validateDashboardSession(request)) {
    return Response.json(
      { error: "Dashboard display login required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { env } = await import("cloudflare:workers");
  const recordPlaceholders = DASHBOARD_RECORD_TYPES.map(() => "?").join(",");
  const contracts = await loadSalesContracts(env.DB);
  const [projectResult, recordResult, photoResult, wipResult, live] = await Promise.all([
    env.DB.prepare(`SELECT number, name, status, site, project_type, owner_contract_status, contract_amount, current_contract_amount, start_date, substantial_date, final_date, project_manager, superintendent, updated_at FROM projects ORDER BY number`).all<ProjectRow>(),
    env.DB.prepare(`SELECT project_id, id, record_type, title, owner, due, status, meta, record_date, data_json, updated_at FROM command_records WHERE record_type IN (${recordPlaceholders}) ORDER BY updated_at DESC LIMIT 5000`).bind(...DASHBOARD_RECORD_TYPES).all<RecordRow>(),
    env.DB.prepare(`SELECT id, project_id, name, category, content_type, created_at FROM project_files WHERE category = 'Photos' ORDER BY created_at DESC LIMIT 96`).all<PhotoRow>(),
    env.DB.prepare(`SELECT project_id, period_id, forecast_profit_cents, projected_margin_basis_points, status, updated_at FROM accounting_wip_forecasts ORDER BY period_id DESC, updated_at DESC`).all<WipForecastRow>(),
    dashboardRevision(),
  ]);
  const payload = {
    account: "dashboards@meffcon.com",
    readOnly: true,
    generatedAt: new Date().toISOString(),
    revision: live.revision,
    changedAt: live.changedAt,
    refreshSeconds: 15,
    live: { transport: "event-stream", endpoint: "/api/dashboard-display-live", targetLatencySeconds: 1, fallbackSeconds: 15 },
    dashboards: buildDashboards(projectResult.results || [], recordResult.results || [], (photoResult.results || []).filter((file) => isPhotoUpload({ name: file.name, type: file.content_type })).slice(0, 48), wipResult.results || [], contracts),
  } as const;
  return Response.json(payload, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      ETag: `W/\"dashboard-${live.revision}\"`,
      "X-Dashboard-Revision": String(live.revision),
    },
  });
}

function buildDashboards(projects: ProjectRow[], records: RecordRow[], photoRows: PhotoRow[], wipRows: WipForecastRow[], contracts: ReadonlyMap<string, SalesContract>): Dashboard[] {
  projects = projects.map(project => ({ ...project, contractAuthorized: contracts.get(project.number)?.signed === true }));
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  const activeProjects = projects.filter(isContractedActiveProject);
  const activeProjectIds = new Set(activeProjects.map((project) => project.number));
  const opportunities = records.filter((record) => record.record_type === "Sales Opportunities").map(withData)
    .map(record => ({ ...record, data: withSalesContract(record.data, contracts) }));
  const openOpportunities = opportunities.filter((record) => !["Awarded", "Lost", "On Hold"].includes(opportunityStage(record)));
  const awarded = signedSalesRecords(opportunities, year);
  const pendingContracts = projects.filter(project => contracts.get(project.number)?.pendingSignature);
  const pendingRows = pendingContracts.map(project => ({ ...displayProject(project), status: "Awaiting Signatures", value: currency(contracts.get(project.number)!.contractValue) }));
  const estimates = opportunities.filter((record) => ["Estimating", "Awarded", "Lost"].includes(opportunityStage(record)) || Boolean(record.data.estimatingRequestedAt));
  const activeEstimates = estimates.filter((record) => !["Awarded", "Lost"].includes(text(record.data.estimateStatus || record.data.stage || record.status)));
  const marketing = records.filter((record) => record.record_type.startsWith("Marketing ")).map(withData);
  const schedules = records.filter((record) => record.record_type === "Schedule").map(withData);
  const bidPackages = records.filter((record) => record.record_type === "Bid Packages").map(withData);
  const todayLogs = new Set(records.filter((record) => record.record_type === "Daily Logs" && record.record_date === today).map((record) => record.project_id));
  const missingLogs = activeProjects.filter((project) => !todayLogs.has(project.number));
  const lateSchedule = records.filter((record) => record.record_type === "Schedule" && !FINAL_STATUSES.has(record.status) && record.due && toIsoDate(record.due) < today);
  const scheduleRiskIds = new Set([...lateSchedule.map((record) => record.project_id), ...activeProjects.filter((project) => project.final_date && project.final_date < today).map((project) => project.number)]);
  const healthSnapshots = records.filter((record) => record.record_type === "Project Health Daily Snapshots").map(withData);
  const latestHealth = latestPerProject(healthSnapshots);
  const healthRows = activeProjects.map((project) => {
    const snapshot = latestHealth.get(project.number);
    const score = number(snapshot?.data.score ?? snapshot?.data.healthScore ?? 100);
    const color = text(snapshot?.data.color || (scheduleRiskIds.has(project.number) ? "Red" : score < 75 ? "Red" : score < 90 ? "Yellow" : "Green"));
    return { project, score, color, progress: projectScheduleProgress(project.number, schedules), target: expectedProjectProgress(project, today) };
  });
  const averageHealth = healthRows.length ? Math.round(healthRows.reduce((sum, row) => sum + row.score, 0) / healthRows.length) : 0;
  const redProjects = healthRows.filter((row) => row.color === "Red");
  const yellowProjects = healthRows.filter((row) => row.color === "Yellow");
  const greenProjects = healthRows.filter((row) => row.color === "Green");
  const openDecisions = records.filter((record) => !record.project_id.startsWith("MEFFORD-") && !FINAL_STATUSES.has(record.status) && record.due && toIsoDate(record.due) <= today);
  const integrationRows = records.filter((record) => record.project_id === "MEFFORD-COMPANY" && (record.id.startsWith("INTEGRATION-") || record.record_type === "Integration Health")).map(withData);
  const photos = photoRows.filter((photo) => activeProjectIds.has(photo.project_id)).flatMap((photo) => {
    const project = projects.find((item) => item.number === photo.project_id);
    if (!project) return [];
    return [{ id: photo.id, url: `/api/dashboard-display-photo?id=${photo.id}`, project: project.name, caption: `${photo.name} · ${displayDate(photo.created_at)}` }];
  });

  const projectRows = activeProjects.map(displayProject);
  const salesRows = openOpportunities.map(opportunityRow);
  const awardedRows = awarded.map(record => ({ ...opportunityRow(record), status: "Signed", subtitle: `${opportunityRow(record).subtitle} · ${opportunityContract(record.data)!.signedDate}` }));
  const estimatingRows = activeEstimates.map(estimateRow);
  const dueFollowups = openOpportunities.filter((record) => Boolean(text(record.data.nextFollowUpDate)) && toIsoDate(text(record.data.nextFollowUpDate)) <= today);
  const pendingContent = marketing.filter((record) => ["Marketing Campaigns", "Marketing Content"].includes(record.record_type) && !["Published", "Complete", "Completed"].includes(record.status));
  const newsletters = marketing.filter((record) => record.record_type === "Marketing Newsletter" && !["Sent", "Complete", "Completed"].includes(record.status));
  const surveyRequests = marketing.filter((record) => record.record_type === "Marketing Customer Survey Request" && record.status !== "Responded");
  const analytics = marketing.filter((record) => record.record_type === "Marketing Analytics Snapshot");
  const reviewRecords = marketing.filter((record) => record.record_type === "Marketing Customer Survey Response");
  const requestRecords = marketing.filter((record) => record.record_type === "Marketing Customer Survey Request");
  const reviews = reviewRecords.map(reviewItem).sort((a, b) => b.responseDate.localeCompare(a.responseDate));
  const averageReview = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
  const fiveStarReviews = reviews.filter((review) => review.rating >= 4.95);
  const responseRate = requestRecords.length ? Math.min(100, Math.round(reviews.length / requestRecords.length * 100)) : 0;
  const reviewRows = reviews.map((review) => ({ id: review.id, title: review.displayConsent ? review.respondent : "Anonymous Customer", subtitle: review.displayConsent ? `${review.project} · ${review.milestone}` : `${review.milestone} · Details Kept Private`, status: `${review.rating.toFixed(1)} Stars`, value: review.comment || undefined }));
  const ratingDistribution = [5, 4, 3, 2, 1].map((rating) => {
    const count = reviews.filter((review) => Math.round(review.rating) === rating).length;
    return point(`${rating} Star`, count, String(count), rating >= 4 ? "brand" : rating === 3 ? "warn" : "risk", `${percent(count, reviews.length)}% of reviews`);
  });
  const milestoneRatings = groupAverages(reviews.map((review) => ({ group: review.milestone, value: review.rating }))).map((item) => point(item.label, item.value, `${item.value.toFixed(1)} ★`, item.value >= 4 ? "brand" : item.value >= 3 ? "warn" : "risk"));

  const currentGoal = records.filter((record) => record.record_type === "Sales Goals").map(withData).find((record) => number(record.data.year || record.record_date?.slice(0, 4)) === Number(year));
  const companyGoal = number(currentGoal?.data.companyGoal);
  const awardedValue = awarded.reduce((sum, record) => sum + opportunityValue(record), 0);
  const goalProgress = companyGoal ? Math.min(999, awardedValue / companyGoal * 100) : 0;
  const stageValues = groupSums(openOpportunities.map((record) => ({ group: normalizedSalesStage(record), value: opportunityValue(record) })), ["New Lead", "Qualified Opportunity", "Estimating", "Proposal Submitted", "Negotiation"]);
  const repAwards = groupSums(awarded.map((record) => ({ group: text(record.data.assignedRep || record.owner) || "Unassigned", value: opportunityValue(record) })));
  const monthlySales = cumulativeSalesTrend(awarded, companyGoal, Number(year));

  const dueSoon = activeEstimates.filter((record) => inNextDays(text(record.data.bidDueDate), today, 7));
  const readyForReview = activeEstimates.filter((record) => estimateStatus(record) === "Ready For Review");
  const coverageGaps = bidPackages.filter((record) => !bidCoverage(record).satisfied);
  const estimatorWorkload = groupSums(activeEstimates.map((record) => ({ group: text(record.data.assignedEstimator) || "Unassigned", value: 1, secondary: opportunityValue(record) })));
  const upcomingBids = activeEstimates.filter((record) => Boolean(text(record.data.bidDueDate))).sort((a, b) => text(a.data.bidDueDate).localeCompare(text(b.data.bidDueDate))).slice(0, 10);

  const analyticsTotals = analytics.reduce((totals, record) => ({
    impressions: totals.impressions + number(record.data.impressions),
    engagements: totals.engagements + number(record.data.engagements),
    clicks: totals.clicks + number(record.data.clicks),
    conversions: totals.conversions + number(record.data.conversions),
  }), { impressions: 0, engagements: 0, clicks: 0, conversions: 0 });
  const engagementRate = analyticsTotals.impressions ? analyticsTotals.engagements / analyticsTotals.impressions * 100 : 0;
  const platformPerformance = groupSums(analytics.map((record) => ({ group: text(record.data.platform) || "Unassigned", value: number(record.data.impressions), secondary: number(record.data.clicks) })));
  const contentMix = groupSums([...pendingContent, ...newsletters].map((record) => ({ group: record.status || "Unassigned", value: 1 })));
  const activePortfolioValue = activeProjects.reduce((sum, project) => sum + number(project.current_contract_amount || project.contract_amount), 0);
  const fieldReporting = activeProjects.length ? todayLogs.size / activeProjects.length * 100 : 100;
  const healthTrend = averageHealthTrend(healthSnapshots);
  const operatingTruths = buildOperatingTruths({
    activeProjects,
    records,
    wipRows,
    today,
    missingLogs,
    scheduleRiskIds,
    openOpportunities,
    companyGoal,
    awardedValue,
    dueFollowups,
    activeEstimates,
    dueSoon,
    coverageGaps,
  });

  return [
    operatingTruths,
    {
      id: "customer-reviews", title: "Customer Reviews Dashboard", eyebrow: "EVERY VERIFIED CUSTOMER REVIEW",
      metrics: [
        metric("Star Review Average", reviews.length ? `${averageReview.toFixed(1)} ★` : "—", "Average across every recorded review", reviewRows, reviews.length ? "brand" : "warn", averageReview / 5 * 100),
        metric("Total Reviews", String(reviews.length), "All verified survey responses", reviewRows),
        metric("5-Star Reviews", String(fiveStarReviews.length), "Reviews averaging 4.95 or better", fiveStarReviews.map((review) => reviewRows.find((row) => row.id === review.id)!).filter(Boolean), "brand", percent(fiveStarReviews.length, reviews.length)),
        metric("Response Rate", `${responseRate}%`, `${reviews.length} responses from ${requestRecords.length} requests`, reviewRows, responseRate >= 50 ? "brand" : "warn", responseRate),
      ],
      visuals: [
        visual("rating-distribution", "donut", "Rating Distribution", "Every verified review remains visible", ratingDistribution),
        visual("milestone-ratings", "bars", "Experience By Survey Stage", "Average score at each customer touchpoint", milestoneRatings),
      ],
      story: story(
        reviews.length ? `${averageReview.toFixed(1)} stars across ${reviews.length} verified customer responses.` : "The first verified customer response will establish the company baseline.",
        reviews.length ? `${fiveStarReviews.length} reviews are five-star, with a ${responseRate}% response rate.` : "Every response, comment, photo, and consent decision will remain tied to its project.",
        reviews.length ? "Which customer-experience stage deserves the next operating improvement?" : "Which active project will create the first customer-experience baseline?",
        "CUSTOMER EXPERIENCE QUESTION",
      ),
      photos: [], sections: [{ title: "All Customer Reviews", rows: reviewRows }], reviews,
    },
    {
      id: "company-health", title: "Company Health Dashboard", eyebrow: "MEFFORD CONTRACTING",
      metrics: [
        metric("Active Portfolio", currency(activePortfolioValue), `${activeProjects.length} projects currently in operation`, projectRows, "brand"),
        metric("Active Projects", String(activeProjects.length), `${greenProjects.length} on plan · ${yellowProjects.length} watch · ${redProjects.length} critical`, projectRows, redProjects.length ? "risk" : yellowProjects.length ? "warn" : "good"),
        metric("Average Health", healthRows.length ? `${averageHealth}/100` : "—", "Live average across active projects", healthRows.map(healthDisplay), averageHealth >= 90 ? "good" : averageHealth >= 75 ? "warn" : "risk", averageHealth),
        metric("Decisions Due", String(openDecisions.length), "Open controls due today or earlier", openDecisions.map(controlRow), openDecisions.length ? "warn" : "good"),
      ],
      visuals: [
        visual("company-pulse", "donut", "Portfolio Health Mix", "Current active-project health distribution", [point("On Plan", greenProjects.length, String(greenProjects.length), "good"), point("Needs Attention", yellowProjects.length, String(yellowProjects.length), "warn"), point("Critical", redProjects.length, String(redProjects.length), "risk")]),
        visual("portfolio-value", "bars", "Largest Active Commitments", "Current contract value by project", activeProjects.sort((a, b) => projectValue(b) - projectValue(a)).slice(0, 8).map((project) => point(project.name, projectValue(project), currency(projectValue(project)), "brand", project.number))),
      ],
      story: story(
        redProjects.length ? `${redProjects.length} active project${redProjects.length === 1 ? " is" : "s are"} driving immediate company risk.` : openDecisions.length ? `${openDecisions.length} decisions are due while the active portfolio averages ${averageHealth}/100.` : `The active portfolio averages ${averageHealth || 100}/100 with no overdue decision queue.`,
        `${currency(activePortfolioValue)} is active. Field reporting is ${Math.round(fieldReporting)}% complete today, and ${integrationRows.filter((record) => record.status === "Connected").length}/${integrationRows.length || 0} tracked systems report connected.`,
        openDecisions.length ? "Which overdue decision has the greatest financial or schedule consequence?" : "What should leadership solve before it becomes the next red condition?",
        "LEADERSHIP DECISION",
      ),
      photos: photos.slice(0, 8),
      sections: [
        { title: "Active Portfolio", rows: projectRows },
        { title: "Immediate Company Attention", rows: [...openDecisions.map(controlRow), ...missingLogs.map((project) => ({ ...displayProject(project), status: "Daily Log Missing" }))].slice(0, 15) },
      ],
    },
    {
      id: "project-health", title: "Project Health Dashboard", eyebrow: "LIVE PROJECT PORTFOLIO",
      metrics: [
        metric("On Plan", String(greenProjects.length), "Projects scoring Green", greenProjects.map(healthDisplay), "good"),
        metric("Needs Attention", String(yellowProjects.length), "Projects scoring Yellow", yellowProjects.map(healthDisplay), "warn"),
        metric("Critical", String(redProjects.length), "Projects scoring Red", redProjects.map(healthDisplay), redProjects.length ? "risk" : "good"),
        metric("Schedule Risk", String(scheduleRiskIds.size), "Late activity or contract finish exposure", activeProjects.filter((project) => scheduleRiskIds.has(project.number)).map(displayProject), scheduleRiskIds.size ? "risk" : "good"),
      ],
      visuals: [
        visual("project-heatmap", "heatmap", "Portfolio Health Map", "Score, team, and current schedule progress", healthRows.map((row) => point(row.project.name, row.score, `${row.score}/100`, healthTone(row.color), `${row.project.number} · ${row.project.project_manager || "PM Unassigned"} · ${Math.round(row.progress)}% complete`, row.target))),
        visual("health-trend", "line", "Portfolio Health Trend", "Average recorded health by snapshot date", healthTrend),
      ],
      story: story(
        redProjects.length ? `${redProjects.length} project${redProjects.length === 1 ? " requires" : "s require"} immediate action.` : yellowProjects.length ? `${yellowProjects.length} project${yellowProjects.length === 1 ? " needs" : "s need"} attention before risk compounds.` : "Every active project is currently on plan.",
        `${scheduleRiskIds.size} projects have schedule exposure and ${missingLogs.length} are missing today’s field report.`,
        redProjects[0] ? `What action changes ${redProjects[0].project.name} most before tomorrow?` : scheduleRiskIds.size ? "Which schedule exposure has the least recovery time?" : "Where is the earliest signal that could weaken portfolio health?",
        "PROJECT QUESTION",
      ),
      photos: photos.slice(0, 12),
      sections: [{ title: "Project Health Scorecards", rows: healthRows.map(healthDisplay) }, { title: "Today’s Missing Daily Logs", rows: missingLogs.map(displayProject) }],
    },
    {
      id: "sales", title: "Sales Dashboard", eyebrow: `${year} SALES`,
      metrics: [
        metric("Signed Sales", currency(awardedValue), `${awarded.length} signed contract${awarded.length === 1 ? "" : "s"}`, awardedRows, "brand", goalProgress),
        metric("Goal Progress", companyGoal ? `${goalProgress.toFixed(1)}%` : "Goal Needed", companyGoal ? `${currency(Math.max(0, companyGoal - awardedValue))} remaining` : "Owner-controlled annual sales goal has not been entered", awardedRows, companyGoal && goalProgress >= expectedYearProgress(today) ? "good" : "warn", goalProgress),
        metric("Open Pipeline", currency(openOpportunities.reduce((sum, record) => sum + opportunityValue(record), 0)), `${openOpportunities.length} open opportunities`, salesRows),
        metric("Weighted Pipeline", currency(openOpportunities.reduce((sum, record) => sum + opportunityValue(record) * number(record.data.probability) / 100, 0)), "Probability-adjusted opportunity value", salesRows),
      ],
      visuals: [
        visual("sales-funnel", "funnel", "Pipeline By Stage", "Current opportunity value flowing toward award", stageValues.map((item, index) => point(item.label, item.value, currency(item.value), index === stageValues.length - 1 ? "brand" : undefined))),
        visual("sales-pace", "line", "Signed Sales Pace", companyGoal ? `Cumulative signed sales compared with the ${currency(companyGoal)} annual goal` : "Cumulative signed sales by month; annual goal still required", monthlySales),
      ],
      story: story(
        companyGoal ? `${currency(awardedValue)} is signed against a ${currency(companyGoal)} goal.` : `${currency(awardedValue)} is signed, but leadership has not entered the annual goal.`,
        `${currency(openOpportunities.reduce((sum, record) => sum + opportunityValue(record), 0))} is open and ${dueFollowups.length} follow-ups are due. Top salesperson for signed contracts: ${repAwards[0]?.label || "No signed contracts"}.`,
        dueFollowups.length ? "Which follow-up changes weighted pipeline the most today?" : "Which opportunity has the strongest fit, margin, and probability combination?",
        "SALES QUESTION",
      ),
      photos: photos.slice(0, 6), sections: [{ title: "Contracts To Sign", rows: pendingRows }, { title: "Open Opportunities", rows: salesRows.slice(0, 12) }, { title: "Follow-Ups And Recent Signed Contracts", rows: [...dueFollowups.map(opportunityRow), ...awardedRows].slice(0, 12) }],
    },
    {
      id: "estimating", title: "Estimating Dashboard", eyebrow: "PRECONSTRUCTION",
      metrics: [
        metric("Estimating Projects", String(activeEstimates.length), "Locked active estimating records", estimatingRows, "brand"),
        metric("Due In 7 Days", String(dueSoon.length), "Upcoming bid deadlines", dueSoon.map(estimateRow), dueSoon.length ? "warn" : "good"),
        metric("Ready For Review", String(readyForReview.length), "Estimates awaiting review", readyForReview.map(estimateRow), readyForReview.length ? "warn" : "good"),
        metric("Coverage Gaps", String(coverageGaps.length), "Bid packages below three responsive bids without approved exception", coverageGaps.map(bidPackageRow), coverageGaps.length ? "risk" : "good"),
      ],
      visuals: [
        visual("bid-deadlines", "timeline", "Upcoming Bid Deadlines", "Days remaining before each active estimate is due", upcomingBids.map((record) => { const days = daysBetween(today, toIsoDate(text(record.data.bidDueDate))); return point(record.title, Math.max(0, days), days < 1 ? "DUE TODAY" : `${days} DAYS`, days <= 2 ? "risk" : days <= 7 ? "warn" : "brand", `${text(record.data.assignedEstimator) || "Estimator Unassigned"} · ${currency(opportunityValue(record))}`); })),
        visual("estimator-load", "bars", "Estimator Workload", "Active assignments and estimated contract value", estimatorWorkload.map((item) => point(item.label, item.value, `${item.value} active`, item.label === "Unassigned" ? "risk" : "brand", currency(item.secondary || 0), item.secondary))),
      ],
      story: story(
        coverageGaps.length ? `${coverageGaps.length} bid package${coverageGaps.length === 1 ? " lacks" : "s lack"} required competitive coverage.` : dueSoon.length ? `${dueSoon.length} estimate${dueSoon.length === 1 ? " is" : "s are"} due inside seven days.` : `${activeEstimates.length} estimates are active with no immediate coverage exception.`,
        `${readyForReview.length} estimates await review and ${estimatorWorkload.find((item) => item.label === "Unassigned")?.value || 0} remain unassigned.`,
        coverageGaps.length ? "Which uncovered trade creates the greatest price or schedule exposure?" : dueSoon.length ? "Which deadline is most likely to compress review quality?" : "Where can estimating create the most leverage before the next deadline wave?",
        "ESTIMATING QUESTION",
      ),
      photos: photos.slice(0, 6), sections: [{ title: "Active Estimate Queue", rows: estimatingRows }, { title: "Deadlines And Bid Coverage", rows: [...dueSoon.map(estimateRow), ...coverageGaps.map(bidPackageRow)].slice(0, 15) }],
    },
    {
      id: "marketing", title: "Marketing Dashboard", eyebrow: "COMPANY VOICE",
      metrics: [
        metric("Open Content", String(pendingContent.length), "Campaigns and posts not yet published", pendingContent.map(marketingRow), pendingContent.length ? "brand" : "good"),
        metric("Impressions", compactNumber(analyticsTotals.impressions), `${analytics.length} verified analytics snapshots`, analytics.map(marketingRow), analyticsTotals.impressions ? "brand" : "warn"),
        metric("Engagement Rate", analyticsTotals.impressions ? `${engagementRate.toFixed(1)}%` : "—", `${compactNumber(analyticsTotals.engagements)} engagements`, analytics.map(marketingRow), engagementRate >= 2 ? "good" : analyticsTotals.impressions ? "warn" : undefined, Math.min(100, engagementRate * 10)),
        metric("Conversions", compactNumber(analyticsTotals.conversions), `${compactNumber(analyticsTotals.clicks)} recorded clicks`, analytics.map(marketingRow), analyticsTotals.conversions ? "good" : analyticsTotals.impressions ? "warn" : undefined),
      ],
      visuals: [
        visual("channel-performance", "bars", "Performance By Channel", "Verified impressions with click evidence", platformPerformance.map((item) => point(item.label, item.value, compactNumber(item.value), "brand", `${compactNumber(item.secondary || 0)} clicks`, item.secondary))),
        visual("marketing-funnel", "funnel", "Attention To Action", "Verified audience movement across stored analytics", [point("Impressions", analyticsTotals.impressions, compactNumber(analyticsTotals.impressions)), point("Engagements", analyticsTotals.engagements, compactNumber(analyticsTotals.engagements)), point("Clicks", analyticsTotals.clicks, compactNumber(analyticsTotals.clicks)), point("Conversions", analyticsTotals.conversions, compactNumber(analyticsTotals.conversions), "brand")]),
      ],
      story: story(
        analyticsTotals.impressions ? `${compactNumber(analyticsTotals.impressions)} verified impressions produced ${compactNumber(analyticsTotals.conversions)} recorded conversions.` : "Marketing analytics are waiting for verified provider or dated manual evidence.",
        `${pendingContent.length} content items and ${newsletters.length} newsletters remain in progress. Content mix: ${contentMix.slice(0, 3).map((item) => `${item.label} ${item.value}`).join(" · ") || "No open work"}.`,
        analyticsTotals.impressions && !analyticsTotals.conversions ? "Why is attention not becoming a measurable business action?" : "Which campaign is creating qualified construction conversations—not only activity?",
        "MARKETING QUESTION",
      ),
      photos: photos.slice(0, 10), sections: [{ title: "Upcoming Marketing Work", rows: [...pendingContent, ...newsletters].sort((a, b) => toIsoDate(a.due).localeCompare(toIsoDate(b.due))).map(marketingRow).slice(0, 12) }, { title: "Customer Voice And Measurement", rows: [...surveyRequests, ...analytics].map(marketingRow).slice(0, 12) }],
    },
  ];
}

function buildOperatingTruths(input: {
  activeProjects: ProjectRow[];
  records: RecordRow[];
  wipRows: WipForecastRow[];
  today: string;
  missingLogs: ProjectRow[];
  scheduleRiskIds: Set<string>;
  openOpportunities: DataRecord[];
  companyGoal: number;
  awardedValue: number;
  dueFollowups: DataRecord[];
  activeEstimates: DataRecord[];
  dueSoon: DataRecord[];
  coverageGaps: DataRecord[];
}): Dashboard {
  const {
    activeProjects,
    records,
    wipRows,
    today,
    missingLogs,
    scheduleRiskIds,
    openOpportunities,
    companyGoal,
    awardedValue,
    dueFollowups,
    activeEstimates,
    dueSoon,
    coverageGaps,
  } = input;
  const activeIds = new Set(activeProjects.map((project) => project.number));
  const projectById = new Map(activeProjects.map((project) => [project.number, project]));
  const currentPeriod = today.slice(0, 7);
  const latestForecast = new Map<string, WipForecastRow>();
  for (const forecast of wipRows) {
    if (!activeIds.has(forecast.project_id) || latestForecast.has(forecast.project_id)) continue;
    if (["Accounting Reviewed", "Owner Approved", "Locked"].includes(forecast.status)) latestForecast.set(forecast.project_id, forecast);
  }
  const currentForecasts = activeProjects.filter((project) => latestForecast.get(project.number)?.period_id === currentPeriod);
  const missingForecasts = activeProjects.filter((project) => latestForecast.get(project.number)?.period_id !== currentPeriod);
  const projectsAtLoss = activeProjects.filter((project) => (latestForecast.get(project.number)?.forecast_profit_cents ?? 1) <= 0);
  const marginAtRisk = activeProjects.filter((project) => {
    const forecast = latestForecast.get(project.number);
    return Boolean(forecast && forecast.forecast_profit_cents > 0 && forecast.projected_margin_basis_points < PROFITABILITY_FLOOR_BASIS_POINTS);
  });
  const openSafety = records.filter((record) => activeIds.has(record.project_id) && record.record_type === "Safety" && !["Closed", "Complete", "Completed", "Resolved", "Filed"].includes(record.status));
  const budgetByProject = new Map<string, DataRecord>();
  for (const record of records.filter((row) => row.record_type === "Budget Control").map(withData)) if (!budgetByProject.has(record.project_id)) budgetByProject.set(record.project_id, record);
  const budgetsUnlocked = activeProjects.filter((project) => budgetByProject.get(project.number)?.data.locked !== true);
  const finalOverdue = activeProjects.filter((project) => Boolean(project.final_date && project.final_date < today));
  const overdueEstimates = activeEstimates.filter((record) => {
    const due = toIsoDate(text(record.data.bidDueDate || record.due));
    return due !== "9999-12-31" && due < today && !["Proposal Submitted", "Approved"].includes(estimateStatus(record));
  });
  const weightedPipeline = openOpportunities.reduce((sum, record) => sum + opportunityValue(record) * number(record.data.probability) / 100, 0);
  const remainingGoal = Math.max(0, companyGoal - awardedValue);
  const weightedGoalCoverage = remainingGoal ? weightedPipeline / remainingGoal : 1;
  const pipelineGap = remainingGoal > weightedPipeline;

  const lossRows = projectsAtLoss.map((project) => {
    const forecast = latestForecast.get(project.number)!;
    return { ...displayProject(project), subtitle: `${project.project_manager || "PM Unassigned"} owns recovery · Accounting verifies the forecast`, status: "Critical · Forecast Loss", value: currency(forecast.forecast_profit_cents / 100) };
  });
  const scheduleRows = activeProjects.filter((project) => scheduleRiskIds.has(project.number)).map((project) => ({ ...displayProject(project), subtitle: `${project.superintendent || "Superintendent"} reports field truth · ${project.project_manager || "PM Unassigned"} owns recovery`, status: "Schedule Risk" }));
  const safetyRows = openSafety.map((record) => ({ id: `${record.project_id}-${record.id}`, title: projectById.get(record.project_id)?.name || record.title, subtitle: `${record.title} · ${projectById.get(record.project_id)?.superintendent || "Superintendent"} accountable`, status: "Critical · Safety", value: record.due ? displayDate(record.due) : undefined }));
  const wipRowsDisplay = missingForecasts.map((project) => ({ ...displayProject(project), subtitle: `Accounting supplies current cost and cash truth · ${project.project_manager || "PM Unassigned"} owns the forecast decision`, status: "Current WIP Missing", value: currentPeriod }));
  const marginRows = marginAtRisk.map((project) => {
    const forecast = latestForecast.get(project.number)!;
    return { ...displayProject(project), subtitle: `${project.project_manager || "PM Unassigned"} owns margin recovery · Accounting identifies cost-code exceptions`, status: "Margin Recovery", value: `${(forecast.projected_margin_basis_points / 100).toFixed(1)}%` };
  });
  const budgetRows = budgetsUnlocked.map((project) => ({ ...displayProject(project), subtitle: `${project.project_manager || "PM Unassigned"} owns the budget baseline · Accounting validates the cost structure`, status: "Critical · Budget Control" }));
  const estimateRows = overdueEstimates.map((record) => ({ ...estimateRow(record), status: "Critical · Proposal Overdue" }));
  const ownerFlags = [...safetyRows, ...lossRows, ...finalOverdue.map((project) => ({ ...displayProject(project), subtitle: `${project.project_manager || "PM Unassigned"} owns the recovery plan · Ownership removes barriers`, status: "Critical · Final Completion" })), ...budgetRows, ...estimateRows].slice(0, 18);

  const roleTruths: DisplayRow[] = [
    roleTruth("01", "Site Superintendents", "Safe work, current field truth, and schedule execution", openSafety.length, missingLogs.length + scheduleRiskIds.size, openSafety.length ? "Critical" : missingLogs.length + scheduleRiskIds.size ? "Needs Attention" : "On Track"),
    roleTruth("02", "Project Managers", "Hit the schedule and protect every dollar of projected profit", projectsAtLoss.length + budgetsUnlocked.length + finalOverdue.length, marginAtRisk.length + scheduleRiskIds.size, projectsAtLoss.length + budgetsUnlocked.length + finalOverdue.length ? "Critical" : marginAtRisk.length + scheduleRiskIds.size ? "Needs Attention" : "On Track"),
    roleTruth("03", "Estimators", "Submit complete, reviewed proposals on time and put Mefford’s best foot forward", overdueEstimates.length, dueSoon.length + coverageGaps.length, overdueEstimates.length ? "Critical" : dueSoon.length + coverageGaps.length ? "Needs Attention" : "On Track"),
    roleTruth("04", "Sales", "Load the pipeline and close profitable work", 0, dueFollowups.length + (pipelineGap ? 1 : 0), dueFollowups.length || pipelineGap ? "Needs Attention" : "On Track"),
    roleTruth("05", "Accounting", "Give PMs current cost, cash, billing, and forecast truth for profitable decisions", projectsAtLoss.length, missingForecasts.length + marginAtRisk.length, projectsAtLoss.length ? "Critical" : missingForecasts.length + marginAtRisk.length ? "Needs Attention" : "On Track"),
  ];
  const criticalCount = roleTruths.filter((row) => row.status === "Critical").length;
  const attentionCount = roleTruths.filter((row) => row.status === "Needs Attention").length;
  const rolePoints = roleTruths.map((row) => point(row.title, number(row.value?.split(" ")[0]), row.value || "0 open", row.status === "Critical" ? "risk" : row.status === "Needs Attention" ? "warn" : "good", row.subtitle));
  const allRecoveryRows = [...lossRows, ...marginRows, ...scheduleRows, ...safetyRows, ...wipRowsDisplay, ...budgetRows, ...estimateRows];

  return {
    id: "operating-truths",
    title: "Operating Truths Dashboard",
    eyebrow: "FIVE ROLES · ONE PROFITABLE OUTCOME",
    metrics: [
      metric("Ownership Red Flags", String(ownerFlags.length), "Only safety, loss, final-completion, budget-control, and overdue-proposal failures", ownerFlags, ownerFlags.length ? "risk" : "good"),
      metric("Projects At Loss", String(projectsAtLoss.length), "Authoritative forecast profit at or below zero", lossRows, projectsAtLoss.length ? "risk" : "good"),
      metric("Schedule Risk", String(scheduleRiskIds.size), "Late activity or contract-completion exposure", scheduleRows, scheduleRiskIds.size ? "risk" : "good"),
      metric("Weighted Goal Coverage", companyGoal ? `${weightedGoalCoverage.toFixed(2)}×` : "Goal Needed", companyGoal ? `${currency(weightedPipeline)} weighted pipeline against ${currency(remainingGoal)} remaining` : "Annual sales goal must be entered in Main", dueFollowups.map(opportunityRow), pipelineGap || !companyGoal ? "warn" : "good", Math.min(100, weightedGoalCoverage * 100)),
    ],
    visuals: [
      visual("five-role-truth", "bars", "Accountability Load By Role", "Critical and high-priority signals stay with the role that owns the outcome", rolePoints),
      visual("profit-decision-chain", "progress", "PM Decision Support", "Accounting truth must reach the PM before margin erosion becomes a loss", [
        point("Current PM Forecasts", currentForecasts.length, `${currentForecasts.length}/${activeProjects.length}`, currentForecasts.length === activeProjects.length ? "good" : "warn"),
        point("Margin Recovery", marginAtRisk.length, String(marginAtRisk.length), marginAtRisk.length ? "warn" : "good"),
        point("Forecast Loss", projectsAtLoss.length, String(projectsAtLoss.length), projectsAtLoss.length ? "risk" : "good"),
      ]),
    ],
    story: story(
      criticalCount ? `${criticalCount} role${criticalCount === 1 ? " has" : "s have"} a critical operating truth that ownership must see.` : attentionCount ? `${attentionCount} role${attentionCount === 1 ? " needs" : "s need"} recovery before the issue becomes an ownership red flag.` : "All five operating roles are currently holding their core promise.",
      `Field truth drives the PM decision. Accounting makes profit visible. Estimating and Sales create the next profitable backlog. The 15% margin floor is a recovery trigger—not a reporting footnote.`,
      ownerFlags.length ? "Which barrier must ownership remove without taking accountability away from the role that owns the outcome?" : "What is the earliest signal that could break the operating chain next?",
      "OWNERSHIP QUESTION",
    ),
    photos: [],
    sections: [
      { title: "The Five Operating Truths", rows: roleTruths },
      { title: "Ownership Red Flags", rows: ownerFlags },
      { title: "Role Recovery Queue", rows: allRecoveryRows.slice(0, 20) },
    ],
  };
}

function roleTruth(id: string, title: string, subtitle: string, critical: number, attention: number, status: string): DisplayRow {
  const open = critical + attention;
  return { id: `ROLE-${id}`, title, subtitle, status, value: `${open} OPEN` };
}

function metric(label: string, value: string, detail: string, rows: DisplayRow[], tone?: DisplayTone, progress?: number): Metric { return { label, value, detail, rows, tone, progress: progress === undefined ? undefined : Math.max(0, Math.min(100, progress)) }; }
function visual(id: string, kind: Visual["kind"], title: string, subtitle: string, points: VisualPoint[]): Visual { return { id, kind, title, subtitle, points }; }
function point(label: string, value: number, display: string, tone?: DisplayTone, meta?: string, secondary?: number): VisualPoint { return { label, value: Number.isFinite(value) ? value : 0, display, tone, meta, secondary: Number.isFinite(secondary) ? secondary : undefined }; }
function story(headline: string, explanation: string, question: string, decisionLabel: string): Story { return { headline, explanation, question, decisionLabel, sceneSeconds: 18 }; }
function withData(record: RecordRow) { return { ...record, data: parse(record.data_json) }; }
type DataRecord = ReturnType<typeof withData>;
function parse(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function text(value: unknown) { return String(value ?? "").trim(); }
function number(value: unknown) { const parsed = Number(value || 0); return Number.isFinite(parsed) ? parsed : 0; }
function currency(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0); }
function compactNumber(value: number) { return new Intl.NumberFormat("en-US", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value || 0); }
function percent(value: number, total: number) { return total ? Math.round(value / total * 100) : 0; }
function toIsoDate(value: string) { const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/); if (match) return `${match[1]}-${match[2]}-${match[3]}`; const parts = text(value).split("/"); return parts.length === 3 ? `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}` : "9999-12-31"; }
function displayDate(value: string) { const date = toIsoDate(value); if (date === "9999-12-31") return "Date Pending"; return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)); }
function daysBetween(start: string, end: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end === "9999-12-31") return 999; return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000); }
function inNextDays(value: string, today: string, days: number) { const date = toIsoDate(value); const difference = daysBetween(today, date); return difference >= 0 && difference <= days; }
function projectValue(project: ProjectRow) { return number(project.current_contract_amount || project.contract_amount); }
function displayProject(project: ProjectRow): DisplayRow { return { id: project.number, title: project.name, subtitle: `${project.number} · ${project.site}`, status: project.status, value: projectValue(project) ? currency(projectValue(project)) : undefined }; }
function opportunityValue(record: DataRecord) { return salesOpportunityValue(record.data, record.status); }
function opportunityStage(record: DataRecord) { return text(record.data.stage || record.data.estimateStatus || record.status); }
function normalizedSalesStage(record: DataRecord) { const value = opportunityStage(record).toLowerCase(); if (value.includes("negotiat")) return "Negotiation"; if (value.includes("proposal")) return "Proposal Submitted"; if (value.includes("estimat")) return "Estimating"; if (value.includes("qualif") || value.includes("design")) return "Qualified Opportunity"; return "New Lead"; }
function opportunityRow(record: DataRecord): DisplayRow { return { id: record.id, title: record.title, subtitle: `${text(record.data.company) || "Company Pending"} · ${text(record.data.assignedRep) || record.owner}`, status: opportunityStage(record), value: currency(opportunityValue(record)) }; }
function estimateStatus(record: DataRecord) { return text(record.data.estimateStatus || (record.data.estimate && typeof record.data.estimate === "object" ? (record.data.estimate as Record<string, unknown>).status : "") || "Not Started"); }
function estimateRow(record: DataRecord): DisplayRow { return { id: record.id, title: record.title, subtitle: `${text(record.data.assignedEstimator) || "Estimator Unassigned"} · Bid ${toIsoDate(text(record.data.bidDueDate)) === "9999-12-31" ? "Date Pending" : displayDate(text(record.data.bidDueDate))}`, status: estimateStatus(record), value: currency(opportunityValue(record)) }; }
function marketingRow(record: DataRecord): DisplayRow { return { id: record.id, title: record.title, subtitle: `${record.record_type.replace("Marketing ", "")} · Due ${toIsoDate(record.due) === "9999-12-31" ? "Not Set" : displayDate(record.due)}`, status: record.status }; }
function controlRow(record: RecordRow): DisplayRow { return { id: `${record.project_id}-${record.id}`, title: record.title, subtitle: `${record.record_type} · ${record.project_id}`, status: record.status, value: displayDate(record.due) }; }
function healthDisplay(row: { project: ProjectRow; score: number; color: string }): DisplayRow { return { ...displayProject(row.project), status: row.color, value: `${row.score}/100` }; }
function healthTone(color: string): DisplayTone { return color === "Red" ? "risk" : color === "Yellow" ? "warn" : "good"; }
function latestPerProject(records: DataRecord[]) { const map = new Map<string, DataRecord>(); for (const record of records) if (!map.has(record.project_id)) map.set(record.project_id, record); return map; }
function projectScheduleProgress(projectId: string, schedules: DataRecord[]) { const tasks = schedules.filter((record) => record.project_id === projectId); return tasks.length ? tasks.reduce((sum, record) => sum + Math.max(0, Math.min(100, number(record.data.progress))), 0) / tasks.length : 0; }
function expectedProjectProgress(project: ProjectRow, today: string) { const start = toIsoDate(project.start_date); const finish = toIsoDate(project.substantial_date || project.final_date); const total = daysBetween(start, finish); const elapsed = daysBetween(start, today); if (total <= 0 || total >= 999 || elapsed <= 0) return elapsed > 0 ? 100 : 0; return Math.max(0, Math.min(100, elapsed / total * 100)); }
function groupSums(items: Array<{ group: string; value: number; secondary?: number }>, order: string[] = []) { const map = new Map<string, { value: number; secondary: number }>(); for (const item of items) { const current = map.get(item.group) || { value: 0, secondary: 0 }; current.value += number(item.value); current.secondary += number(item.secondary); map.set(item.group, current); } const labels = order.length ? order.filter((label) => map.has(label)) : [...map.keys()].sort((a, b) => (map.get(b)?.value || 0) - (map.get(a)?.value || 0)); return labels.map((label) => ({ label, value: map.get(label)?.value || 0, secondary: map.get(label)?.secondary || 0 })); }
function groupAverages(items: Array<{ group: string; value: number }>) { const map = new Map<string, number[]>(); for (const item of items) map.set(item.group, [...(map.get(item.group) || []), item.value]); return [...map.entries()].map(([label, values]) => ({ label, value: values.reduce((sum, value) => sum + value, 0) / values.length })).sort((a, b) => b.value - a.value); }
function averageHealthTrend(records: DataRecord[]) { const byDate = new Map<string, number[]>(); for (const record of records) { const date = text(record.record_date || record.updated_at).slice(0, 10); if (!date) continue; byDate.set(date, [...(byDate.get(date) || []), number(record.data.score)]); } return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([date, values]) => { const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length); return point(new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)), average, `${average}/100`, average >= 90 ? "good" : average >= 75 ? "warn" : "risk"); }); }
function cumulativeSalesTrend(records: DataRecord[], goal: number, year: number) { const months = Array.from({ length: 12 }, () => 0); for (const record of records) { const date = opportunityContract(record.data)?.signedDate || ""; if (Number(date.slice(0, 4)) !== year) continue; const month = Number(date.slice(5, 7)) - 1; if (month >= 0 && month < 12) months[month] += opportunityValue(record); } let cumulative = 0; return months.map((value, index) => { cumulative += value; const target = goal ? goal * (index + 1) / 12 : 0; return point(new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, index, 1))), cumulative, currency(cumulative), cumulative >= target && target > 0 ? "good" : "brand", goal ? `Goal pace ${currency(target)}` : "Annual goal required", target); }); }
function expectedYearProgress(today: string) { const start = `${today.slice(0, 4)}-01-01`; const end = `${today.slice(0, 4)}-12-31`; return Math.max(0, Math.min(100, daysBetween(start, today) / Math.max(1, daysBetween(start, end)) * 100)); }
function bidCoverage(record: DataRecord) { const bidders = Array.isArray(record.data.bidders) ? record.data.bidders as Array<Record<string, unknown>> : []; const responsive = bidders.filter((bidder) => Array.isArray(bidder.revisions) && bidder.revisions.length > 0).length; const exception = record.data.coverageException && typeof record.data.coverageException === "object" ? record.data.coverageException as Record<string, unknown> : {}; return { responsive, satisfied: responsive >= 3 || Boolean(exception.approvedAt) }; }
function bidPackageRow(record: DataRecord): DisplayRow { const coverage = bidCoverage(record); return { id: `${record.project_id}-${record.id}`, title: record.title, subtitle: `${text(record.data.trade) || "Trade Pending"} · ${record.project_id}`, status: coverage.satisfied ? "Coverage Complete" : "Coverage Gap", value: `${coverage.responsive}/3 Bids` }; }
function reviewItem(record: DataRecord): Review { const rating = Math.min(5, Math.max(0, number(record.data.overallRating))); const displayConsent = record.data.displayConsent === true || record.data.marketingConsent === true; const photoIds = displayConsent && Array.isArray(record.data.photoIds) ? record.data.photoIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : []; return { id: record.id, rating, stars: "★".repeat(Math.max(1, Math.round(rating))), respondent: displayConsent ? text(record.data.respondentName || record.owner) : "Anonymous Customer", project: displayConsent ? text(record.data.projectName || record.data.projectId) : "Private Project", milestone: text(record.data.milestone || "Customer Review"), comment: displayConsent ? text(record.data.comments || record.data.testimonial) : "", photoUrls: photoIds.map((id) => `/api/dashboard-display-photo?id=${id}`), displayConsent, displaySeconds: rating >= 4 ? 30 : 5, responseDate: text(record.data.responseDate || record.record_date || record.updated_at).slice(0, 10) }; }
