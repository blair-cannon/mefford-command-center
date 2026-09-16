"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { eligibleCompanyMembers } from "./company-directory";
import { FormulaNumberInput } from "./formula-number-input";
import { OWNER_CONTRACT_TYPES, contractTemplate, normalizeOwnerContractType, type OwnerContractType } from "../lib/owner-contracts";
import {
  ESTIMATE_TEMPLATE_COST_CODES,
  ESTIMATE_TEMPLATE_VERSION,
  calculateEstimateEntry,
  calculateEstimateSummary,
  estimateOverrideReport,
  estimateManualFields,
  updateEstimateCell,
  estimateEntryTotal,
  newEstimateData,
  normalizeEstimateData,
  type EstimateData,
  type EstimateEntry,
  type EstimateProjectInputs,
} from "./estimate-template";
import { summaryDrilldownProps } from "./summary-drilldown";

type EstimateRecord = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  recordDate?: string;
  data?: Record<string, unknown>;
};

type EstimateActor = {
  name: string;
  email: string;
  accessLevel: "Company Owner" | "Administrator" | "Employee";
  designations: string[];
};

type AwardProjectDraft = {
  name: string;
  site: string;
  ownerName: string;
  ownerContractDate: string;
  ownerContractType: OwnerContractType;
  paymentTerms: string;
  retainageInitialPercent: number;
  retainageAfterHalfPercent: number;
  architect: string;
  projectType: string;
  startDate: string;
  substantialDate: string;
  finalDate: string;
  timeZone: string;
  projectManager: string;
  superintendent: string;
  cameraCount: number;
};

