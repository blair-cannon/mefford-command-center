import {
  ESTIMATE_TEMPLATE_VERSION,
  calculateEstimateEntry,
  calculateEstimateSummary,
  estimateEntryTotal,
  normalizeEstimateData,
} from "../../../estimate-template";
import { resolveCommandActor } from "../../../../lib/server-actor";
import { enforceOnboardingAccess } from "../../../../lib/onboarding";
import {
  normalizeBidPackageData,
  selectedProposalBid,
} from "../../../../lib/procurement";
import { ensureVendorSchema } from "../../../../lib/vendor-portal";
import { ensureOwnerPortalSchema, hashOwnerSecret } from "../../../../lib/owner-portal";
import {
  applyOwnerContractCommercialTerms,
  contractTemplate,
  defaultContractInstrument,
  defaultContractFields,
  isOwnerContractType,
  normalizeOwnerContractCommercialTerms,
  normalizeSmallProjectPricingMethod,
  requiredContractFields,
  synchronizeOwnerContractContactFields,
  type OwnerContractType,
  withOwnerContractComputedFields,
} from "../../../../lib/owner-contracts";
import {
  domainEventStatements,
  ensureDomainOutboxSchema,
  reconcileDomainEvent,
} from "../../../../lib/domain-outbox";
import {
  PREAWARD_OWNER_CONTRACT_RECORD_TYPE,
  carryPreAwardContractFields,
  normalizePreAwardOwnerContractData,
  preAwardOwnerContractRecordId,
} from "../../../../lib/preaward-owner-contract";
import { buildOwnerContractPrefill } from "../../../../lib/owner-contract-prefill";
import {
  ownerContractContactReference,
  resolveOwnerContractContact,
} from "../../../../lib/owner-contract-contact";

const SALES_PROJECT_ID = "MEFFORD-SALES";
const OPPORTUNITY_RECORD_TYPE = "Sales Opportunities";
const BUDGET_CONTROL_ID = "BUDGET-CONTROL";

type AwardPayload = {
  opportunityId?: string;
  project?: {
    name?: string;
    site?: string;
    ownerName?: string;
    ownerContractDate?: string;
    ownerContractType?: OwnerContractType;
    paymentTerms?: string;
    retainageInitialPercent?: number;
    retainageAfterHalfPercent?: number;
    architect?: string;
    projectType?: string;
    startDate?: string;
    substantialDate?: string;
    finalDate?: string;
    timeZone?: string;
    projectManager?: string;
    superintendent?: string;
    cameraCount?: number;
  };
};

type OpportunityRow = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  record_date: string | null;
  data_json: string;
};

type DesignPackageRow = {
  id: string;
  title: string;
  owner: string;
  due: string;
  status: string;
  meta: string;
  record_date: string | null;
  record_time: string | null;
  data_json: string;
};

export async function POST(request: Request) {
  const actor = await resolveCommandActor(request);
  const errorReference = `AWARD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  if (!actor.authenticated) {
    return Response.json({ error: "Authentication Required" }, { status: 401 });
  }
  const onboardingLock = await enforceOnboardingAccess(request);
  if (onboardingLock) return onboardingLock;

  try {
    const database = await commandD1();
    await ensureOwnerContractProjectColumns(database);
    await ensureVendorSchema();
    await ensureOwnerPortalSchema(database);
    await ensureDomainOutboxSchema(database);
    if (!(await canAwardEstimate(database, actor.email, actor.accessLevel))) {
      return Response.json(
        { error: "A Company Owner Or Administrator Must Approve The Award" },
        { status: 403 },
      );
    }

    const payload = (await request.json()) as AwardPayload;
    const opportunityId = payload.opportunityId?.trim() || "";
    const project = payload.project;
    if (!opportunityId || !project || !completeProject(project)) {
      return Response.json(
        { error: "Complete Award And Project Setup Information Is Required" },
        { status: 400 },
      );
    }
    if (
      project.startDate! > project.substantialDate! ||
      project.substantialDate! > project.finalDate!
    ) {
      return Response.json(
        { error: "Start Substantial Completion And Final Completion Dates Must Be In Order" },
        { status: 400 },
      );
    }

    const opportunity = await database.prepare(
      `SELECT id, title, owner, due, status, meta, record_date, data_json
       FROM command_records
       WHERE project_id = ? AND id = ? AND record_type = ?
       LIMIT 1`,
    )
      .bind(SALES_PROJECT_ID, opportunityId, OPPORTUNITY_RECORD_TYPE)
      .first<OpportunityRow>();
    if (!opportunity) {
      return Response.json({ error: "The Sales Opportunity Could Not Be Found" }, { status: 404 });
    }

    const opportunityData = parseJson(opportunity.data_json);
    const preAwardContract = await database.prepare(
      `SELECT id, title, owner, due, status, meta, record_date, record_time, data_json
       FROM command_records
       WHERE project_id = ? AND id = ? AND record_type = ?
       LIMIT 1`,
    ).bind(
      SALES_PROJECT_ID,
      preAwardOwnerContractRecordId(opportunityId),
      PREAWARD_OWNER_CONTRACT_RECORD_TYPE,
    ).first<DesignPackageRow>();
    const preAwardContractRaw = preAwardContract ? parseJson(preAwardContract.data_json) : null;
    const preAwardContractData = normalizePreAwardOwnerContractData(preAwardContractRaw);
    const salesDesignPackages = (await database.prepare(
      `SELECT id, title, owner, due, status, meta, record_date, record_time, data_json
       FROM command_records
       WHERE project_id = ? AND record_type = 'Design Packages'`,
    ).bind(SALES_PROJECT_ID).all<DesignPackageRow>()).results.filter((row) => String(parseJson(row.data_json).opportunityId || "") === opportunityId);
    const salesDesignTeam = await database.prepare(
      `SELECT id, title, owner, due, status, meta, record_date, record_time, data_json
       FROM command_records
       WHERE project_id = ? AND id = ? AND record_type = 'Design Team'
       LIMIT 1`,
    ).bind(SALES_PROJECT_ID, `DESIGN-TEAM-${opportunityId}`).first<DesignPackageRow>();
    const salesBidPackages = (await database.prepare(
      `SELECT id, title, owner, due, status, meta, record_date, record_time, data_json
       FROM command_records
       WHERE project_id = ? AND record_type = 'Bid Packages'`,
    ).bind(SALES_PROJECT_ID).all<DesignPackageRow>()).results.filter((row) => String(parseJson(row.data_json).opportunityId || "") === opportunityId);
    const salesOwnerProposals = (await database.prepare(
      `SELECT id, title, owner, due, status, meta, record_date, record_time, data_json
       FROM command_records
       WHERE project_id = ? AND record_type = 'Owner Proposals'`,
    ).bind(SALES_PROJECT_ID).all<DesignPackageRow>()).results.filter((row) =>
      row.status === "Issued" && String(parseJson(row.data_json).opportunityId || "") === opportunityId,
    );
    const estimate = normalizeEstimateData(opportunityData.estimate);
    const existingProjectNumber = String(
      estimate.awardedProjectNumber || opportunityData.awardedProjectNumber || "",
    );
    if (existingProjectNumber) {
      const existingProject = await loadProject(database, existingProjectNumber);
      if (existingProject) {
        const existingHandoff = await reconcileDomainEvent(
          database,
          `estimate-awarded:${opportunityId}:${existingProjectNumber}`,
        );
        return Response.json(
          {
            project: existingProject,
            idempotent: true,
            handoff: existingHandoff || {
              status: "Legacy Untracked",
              consumers: [],
              completionRule: "This project predates the F-13 durable handoff ledger and is not represented as reconciled evidence.",
            },
          },
          { status: existingHandoff && existingHandoff.status !== "Completed" ? 202 : 200 },
        );
      }
    }
    if (estimate.templateVersion !== ESTIMATE_TEMPLATE_VERSION) {
      return Response.json(
        { error: "This Estimate Uses An Older Template And Must Be Reviewed Before Award" },
        { status: 409 },
      );
    }
    if (estimate.status !== "Approved" || !estimate.approvedBy || !estimate.approvedAt) {
      return Response.json(
        { error: "Approve The Final Estimate Before Creating The Project" },
        { status: 409 },
      );
    }

    const sourceProposal = latestIssuedProposal(salesOwnerProposals);
    const sourceProposalData = sourceProposal ? parseJson(sourceProposal.data_json) : null;
    const linkedOwnerContact = await resolveOwnerContractContact(database, ownerContractContactReference(
      opportunityData,
      opportunityData.proposalHandoff,
      sourceProposalData,
      { ownerName: project.ownerName },
    ));

    const summary = calculateEstimateSummary(estimate);
    if (
      summary.directJobCost <= 0 ||
      summary.originalBudget <= 0 ||
      summary.contractValue <= 0 ||
      summary.budgetRollups.length === 0
    ) {
      return Response.json(
        { error: "The Approved Estimate Must Contain Positive Budgetable Job Cost" },
        { status: 409 },
      );
    }
    if (Math.abs(summary.reconciliationDifference) > 0.01) {
      return Response.json(
        { error: "Estimate-To-Budget Reconciliation Failed And The Project Was Not Created" },
        { status: 409 },
      );
    }

    const projectNumber = await nextProjectNumber(database);
    const now = new Date().toISOString();
    const managementEntries = [
      calculateEstimateEntry(estimate, "0131.00", "100", { quantity: 0, unit: "HR" }).entry,
      calculateEstimateEntry(estimate, "0131.00", "200", { quantity: 0, unit: "HR" }).entry,
    ];
    const salesMetrics = {
      contractValue: roundMoney(summary.contractValue),
      managementHours: managementEntries.reduce((total, entry) => total + entry.quantity, 0),
      managementRevenue: roundMoney(
        managementEntries.reduce((total, entry) => total + estimateEntryTotal(entry), 0),
      ),
      insuranceRevenue: roundMoney(
        summary.budgetRollups.find((rollup) => rollup.code === "0142.00")?.amount || 0,
      ),
      technologyFee: roundMoney(summary.technologyFee),
      grossProfit: roundMoney(summary.grossProfit),
      grossMargin: summary.grossMargin,
    };
    const currentDate = dateLabel(project.ownerContractDate!);
    const contractType = isOwnerContractType(project.ownerContractType) ? project.ownerContractType : "Plan & Spec Lump Sum";
    const commercialTerms = normalizeOwnerContractCommercialTerms(project);
    const { paymentTerms, retainageInitialPercent, retainageAfterHalfPercent } = commercialTerms;
    const contractValue = summary.contractValue.toFixed(2);
    const projectManager = project.projectManager!.trim();
    const projectName = project.name!.trim();
    const timeZone = project.timeZone || "America/New_York";
    const activeInstrument = defaultContractInstrument(contractType);
    const contractProjectSource = {
      number: projectNumber,
      name: projectName,
      site: project.site!.trim(),
      ownerName: project.ownerName!.trim(),
      ownerContractDate: project.ownerContractDate!,
      architect: project.architect?.trim() || "",
      contractAmount: contractValue,
      startDate: project.startDate!,
      substantialDate: project.substantialDate!,
      finalDate: project.finalDate!,
      projectManager,
      superintendent: project.superintendent!.trim(),
      projectType: project.projectType!.trim(),
      paymentTerms,
      retainageInitialPercent,
      retainageAfterHalfPercent,
    };
    const generatedContractFields = defaultContractFields(contractType, contractProjectSource, { name: actor.name, email: actor.email }, activeInstrument);
    const contractPrefill = buildOwnerContractPrefill({
      baseFields: generatedContractFields,
      project: contractProjectSource,
      estimate,
      estimateRecordId: `ESTIMATE-${opportunityId}`,
      proposal: sourceProposalData,
      proposalRecordId: sourceProposal?.id,
      contact: linkedOwnerContact?.contact,
      contactRecordId: linkedOwnerContact?.recordId,
    });
    const carriedContract = carryPreAwardContractFields({
      preAward: preAwardContractData,
      finalContractType: contractType,
      finalInstrument: activeInstrument,
      generatedFields: contractPrefill.fields,
    });
    let contractFields = carriedContract.fields;
    let manualFieldKeys = carriedContract.carried
      ? preAwardContractData?.manualFieldKeys.length
        ? preAwardContractData.manualFieldKeys
        : Object.entries(preAwardContractData?.fields || {}).filter(([field, value]) =>
          String(value || "").trim() && value !== contractPrefill.fields[field],
        ).map(([field]) => field)
      : [];
    const contactRouting = synchronizeOwnerContractContactFields(contractFields, manualFieldKeys);
    contractFields = withOwnerContractComputedFields(contractType, contactRouting.fields);
    manualFieldKeys = contactRouting.manualFieldKeys;
    const contractFieldSources = {
      ...contractPrefill.sources,
      ...Object.fromEntries(manualFieldKeys.map((field) => [field, { kind: "Manual", label: "Manual Override" }])),
    };
    applyOwnerContractCommercialTerms(contractFields, commercialTerms);
    const openContractFields = requiredContractFields(contractType, activeInstrument, contractFields).filter((field) => !contractFields[field]?.trim());
    const projectStatement = database.prepare(
      `INSERT INTO projects (
        number, name, status, site, owner_name, owner_contract_date,
        owner_contract_type, owner_contract_status, owner_contract_record_id,
        payment_terms, retainage_initial_percent, retainage_after_half_percent, architect,
        project_type, contract_amount, current_contract_amount, start_date,
        substantial_date, final_date, time_zone, latitude_millionths,
        longitude_millionths, project_manager, superintendent, camera_count,
        updated_at
      ) VALUES (?, ?, 'Active', ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).bind(
      projectNumber,
      projectName,
      project.site!.trim(),
      project.ownerName!.trim(),
      project.ownerContractDate!,
      contractType,
      `OWNER-CONTRACT-${projectNumber}`,
      paymentTerms,
      String(retainageInitialPercent),
      String(retainageAfterHalfPercent),
      project.architect?.trim() || "",
      project.projectType!.trim(),
      contractValue,
      contractValue,
      project.startDate!,
      project.substantialDate!,
      project.finalDate!,
      timeZone,
      projectManager,
      project.superintendent!.trim(),
      Math.min(16, Math.max(0, Number(project.cameraCount) || 0)),
      now,
    );

    const budgetStatements = summary.budgetRollups.map((rollup) => {
      const budgetData = {
        code: rollup.code,
        division: rollup.division,
        description: rollup.description,
        originalBudget: roundMoney(rollup.amount),
        approvedChanges: 0,
        committedCost: 0,
        actualCost: 0,
        forecastCost: roundMoney(rollup.amount),
        source: "Company Master",
        selectedForProject: true,
        estimateOpportunityId: opportunityId,
        estimateTemplateVersion: estimate.templateVersion,
      };
      return database.prepare(
        `INSERT INTO command_records (
          project_id, id, record_type, title, owner, due, status, meta,
          record_date, record_time, date_locked, data_json, updated_at
        ) VALUES (?, ?, 'Budget', ?, ?, ?, 'Active', ?, ?, NULL, 1, ?, ?)`,
      ).bind(
        projectNumber,
        rollup.code,
        rollup.description,
        projectManager,
        currentDate,
        `${rollup.division} · Approved Estimate`,
        project.ownerContractDate!,
        JSON.stringify(budgetData),
        now,
      );
    });

    const controlData = {
      locked: true,
      lockedBy: actor.name,
      lockedAt: `${currentDate} · Awarded Estimate`,
      source: "Approved Estimate",
      estimateOpportunityId: opportunityId,
      estimateTemplateVersion: estimate.templateVersion,
      originalBudget: roundMoney(summary.originalBudget),
      contractValue: roundMoney(summary.contractValue),
      grossProfit: roundMoney(summary.grossProfit),
      grossMargin: summary.grossMargin,
    };
    const controlStatement = database.prepare(
      `INSERT INTO command_records (
        project_id, id, record_type, title, owner, due, status, meta,
        record_date, record_time, date_locked, data_json, updated_at
      ) VALUES (?, ?, 'Budget Control', ?, ?, ?, 'Locked', ?, ?, NULL, 1, ?, ?)`,
    ).bind(
      projectNumber,
      BUDGET_CONTROL_ID,
      `${projectName} Original Budget`,
      actor.name,
      currentDate,
      `Locked From Approved Estimate By ${actor.name}`,
      project.ownerContractDate!,
      JSON.stringify(controlData),
      now,
    );

    const awardedEstimate = {
      ...estimate,
      status: "Awarded" as const,
      awardedProjectNumber: projectNumber,
    };
    const awardedOpportunityData = {
      ...opportunityData,
      stage: "Awarded",
      estimateStatus: "Awarded",
      estimatedValue: contractValue,
      awardedAt: now,
      awardDate: now.slice(0, 10),
      salesperson: String(opportunityData.assignedRep || opportunity.owner),
      company: String(opportunityData.company || project.ownerName || ""),
      contactId: linkedOwnerContact?.recordId || String(opportunityData.contactId || ""),
      contactName: linkedOwnerContact?.contact.name || String(opportunityData.contactName || ""),
      salesMetrics,
      awardedProjectNumber: projectNumber,
      projectOwnerContractRecordId: `OWNER-CONTRACT-${projectNumber}`,
      preAwardOwnerContractStatus: preAwardContract
        ? carriedContract.carried ? "Carried To Project" : "Superseded At Award"
        : opportunityData.preAwardOwnerContractStatus,
      preAwardOwnerContractCarried: carriedContract.carried,
      preAwardOwnerContractCarryReason: carriedContract.reason,
      estimate: awardedEstimate,
    };
    const opportunityStatement = database.prepare(
      `UPDATE command_records
       SET status = 'Awarded', meta = ?, data_json = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND record_type = ?`,
    ).bind(
      `${project.ownerName!.trim()} · ${project.site!.trim()} · ${contractValue}`,
      JSON.stringify(awardedOpportunityData),
      now,
      SALES_PROJECT_ID,
      opportunityId,
      OPPORTUNITY_RECORD_TYPE,
    );
    const auditStatement = database.prepare(
      `INSERT INTO record_audits (
        project_id, record_id, field_name, old_value, new_value, reason,
        actor_name, actor_email, summary
      ) VALUES (?, ?, 'Estimate Award', 'Approved Estimate', ?, ?, ?, ?, ?)`,
    ).bind(
      SALES_PROJECT_ID,
      opportunityId,
      projectNumber,
      "Owner Or Administrator Approved Estimate-To-Budget Conversion",
      actor.name,
      actor.email,
      `${actor.name} Awarded ${projectName} As Project ${projectNumber}. Original Budget ${summary.originalBudget.toFixed(2)} And Contract Value ${contractValue}.`,
    );
    const projectEstimateRecord = database.prepare(
      `INSERT INTO command_records (
        project_id, id, record_type, title, owner, due, status, meta,
        record_date, record_time, date_locked, data_json, updated_at
      ) VALUES (?, ?, 'Awarded Estimates', ?, ?, ?, 'Awarded', ?, ?, NULL, 1, ?, ?)`,
    ).bind(
      projectNumber,
      `ESTIMATE-${opportunityId}`,
      `${projectName} Awarded Estimate`,
      actor.name,
      currentDate,
      `Owner Contract ${contractValue} · Original Budget ${summary.originalBudget.toFixed(2)}`,
      project.ownerContractDate!,
      JSON.stringify({
        opportunityId,
        templateVersion: estimate.templateVersion,
        approvedBy: estimate.approvedBy,
        approvedAt: estimate.approvedAt,
        contractValue: roundMoney(summary.contractValue),
        originalBudget: roundMoney(summary.originalBudget),
        grossProfit: roundMoney(summary.grossProfit),
        grossMargin: summary.grossMargin,
        awardedAt: now,
        awardDate: now.slice(0, 10),
        salesperson: String(opportunityData.assignedRep || opportunity.owner),
        company: String(opportunityData.company || project.ownerName || ""),
        salesMetrics,
        estimate: awardedEstimate,
      }),
      now,
    );
    const ownerBillingSetupStatement = database.prepare(
      `INSERT INTO command_records (
        project_id, id, record_type, title, owner, due, status, meta,
        record_date, record_time, date_locked, data_json, updated_at
      ) VALUES (?, 'OWNER-BILLING-SETUP', 'Owner Billing Setup', ?, 'Company Owner', ?, 'Owner Action Required', ?, ?, NULL, 0, ?, ?)`,
    ).bind(
      projectNumber,
      `${projectName} First Owner Invoice Structure`,
      currentDate,
      "Owner Must Review And Lock The SOV Before First Billing",
      project.ownerContractDate!,
      JSON.stringify({
        projectNumber,
        contractType,
        pricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(contractFields.SMALL_PROJECT_PRICING_METHOD) : "",
        contractRecordId: `OWNER-CONTRACT-${projectNumber}`,
        paymentTerms,
        retainageInitialPercent,
        retainageAfterHalfPercent,
        ownerOnly: true,
        locked: false,
        createdFromAward: true,
        standardRules: {
          projectManagement: "Combined Project Manager And Superintendent",
          generalConditions: "Division 01 Except Project Management Plus Technology Insurance And Other Contract Fees",
          overheadAndProfit: "Explicit Base Profit Only",
        },
        billingCycle: {
          billingMonthEnds: "Month-End",
          subcontractInvoicesDueDay: 5,
          automatedDraftDay: 6,
          ownerSubmissionDay: 15,
        },
        ownerContactRecordId: linkedOwnerContact?.recordId || "",
        ownerContactName: contractFields.OWNER_SIGNATORY || contractFields.OWNER_NOTICE_CONTACT || contractFields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
        ownerContactTitle: contractFields.OWNER_SIGNATORY_TITLE || "",
        ownerContactEmail: contractFields.OWNER_NOTICE_EMAIL || contractFields.OWNER_EMAIL || "",
        ownerContactPhone: contractFields.OWNER_NOTICE_PHONE || contractFields.OWNER_PHONE || "",
        ownerMailingAddress: contractFields.OWNER_DELIVERY_ADDRESS || [contractFields.OWNER_NOTICE_ADDRESS_LINE_1, contractFields.OWNER_NOTICE_ADDRESS_LINE_2].filter(Boolean).join("\n"),
        invoiceDeliveryMethodRecipient: contractFields.INVOICE_DELIVERY_METHOD_RECIPIENT || "",
        primarySiteContact: contractFields.PRIMARY_SITE_CONTACT || contractFields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
      }),
      now,
    );
    const contractTemplateRecord = contractTemplate(contractType);
    const ownerContractDraftStatement = database.prepare(
      `INSERT INTO command_records (
        project_id, id, record_type, title, owner, due, status, meta,
        record_date, record_time, date_locked, data_json, updated_at
      ) VALUES (?, ?, 'Contracts', ?, ?, ?, 'Draft', ?, ?, NULL, 0, ?, ?)`,
    ).bind(
      projectNumber,
      `OWNER-CONTRACT-${projectNumber}`,
      contractType === "External Contract" ? `${projectName} · External Contract Control` : `${projectName} · ${contractTemplateRecord.label}`,
      actor.name,
      currentDate,
      `${contractTemplateRecord.id} · ${openContractFields.length} Required Fields Open`,
      project.ownerContractDate!,
      JSON.stringify({
        contractType,
        pricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(contractFields.SMALL_PROJECT_PRICING_METHOD) : "",
        templateId: contractTemplateRecord.id,
        templateVersion: contractTemplateRecord.version,
        templateHtmlPath: contractTemplateRecord.htmlPath,
        templateDocxPath: contractTemplateRecord.docxPath,
        agreementSource: contractTemplateRecord.source,
        activeInstrument,
        phaseExecutions: {},
        fields: contractFields,
        fieldSources: contractFieldSources,
        manualFieldKeys,
        sourceSummary: contractPrefill.summary,
        sourceRefresh: {
          estimateRecordId: `ESTIMATE-${opportunityId}`,
          proposalRecordId: sourceProposal?.id || "",
          contactRecordId: linkedOwnerContact?.recordId || "",
          refreshedAt: now,
          refreshedBy: actor.name,
        },
        missingRequiredFields: openContractFields,
        retainageInitialPercent,
        retainageAfterHalfPercent,
        paymentTerms,
        signatures: {},
        sourceOfTruth: "Owner Contract Record",
        createdFromAward: true,
        createdFromPreAwardDraft: carriedContract.carried,
        sourcePreAwardContractRecordId: carriedContract.carried ? preAwardContract?.id || "" : "",
        sourcePreAwardRevisionNumber: carriedContract.carried ? preAwardContractData?.revisionNumber || 0 : 0,
        preAwardCarryReason: carriedContract.reason,
        sourceProposalRecordIds: salesOwnerProposals.map((proposal) => proposal.id),
        savedAt: now,
        savedBy: actor.name,
      }),
      now,
    );
    const initialOwnerRevisionHash = await hashOwnerSecret(JSON.stringify({ contractType, activeInstrument, fields: contractFields, paymentTerms, retainageInitialPercent, retainageAfterHalfPercent }));
    const dormantOwnerAccessStatement = database.prepare(
      `INSERT INTO owner_portal_access (project_id, contract_record_id, status, created_at, updated_at)
       VALUES (?, ?, 'Dormant', ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET contract_record_id = excluded.contract_record_id, status = 'Dormant', contact_name = '', contact_email = '', approved_revision_id = '', approved_by = '', approved_at = NULL, invited_at = NULL, revoked_at = NULL, updated_at = excluded.updated_at`,
    ).bind(projectNumber, `OWNER-CONTRACT-${projectNumber}`, now, now);
    const initialOwnerRevisionStatement = database.prepare(
      `INSERT INTO owner_contract_revisions (id, project_id, contract_record_id, revision_number, phase, contract_type, fields_json, snapshot_hash, note, created_by_type, created_by_name, created_by_email, created_at)
       VALUES (?, ?, ?, 1, 'Draft Preparation', ?, ?, ?, ?, 'Mefford', ?, ?, ?)`,
    ).bind(
      `OWNER-CONTRACT-${projectNumber}-R1`,
      projectNumber,
      `OWNER-CONTRACT-${projectNumber}`,
      contractType,
      JSON.stringify(contractFields),
      initialOwnerRevisionHash,
      carriedContract.carried
        ? `Pre-award owner contract revision ${preAwardContractData?.revisionNumber || 1} carried into the awarded project. No Project Owner access or invitation was activated.`
        : `Award-created controlled draft. ${carriedContract.reason}. No Project Owner access or invitation was activated.`,
      actor.name,
      actor.email,
      now,
    );
    const preAwardCarryStatements = preAwardContract ? [
      database.prepare(
        `UPDATE command_records SET status = ?, date_locked = 1, meta = ?, data_json = ?, updated_at = ?
         WHERE project_id = ? AND id = ? AND record_type = ?`,
      ).bind(
        carriedContract.carried ? "Carried To Project" : "Superseded At Award",
        `${contractTemplateRecord.id} · R${preAwardContractData?.revisionNumber || 1} · ${carriedContract.carried ? `Carried To ${projectNumber}` : `Superseded By ${projectNumber}`}`,
        JSON.stringify({
          ...(preAwardContractRaw || {}),
          status: carriedContract.carried ? "Carried To Project" : "Superseded At Award",
          dateLocked: true,
          targetProjectNumber: projectNumber,
          targetContractRecordId: `OWNER-CONTRACT-${projectNumber}`,
          carriedToProject: carriedContract.carried,
          carryReason: carriedContract.reason,
          carriedAt: now,
          carriedBy: actor.name,
        }),
        now,
        SALES_PROJECT_ID,
        preAwardContract.id,
        PREAWARD_OWNER_CONTRACT_RECORD_TYPE,
      ),
      database.prepare(
        `INSERT INTO record_audits (
          project_id, record_id, field_name, old_value, new_value, reason,
          actor_name, actor_email, summary
        ) VALUES (?, ?, 'Pre-Award Contract Handoff', ?, ?, ?, ?, ?, ?)`,
      ).bind(
        SALES_PROJECT_ID,
        preAwardContract.id,
        preAwardContract.status,
        carriedContract.carried ? "Carried To Project" : "Superseded At Award",
        "Formal Project Award Reconciled The Internal Pre-Award Draft",
        actor.name,
        actor.email,
        carriedContract.carried
          ? `${preAwardContract.id} revision ${preAwardContractData?.revisionNumber || 1} became OWNER-CONTRACT-${projectNumber} without duplicate entry.`
          : `${preAwardContract.id} was preserved but not carried because ${carriedContract.reason.toLowerCase()}.`,
      ),
    ] : [];
    const accountingContractSetupStatement = database.prepare(
      `INSERT INTO command_records (
        project_id, id, record_type, title, owner, due, status, meta,
        record_date, record_time, date_locked, data_json, updated_at
      ) VALUES ('MEFFORD-ACCOUNTING', ?, 'Owner Contract Setup', ?, ?, ?, 'Draft', ?, ?, NULL, 0, ?, ?)
      ON CONFLICT(project_id, id) DO UPDATE SET title = excluded.title, owner = excluded.owner,
        due = excluded.due, status = excluded.status, meta = excluded.meta,
        record_date = excluded.record_date, data_json = excluded.data_json, updated_at = excluded.updated_at`,
    ).bind(
      `OWNER-CONTRACT-${projectNumber}`,
      `${projectNumber} · ${projectName} Owner Contract`,
      actor.name,
      currentDate,
      `${contractType} · ${contractValue}`,
      project.ownerContractDate!,
      JSON.stringify({
        projectNumber,
        projectName,
        ownerName: project.ownerName!.trim(),
        contractRecordId: `OWNER-CONTRACT-${projectNumber}`,
        contractType,
        pricingMethod: contractType === "Time & Materials" ? normalizeSmallProjectPricingMethod(contractFields.SMALL_PROJECT_PRICING_METHOD) : "",
        contractAmount: contractValue,
        paymentTerms,
        retainageInitialPercent,
        retainageAfterHalfPercent,
        ownerContactRecordId: linkedOwnerContact?.recordId || "",
        ownerContactName: contractFields.OWNER_SIGNATORY || contractFields.OWNER_NOTICE_CONTACT || contractFields.OWNER_AUTHORIZED_REPRESENTATIVE || "",
        ownerContactEmail: contractFields.OWNER_NOTICE_EMAIL || contractFields.OWNER_EMAIL || "",
        ownerContactPhone: contractFields.OWNER_NOTICE_PHONE || contractFields.OWNER_PHONE || "",
        invoiceDeliveryMethodRecipient: contractFields.INVOICE_DELIVERY_METHOD_RECIPIENT || "",
        contractStatus: "Draft",
        effectiveDate: project.ownerContractDate!,
        sourceOfTruth: "Owner Contract Record",
        synchronizedAt: now,
      }),
      now,
    );
    const designHandoffStatements = salesDesignPackages.flatMap((designPackage) => {
      const packageData = parseJson(designPackage.data_json);
      const versions = Array.isArray(packageData.versions) ? packageData.versions as Array<Record<string, unknown>> : [];
      const pricingBasisVersionId = String(packageData.pricingBasisVersionId || versions.at(-1)?.id || "");
      const lockedVersions = versions.map((version) => ({
        ...version,
        isBasisOfSale: String(version.id || "") === pricingBasisVersionId,
        basisLockedAt: now,
      }));
      const immutableSnapshot = {
        capturedAt: now,
        capturedBy: actor.name,
        opportunityId,
        packageId: designPackage.id,
        title: designPackage.title,
        status: designPackage.status,
        discipline: String(packageData.discipline || "Design"),
        phase: String(packageData.phase || "Sales Design"),
        description: String(packageData.description || ""),
        pricingBasisVersionId,
        versions: lockedVersions,
      };
      const lockedSalesData = {
        ...packageData,
        versions: lockedVersions,
        pricingBasisVersionId,
        basisOfSaleLocked: true,
        basisOfSaleLockedBy: actor.name,
        basisOfSaleLockedAt: now,
        awardedProjectNumber: projectNumber,
        immutableSnapshot,
        timeline: [
          ...(Array.isArray(packageData.timeline) ? packageData.timeline : []),
          { action: "Basis Of Sale Locked", actor: actor.name, at: now, detail: `Awarded as project ${projectNumber}; working copy created without changing this snapshot.` },
        ],
      };
      const projectWorkingData = {
        ...packageData,
        lifecycleScope: "Project",
        projectId: projectNumber,
        sourceOpportunityId: opportunityId,
        sourceSalesPackageId: designPackage.id,
        basisOfSaleLocked: false,
        basisOfSaleSnapshot: immutableSnapshot,
        versions: lockedVersions.map((version) => ({ ...version, isCurrent: false })),
        workingCopyCreatedAt: now,
        workingCopyCreatedBy: actor.name,
        phase: "Design Development",
        timeline: [
          ...(Array.isArray(packageData.timeline) ? packageData.timeline : []),
          { action: "Project Working Copy Created", actor: actor.name, at: now, detail: `Copied from immutable sales package ${designPackage.id} at award.` },
        ],
      };
      const consultantVendorId = String(packageData.consultantVendorId || "");
      return [
        database.prepare(
          `UPDATE command_records
           SET status = 'Basis Of Sale Locked', date_locked = 1, meta = ?, data_json = ?, updated_at = ?
           WHERE project_id = ? AND id = ? AND record_type = 'Design Packages'`,
        ).bind(
          `${String(packageData.discipline || "Design")} · Immutable Basis Of Sale · Project ${projectNumber}`,
          JSON.stringify(lockedSalesData),
          now,
          SALES_PROJECT_ID,
          designPackage.id,
        ),
        database.prepare(
          `INSERT INTO command_records (
            project_id, id, record_type, title, owner, due, status, meta,
            record_date, record_time, date_locked, data_json, updated_at
          ) VALUES (?, ?, 'Design Packages', ?, ?, ?, 'Working Design', ?, ?, ?, 0, ?, ?)`,
        ).bind(
          projectNumber,
          designPackage.id,
          designPackage.title,
          projectManager,
          designPackage.due,
          `${String(packageData.discipline || "Design")} · Working Copy From Locked Basis Of Sale`,
          designPackage.record_date || now.slice(0, 10),
          designPackage.record_time,
          JSON.stringify(projectWorkingData),
          now,
        ),
        database.prepare(
          `INSERT INTO record_audits (
            project_id, record_id, field_name, old_value, new_value, reason,
            actor_name, actor_email, summary
          ) VALUES (?, ?, 'Basis Of Sale', ?, 'Basis Of Sale Locked', ?, ?, ?, ?)`,
        ).bind(
          SALES_PROJECT_ID,
          designPackage.id,
          designPackage.status,
          "Project Award Requires An Immutable Sales Design Snapshot",
          actor.name,
          actor.email,
          `${designPackage.id} locked at award and copied to project ${projectNumber}.`,
        ),
        database.prepare(
          `INSERT INTO record_audits (
            project_id, record_id, field_name, old_value, new_value, reason,
            actor_name, actor_email, summary
          ) VALUES (?, ?, 'Design Handoff', 'Sales Design', 'Project Working Copy', ?, ?, ?, ?)`,
        ).bind(
          projectNumber,
          designPackage.id,
          "Award Copied Design Forward Without Overwriting The Basis Of Sale",
          actor.name,
          actor.email,
          `${designPackage.id} project working copy linked to immutable sales source.`,
        ),
        ...(consultantVendorId ? [database.prepare(
          `INSERT INTO vendor_project_access (
            id, vendor_id, project_id, project_name, status, trade,
            contract_reference, cost_code, committed_amount, permissions_json,
            shared_records_json, granted_by, updated_at
          ) VALUES (?, ?, ?, ?, 'Active', ?, '', 'Unassigned', '0', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            project_name = excluded.project_name,
            trade = excluded.trade,
            permissions_json = excluded.permissions_json,
            shared_records_json = excluded.shared_records_json,
            updated_at = excluded.updated_at`,
        ).bind(
          `${consultantVendorId}:${projectNumber}`,
          consultantVendorId,
          projectNumber,
          projectName,
          String(packageData.discipline || "Architecture"),
          JSON.stringify(["Design Review", "Design Upload"]),
          JSON.stringify(["Design Packages"]),
          actor.email,
          now,
        )] : []),
      ];
    });
    const designTeamHandoffStatements = salesDesignTeam ? (() => {
      const teamData = parseJson(salesDesignTeam.data_json);
      const assignments = Array.isArray(teamData.assignments) ? teamData.assignments as Array<Record<string, unknown>> : [];
      const immutableTeamSnapshot = {
        capturedAt: now,
        capturedBy: actor.name,
        opportunityId,
        assignments,
        checklist: Array.isArray(teamData.checklist) ? teamData.checklist : [],
      };
      const lockedTeamData = {
        ...teamData,
        basisOfSaleLocked: true,
        basisOfSaleLockedBy: actor.name,
        basisOfSaleLockedAt: now,
        awardedProjectNumber: projectNumber,
        immutableTeamSnapshot,
        timeline: [
          ...(Array.isArray(teamData.timeline) ? teamData.timeline : []),
          { action: "Design Team Snapshot Locked", actor: actor.name, at: now, detail: `Awarded as project ${projectNumber}; project team working copy created.` },
        ],
      };
      const projectAssignments: Array<Record<string, unknown>> = assignments.map((assignment) => ({
        ...assignment,
        linkedSubcontractId: "",
        portalStatus: "Enabled",
        projectCopiedAt: now,
      }));
      const projectTeamData = {
        ...teamData,
        lifecycleScope: "Project",
        projectId: projectNumber,
        sourceOpportunityId: opportunityId,
        sourceSalesDesignTeamId: salesDesignTeam.id,
        basisOfSaleLocked: false,
        basisOfSaleSnapshot: immutableTeamSnapshot,
        assignments: projectAssignments,
        timeline: [
          ...(Array.isArray(teamData.timeline) ? teamData.timeline : []),
          { action: "Project Design Team Working Copy Created", actor: actor.name, at: now, detail: `Copied from immutable sales design team ${salesDesignTeam.id}.` },
        ],
      };
      return [
        database.prepare(
          `UPDATE command_records
           SET status = 'Basis Of Sale Locked', date_locked = 1, meta = ?, data_json = ?, updated_at = ?
           WHERE project_id = ? AND id = ? AND record_type = 'Design Team'`,
        ).bind(
          `${assignments.length} Designer${assignments.length === 1 ? "" : "s"} · Immutable Award Team`,
          JSON.stringify(lockedTeamData),
          now,
          SALES_PROJECT_ID,
          salesDesignTeam.id,
        ),
        database.prepare(
          `INSERT INTO command_records (
            project_id, id, record_type, title, owner, due, status, meta,
            record_date, record_time, date_locked, data_json, updated_at
          ) VALUES (?, 'DESIGN-TEAM', 'Design Team', ?, ?, ?, 'Active Design Team', ?, ?, ?, 0, ?, ?)`,
        ).bind(
          projectNumber,
          `${projectName} Design Team`,
          projectManager,
          salesDesignTeam.due,
          `${assignments.length} Designer${assignments.length === 1 ? "" : "s"} · Working Copy From Award`,
          salesDesignTeam.record_date || now.slice(0, 10),
          salesDesignTeam.record_time,
          JSON.stringify(projectTeamData),
          now,
        ),
        database.prepare(
          `INSERT INTO record_audits (
            project_id, record_id, field_name, old_value, new_value, reason,
            actor_name, actor_email, summary
          ) VALUES (?, ?, 'Design Team Handoff', 'Sales Team', 'Project Working Team', ?, ?, ?, ?)`,
        ).bind(
          projectNumber,
          "DESIGN-TEAM",
          "Award Locked The Sales Team And Copied Assignments And Checklist Forward",
          actor.name,
          actor.email,
          `${assignments.length} design team assignment${assignments.length === 1 ? "" : "s"} copied to project ${projectNumber}.`,
        ),
        ...projectAssignments.map((assignment) => {
          const vendorId = String(assignment.vendorId || "");
          const discipline = String(assignment.discipline || "Design");
          const contractReference = String(assignment.contractReference || "");
          return database.prepare(
            `INSERT INTO vendor_project_access (
              id, vendor_id, project_id, project_name, status, trade,
              contract_reference, cost_code, committed_amount, permissions_json,
              shared_records_json, granted_by, updated_at
            ) VALUES (?, ?, ?, ?, 'Active', ?, ?, 'Unassigned', '0', ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              project_name = excluded.project_name,
              trade = excluded.trade,
              contract_reference = excluded.contract_reference,
              permissions_json = excluded.permissions_json,
              shared_records_json = excluded.shared_records_json,
              updated_at = excluded.updated_at`,
          ).bind(
            `${vendorId}:${projectNumber}`,
            vendorId,
            projectNumber,
            projectName,
            discipline,
            contractReference,
            JSON.stringify(["Design Review", "Design Upload"]),
            JSON.stringify(["Design Packages"]),
            actor.email,
            now,
          );
        }),
      ];
    })() : [];
    const procurementHandoffStatements = salesBidPackages.flatMap((bidPackage) => {
      const packageData = normalizeBidPackageData(parseJson(bidPackage.data_json));
      const selected = selectedProposalBid(packageData);
      const commitmentType = packageData.commitmentType || packageData.commitmentRecommendation;
      const commitmentRecordType = commitmentType === "Purchase Order" ? "Purchase Orders" : "Subcontracts";
      const commitmentId = selected
        ? `${bidPackage.id}-${commitmentType === "Purchase Order" ? "PO" : "SC"}-DRAFT`
        : "";
      const immutableSnapshot = {
        capturedAt: now,
        capturedBy: actor.name,
        opportunityId,
        packageId: bidPackage.id,
        title: bidPackage.title,
        status: bidPackage.status,
        bidders: packageData.bidders,
        addenda: packageData.addenda,
        publicAnswers: packageData.publicAnswers,
        coverageException: packageData.coverageException,
        recommendation: packageData.recommendation,
        ownerApproval: packageData.ownerApproval,
        timeline: packageData.timeline,
        retention: "Permanent; Versions Supersede But Never Delete",
      };
      const lockedSalesData = {
        ...packageData,
        awardedProjectNumber: projectNumber,
        immutableSalesSnapshot: immutableSnapshot,
        awardHandoff: { projectNumber, copiedAt: now, copiedBy: actor.name, commitmentId },
        timeline: [...packageData.timeline, { action: "Sales Procurement Snapshot Locked", actor: actor.name, at: now, detail: `Complete invitation, bid, quote, addenda, Q&A, acknowledgment, leveling, and decision history copied to project ${projectNumber}.` }],
      };
      const projectData = {
        ...packageData,
        commitmentType: selected ? commitmentType : packageData.commitmentType,
        lifecycleScope: "Project",
        projectId: projectNumber,
        sourceOpportunityId: opportunityId,
        sourceSalesBidPackageId: bidPackage.id,
        folderProjectId: projectNumber,
        immutableSalesSnapshot: immutableSnapshot,
        linkedCommitmentId: commitmentId,
        awardHandoff: { sourceOpportunityId: opportunityId, copiedAt: now, copiedBy: actor.name },
        timeline: [
          ...packageData.timeline,
          {
            action: "Project Procurement Record Created",
            actor: actor.name,
            at: now,
            detail: `Copied from immutable Sales package ${bidPackage.id}; transferred files remain in the existing awarded-estimate file structure.`,
          },
          ...(selected
            ? [{
                action: `Draft ${commitmentType} Prepared From Owner Project Award`,
                actor: actor.name,
                at: now,
                detail: `${commitmentId} was prefilled from the exact estimate and proposal basis. PM award review is required; nothing was sent, released, or executed.`,
              }]
            : []),
        ],
      };
      const projectStatus = selected
        ? packageData.ownerApproval?.decision === "Approved"
          ? "Awarded"
          : packageData.recommendation
            ? "Owner Approval"
            : "PM Award Decision"
        : bidPackage.status === "Open For Bids"
          ? "Open For Bids"
          : bidPackage.status;
      const statements = [
        database.prepare(
          `UPDATE command_records SET status = 'Award Snapshot Locked', date_locked = 1, meta = ?, data_json = ?, updated_at = ?
           WHERE project_id = ? AND id = ? AND record_type = 'Bid Packages'`,
        ).bind(`Immutable Procurement Snapshot · Project ${projectNumber}`, JSON.stringify(lockedSalesData), now, SALES_PROJECT_ID, bidPackage.id),
        database.prepare(
          `INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, record_time, date_locked, data_json, updated_at)
           VALUES (?, ?, 'Bid Packages', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).bind(projectNumber, bidPackage.id, bidPackage.title, projectManager, bidPackage.due, projectStatus, `${packageData.trade} · Permanent Award Handoff`, bidPackage.record_date || now.slice(0, 10), bidPackage.record_time, JSON.stringify(projectData), now),
        database.prepare(
          `INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
           VALUES (?, ?, 'Procurement Handoff', 'Sales / Estimating', 'Awarded Project', ?, ?, ?, ?)`,
        ).bind(projectNumber, bidPackage.id, "Award copied the complete permanent procurement record and existing file structure forward", actor.name, actor.email, `${bidPackage.id} procurement history copied from ${opportunityId}.`),
        ...packageData.bidders.map((bidder) => database.prepare(
          `INSERT INTO vendor_project_access (id, vendor_id, project_id, project_name, status, trade, contract_reference, cost_code, committed_amount, permissions_json, shared_records_json, granted_by, updated_at)
           VALUES (?, ?, ?, ?, 'Bidding', ?, '', ?, '0', ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_name = excluded.project_name, trade = excluded.trade, cost_code = excluded.cost_code, permissions_json = excluded.permissions_json, shared_records_json = excluded.shared_records_json, updated_at = excluded.updated_at`,
        ).bind(`${bidder.vendorId}:${projectNumber}`, bidder.vendorId, projectNumber, projectName, packageData.trade, packageData.costCode, JSON.stringify(["Bid Submission"]), JSON.stringify(["Bid Packages"]), actor.email, now)),
      ];
      if (commitmentId && selected) {
        const { bidder, bid, basis } = selected;
        const selectedPrice = Number(basis.selectedPrice || bid.ocr?.reviewedPrice || bid.total);
        const commitmentCostCode = basis.estimateLineKey || packageData.costCode;
        const rankedPrices = packageData.bidders
          .flatMap((item) => item.revisions.at(-1) ? [Number(item.revisions.at(-1)?.ocr?.reviewedPrice || item.revisions.at(-1)?.total || 0)] : [])
          .filter((amount) => amount > 0)
          .sort((left, right) => left - right);
        const scope = [packageData.scopeDescription, basis.sourceScope]
          .map((item) => item.trim())
          .filter((item, index, items) => item && items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
          .join("\n\n");
        const commonData = {
          vendor: bidder.vendorName,
          vendorId: bidder.vendorId,
          contactName: bidder.contactName,
          contactEmail: bidder.contactEmail,
          amount: selectedPrice,
          costCode: commitmentCostCode,
          sourceBidCostCode: packageData.costCode,
          trade: packageData.trade,
          scope,
          ownerScopeDraft: basis.ownerScopeDraft,
          quoteScope: basis.sourceScope,
          exclusions: bid.exclusions,
          alternates: bid.alternates,
          allowances: bid.allowances,
          qualifications: bid.qualifications,
          clarifications: bid.clarifications,
          schedule: bid.schedule,
          estimatedStart: packageData.estimatedStart,
          bidInstructions: packageData.bidInstructions,
          sourceBidPackageId: bidPackage.id,
          sourceBidRevisionId: bid.id,
          sourceQuoteFileId: bid.fileId,
          sourceQuoteFileName: bid.fileName,
          procurementArchiveProjectId: projectNumber,
          proposalBasis: basis,
          selectedBidRankAtOwnerAward: rankedPrices.findIndex((amount) => amount === selectedPrice) + 1 || null,
          lowestReviewedBidAtOwnerAward: rankedPrices[0] || selectedPrice,
          recommendation: packageData.recommendation,
          ownerApproval: packageData.ownerApproval,
          preparedFromOwnerProjectAward: true,
          preparedAt: now,
          preparedBy: actor.name,
          awardDecision: "PM Decision Required",
          automaticDistribution: false,
          releasedAt: "",
          executedAt: "",
          timeline: [{
            action: `Draft ${commitmentType} Prepared`,
            actor: actor.name,
            at: now,
            detail: `Owner awarded project ${projectNumber}. Exact selected quote ${bid.id} was used; no subcontractor award, release, distribution, or execution occurred.`,
          }],
        };
        const commitmentData = commitmentType === "Purchase Order"
          ? {
              ...commonData,
              contactPhone: "",
              vendorAddress: "",
              deliveryLocation: project.site,
              requiredBy: packageData.estimatedStart || project.startDate,
              paymentTerms: "Net 30",
              freightTerms: "FOB Destination",
              taxIncluded: "Included",
              warranty: "Manufacturer standard warranty",
              specialInstructions: [bid.schedule, bid.clarifications].filter(Boolean).join(" · "),
              sourceSelectionId: "",
              approvalRequired: false,
              approvalReasons: [],
              budgetAvailableAtSubmit: 0,
              releasedBy: "",
              distributionReference: "",
              acknowledgedAt: "",
              acknowledgedBy: "",
              acknowledgmentReference: "",
              revisionOf: "",
              revisionNumber: 0,
              supersededBy: "",
            }
          : {
              ...commonData,
              subcontractor: bidder.vendorName,
              signerName: bidder.contactName,
              signerTitle: "",
              signerEmail: bidder.contactEmail,
              price: selectedPrice,
              subcontractDate: currentDate,
              retainage: 10,
              substantialDate: project.substantialDate,
              finalDate: project.finalDate,
              costAllocations: [{
                id: "allocation-1",
                costCode: commitmentCostCode,
                amount: selectedPrice,
              }],
              proposalName: bid.fileName,
              meffordCountersigner: "Jordan Mefford",
              workflowStatus: "Draft",
              workflowUpdatedAt: now,
            };
        statements.push(database.prepare(
          `INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, record_time, date_locked, data_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'Draft', ?, ?, NULL, 0, ?, ?)`,
        ).bind(projectNumber, commitmentId, commitmentRecordType, `${bidder.vendorName} · ${bidPackage.title}`, projectManager, packageData.estimatedStart || currentDate, `${bidPackage.id} · ${Number(selectedPrice).toFixed(2)} · Prepared From Owner Award · PM Decision Required`, now.slice(0, 10), JSON.stringify(commitmentData), now));
        statements.push(database.prepare(
          `INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
           VALUES (?, ?, 'Owner Project Award Preparation', 'No Commitment Draft', 'PM Decision Required', ?, ?, ?, ?)`,
        ).bind(projectNumber, commitmentId, `Exact selected quote ${bid.id} prefilled the draft; no subcontractor award or distribution occurred`, actor.name, actor.email, `${commitmentId} prepared automatically for PM review from ${bidPackage.id}.`));
      }
      return statements;
    });
    const proposalHandoffStatements = salesOwnerProposals.flatMap((proposal) => {
      const proposalData = parseJson(proposal.data_json);
      const lockedSalesData = {
        ...proposalData,
        basisOfSaleLocked: true,
        basisOfSaleLockedAt: now,
        basisOfSaleLockedBy: actor.name,
        awardedProjectNumber: projectNumber,
      };
      const projectProposalData = {
        ...lockedSalesData,
        sourceOpportunityId: opportunityId,
        sourceSalesProposalId: proposal.id,
        copiedToProjectAt: now,
        copiedToProjectBy: actor.name,
        immutableIssuedOwnerCopy: true,
      };
      return [
        database.prepare(
          `UPDATE command_records SET status = 'Award Basis Of Sale Locked', date_locked = 1, meta = ?, data_json = ?, updated_at = ?
           WHERE project_id = ? AND id = ? AND record_type = 'Owner Proposals'`,
        ).bind(`Immutable Issued Owner Copy · Project ${projectNumber}`, JSON.stringify(lockedSalesData), now, SALES_PROJECT_ID, proposal.id),
        database.prepare(
          `INSERT INTO command_records (project_id, id, record_type, title, owner, due, status, meta, record_date, record_time, date_locked, data_json, updated_at)
           VALUES (?, ?, 'Owner Proposals', ?, ?, ?, 'Award Basis Of Sale', ?, ?, ?, 1, ?, ?)`,
        ).bind(projectNumber, proposal.id, proposal.title, actor.name, proposal.due, `Issued R${String(proposalData.revision || 1)} · Linked To Owner Contract`, proposal.record_date || now.slice(0, 10), proposal.record_time, JSON.stringify(projectProposalData), now),
        database.prepare(
          `INSERT INTO record_audits (project_id, record_id, field_name, old_value, new_value, reason, actor_name, actor_email, summary)
           VALUES (?, ?, 'Proposal Handoff', 'Sales / Estimating', 'Project Contract Record', ?, ?, ?, ?)`,
        ).bind(projectNumber, proposal.id, "Award copied the exact issued proposal or engagement letter into the project contract history", actor.name, actor.email, `${proposal.id} and its immutable PDF followed ${opportunityId} into project ${projectNumber}.`),
      ];
    });
    const transferEstimateFiles = database.prepare(
      `UPDATE project_files
       SET project_id = ?,
           category = 'Awarded Estimate / ' || category,
           revision = revision || ' · Transferred From Estimate'
       WHERE project_id = ?`,
    ).bind(projectNumber, `ESTIMATE-${opportunityId}`);
    const transferLegacySalesDesignFiles = database.prepare(
      `UPDATE project_files
       SET project_id = ?,
           category = 'Awarded Estimate / 02-Design & Drawings',
           revision = revision || ' · Transferred From Sales Design'
       WHERE project_id = ?`,
    ).bind(projectNumber, `DESIGN-${opportunityId}`);
    const domainEventId = `estimate-awarded:${opportunityId}:${projectNumber}`;
    const outboxStatements = domainEventStatements(database, {
      id: domainEventId,
      idempotencyKey: `estimate-awarded:${opportunityId}`,
      eventType: "estimate.awarded",
      aggregateType: "Sales Opportunity",
      aggregateId: opportunityId,
      projectId: projectNumber,
      actorName: actor.name,
      actorEmail: actor.email,
      occurredAt: now,
      payload: {
        actorName: actor.name,
        actorEmail: actor.email,
        estimate: {
          entityId: opportunityId,
          displayName: opportunity.title,
          sourceProjectId: SALES_PROJECT_ID,
          sourceRecordId: opportunityId,
        },
        project: {
          entityId: projectNumber,
          displayName: projectName,
          sourceProjectId: projectNumber,
          sourceRecordId: opportunityId,
        },
      },
      consumers: [
        {
          key: "source-project-activation",
          completedInSourceTransaction: true,
          result: {
            projectNumber,
            contractRecordId: `OWNER-CONTRACT-${projectNumber}`,
            budgetLineCount: summary.budgetRollups.length,
          },
        },
        { key: "operations-turnover-meeting" },
        { key: "sharepoint-estimate-workspace" },
        { key: "sharepoint-project-workspace" },
      ],
    });

    await database.batch([
      projectStatement,
      ...budgetStatements,
      controlStatement,
      opportunityStatement,
      auditStatement,
      projectEstimateRecord,
      ownerBillingSetupStatement,
      ownerContractDraftStatement,
      dormantOwnerAccessStatement,
      initialOwnerRevisionStatement,
      ...preAwardCarryStatements,
      accountingContractSetupStatement,
      ...designHandoffStatements,
      ...designTeamHandoffStatements,
      ...procurementHandoffStatements,
      ...proposalHandoffStatements,
      transferEstimateFiles,
      transferLegacySalesDesignFiles,
      ...outboxStatements,
    ]);

    const savedProject = await loadProject(database, projectNumber);
    const handoff = await reconcileDomainEvent(database, domainEventId);
    const microsoftEstimateWorkspace = handoff?.consumers.find((consumer) => consumer.key === "sharepoint-estimate-workspace")?.result || null;
    const microsoftProjectWorkspace = handoff?.consumers.find((consumer) => consumer.key === "sharepoint-project-workspace")?.result || null;
    return Response.json(
      {
        project: savedProject,
        microsoftEstimateWorkspace,
        microsoftProjectWorkspace,
        handoff: {
          eventId: domainEventId,
          status: handoff?.status || "Partially Applied",
          consumers: handoff?.consumers || [],
          completionRule: "Every mandatory consumer must reconcile before the award handoff is Complete.",
        },
        reconciliation: {
          templateVersion: estimate.templateVersion,
          budgetLineCount: summary.budgetRollups.length,
          originalBudget: roundMoney(summary.originalBudget),
          contractValue: roundMoney(summary.contractValue),
          grossProfit: roundMoney(summary.grossProfit),
          grossMargin: summary.grossMargin,
          difference: roundMoney(summary.reconciliationDifference),
        },
      },
      { status: handoff?.status === "Completed" ? 201 : 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("Estimate Award Failed", JSON.stringify({ errorReference, message: message || "Unknown Award Error" }));
    if (message.toLowerCase().includes("unique")) {
      return Response.json(
        { error: "The Project Number Was Already Assigned. Try The Award Again.", errorReference, retryable: true },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error:
          new URL(request.url).hostname === "terminal.local" && message
            ? `The Award Could Not Be Completed. ${message}`
            : `The Project Could Not Be Created. Nothing Was Saved. Try Again; If It Repeats, Report Reference ${errorReference}.`,
        errorReference,
        retryable: true,
      },
      { status: 500 },
    );
  }
}

async function canAwardEstimate(
  database: Awaited<ReturnType<typeof commandD1>>,
  email: string,
  accessLevel: "Company Owner" | "Administrator" | "Employee",
) {
  if (["Company Owner", "Administrator"].includes(accessLevel)) return true;
  if (!email) return false;
  const member = await database.prepare(
    "SELECT company_access_level FROM company_members WHERE email = ? AND is_active = 1 LIMIT 1",
  )
    .bind(email)
    .first<{ company_access_level: string }>();
  return ["Company Owner", "Administrator"].includes(
    member?.company_access_level || "",
  );
}

async function nextProjectNumber(
  database: Awaited<ReturnType<typeof commandD1>>,
) {
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "2-digit",
  }).format(new Date());
  const rows = await database.prepare(
    "SELECT number FROM projects WHERE number LIKE ?",
  )
    .bind(`${year}-%`)
    .all<{ number: string }>();
  const largest = (rows.results || []).reduce((current, row) => {
    const match = row.number.match(new RegExp(`^${year}-(\\d{3})$`));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${year}-${String(largest + 1).padStart(3, "0")}`;
}

async function loadProject(
  database: Awaited<ReturnType<typeof commandD1>>,
  projectNumber: string,
) {
  const row = await database.prepare(
    `SELECT number, name, status, site, owner_name, owner_contract_date,
      owner_contract_type, owner_contract_status, owner_contract_record_id,
      payment_terms, retainage_initial_percent, retainage_after_half_percent,
      architect, project_type, contract_amount, current_contract_amount,
      start_date, substantial_date, final_date, time_zone,
      latitude_millionths, longitude_millionths, project_manager,
      superintendent, camera_count, created_at, updated_at
     FROM projects WHERE number = ? LIMIT 1`,
  )
    .bind(projectNumber)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    number: row.number,
    name: row.name,
    status: row.status,
    site: row.site,
    ownerName: row.owner_name,
    ownerContractDate: row.owner_contract_date,
    ownerContractType: row.owner_contract_type,
    ownerContractStatus: row.owner_contract_status,
    ownerContractRecordId: row.owner_contract_record_id,
    paymentTerms: row.payment_terms,
    retainageInitialPercent: row.retainage_initial_percent,
    retainageAfterHalfPercent: row.retainage_after_half_percent,
    architect: row.architect,
    projectType: row.project_type,
    contractAmount: row.contract_amount,
    currentContractAmount: row.current_contract_amount,
    startDate: row.start_date,
    substantialDate: row.substantial_date,
    finalDate: row.final_date,
    timeZone: row.time_zone,
    latitude:
      row.latitude_millionths === null
        ? null
        : Number(row.latitude_millionths) / 1_000_000,
    longitude:
      row.longitude_millionths === null
        ? null
        : Number(row.longitude_millionths) / 1_000_000,
    projectManager: row.project_manager,
    superintendent: row.superintendent,
    cameraCount: Number(row.camera_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function completeProject(project: NonNullable<AwardPayload["project"]>) {
  return Boolean(
    project.name?.trim() &&
      project.site?.trim() &&
      project.ownerName?.trim() &&
      project.ownerContractDate &&
      project.projectType?.trim() &&
      project.startDate &&
      project.substantialDate &&
      project.finalDate &&
      project.projectManager?.trim() &&
      project.superintendent?.trim(),
  );
}

function latestIssuedProposal(rows: DesignPackageRow[]) {
  return [...rows].sort((left, right) => {
    const leftData = parseJson(left.data_json);
    const rightData = parseJson(right.data_json);
    return Number(rightData.revision || 0) - Number(leftData.revision || 0);
  })[0] || null;
}

function parseJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${month}/${day}/${year}` : value;
}

async function commandD1() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Command Center Database Is Unavailable");
  return env.DB;
}

async function ensureOwnerContractProjectColumns(database: Awaited<ReturnType<typeof commandD1>>) {
  const columns = await database.prepare("PRAGMA table_info(projects)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["owner_contract_type", "TEXT NOT NULL DEFAULT 'Plan & Spec Lump Sum'"],
    ["owner_contract_status", "TEXT NOT NULL DEFAULT 'Draft'"],
    ["owner_contract_record_id", "TEXT NOT NULL DEFAULT ''"],
    ["payment_terms", "TEXT NOT NULL DEFAULT ''"],
    ["retainage_initial_percent", "TEXT NOT NULL DEFAULT '10'"],
    ["retainage_after_half_percent", "TEXT NOT NULL DEFAULT '5'"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!names.has(name)) await database.prepare(`ALTER TABLE projects ADD COLUMN ${name} ${definition}`).run();
  }
}