function todayInput() {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function percent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function moneyPerSquareFoot(value: number) {
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)} / SF`;
}

function opportunityText(record: EstimateRecord, field: string, fallback = "") {
  return String(record.data?.[field] || fallback);
}

function estimateLineKey(parentCode: string, childCode?: string) {
  return childCode ? `${parentCode}:${childCode}` : parentCode;
}

function automaticEstimateEntry(
  estimate: EstimateData,
  parentCode: string,
  childCode: string | undefined,
  defaults: { quantity: number | null; unit: string | null },
) {
  const key = estimateLineKey(parentCode, childCode);
  if (!estimate.entries[key]) return calculateEstimateEntry(estimate, parentCode, childCode, defaults);
  const entries = { ...estimate.entries };
  delete entries[key];
  return calculateEstimateEntry({ ...estimate, entries }, parentCode, childCode, defaults);
}

function NumberInput({
  label,
  value,
  onChange,
  expression,
  onExpressionChange,
  readOnly = false,
  currency = false,
  allowEmpty = false,
  max,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  expression?: string;
  onExpressionChange?: (expression: string) => void;
  readOnly?: boolean;
  currency?: boolean;
  allowEmpty?: boolean;
  max?: number;
}) {
  return <FormulaNumberInput
    label={label}
    className={readOnly ? "estimate-readonly-input" : ""}
    value={value}
    expression={expression}
    readOnly={readOnly}
    currency={currency}
    allowEmpty={allowEmpty}
    max={max}
    onValueChange={onChange}
    onExpressionChange={onExpressionChange}
  />;
}

export function EstimateEditor({
  record,
  actor,
  onClose,
  onRecordSaved,
  onProjectCreated,
}: {
  record: EstimateRecord;
  actor: EstimateActor;
  onClose: () => void;
  onRecordSaved: (record: EstimateRecord) => void;
  onProjectCreated?: (projectNumber: string) => void;
}) {
  const [estimate, setEstimate] = useState<EstimateData>(() =>
    normalizeEstimateData(record.data?.estimate ?? newEstimateData()),
  );
  const [openDivisions, setOpenDivisions] = useState<string[]>(["01"]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<HTMLElement>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(normalizeEstimateData(record.data?.estimate ?? newEstimateData())));
  const [confirmClose, setConfirmClose] = useState(false);
  const dirty = JSON.stringify(estimate) !== savedSnapshot;
  const [awardOpen, setAwardOpen] = useState(false);
  const [awardConfirmation, setAwardConfirmation] = useState(false);
  const [architectOptions, setArchitectOptions] = useState<Array<{ id: string; name: string; paymentHold?: boolean; temporaryApproval?: boolean; temporaryApprovalExpiresAt?: string }>>([]);
  const [distanceStatus, setDistanceStatus] = useState<{ loading: boolean; error: string; provider: string; originAddress: string; resolvedAddress: string; oneWayMiles: number | null }>({ loading: false, error: "", provider: "", originAddress: "", resolvedAddress: "", oneWayMiles: null });
  const projectLocation = opportunityText(record, "projectLocation").trim();
  const projectManagerOptions = useMemo(
    () => eligibleCompanyMembers("Project Manager"),
    [],
  );
  const superintendentOptions = useMemo(
    () => eligibleCompanyMembers("Superintendent"),
    [],
  );
  const [awardDraft, setAwardDraft] = useState<AwardProjectDraft>(() => {
    const today = todayInput();
    const handoff = record.data?.proposalHandoff && typeof record.data.proposalHandoff === "object"
      ? record.data.proposalHandoff as Record<string, unknown>
      : {};
    const startDate = String(handoff.targetStartDate || today);
    const durationDays = Math.max(30, Number(handoff.durationMonths || 6) * 30);
    const requestedContractType = String(handoff.ownerContractType || "Plan & Spec Lump Sum");
    const ownerContractType: AwardProjectDraft["ownerContractType"] = normalizeOwnerContractType(requestedContractType) || "Plan & Spec Lump Sum";
    return {
      name: String(handoff.projectName || record.title),
      site: String(handoff.projectLocation || opportunityText(record, "projectLocation")),
      ownerName: String(handoff.ownerName || opportunityText(record, "company")),
      ownerContractDate: String(handoff.ownerContractDate || today),
      ownerContractType,
      paymentTerms: String(handoff.paymentTerms || "Monthly progress payments; undisputed amounts due as required by Project-state law."),
      retainageInitialPercent: boundedPercent(handoff.retainageInitialPercent, 10),
      retainageAfterHalfPercent: boundedPercent(handoff.retainageAfterHalfPercent, 5),
      architect: String(handoff.architect || ""),
      projectType: opportunityText(record, "projectType", "Commercial"),
      startDate,
      substantialDate: String(handoff.substantialDate || addDays(startDate, durationDays)),
      finalDate: String(handoff.finalDate || addDays(startDate, durationDays + 15)),
      timeZone: "America/New_York",
      projectManager: projectManagerOptions.some((member) => member.name === actor.name)
        ? actor.name
        : projectManagerOptions[0]?.name || "",
      superintendent: superintendentOptions[0]?.name || "",
      cameraCount: 0,
    };
  });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/estimates/setup", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { architects?: Array<{ id: string; name: string; paymentHold?: boolean; temporaryApproval?: boolean; temporaryApprovalExpiresAt?: string }>; error?: string };
        if (!response.ok) throw new Error(result.error || "Architect Vendor Options Are Unavailable.");
        if (!cancelled) setArchitectOptions(result.architects ?? []);
      })
      .catch((error) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : "Architect Vendor Options Are Unavailable.");
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (projectLocation.length < 3) return;
    let cancelled = false;
    const currentInputs = estimate.projectInputs;
    if (currentInputs.distanceCalculationAddress === projectLocation && currentInputs.distanceCalculatedMiles !== null) return;
    queueMicrotask(() => {
      if (!cancelled) setDistanceStatus((current) => ({ ...current, loading: true, error: "" }));
    });
    fetch(`/api/estimate-distance?address=${encodeURIComponent(projectLocation)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { roundTripMiles?: number; oneWayMiles?: number; provider?: string; originAddress?: string; resolvedAddress?: string; error?: string };
        if (!response.ok || !Number.isFinite(result.roundTripMiles)) throw new Error(result.error || "Automatic Job Distance Is Unavailable.");
        if (cancelled) return;
        const roundTripMiles = Math.max(0, Number(result.roundTripMiles));
        setEstimate((current) => {
          const addressChanged = current.projectInputs.distanceCalculationAddress !== projectLocation;
          const useAutomatic = !current.projectInputs.distanceManuallyOverridden || (addressChanged && Boolean(current.projectInputs.distanceCalculationAddress));
          const next = invalidateApproval(current);
          return {
            ...next,
            projectInputs: {
              ...next.projectInputs,
              distanceCalculatedMiles: roundTripMiles,
              distanceCalculationAddress: projectLocation,
              distanceManuallyOverridden: useAutomatic ? false : next.projectInputs.distanceManuallyOverridden,
              distanceToFromJobMiles: useAutomatic ? roundTripMiles : next.projectInputs.distanceToFromJobMiles,
            },
          };
        });
        setDistanceStatus({ loading: false, error: "", provider: String(result.provider || "Mapped Route"), originAddress: String(result.originAddress || ""), resolvedAddress: String(result.resolvedAddress || projectLocation), oneWayMiles: Number(result.oneWayMiles || 0) });
      })
      .catch((error) => {
        if (!cancelled) setDistanceStatus((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Automatic Job Distance Is Unavailable." }));
      });
    return () => { cancelled = true; };
    // A saved address change should trigger one new mapped route calculation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectLocation]);
  const summary = useMemo(() => calculateEstimateSummary(estimate), [estimate]);
  const overrideReport = useMemo(() => estimateOverrideReport(estimate), [estimate]);
  const canApprove = ["Company Owner", "Administrator"].includes(
    actor.accessLevel,
  );
  const divisions = useMemo(
    () =>
      Array.from(
        new Map(
          ESTIMATE_TEMPLATE_COST_CODES.map((line) => [
            line.divisionCode,
            line.division,
          ]),
        ).entries(),
      ),
    [],
  );

  function invalidateApproval(current: EstimateData): EstimateData {
    if (current.status === "Draft") return current;
    return {
      ...current,
      status: "Draft",
      approvedAt: undefined,
      approvedBy: undefined,
    };
  }

  function updateEntry(
    parentCode: string,
    childCode: string | undefined,
    defaults: { quantity: number | null; unit: string | null },
    field: keyof EstimateEntry,
    value: string | number,
  ) {
    setEstimate((current) => {
      const next = invalidateApproval(current);
      return updateEstimateCell(next, parentCode, childCode, defaults, field, value);
    });
  }

  function resetEntryToFormula(parentCode: string, childCode?: string) {
    setEstimate((current) => {
      const next = invalidateApproval(current);
      const key = estimateLineKey(parentCode, childCode);
      const entries = { ...next.entries };
      delete entries[key];
      const cellFormulas = Object.fromEntries(Object.entries(next.cellFormulas)
        .filter(([formulaKey]) => !formulaKey.startsWith(`entry.${key}.`)));
      const entryOverrides = { ...next.entryOverrides };
      delete entryOverrides[key];
      return { ...next, entries, entryOverrides, cellFormulas };
    });
  }

  function updateSettings(
    field: keyof EstimateData["settings"],
    value: boolean | number,
  ) {
    setEstimate((current) => {
      const next = invalidateApproval(current);
      return { ...next, settings: { ...next.settings, [field]: value } };
    });
  }

  function updateProjectInput(
    field: keyof EstimateProjectInputs,
    value: EstimateProjectInputs[keyof EstimateProjectInputs],
  ) {
    setEstimate((current) => {
      const next = invalidateApproval(current);
      return {
        ...next,
        projectInputs: { ...next.projectInputs, [field]: value },
      };
    });
  }

  function updateFormula(key: string, expression: string) {
    setEstimate((current) => {
      const next = invalidateApproval(current);
      const cellFormulas = { ...next.cellFormulas };
      if (expression.trim()) cellFormulas[key] = expression.trim();
      else delete cellFormulas[key];
      return { ...next, cellFormulas };
    });
  }

  function formulaProps(key: string) {
    return {
      expression: estimate.cellFormulas[key] || "",
      onExpressionChange: (expression: string) => updateFormula(key, expression),
    };
  }

  function updateDistance(value: number | null) {
    setEstimate((current) => {
      const next = invalidateApproval(current);
      return {
        ...next,
        projectInputs: {
          ...next.projectInputs,
          distanceToFromJobMiles: Number(value || 0),
          distanceManuallyOverridden: true,
        },
      };
    });
  }

  function resetAutomaticDistance() {
    const automatic = estimate.projectInputs.distanceCalculatedMiles;
    if (automatic === null) return;
    setEstimate((current) => {
      const next = invalidateApproval(current);
      const cellFormulas = { ...next.cellFormulas };
      delete cellFormulas["project.distanceToFromJobMiles"];
      return {
        ...next,
        cellFormulas,
        projectInputs: {
          ...next.projectInputs,
          distanceToFromJobMiles: automatic,
          distanceManuallyOverridden: false,
        },
      };
    });
  }

  async function persistEstimate(nextEstimate: EstimateData, message: string) {
    if (estimate.status === "Awarded") throw new Error("The Awarded Estimate Is Locked.");
    const invalid = editorRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    if (invalid) { invalid.focus(); throw new Error("Correct The Highlighted Formula Before Saving Or Submitting."); }
    const estimateStatus =
      nextEstimate.status === "Ready For Review"
        ? "Ready For Review"
        : nextEstimate.status === "Approved"
          ? "Approved"
          : nextEstimate.status === "Awarded"
            ? "Awarded"
            : "In Progress";
    const updated: EstimateRecord = {
      ...record,
      data: {
        ...(record.data ?? {}),
        estimateStatus,
        estimatedValue: calculateEstimateSummary(nextEstimate).contractValue.toFixed(2),
        estimate: nextEstimate,
      },
    };
    const response = await fetch("/api/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "MEFFORD-SALES",
        recordType: "Sales Opportunities",
        record: updated,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(result.error || "The Estimate Could Not Be Saved.");
    setEstimate(nextEstimate);
    setSavedSnapshot(JSON.stringify(nextEstimate));
    onRecordSaved(updated);
    setNotice(message);
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const next = {
        ...estimate,
        templateVersion: ESTIMATE_TEMPLATE_VERSION,
        savedAt: new Date().toISOString(),
        savedBy: actor.name,
      };
      await persistEstimate(next, `${record.title} Estimate Saved!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Estimate Could Not Be Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function submitForReview() {
    if (summary.directJobCost <= 0) {
      setNotice("Enter A Positive Direct Job Cost Before Submitting The Estimate.");
      return;
    }
    setSaving(true);
    try {
      const next: EstimateData = {
        ...estimate,
        status: "Ready For Review",
        submittedAt: new Date().toISOString(),
        submittedOverrideReport: overrideReport,
        savedAt: new Date().toISOString(),
        savedBy: actor.name,
      };
      await persistEstimate(next, `${record.title} Submitted For Review!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Estimate Could Not Be Submitted.");
    } finally {
      setSaving(false);
    }
  }

  async function approveEstimate() {
    if (!canApprove) return;
    if (summary.directJobCost <= 0 || Math.abs(summary.reconciliationDifference) > 0.01) {
      setNotice("The Estimate Must Have Positive Reconciled Job Cost Before Approval.");
      return;
    }
    setSaving(true);
    try {
      const next: EstimateData = {
        ...estimate,
        status: "Approved",
        approvedAt: new Date().toISOString(),
        approvedBy: actor.name,
        savedAt: new Date().toISOString(),
        savedBy: actor.name,
      };
      await persistEstimate(next, `${record.title} Estimate Approved!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Estimate Could Not Be Approved.");
    } finally {
      setSaving(false);
    }
  }

  async function awardAndCreateProject() {
    if (!awardConfirmation) {
      setNotice("Check The Final Approval Confirmation Before Creating The Project.");
      return;
    }
    const required = [
      awardDraft.name,
      awardDraft.site,
      awardDraft.ownerName,
      awardDraft.ownerContractDate,
      awardDraft.ownerContractType,
      awardDraft.paymentTerms,
      awardDraft.projectType,
      awardDraft.startDate,
      awardDraft.substantialDate,
      awardDraft.finalDate,
      awardDraft.projectManager,
      awardDraft.superintendent,
    ];
    if (required.some((value) => !String(value).trim())) {
      setNotice("Complete Every Required Project Setup Field Before Awarding The Estimate.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/estimates/award", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId: record.id, project: awardDraft }),
      });
      const result = (await response.json()) as {
        project?: { number: string };
        error?: string;
        errorReference?: string;
      };
      if (!response.ok || !result.project) {
        const reference = result.errorReference && !result.error?.includes(result.errorReference)
          ? ` Reference ${result.errorReference}.`
          : "";
        throw new Error(`${result.error || "The Project Could Not Be Created. Nothing Was Saved."}${reference}`);
      }
      const next: EstimateData = {
        ...estimate,
        status: "Awarded",
        awardedProjectNumber: result.project.number,
      };
      setEstimate(next);
      onRecordSaved({
        ...record,
        status: "Awarded",
        data: {
          ...(record.data ?? {}),
          stage: "Awarded",
          estimateStatus: "Awarded",
          estimatedValue: String(summary.contractValue.toFixed(2)),
          awardedProjectNumber: result.project.number,
          estimate: next,
        },
      });
      setAwardOpen(false);
      setNotice(
        `${record.title} Became Project ${result.project.number}! The Original Budget Is Reconciled And Locked.`,
      );
      onProjectCreated?.(result.project.number);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The Project Could Not Be Created.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="estimate-editor-layer" role="presentation">
      <section ref={editorRef} className="estimate-editor" role="dialog" aria-modal="true" aria-labelledby="estimate-title">
        <header className="estimate-editor-header">
          <div>

            <h1 id="estimate-title">{record.title}</h1>
            <span>{record.id}</span>
          </div>
          <div className="estimate-header-actions">
            <span className={`estimate-state state-${estimate.status.toLowerCase().replaceAll(" ", "-")}`}>{estimate.status}</span>
            <span className={dirty ? "estimate-unsaved" : "estimate-saved"}>{dirty ? "Unsaved Changes" : "Saved"}</span>
            <button className="secondary-action" disabled={saving} onClick={() => dirty ? setConfirmClose(true) : onClose()}>Close</button>
          </div>
        </header>

        {confirmClose ? <div className="estimate-close-confirm" role="alert"><p>Your latest estimate changes have not been saved.</p><button onClick={() => setConfirmClose(false)}>Keep Editing</button><button onClick={onClose}>Discard Changes & Close</button><button className="primary-action" disabled={saving} onClick={() => void persistEstimate({ ...estimate, savedAt: new Date().toISOString(), savedBy: actor.name }, "Estimate Saved").then(onClose).catch(error => setNotice(error.message))}>Save & Close</button></div> : null}
        <fieldset className="estimate-editor-content" disabled={saving || estimate.status === "Awarded"}>
        {notice ? <button className="sales-notice estimate-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button> : null}

        <section className="estimate-summary-grid">
          <article {...summaryDrilldownProps({ title: "Estimate Contract Price Breakdown", rows: [...summary.budgetRollups.map((rollup) => ({ id: rollup.code, title: rollup.description, subtitle: rollup.division, value: money(rollup.amount), status: "Budget Cost" })), { id: "contract-only-fees", title: "Contract-Only Fees", value: money(summary.contractOnlyFees), status: "Selling Price" }, { id: "base-profit", title: "Base Profit", value: money(summary.baseProfit), status: "Selling Price" }, { id: "technology-fee", title: "Technology Fee", value: money(summary.technologyFee), status: "Selling Price" }] })}><span>TOTAL CONTRACT PRICE</span><strong>{money(summary.contractValue)}</strong></article>
          <article {...summaryDrilldownProps({ title: "Contractor Fee Breakdown", rows: [{ id: "base-profit", title: "Overhead And Profit", value: money(summary.baseProfit), status: "Contractor Fee" }, { id: "construction-management", title: "Construction Management", value: money(summary.constructionManagementFees), status: "Contractor Fee" }, { id: "technology", title: "Technology", value: money(summary.technologyFee), status: "Contractor Fee" }, { id: "insurance", title: "Insurance", value: money(summary.insuranceFees), status: "Contractor Fee" }] })}><span>TOTAL CONTRACTOR FEES · DOLLARS</span><strong>{money(summary.totalContractorFees)}</strong><small>O/P + CM + Tech + Insurance</small></article>
          <article {...summaryDrilldownProps({ title: "Contractor Fee Percentage", rows: [{ id: record.id, title: record.title, subtitle: `${money(summary.totalContractorFees)} fees ÷ ${money(summary.contractValue)} total contract price`, value: percent(summary.totalContractorFeeRate), status: estimate.status }] })}><span>TOTAL CONTRACTOR FEES · % OF TOTAL PRICE</span><strong>{percent(summary.totalContractorFeeRate)}</strong><small>Contractor Fees ÷ Total Contract Price</small></article>
          <article {...summaryDrilldownProps({ title: "Estimate Cost Per Square Foot", rows: [{ id: record.id, title: record.title, subtitle: `${money(summary.contractValue)} ÷ ${estimate.projectInputs.buildingSquareFeet.toLocaleString("en-US")} building SF`, value: moneyPerSquareFoot(summary.costPerSquareFoot), status: estimate.status }] })}><span>COST PER SQ FT</span><strong>{moneyPerSquareFoot(summary.costPerSquareFoot)}</strong><small>Total Contract Price ÷ {estimate.projectInputs.buildingSquareFeet.toLocaleString("en-US")} Building SF</small></article>
        </section>

        <section className="estimate-workbook-setup" aria-labelledby="estimate-setup-title">
          <div className="estimate-workbook-heading">
            <div>

              <h2 id="estimate-setup-title">Project Inputs</h2>

            </div>

          </div>
          <div className="estimate-setup-grid">
            <label><span>Project Duration</span><div><NumberInput label="Project Duration In Months" value={estimate.projectInputs.projectDurationMonths} {...formulaProps("project.projectDurationMonths")} onChange={(value) => updateProjectInput("projectDurationMonths", Number(value || 0))} /><b>Months</b></div></label>
            <div className="estimate-setup-field estimate-distance-field"><span>Round-Trip Job Distance</span><div><NumberInput label="Round-Trip Job Distance In Miles" value={estimate.projectInputs.distanceToFromJobMiles} {...formulaProps("project.distanceToFromJobMiles")} onChange={updateDistance} /><b>Miles</b></div><small className={distanceStatus.error ? "setup-warning" : ""}>{distanceStatus.loading ? `Mapping ${projectLocation}...` : distanceStatus.error ? `Route lookup is unavailable. Enter the round-trip mileage manually.` : estimate.projectInputs.distanceManuallyOverridden ? `Manual override. Automatic route is ${estimate.projectInputs.distanceCalculatedMiles ?? 0} miles round trip.` : distanceStatus.oneWayMiles !== null ? `${distanceStatus.oneWayMiles.toFixed(1)} miles each way from ${distanceStatus.originAddress || "the Mefford office"} · ${distanceStatus.provider}` : projectLocation ? "Uses the Sales Opportunity project address automatically." : "Enter a project address in Sales or type the mileage manually."}</small>{estimate.projectInputs.distanceManuallyOverridden && estimate.projectInputs.distanceCalculatedMiles !== null ? <button type="button" onClick={resetAutomaticDistance}>Use Automatic Mileage</button> : null}</div>
            <label><span>Building Square Feet</span><div><NumberInput label="Building Square Feet" value={estimate.projectInputs.buildingSquareFeet} {...formulaProps("project.buildingSquareFeet")} onChange={(value) => updateProjectInput("buildingSquareFeet", Number(value || 0))} /><b>SF</b></div></label>
            <label><span>Cleanup Square Feet</span><div><NumberInput label="Cleanup Square Feet" value={estimate.projectInputs.cleanupSquareFeet} {...formulaProps("project.cleanupSquareFeet")} onChange={(value) => updateProjectInput("cleanupSquareFeet", Number(value || 0))} /><b>SF</b></div></label>
          </div>
          <details className="estimate-rate-settings" open>
            <summary>Management Rates And Fee Overrides</summary>
            <div className="estimate-setup-grid">
              {([
                ["Project Manager Billable Rate", "projectManagerBillableRate"],
                ["Project Manager Cost Rate", "projectManagerCostRate"],
                ["Superintendent Billable Rate", "superintendentBillableRate"],
                ["Superintendent Cost Rate", "superintendentCostRate"],
              ] as const).map(([label, field]) => <label key={field}><span>{label}</span><div><NumberInput currency label={label} value={estimate.settings[field]} {...formulaProps(`settings.${field}`)} onChange={value => updateSettings(field, Number(value || 0))}/><b>/ Hr</b></div></label>)}
              <label><span>Cleanup Fee Override</span><div><NumberInput currency allowEmpty label="Cleanup Fee Override" value={estimate.projectInputs.cleanupFeeOverride} {...formulaProps("project.cleanupFeeOverride")} onChange={value => updateProjectInput("cleanupFeeOverride", value)}/></div><small>{estimate.projectInputs.cleanupFeeOverride === null ? "Automatic: Cleanup SF × $2.00" : "Manual Total · Clear To Restore SF Formula"}</small></label>
              <label><span>Architectural Fee Override</span><div><NumberInput currency allowEmpty label="Architectural Fee Override" value={estimate.projectInputs.architecturalFeeOverride} {...formulaProps("project.architecturalFeeOverride")} onChange={value => updateProjectInput("architecturalFeeOverride", value)}/></div><small>{estimate.projectInputs.architecturalFeeOverride === null ? "Automatic: 4% Of Construction Cost" : "Manual Total · Clear To Restore 4% Formula"}</small></label>
            </div>
          </details>

        </section>

        <section className="estimate-controls">
          <label><span>Base Profit</span><input type="checkbox" checked={estimate.settings.includeBaseProfit} onChange={(event) => updateSettings("includeBaseProfit", event.target.checked)} /></label>
          <label><span>Base Profit Rate</span><NumberInput label="Base Profit Rate Percentage" value={estimate.settings.baseProfitRate * 100} {...formulaProps("settings.baseProfitRatePercent")} onChange={(value) => updateSettings("baseProfitRate", Number(value || 0) / 100)} /><b>%</b></label>
          <label><span>Performance Bond</span><input type="checkbox" checked={estimate.settings.includePerformanceBond} onChange={(event) => updateSettings("includePerformanceBond", event.target.checked)} /></label>
          <label className="estimate-search"><span>Search Cost Codes</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code Or Description" /></label>
        </section>

        <section className="estimate-table-shell" data-reflow-table="">
          <div className="estimate-table-header" data-reflow-head="wide">
            <span>Cost Code And Scope</span><span>Qty</span><span>Unit</span><span>Material</span><span>Mefford Labor</span><span>Equipment</span><span>Subcontract</span><span>Other</span><span>Total</span>
          </div>
          {divisions.map(([divisionCode, divisionName]) => {
            const lines = ESTIMATE_TEMPLATE_COST_CODES.filter((line) => {
              if (line.divisionCode !== divisionCode) return false;
              const haystack = `${line.code} ${line.description} ${line.children.map((child) => child.description).join(" ")}`.toLowerCase();
              return !query || haystack.includes(query.toLowerCase());
            });
            if (!lines.length) return null;
            const isOpen = Boolean(query) || openDivisions.includes(divisionCode);
            const divisionTotal = lines.reduce((total, line) => {
              if (line.calculation === "technology_fee") return total + summary.technologyFee;
              if (line.calculation === "base_profit") return total + summary.baseProfit;
              if (line.calculation === "performance_bond") return total + summary.performanceBond;
              const parent = calculateEstimateEntry(estimate, line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit }).entry;
              const children = line.children.reduce((lineTotal, child) => lineTotal + estimateEntryTotal(calculateEstimateEntry(estimate, line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }).entry), 0);
              return total + estimateEntryTotal(parent) + children;
            }, 0);
            return (
              <article className="estimate-division" key={divisionCode}>
                <button className="estimate-division-heading" onClick={() => setOpenDivisions((current) => current.includes(divisionCode) ? current.filter((item) => item !== divisionCode) : [...current, divisionCode])}>
                  <span>{isOpen ? "−" : "+"}</span><strong>Division {divisionCode} · {divisionName}</strong><b>{money(divisionTotal)}</b>
                </button>
                {isOpen ? <div className="estimate-lines">{lines.flatMap((line) => {
                  const formulaAmount = line.calculation === "technology_fee" ? summary.technologyFee : line.calculation === "base_profit" ? summary.baseProfit : line.calculation === "performance_bond" ? summary.performanceBond : null;
                  const parentFormula = calculateEstimateEntry(estimate, line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit });
                  const automaticParentFormula = automaticEstimateEntry(estimate, line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit });
                  const parentOverridden = Boolean(estimate.entries[line.code]);
                  const parentEntry = parentFormula.entry;
                  const parentTotal = estimateEntryTotal(parentEntry);
                  const automaticLabel = line.calculation === "technology_fee"
                    ? "Automatic Technology Fee"
                    : line.calculation === "base_profit"
                      ? "Automatic Base Profit"
                      : line.calculation === "performance_bond"
                        ? "Automatic Performance Bond"
                        : automaticParentFormula.formula;
                  const rows = [
                    <div className={`estimate-line ${formulaAmount !== null ? "formula-line" : ""} ${parentOverridden && (automaticLabel || formulaAmount !== null) ? "formula-overridden" : ""}`} key={line.code} data-reflow-row="wide">
                      <span className="estimate-scope" data-label="Cost Code And Scope"><strong>{line.code} · {line.description}</strong><small>{parentOverridden && (automaticLabel || formulaAmount !== null) ? `${automaticLabel} · Manual: ${estimateManualFields(estimate, line.code).join(", ")}` : automaticLabel || `${line.budgetable ? "Budgetable Job Cost" : "Contract Only"}`}</small>{parentOverridden && (automaticLabel || formulaAmount !== null) ? <button type="button" className="estimate-formula-reset" onClick={() => resetEntryToFormula(line.code)}>Reset To Formula</button> : null}</span>
                      <label className="reflow-field" data-label="Qty"><NumberInput label={`${line.code} Quantity`} value={parentEntry.quantity} {...formulaProps(`entry.${line.code}.quantity`)} onChange={(value) => updateEntry(line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit }, "quantity", Number(value || 0))} /></label>
                      <label className="reflow-field" data-label="Unit"><input aria-label={`${line.code} Unit`} value={parentEntry.unit} onChange={(event) => updateEntry(line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit }, "unit", event.target.value.toUpperCase())} /></label>
                      <label className="reflow-field" data-label="Material"><NumberInput currency label={`${line.code} Material`} value={parentEntry.material} {...formulaProps(`entry.${line.code}.material`)} onChange={(value) => updateEntry(line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit }, "material", Number(value || 0))} /></label>
                      <label className="reflow-field" data-label="Mefford Labor"><NumberInput currency label={`${line.code} Mefford Labor`} value={parentEntry.labor} {...formulaProps(`entry.${line.code}.labor`)} onChange={(value) => updateEntry(line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit }, "labor", Number(value || 0))} /></label>
                      <label className="reflow-field" data-label="Equipment"><NumberInput currency label={`${line.code} Equipment`} value={parentEntry.equipment} {...formulaProps(`entry.${line.code}.equipment`)} onChange={(value) => updateEntry(line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit }, "equipment", Number(value || 0))} /></label>
                      <label className="reflow-field" data-label="Subcontract"><NumberInput currency label={`${line.code} Subcontract`} value={parentEntry.subcontract} {...formulaProps(`entry.${line.code}.subcontract`)} onChange={(value) => updateEntry(line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit }, "subcontract", Number(value || 0))} /></label>
                      <label className="reflow-field" data-label="Other"><NumberInput currency label={`${line.code} Other`} value={parentEntry.other} {...formulaProps(`entry.${line.code}.other`)} onChange={(value) => updateEntry(line.code, undefined, { quantity: line.defaultQuantity, unit: line.defaultUnit }, "other", Number(value || 0))} /></label>
                      <strong className="estimate-line-total" data-label="Total">{money(parentTotal)}</strong>
                    </div>,
                    ...line.children.map((child) => {
                      const childDefaults = { quantity: child.defaultQuantity, unit: child.defaultUnit };
                      const childFormula = calculateEstimateEntry(estimate, line.code, child.code, childDefaults);
                      const automaticChildFormula = automaticEstimateEntry(estimate, line.code, child.code, childDefaults);
                      const childEntry = childFormula.entry;
                      const childKey = `${line.code}:${child.code}`;
                      const childOverridden = Boolean(estimate.entries[childKey]) && Boolean(automaticChildFormula.formula);
                      return <div className={`estimate-line child-line ${childOverridden ? "formula-overridden" : ""}`} key={childKey} data-reflow-row="wide">
                        <span className="estimate-scope" data-label="Cost Code And Scope"><strong>{child.code} · {child.description}</strong><small>{childOverridden ? `${automaticChildFormula.formula} · Manual: ${estimateManualFields(estimate, childKey).join(", ")}` : automaticChildFormula.formula || `Rolls Up To ${line.code}`}</small>{childOverridden ? <button type="button" className="estimate-formula-reset" onClick={() => resetEntryToFormula(line.code, child.code)}>Reset To Formula</button> : null}</span>
                        <label className="reflow-field" data-label="Qty"><NumberInput label={`${line.code} ${child.code} Quantity`} value={childEntry.quantity} {...formulaProps(`entry.${line.code}:${child.code}.quantity`)} onChange={(value) => updateEntry(line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }, "quantity", Number(value || 0))} /></label>
                        <label className="reflow-field" data-label="Unit"><input aria-label={`${line.code} ${child.code} Unit`} value={childEntry.unit} onChange={(event) => updateEntry(line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }, "unit", event.target.value.toUpperCase())} /></label>
                        <label className="reflow-field" data-label="Material"><NumberInput currency label={`${line.code} ${child.code} Material`} value={childEntry.material} {...formulaProps(`entry.${line.code}:${child.code}.material`)} onChange={(value) => updateEntry(line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }, "material", Number(value || 0))} /></label>
                        <label className="reflow-field" data-label="Mefford Labor"><NumberInput currency label={`${line.code} ${child.code} Mefford Labor`} value={childEntry.labor} {...formulaProps(`entry.${line.code}:${child.code}.labor`)} onChange={(value) => updateEntry(line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }, "labor", Number(value || 0))} /></label>
                        <label className="reflow-field" data-label="Equipment"><NumberInput currency label={`${line.code} ${child.code} Equipment`} value={childEntry.equipment} {...formulaProps(`entry.${line.code}:${child.code}.equipment`)} onChange={(value) => updateEntry(line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }, "equipment", Number(value || 0))} /></label>
                        <label className="reflow-field" data-label="Subcontract"><NumberInput currency label={`${line.code} ${child.code} Subcontract`} value={childEntry.subcontract} {...formulaProps(`entry.${line.code}:${child.code}.subcontract`)} onChange={(value) => updateEntry(line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }, "subcontract", Number(value || 0))} /></label>
                        <label className="reflow-field" data-label="Other"><NumberInput currency label={`${line.code} ${child.code} Other`} value={childEntry.other} {...formulaProps(`entry.${line.code}:${child.code}.other`)} onChange={(value) => updateEntry(line.code, child.code, { quantity: child.defaultQuantity, unit: child.defaultUnit }, "other", Number(value || 0))} /></label>
                        <strong className="estimate-line-total" data-label="Total">{money(estimateEntryTotal(childEntry))}</strong>
                      </div>;
                    }),
                  ];
                  return rows;
                })}</div> : null}
              </article>
            );
          })}
        </section>

        {estimate.status !== "Draft" ? <section className="estimate-override-report" aria-labelledby="estimate-override-report-title">
          <div className="estimate-override-report-heading">
            <div><h2 id="estimate-override-report-title">Precalculated Overrides</h2></div>
            <strong>{(estimate.submittedOverrideReport ?? overrideReport).length} Changed</strong>
          </div>
          {(estimate.submittedOverrideReport ?? overrideReport).length ? <div className="estimate-override-table" data-reflow-table="">
            <div className="estimate-override-row heading" data-reflow-head="medium"><span>Cost Code</span><span>Edited Fields</span><span>Automatic</span><span>Entered</span><span>Difference</span></div>
            {(estimate.submittedOverrideReport ?? overrideReport).map((item) => <div className="estimate-override-row" key={item.lineKey} data-reflow-row="medium">
              <span data-label="Cost Code"><strong>{item.code}</strong><small>{item.description}</small></span>
              <span data-label="Edited Fields">{item.changedFields.join(", ")}</span>
              <span data-label="Automatic">{money(item.automaticAmount)}</span>
              <span data-label="Entered">{money(item.enteredAmount)}</span>
              <span className={item.difference < 0 ? "negative" : item.difference > 0 ? "positive" : ""} data-label="Difference">{item.difference > 0 ? "+" : ""}{money(item.difference)}</span>
            </div>)}
          </div> : null}
          <small>Submitted by {estimate.savedBy || "Estimator"}{estimate.submittedAt ? ` · ${new Date(estimate.submittedAt).toLocaleString("en-US")}` : ""}</small>
        </section> : null}

        <section className="estimate-notes-section"><label><span>Estimate Notes And Assumptions</span><textarea rows={4} value={estimate.notes} onChange={(event) => setEstimate((current) => ({ ...invalidateApproval(current), notes: event.target.value }))} /></label></section>

        </fieldset>
        <footer className="estimate-footer">
          <div className={Math.abs(summary.reconciliationDifference) <= 0.01 ? "reconciliation-pass" : "reconciliation-fail"}><strong>{Math.abs(summary.reconciliationDifference) <= 0.01 ? "✓ Budget Reconciled" : "Budget Does Not Reconcile"}</strong></div>
          <span />
          <button className="secondary-action" disabled={saving || estimate.status === "Awarded"} onClick={() => void saveDraft()}>{saving ? "Saving..." : "Save Draft"}</button>
          {estimate.status !== "Approved" && estimate.status !== "Awarded" ? <button className="primary-action" disabled={saving} onClick={() => void submitForReview()}>Submit For Review</button> : null}
          {canApprove && estimate.status === "Ready For Review" ? <button className="primary-action" disabled={saving} onClick={() => void approveEstimate()}>Approve Estimate</button> : null}
          {canApprove && estimate.status === "Approved" ? <button className="primary-action large" disabled={saving} onClick={() => setAwardOpen(true)}>Award And Create Project →</button> : null}
          {estimate.status === "Awarded" ? <button className="primary-action large" onClick={() => onProjectCreated?.(estimate.awardedProjectNumber || "")}>Open Project {estimate.awardedProjectNumber} →</button> : null}
        </footer>

        {awardOpen ? <div className="modal-layer award-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setAwardOpen(false)}>
          <section className="record-modal wide award-modal" role="dialog" aria-modal="true" aria-labelledby="award-title">
            <div className="modal-heading"><div><h2 id="award-title">Award And Create Project</h2></div><button aria-label="Close Award Setup" onClick={() => setAwardOpen(false)}>×</button></div>
            <div className="award-summary"><span><small>Project Owner Contract</small><strong>{money(summary.contractValue)}</strong></span><span><small>Locked Original Budget</small><strong>{money(summary.originalBudget)}</strong></span><span><small>Total Contractor Fees</small><strong>{percent(summary.totalContractorFeeRate)}</strong></span></div>
            <div className="sales-form-grid">
              {([
                ["Project Name", "name", "text"], ["Project Location", "site", "text"], ["Project Owner / Client", "ownerName", "text"], ["Project Owner Contract Date", "ownerContractDate", "date"], ["Project Type", "projectType", "text"], ["Start Date", "startDate", "date"], ["Substantial Completion", "substantialDate", "date"], ["Final Completion", "finalDate", "date"],
              ] as Array<[string, keyof AwardProjectDraft, string]>).map(([label, field, type]) => <label className="sales-field" key={field}><span>{label}</span><input type={type} value={String(awardDraft[field])} onChange={(event) => setAwardDraft((current) => ({ ...current, [field]: event.target.value }))} /></label>)}
              <label className="sales-field"><span>Architect</span><select aria-label="Architect" value={awardDraft.architect} onChange={(event) => setAwardDraft((current) => ({ ...current, architect: event.target.value }))}><option value="">Select Architect Vendor</option>{awardDraft.architect && !architectOptions.some((vendor) => vendor.name === awardDraft.architect) ? <option>{awardDraft.architect}</option> : null}{architectOptions.map((vendor) => <option key={vendor.id} value={vendor.name}>{vendor.name}{vendor.temporaryApproval ? " · Temporary Approval" : vendor.paymentHold ? " · Payment Hold" : " · Compliance Current"}</option>)}</select></label>
              <label className="sales-field"><span>Project Owner Contract Type</span><select value={awardDraft.ownerContractType} onChange={(event) => setAwardDraft((current) => ({ ...current, ownerContractType: event.target.value as AwardProjectDraft["ownerContractType"] }))}>{OWNER_CONTRACT_TYPES.map((type) => <option key={type} value={type}>{contractTemplate(type).label}</option>)}</select><small>External Contract means another party’s uploaded agreement controls.</small></label>
              <label className="sales-field wide"><span>Payment Terms</span><input value={awardDraft.paymentTerms} onChange={(event) => setAwardDraft((current) => ({ ...current, paymentTerms: event.target.value }))} /></label>
              <label className="sales-field"><span>Retainage Before 50% (%)</span><input type="number" min="0" max="100" step="0.1" value={awardDraft.retainageInitialPercent} onChange={(event) => setAwardDraft((current) => ({ ...current, retainageInitialPercent: Number(event.target.value) }))} /></label>
              <label className="sales-field"><span>Retainage After 50% (%)</span><input type="number" min="0" max="100" step="0.1" value={awardDraft.retainageAfterHalfPercent} onChange={(event) => setAwardDraft((current) => ({ ...current, retainageAfterHalfPercent: Number(event.target.value) }))} /></label>
              <label className="sales-field"><span>Project Manager</span><select aria-label="Project Manager" value={awardDraft.projectManager} onChange={(event) => setAwardDraft((current) => ({ ...current, projectManager: event.target.value }))}><option value="" disabled>Select Project Manager</option>{projectManagerOptions.map((member) => <option key={member.email} value={member.name}>{member.name}</option>)}</select></label>
              <label className="sales-field"><span>Site Superintendent</span><select aria-label="Site Superintendent" value={awardDraft.superintendent} onChange={(event) => setAwardDraft((current) => ({ ...current, superintendent: event.target.value }))}><option value="" disabled>Select Site Superintendent</option>{superintendentOptions.map((member) => <option key={member.email} value={member.name}>{member.name}</option>)}</select></label>
              <label className="sales-field"><span>Project Cameras</span><input type="number" min="0" max="16" value={awardDraft.cameraCount} onChange={(event) => setAwardDraft((current) => ({ ...current, cameraCount: Math.min(16, Math.max(0, Number(event.target.value) || 0)) }))} /></label>
              <label className="sales-field"><span>Project Time Zone</span><select value={awardDraft.timeZone} onChange={(event) => setAwardDraft((current) => ({ ...current, timeZone: event.target.value }))}><option value="America/New_York">Eastern Time</option><option value="America/Chicago">Central Time</option><option value="America/Denver">Mountain Time</option><option value="America/Los_Angeles">Pacific Time</option></select></label>
            </div>
            <label className="award-confirmation"><input type="checkbox" checked={awardConfirmation} onChange={(event) => setAwardConfirmation(event.target.checked)} /><span><strong>Final Company Owner Or Administrator Approval</strong>I Confirm This Approved Estimate May Create The Project Owner Contract Value And Locked Original Project Budget.</span></label>
            <div className="sales-modal-actions"><button className="secondary-action" onClick={() => setAwardOpen(false)}>Cancel</button><button className="primary-action large" disabled={saving || !awardConfirmation} onClick={() => void awardAndCreateProject()}>{saving ? "Creating Project..." : "Approve Award And Create Project"}</button></div>
          </section>
        </div> : null}
      </section>
    </div>
  );
}

function boundedPercent(value: unknown, fallback: number) {
  const parsed = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
}
