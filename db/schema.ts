import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const commandRecords = sqliteTable(
  "command_records",
  {
    projectId: text("project_id").notNull(),
    id: text("id").notNull(),
    recordType: text("record_type").notNull(),
    title: text("title").notNull(),
    owner: text("owner").notNull(),
    due: text("due").notNull(),
    status: text("status").notNull(),
    meta: text("meta").notNull().default(""),
    recordDate: text("record_date"),
    recordTime: text("record_time"),
    dateLocked: integer("date_locked", { mode: "boolean" })
      .notNull()
      .default(false),
    dataJson: text("data_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.id] }),
    index("command_records_project_type_idx").on(
      table.projectId,
      table.recordType,
    ),
  ],
);

export const recordAudits = sqliteTable(
  "record_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id").notNull(),
    recordId: text("record_id").notNull(),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value").notNull(),
    newValue: text("new_value").notNull(),
    reason: text("reason").notNull(),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    summary: text("summary").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("record_audits_record_idx").on(table.projectId, table.recordId),
  ],
);

export const commandNotifications = sqliteTable(
  "command_notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email"),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    isRead: integer("is_read", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("command_notifications_recipient_idx").on(
      table.projectId,
      table.recipientName,
      table.isRead,
    ),
  ],
);

export const commandWorkItems = sqliteTable(
  "command_work_items",
  {
    id: text("id").primaryKey(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    projectId: text("project_id").notNull().default("MEFFORD-COMPANY"),
    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    priority: text("priority").notNull().default("Normal"),
    itemKind: text("item_kind").notNull().default("To-Do"),
    status: text("status").notNull().default("Open"),
    sourceType: text("source_type").notNull().default("Notification"),
    sourceRecordId: text("source_record_id").notNull().default(""),
    actionTarget: text("action_target").notNull().default("Dashboard"),
    dueAt: text("due_at"),
    snoozedUntil: text("snoozed_until"),
    readAt: text("read_at"),
    acknowledgedAt: text("acknowledged_at"),
    completedAt: text("completed_at"),
    escalatedAt: text("escalated_at"),
    escalationLevel: integer("escalation_level").notNull().default(0),
    createdBy: text("created_by").notNull().default("Command Center"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("command_work_items_recipient_status_idx").on(
      table.recipientEmail,
      table.status,
    ),
    index("command_work_items_due_idx").on(table.dueAt),
  ],
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    recipientEmail: text("recipient_email").primaryKey(),
    inAppEnabled: integer("in_app_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    emailEnabled: integer("email_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    quietHoursEnabled: integer("quiet_hours_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    quietStart: text("quiet_start").notNull().default("19:00"),
    quietEnd: text("quiet_end").notNull().default("07:00"),
    digestMode: text("digest_mode").notNull().default("Immediate"),
    timeZone: text("time_zone").notNull().default("America/New_York"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const notificationDeliveryEvents = sqliteTable(
  "notification_delivery_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dedupeKey: text("dedupe_key").notNull().unique(),
    workItemId: text("work_item_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    channel: text("channel").notNull().default("Email"),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("Queued"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    nextAttemptAt: text("next_attempt_at"),
    error: text("error").notNull().default(""),
    errorClass: text("error_class").notNull().default(""),
    deferredReason: text("deferred_reason").notNull().default(""),
    provider: text("provider").notNull().default(""),
    providerReceiptId: text("provider_receipt_id").notNull().default(""),
    providerStatus: integer("provider_status").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    sentAt: text("sent_at"),
    acceptedAt: text("accepted_at"),
    deadLetteredAt: text("dead_lettered_at"),
  },
  (table) => [
    index("notification_delivery_status_idx").on(table.status, table.channel),
  ],
);

export const workItemAudits = sqliteTable(
  "work_item_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workItemId: text("work_item_id").notNull(),
    action: text("action").notNull(),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("work_item_audits_item_idx").on(table.workItemId)],
);

export const ownerApprovalSnapshots = sqliteTable(
  "owner_approval_snapshots",
  {
    id: text("id").primaryKey(),
    approvalItemId: text("approval_item_id").notNull(),
    projectId: text("project_id").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    sourceRecordType: text("source_record_type").notNull(),
    sourceUpdatedAt: text("source_updated_at").notNull(),
    decision: text("decision").notNull(),
    decisionNote: text("decision_note").notNull().default(""),
    riskLevel: text("risk_level").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    packetJson: text("packet_json").notNull(),
    packetSha256: text("packet_sha256").notNull(),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    status: text("status").notNull().default("Pending Dispatch"),
    dispatchResult: text("dispatch_result").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("owner_approval_snapshots_source_idx").on(table.projectId, table.sourceRecordId),
    index("owner_approval_snapshots_actor_idx").on(table.actorEmail, table.createdAt),
  ],
);

export const assistantAudits = sqliteTable(
  "assistant_audits",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorRole: text("actor_role").notNull(),
    activeTarget: text("active_target").notNull().default("Dashboard"),
    projectId: text("project_id").notNull().default(""),
    requestText: text("request_text").notNull(),
    responseText: text("response_text").notNull().default(""),
    sourceIdsJson: text("source_ids_json").notNull().default("[]"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    status: text("status").notNull(),
    openaiRequestId: text("openai_request_id").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("assistant_audits_actor_created_idx").on(
      table.actorEmail,
      table.createdAt,
    ),
    index("assistant_audits_conversation_idx").on(table.conversationId),
  ],
);

export const projectFiles = sqliteTable(
  "project_files",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    revision: text("revision").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    access: text("access").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("project_files_project_idx").on(table.projectId)],
);

export const projects = sqliteTable("projects", {
  number: text("number").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  site: text("site").notNull(),
  ownerName: text("owner_name").notNull(),
  ownerContractDate: text("owner_contract_date").notNull(),
  ownerContractType: text("owner_contract_type").notNull().default("Plan & Spec Lump Sum"),
  ownerContractStatus: text("owner_contract_status").notNull().default("Draft"),
  ownerContractRecordId: text("owner_contract_record_id").notNull().default(""),
  paymentTerms: text("payment_terms").notNull().default(""),
  retainageInitialPercent: text("retainage_initial_percent").notNull().default("10"),
  retainageAfterHalfPercent: text("retainage_after_half_percent").notNull().default("5"),
  architect: text("architect").notNull().default(""),
  projectType: text("project_type").notNull(),
  contractAmount: text("contract_amount").notNull().default(""),
  currentContractAmount: text("current_contract_amount").notNull().default(""),
  startDate: text("start_date").notNull(),
  substantialDate: text("substantial_date").notNull(),
  finalDate: text("final_date").notNull(),
  timeZone: text("time_zone").notNull().default("America/New_York"),
  latitude: integer("latitude_millionths"),
  longitude: integer("longitude_millionths"),
  projectManager: text("project_manager").notNull(),
  superintendent: text("superintendent").notNull(),
  cameraCount: integer("camera_count").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dashboardChangeRevisions = sqliteTable("dashboard_change_revisions", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const meetingTurnovers = sqliteTable("meeting_turnovers", {
  id: text("id").primaryKey(),
  meetingType: text("meeting_type").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  projectId: text("project_id").notNull().default(""),
  occurrenceId: text("occurrence_id").notNull().unique(),
  status: text("status").notNull().default("Preparation"),
  revision: integer("revision").notNull().default(0),
  snapshotJson: text("snapshot_json").notNull().default("{}"),
  reviewedJson: text("reviewed_json").notNull().default("[]"),
  acceptedSnapshotJson: text("accepted_snapshot_json").notNull().default("{}"),
  acceptedBy: text("accepted_by").notNull().default(""),
  acceptedAt: text("accepted_at").notNull().default(""),
  ntpReference: text("ntp_reference").notNull().default(""),
  scheduledConfirmed: integer("scheduled_confirmed").notNull().default(0),
  checkedAt: text("checked_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [
  uniqueIndex("meeting_turnover_source_idx").on(table.meetingType,table.opportunityId),
  index("meeting_turnover_queue_idx").on(table.checkedAt,table.id),
]);

export const meetingTurnoverRecovery = sqliteTable("meeting_turnover_recovery", {
  sourceId: text("source_id").primaryKey(),
  lastError: text("last_error").notNull().default(""),
  attemptedAt: text("attempted_at").notNull(),
  retryAfter: text("retry_after").notNull().default(""),
});

export const projectBonusControls = sqliteTable("project_bonus_controls", {
  projectId:text("project_id").primaryKey(), currentId:text("current_id").notNull(), revision:integer("revision").notNull(),
  occurrenceId:text("occurrence_id").notNull(), closeoutAt:text("closeout_at").notNull().default(""),
  paymentStatus:text("payment_status").notNull().default("Awaiting Closeout"), updatedAt:text("updated_at").notNull(),
}, t=>[index("project_bonus_payment_idx").on(t.paymentStatus,t.projectId)]);

export const projectBonusAgreements = sqliteTable("project_bonus_agreements", {
  id:text("id").primaryKey(), projectId:text("project_id").notNull(), revision:integer("revision").notNull(),
  version:integer("version").notNull().default(1), snapshotJson:text("snapshot_json").notNull(), sourceJson:text("source_json").notNull(),
  contentHash:text("content_hash").notNull(), pmSignatureJson:text("pm_signature_json").notNull().default("null"),
  superintendentSignatureJson:text("superintendent_signature_json").notNull().default("null"), fileId:integer("file_id").notNull().default(0),
  createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull(),
}, t=>[uniqueIndex("project_bonus_revision_idx").on(t.projectId,t.revision)]);

export const projectBonusAudits = sqliteTable("project_bonus_audits", {
  id:text("id").primaryKey(), agreementId:text("agreement_id").notNull(), action:text("action").notNull(),
  actorEmail:text("actor_email").notNull(), detailJson:text("detail_json").notNull(), createdAt:text("created_at").notNull(),
}, t=>[index("project_bonus_audit_agreement_idx").on(t.agreementId,t.createdAt)]);

export const companyMembers = sqliteTable("company_members", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  companyAccessLevel: text("company_access_level").notNull(),
  designationsJson: text("designations_json").notNull().default("[]"),
  isActive: integer("is_active", { mode: "boolean" })
    .notNull()
    .default(true),
  identityProvider: text("identity_provider")
    .notNull()
    .default("microsoft_entra_pending"),
  providerSubject: text("provider_subject"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const commandIdentityAliases = sqliteTable(
  "command_identity_aliases",
  {
    aliasEmail: text("alias_email").primaryKey(),
    canonicalEmail: text("canonical_email").notNull(),
    aliasPurpose: text("alias_purpose").notNull().default("Temporary Authentication Bridge"),
    isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
    verifiedBy: text("verified_by").notNull().default(""),
    verifiedAt: text("verified_at"),
    disableAfterMicrosoftCutover: integer("disable_after_microsoft_cutover", { mode: "boolean" }).notNull().default(true),
    disabledAt: text("disabled_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("command_identity_aliases_canonical_idx").on(table.canonicalEmail, table.isVerified)],
);

export const microsoftDirectoryUsers = sqliteTable(
  "microsoft_directory_users",
  {
    providerSubject: text("provider_subject").primaryKey(),
    displayName: text("display_name").notNull(),
    userPrincipalName: text("user_principal_name").notNull(),
    mail: text("mail").notNull().default(""),
    jobTitle: text("job_title").notNull().default(""),
    department: text("department").notNull().default(""),
    userType: text("user_type").notNull().default("Member"),
    accountEnabled: integer("account_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    directoryPresent: integer("directory_present", { mode: "boolean" })
      .notNull()
      .default(true),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    lastSyncRunId: text("last_sync_run_id").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("microsoft_directory_users_upn_idx").on(table.userPrincipalName),
    index("microsoft_directory_users_access_idx").on(
      table.directoryPresent,
      table.accountEnabled,
      table.userType,
    ),
  ],
);

export const microsoftAccessGrants = sqliteTable(
  "microsoft_access_grants",
  {
    providerSubject: text("provider_subject").primaryKey(),
    microsoftEmail: text("microsoft_email").notNull(),
    accessStatus: text("access_status").notNull().default("No Access"),
    companyAccessLevel: text("company_access_level").notNull().default("Employee"),
    designationsJson: text("designations_json").notNull().default("[]"),
    projectScopesJson: text("project_scopes_json").notNull().default("[]"),
    previousAccessStatus: text("previous_access_status").notNull().default("No Access"),
    ownerApprovedByName: text("owner_approved_by_name").notNull().default(""),
    ownerApprovedByEmail: text("owner_approved_by_email").notNull().default(""),
    ownerApprovedAt: text("owner_approved_at"),
    activatedAt: text("activated_at"),
    lastSignInAt: text("last_sign_in_at"),
    suspendedAt: text("suspended_at"),
    revokedAt: text("revoked_at"),
    decisionReason: text("decision_reason").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("microsoft_access_grants_email_idx").on(table.microsoftEmail),
    index("microsoft_access_grants_status_idx").on(table.accessStatus),
  ],
);

export const microsoftAccessAudits = sqliteTable(
  "microsoft_access_audits",
  {
    id: text("id").primaryKey(),
    providerSubject: text("provider_subject").notNull(),
    microsoftEmail: text("microsoft_email").notNull(),
    action: text("action").notNull(),
    priorStatus: text("prior_status").notNull().default(""),
    nextStatus: text("next_status").notNull().default(""),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorType: text("actor_type").notNull().default("Human"),
    reason: text("reason").notNull().default(""),
    detailJson: text("detail_json").notNull().default("{}"),
    syncRunId: text("sync_run_id").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("microsoft_access_audits_subject_idx").on(table.providerSubject, table.createdAt),
    index("microsoft_access_audits_actor_idx").on(table.actorEmail, table.createdAt),
  ],
);

export const microsoftDirectorySyncRuns = sqliteTable(
  "microsoft_directory_sync_runs",
  {
    id: text("id").primaryKey(),
    triggerSource: text("trigger_source").notNull(),
    status: text("status").notNull().default("Running"),
    sourceCount: integer("source_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    disabledCount: integer("disabled_count").notNull().default(0),
    missingCount: integer("missing_count").notNull().default(0),
    errorMessage: text("error_message").notNull().default(""),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("microsoft_directory_sync_runs_status_idx").on(table.status, table.startedAt)],
);

export const microsoftActivityAudits = sqliteTable(
  "microsoft_activity_audits",
  {
    id: text("id").primaryKey(),
    providerSubject: text("provider_subject").notNull().default(""),
    microsoftEmail: text("microsoft_email").notNull(),
    commandActorEmail: text("command_actor_email").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull().default(""),
    status: text("status").notNull(),
    detailJson: text("detail_json").notNull().default("{}"),
    errorMessage: text("error_message").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("microsoft_activity_audits_email_idx").on(table.microsoftEmail, table.createdAt),
    index("microsoft_activity_audits_status_idx").on(table.status, table.createdAt),
  ],
);

export const microsoftGraphSubscriptions = sqliteTable(
  "microsoft_graph_subscriptions",
  {
    id: text("id").primaryKey(),
    resource: text("resource").notNull(),
    changeType: text("change_type").notNull(),
    notificationUrl: text("notification_url").notNull(),
    expirationDateTime: text("expiration_date_time").notNull(),
    clientStateHash: text("client_state_hash").notNull(),
    status: text("status").notNull().default("Active"),
    lastRenewedAt: text("last_renewed_at").notNull().default(""),
    lastNotificationAt: text("last_notification_at").notNull().default(""),
    errorMessage: text("error_message").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("microsoft_graph_subscriptions_resource_idx").on(table.resource),
    index("microsoft_graph_subscriptions_expiry_idx").on(table.status, table.expirationDateTime),
  ],
);

export const microsoftGraphSubscriptionAudits = sqliteTable(
  "microsoft_graph_subscription_audits",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull(),
    expirationDateTime: text("expiration_date_time").notNull().default(""),
    detail: text("detail").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("microsoft_graph_subscription_audits_subscription_idx").on(table.subscriptionId, table.createdAt)],
);

export const microsoftGraphWebhookValidationWindows = sqliteTable(
  "microsoft_graph_webhook_validation_windows",
  {
    id: text("id").primaryKey(),
    operation: text("operation").notNull(),
    status: text("status").notNull().default("Open"),
    openedBy: text("opened_by").notNull(),
    openedAt: text("opened_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    closedAt: text("closed_at").notNull().default(""),
    detail: text("detail").notNull().default(""),
  },
  (table) => [index("microsoft_graph_webhook_windows_status_idx").on(table.status, table.expiresAt)],
);

export const microsoftGraphWebhookRateLimits = sqliteTable(
  "microsoft_graph_webhook_rate_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    scope: text("scope").notNull(),
    sourceHash: text("source_hash").notNull().default(""),
    windowStartedAt: integer("window_started_at").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    blockedCount: integer("blocked_count").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("microsoft_graph_webhook_rate_window_idx").on(table.windowStartedAt)],
);

export const microsoftGraphWebhookSecurityEvents = sqliteTable(
  "microsoft_graph_webhook_security_events",
  {
    id: text("id").primaryKey(),
    outcome: text("outcome").notNull(),
    reasonCode: text("reason_code").notNull(),
    sourceHash: text("source_hash").notNull().default(""),
    requestId: text("request_id").notNull().default(""),
    detail: text("detail").notNull().default(""),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    index("microsoft_graph_webhook_security_outcome_idx").on(table.outcome, table.lastSeenAt),
    index("microsoft_graph_webhook_security_reason_idx").on(table.reasonCode, table.lastSeenAt),
  ],
);

export const meetingSeries = sqliteTable(
  "meeting_series",
  {
    id: text("id").primaryKey(),
    meetingType: text("meeting_type").notNull(),
    projectId: text("project_id").notNull().default("MEFFORD-COMPANY"),
    title: text("title").notNull(),
    status: text("status").notNull().default("Active"),
    cadence: text("cadence").notNull(),
    startAt: text("start_at").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    timeZone: text("time_zone").notNull().default("America/New_York"),
    meetingMode: text("meeting_mode").notNull().default("Teams Remote"),
    location: text("location").notNull().default("Microsoft Teams"),
    leaderName: text("leader_name").notNull(),
    leaderEmail: text("leader_email").notNull(),
    organizerEmail: text("organizer_email").notNull(),
    recordingDefault: integer("recording_default", { mode: "boolean" }).notNull().default(true),
    autoPublishHours: integer("auto_publish_hours").notNull().default(24),
    graphEventId: text("graph_event_id").notNull().default(""),
    graphChangeKey: text("graph_change_key").notNull().default(""),
    teamsJoinUrl: text("teams_join_url").notNull().default(""),
    accessJson: text("access_json").notNull().default("{}"),
    notRequiredReason: text("not_required_reason").notNull().default(""),
    notRequiredBy: text("not_required_by").notNull().default(""),
    notRequiredAt: text("not_required_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("meeting_series_scope_idx").on(table.projectId, table.meetingType, table.status),
    index("meeting_series_start_idx").on(table.startAt),
  ],
);

export const meetingOccurrences = sqliteTable(
  "meeting_occurrences",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id").notNull(),
    meetingNumber: text("meeting_number").notNull().unique(),
    scheduledStart: text("scheduled_start").notNull(),
    scheduledEnd: text("scheduled_end").notNull(),
    status: text("status").notNull().default("Draft Agenda"),
    recordingEnabled: integer("recording_enabled", { mode: "boolean" }).notNull().default(true),
    recordingOverrideReason: text("recording_override_reason").notNull().default(""),
    recordingOverrideBy: text("recording_override_by").notNull().default(""),
    recordingOverrideAt: text("recording_override_at"),
    publicationHold: integer("publication_hold", { mode: "boolean" }).notNull().default(false),
    publicationHoldReason: text("publication_hold_reason").notNull().default(""),
    publicationHoldBy: text("publication_hold_by").notNull().default(""),
    publicationHoldAt: text("publication_hold_at"),
    transcriptStatus: text("transcript_status").notNull().default("Awaiting Meeting"),
    graphEventId: text("graph_event_id").notNull().default(""),
    teamsMeetingId: text("teams_meeting_id").notNull().default(""),
    publishedAt: text("published_at"),
    startedAt: text("started_at"),
    heldAt: text("held_at"),
    draftMinutesAt: text("draft_minutes_at"),
    finalizedAt: text("finalized_at"),
    distributedAt: text("distributed_at"),
    finalizedBy: text("finalized_by").notNull().default(""),
    minutesRevision: integer("minutes_revision").notNull().default(0),
    minutesSummary: text("minutes_summary").notNull().default(""),
    financialSnapshotJson: text("financial_snapshot_json").notNull().default("{}"),
    distributionJson: text("distribution_json").notNull().default("[]"),
    agendaPdfKey: text("agenda_pdf_key").notNull().default(""),
    minutesPdfKey: text("minutes_pdf_key").notNull().default(""),
    leaderRating: integer("leader_rating"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("meeting_occurrence_series_idx").on(table.seriesId, table.scheduledStart),
    index("meeting_occurrence_status_idx").on(table.status, table.scheduledStart),
  ],
);

export const meetingAttendees = sqliteTable(
  "meeting_attendees",
  {
    id: text("id").primaryKey(),
    occurrenceId: text("occurrence_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    attendeeRole: text("attendee_role").notNull().default("Participant"),
    attendanceRequirement: text("attendance_requirement").notNull().default("Required"),
    external: integer("external", { mode: "boolean" }).notNull().default(false),
    calendarResponse: text("calendar_response").notNull().default("Not Responded"),
    attendanceStatus: text("attendance_status").notNull().default("Unconfirmed"),
    attendanceSource: text("attendance_source").notNull().default(""),
    checkInAt: text("check_in_at"),
    checkOutAt: text("check_out_at"),
    endConfirmedAt: text("end_confirmed_at"),
    rating: integer("rating"),
    exceptionReason: text("exception_reason").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("meeting_attendee_occurrence_idx").on(table.occurrenceId, table.email)],
);

export const meetingAgendaItems = sqliteTable(
  "meeting_agenda_items",
  {
    id: text("id").primaryKey(),
    occurrenceId: text("occurrence_id").notNull(),
    sectionKey: text("section_key").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    timeboxMinutes: integer("timebox_minutes").notNull(),
    status: text("status").notNull().default("Open"),
    notes: text("notes").notNull().default(""),
    sourceType: text("source_type").notNull().default("Standard Section"),
    sourceId: text("source_id").notNull().default(""),
    sourceVersion: text("source_version").notNull().default(""),
    sourceReason: text("source_reason").notNull().default(""),
    aiSuggested: integer("ai_suggested", { mode: "boolean" }).notNull().default(false),
    aiConfidence: text("ai_confidence").notNull().default(""),
    visibility: text("visibility").notNull().default("Attendees"),
    addendumNumber: integer("addendum_number").notNull().default(0),
    publishedAt: text("published_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("meeting_agenda_occurrence_idx").on(table.occurrenceId, table.position)],
);

export const meetingDecisions = sqliteTable(
  "meeting_decisions",
  {
    id: text("id").primaryKey(),
    occurrenceId: text("occurrence_id").notNull(),
    statement: text("statement").notNull(),
    decisionMakerName: text("decision_maker_name").notNull(),
    decisionMakerEmail: text("decision_maker_email").notNull(),
    status: text("status").notNull().default("Proposed"),
    participantsJson: text("participants_json").notNull().default("[]"),
    sourceLinksJson: text("source_links_json").notNull().default("[]"),
    impactsJson: text("impacts_json").notNull().default("[]"),
    implementationOwner: text("implementation_owner").notNull().default(""),
    evidence: text("evidence").notNull().default(""),
    proposedBy: text("proposed_by").notNull(),
    confirmedBy: text("confirmed_by").notNull().default(""),
    confirmedAt: text("confirmed_at"),
    supersedesId: text("supersedes_id").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("meeting_decision_occurrence_idx").on(table.occurrenceId, table.status)],
);

export const meetingActionItems = sqliteTable(
  "meeting_action_items",
  {
    id: text("id").primaryKey(),
    occurrenceId: text("occurrence_id").notNull(),
    seriesId: text("series_id").notNull(),
    projectId: text("project_id").notNull(),
    title: text("title").notNull(),
    definitionOfDone: text("definition_of_done").notNull(),
    assigneeName: text("assignee_name").notNull(),
    assigneeEmail: text("assignee_email").notNull(),
    collaboratorsJson: text("collaborators_json").notNull().default("[]"),
    dueAt: text("due_at").notNull(),
    priority: text("priority").notNull().default("Normal"),
    itemKind: text("item_kind").notNull().default("To-Do"),
    status: text("status").notNull().default("Assignment Not Confirmed"),
    blocker: text("blocker").notNull().default(""),
    evidence: text("evidence").notNull().default(""),
    sourceType: text("source_type").notNull().default("Meeting"),
    sourceId: text("source_id").notNull().default(""),
    carryCount: integer("carry_count").notNull().default(0),
    carriedFromId: text("carried_from_id").notNull().default(""),
    cancelledReason: text("cancelled_reason").notNull().default(""),
    workItemId: text("work_item_id").notNull().default(""),
    createdBy: text("created_by").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("meeting_action_occurrence_idx").on(table.occurrenceId, table.status),
    index("meeting_action_assignee_idx").on(table.assigneeEmail, table.status, table.dueAt),
  ],
);

export const meetingAttachments = sqliteTable(
  "meeting_attachments",
  {
    id: text("id").primaryKey(),
    occurrenceId: text("occurrence_id").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull().default("Meeting File"),
    storageKey: text("storage_key").notNull().default(""),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sourceType: text("source_type").notNull().default("Command Center"),
    sourceId: text("source_id").notNull().default(""),
    sourceVersion: text("source_version").notNull().default("Current"),
    access: text("access").notNull().default("Attendees"),
    includeWithMinutes: integer("include_with_minutes", { mode: "boolean" }).notNull().default(false),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("meeting_attachment_occurrence_idx").on(table.occurrenceId)],
);

export const meetingAudits = sqliteTable(
  "meeting_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seriesId: text("series_id").notNull().default(""),
    occurrenceId: text("occurrence_id").notNull().default(""),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: text("before_json").notNull().default("{}"),
    afterJson: text("after_json").notNull().default("{}"),
    reason: text("reason").notNull().default(""),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("meeting_audit_occurrence_idx").on(table.occurrenceId, table.createdAt)],
);

export const meetingSyncEvents = sqliteTable(
  "meeting_sync_events",
  {
    id: text("id").primaryKey(),
    seriesId: text("series_id").notNull().default(""),
    occurrenceId: text("occurrence_id").notNull().default(""),
    provider: text("provider").notNull().default("Microsoft Graph"),
    direction: text("direction").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    providerId: text("provider_id").notNull().default(""),
    detail: text("detail").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("meeting_sync_status_idx").on(table.status, table.createdAt)],
);

export const vendorProfiles = sqliteTable(
  "vendor_profiles",
  {
    id: text("id").primaryKey(),
    legalName: text("legal_name").notNull(),
    dbaName: text("dba_name").notNull().default(""),
    vendorType: text("vendor_type").notNull().default("Subcontractor"),
    status: text("status").notNull().default("Prospective"),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone").notNull().default(""),
    addressJson: text("address_json").notNull().default("{}"),
    tradesJson: text("trades_json").notNull().default("[]"),
    serviceAreasJson: text("service_areas_json").notNull().default("[]"),
    paymentTerms: text("payment_terms").notNull().default("Net 30"),
    taxIdLastFour: text("tax_id_last_four").notNull().default(""),
    approvedBy: text("approved_by").notNull().default(""),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("vendor_profiles_status_idx").on(table.status)],
);

export const vendorInvites = sqliteTable(
  "vendor_invites",
  {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    verifiedAt: text("verified_at"),
    revokedAt: text("revoked_at"),
    sessionHash: text("session_hash"),
    sessionExpiresAt: text("session_expires_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("vendor_invites_vendor_idx").on(table.vendorId),
    index("vendor_invites_email_idx").on(table.email),
  ],
);

export const vendorComplianceDocuments = sqliteTable(
  "vendor_compliance_documents",
  {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull(),
    kind: text("kind").notNull(),
    effectiveDate: text("effective_date"),
    expirationDate: text("expiration_date"),
    status: text("status").notNull().default("Pending Review"),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    reviewedBy: text("reviewed_by").notNull().default(""),
    reviewedAt: text("reviewed_at"),
    reviewNote: text("review_note").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("vendor_compliance_vendor_kind_idx").on(table.vendorId, table.kind),
    index("vendor_compliance_expiration_idx").on(table.expirationDate),
  ],
);

export const vendorProjectAccess = sqliteTable(
  "vendor_project_access",
  {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull(),
    projectId: text("project_id").notNull(),
    projectName: text("project_name").notNull(),
    status: text("status").notNull().default("Active"),
    trade: text("trade").notNull().default(""),
    contractReference: text("contract_reference").notNull().default(""),
    costCode: text("cost_code").notNull().default(""),
    committedAmount: text("committed_amount").notNull().default("0"),
    permissionsJson: text("permissions_json").notNull().default("[]"),
    sharedRecordsJson: text("shared_records_json").notNull().default("[]"),
    grantedBy: text("granted_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("vendor_project_access_vendor_idx").on(table.vendorId),
    index("vendor_project_access_project_idx").on(table.projectId),
  ],
);

export const vendorSubmissions = sqliteTable(
  "vendor_submissions",
  {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull(),
    projectId: text("project_id").notNull(),
    submissionType: text("submission_type").notNull(),
    title: text("title").notNull(),
    amount: text("amount").notNull().default("0"),
    periodEnd: text("period_end"),
    status: text("status").notNull().default("Submitted"),
    payloadJson: text("payload_json").notNull().default("{}"),
    attachmentStorageKey: text("attachment_storage_key").notNull().default(""),
    attachmentName: text("attachment_name").notNull().default(""),
    complianceSnapshotJson: text("compliance_snapshot_json").notNull().default("{}"),
    apRecordId: text("ap_record_id").notNull().default(""),
    submittedAt: text("submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("vendor_submissions_vendor_idx").on(table.vendorId),
    index("vendor_submissions_project_idx").on(table.projectId),
    index("vendor_submissions_status_idx").on(table.status),
  ],
);

export const vendorComplianceOverrides = sqliteTable(
  "vendor_compliance_overrides",
  {
    id: text("id").primaryKey(),
    vendorId: text("vendor_id").notNull(),
    projectId: text("project_id").notNull().default("ALL"),
    reason: text("reason").notNull(),
    expiresAt: text("expires_at").notNull(),
    ownerName: text("owner_name").notNull(),
    ownerEmail: text("owner_email").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("vendor_overrides_vendor_idx").on(table.vendorId)],
);

export const vendorAudits = sqliteTable(
  "vendor_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    vendorId: text("vendor_id").notNull(),
    submissionId: text("submission_id").notNull().default(""),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("vendor_audits_vendor_idx").on(table.vendorId)],
);

export const ownerPortalAccess = sqliteTable(
  "owner_portal_access",
  {
    projectId: text("project_id").primaryKey(),
    contractRecordId: text("contract_record_id").notNull(),
    status: text("status").notNull().default("Dormant"),
    contactName: text("contact_name").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    approvedRevisionId: text("approved_revision_id").notNull().default(""),
    approvedBy: text("approved_by").notNull().default(""),
    approvedAt: text("approved_at"),
    invitedAt: text("invited_at"),
    lastReviewAt: text("last_review_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("owner_portal_access_status_idx").on(table.status)],
);

export const ownerPortalInvites = sqliteTable(
  "owner_portal_invites",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    contractRecordId: text("contract_record_id").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    status: text("status").notNull().default("Issued"),
    expiresAt: text("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    verifiedAt: text("verified_at"),
    revokedAt: text("revoked_at"),
    sessionHash: text("session_hash"),
    sessionExpiresAt: text("session_expires_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("owner_portal_invites_project_idx").on(table.projectId),
    index("owner_portal_invites_email_idx").on(table.email),
  ],
);

export const ownerContractRevisions = sqliteTable(
  "owner_contract_revisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    contractRecordId: text("contract_record_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    phase: text("phase").notNull(),
    contractType: text("contract_type").notNull(),
    fieldsJson: text("fields_json").notNull().default("{}"),
    snapshotHash: text("snapshot_hash").notNull(),
    note: text("note").notNull().default(""),
    createdByType: text("created_by_type").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdByEmail: text("created_by_email").notNull(),
    frozenAt: text("frozen_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("owner_contract_revision_number_idx").on(table.projectId, table.contractRecordId, table.revisionNumber),
    index("owner_contract_revision_project_idx").on(table.projectId, table.createdAt),
  ],
);

export const ownerContractChangeRequests = sqliteTable(
  "owner_contract_change_requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    contractRecordId: text("contract_record_id").notNull(),
    revisionId: text("revision_id").notNull(),
    clauseKey: text("clause_key").notNull(),
    requestType: text("request_type").notNull(),
    originalText: text("original_text").notNull().default(""),
    proposedText: text("proposed_text").notNull().default(""),
    comment: text("comment").notNull().default(""),
    status: text("status").notNull().default("Open"),
    meffordResponse: text("mefford_response").notNull().default(""),
    createdByName: text("created_by_name").notNull(),
    createdByEmail: text("created_by_email").notNull(),
    resolvedByName: text("resolved_by_name").notNull().default(""),
    resolvedByEmail: text("resolved_by_email").notNull().default(""),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("owner_contract_change_project_idx").on(table.projectId, table.status, table.createdAt)],
);

export const ownerPortalAudits = sqliteTable(
  "owner_portal_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id").notNull(),
    contractRecordId: text("contract_record_id").notNull().default(""),
    actorType: text("actor_type").notNull(),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("owner_portal_audit_project_idx").on(table.projectId, table.createdAt)],
);

export const ownerDeletionRequests = sqliteTable(
  "owner_deletion_requests",
  {
    id: text("id").primaryKey(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    targetName: text("target_name").notNull(),
    state: text("state").notNull().default("Quarantined"),
    phase: text("phase").notNull().default("Snapshot Verified"),
    manifestStorageKey: text("manifest_storage_key").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    manifestCountsJson: text("manifest_counts_json").notNull().default("{}"),
    requestedByName: text("requested_by_name").notNull(),
    requestedByEmail: text("requested_by_email").notNull(),
    requestedAt: text("requested_at").notNull(),
    purgeAfter: text("purge_after").notNull(),
    restoredAt: text("restored_at"),
    restoredByEmail: text("restored_by_email").notNull().default(""),
    purgeStartedAt: text("purge_started_at"),
    purgeConfirmedAt: text("purge_confirmed_at"),
    purgeConfirmedByEmail: text("purge_confirmed_by_email").notNull().default(""),
    databasePurgedAt: text("database_purged_at"),
    storagePurgedAt: text("storage_purged_at"),
    manifestPurgedAt: text("manifest_purged_at"),
    operationToken: text("operation_token").notNull().default(""),
    operationStartedAt: text("operation_started_at"),
    operationActorEmail: text("operation_actor_email").notNull().default(""),
    completedAt: text("completed_at"),
    errorMessage: text("error_message").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("owner_deletion_requests_target_idx").on(table.targetKind, table.targetId, table.state),
    index("owner_deletion_requests_purge_idx").on(table.state, table.purgeAfter),
  ],
);

export const mobileDeviceSessions = sqliteTable(
  "mobile_device_sessions",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email").notNull(),
    userName: text("user_name").notNull(),
    deviceFingerprint: text("device_fingerprint").notNull(),
    deviceName: text("device_name").notNull(),
    platform: text("platform").notNull(),
    status: text("status").notNull().default("Trusted"),
    biometricCredentialId: text("biometric_credential_id").notNull().default(""),
    biometricPublicKey: text("biometric_public_key").notNull().default(""),
    biometricAlgorithm: integer("biometric_algorithm").notNull().default(-7),
    biometricSignCount: integer("biometric_sign_count").notNull().default(0),
    biometricRpId: text("biometric_rp_id").notNull().default(""),
    pendingChallenge: text("pending_challenge").notNull().default(""),
    challengeExpiresAt: text("challenge_expires_at"),
    pushSubscriptionJson: text("push_subscription_json").notNull().default(""),
    pushEnabled: integer("push_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    offlineExpiresAt: text("offline_expires_at").notNull(),
    revokedAt: text("revoked_at"),
    revokedBy: text("revoked_by").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("mobile_device_sessions_user_idx").on(table.userEmail, table.status),
    index("mobile_device_sessions_fingerprint_idx").on(
      table.deviceFingerprint,
    ),
  ],
);

export const mobileDeviceAudits = sqliteTable(
  "mobile_device_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    userEmail: text("user_email").notNull(),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("mobile_device_audits_session_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("mobile_device_audits_user_idx").on(table.userEmail),
  ],
);

export const accountingPeriods = sqliteTable(
  "accounting_periods",
  {
    id: text("id").primaryKey(),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    status: text("status").notNull().default("Open"),
    softClosedBy: text("soft_closed_by").notNull().default(""),
    softClosedEmail: text("soft_closed_email").notNull().default(""),
    softClosedAt: text("soft_closed_at"),
    hardClosedBy: text("hard_closed_by").notNull().default(""),
    hardClosedEmail: text("hard_closed_email").notNull().default(""),
    hardClosedAt: text("hard_closed_at"),
    reopenedBy: text("reopened_by").notNull().default(""),
    reopenedEmail: text("reopened_email").notNull().default(""),
    reopenedAt: text("reopened_at"),
    reopenReason: text("reopen_reason").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_periods_status_idx").on(table.status, table.periodEnd),
  ],
);

export const accountingEvents = sqliteTable(
  "accounting_events",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    eventType: text("event_type").notNull(),
    sourceType: text("source_type").notNull(),
    sourceProjectId: text("source_project_id").notNull().default(""),
    sourceRecordId: text("source_record_id").notNull(),
    eventDate: text("event_date").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("Posted"),
    amountCents: integer("amount_cents").notNull(),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_events_source_idx").on(
      table.sourceType,
      table.sourceProjectId,
      table.sourceRecordId,
    ),
    index("accounting_events_date_idx").on(table.eventDate, table.eventType),
  ],
);

export const accountingJournalEntries = sqliteTable(
  "accounting_journal_entries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").unique(),
    entryDate: text("entry_date").notNull(),
    periodId: text("period_id").notNull(),
    entryType: text("entry_type").notNull(),
    reference: text("reference").notNull(),
    description: text("description").notNull(),
    supportReference: text("support_reference").notNull().default(""),
    status: text("status").notNull().default("Draft"),
    sourceType: text("source_type").notNull().default("Manual Journal"),
    sourceProjectId: text("source_project_id").notNull().default(""),
    sourceRecordId: text("source_record_id").notNull().default(""),
    preparedBy: text("prepared_by").notNull(),
    preparedEmail: text("prepared_email").notNull(),
    approvedBy: text("approved_by").notNull().default(""),
    approvedEmail: text("approved_email").notNull().default(""),
    approvedAt: text("approved_at"),
    postedBy: text("posted_by").notNull().default(""),
    postedEmail: text("posted_email").notNull().default(""),
    postedAt: text("posted_at"),
    reversesEntryId: text("reverses_entry_id").notNull().default(""),
    totalDebitCents: integer("total_debit_cents").notNull().default(0),
    totalCreditCents: integer("total_credit_cents").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_journal_period_status_idx").on(
      table.periodId,
      table.status,
      table.entryDate,
    ),
    index("accounting_journal_source_idx").on(
      table.sourceType,
      table.sourceProjectId,
      table.sourceRecordId,
    ),
  ],
);

export const accountingJournalLines = sqliteTable(
  "accounting_journal_lines",
  {
    id: text("id").primaryKey(),
    entryId: text("entry_id").notNull(),
    lineNumber: integer("line_number").notNull(),
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    description: text("description").notNull().default(""),
    projectId: text("project_id").notNull().default(""),
    department: text("department").notNull().default(""),
    costCode: text("cost_code").notNull().default(""),
    sourceAllocationId: text("source_allocation_id").notNull().default(""),
    debitCents: integer("debit_cents").notNull().default(0),
    creditCents: integer("credit_cents").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_journal_lines_entry_idx").on(table.entryId, table.lineNumber),
    index("accounting_journal_lines_account_idx").on(
      table.accountNumber,
      table.projectId,
    ),
  ],
);

export const accountingWipForecasts = sqliteTable(
  "accounting_wip_forecasts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    periodId: text("period_id").notNull(),
    actualCostCents: integer("actual_cost_cents").notNull().default(0),
    estimateToCompleteCents: integer("estimate_to_complete_cents").notNull().default(0),
    riskReserveCents: integer("risk_reserve_cents").notNull().default(0),
    estimateAtCompletionCents: integer("estimate_at_completion_cents").notNull().default(0),
    forecastProfitCents: integer("forecast_profit_cents").notNull().default(0),
    projectedMarginBasisPoints: integer("projected_margin_basis_points").notNull().default(0),
    recognitionMethod: text("recognition_method").notNull().default("Cost To Cost"),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("Draft"),
    preparedBy: text("prepared_by").notNull(),
    preparedEmail: text("prepared_email").notNull(),
    reviewedBy: text("reviewed_by").notNull().default(""),
    reviewedEmail: text("reviewed_email").notNull().default(""),
    reviewedAt: text("reviewed_at"),
    approvedBy: text("approved_by").notNull().default(""),
    approvedEmail: text("approved_email").notNull().default(""),
    approvedAt: text("approved_at"),
    lockedAt: text("locked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_wip_project_period_idx").on(table.projectId, table.periodId),
    index("accounting_wip_period_status_idx").on(table.periodId, table.status),
  ],
);

export const accountingBankTransactions = sqliteTable(
  "accounting_bank_transactions",
  {
    id: text("id").primaryKey(),
    cashAccountId: text("cash_account_id").notNull(),
    transactionDate: text("transaction_date").notNull(),
    source: text("source").notNull(),
    reference: text("reference").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("Unmatched"),
    matchedTransactionId: text("matched_transaction_id").notNull().default(""),
    importedBatchId: text("imported_batch_id").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdEmail: text("created_email").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_bank_transaction_account_idx").on(
      table.cashAccountId,
      table.status,
      table.transactionDate,
    ),
    index("accounting_bank_transaction_batch_idx").on(table.importedBatchId),
  ],
);

export const accountingBankReconciliations = sqliteTable(
  "accounting_bank_reconciliations",
  {
    id: text("id").primaryKey(),
    cashAccountId: text("cash_account_id").notNull(),
    statementStart: text("statement_start").notNull(),
    statementEnd: text("statement_end").notNull(),
    statementEndingBalanceCents: integer("statement_ending_balance_cents").notNull(),
    bookEndingBalanceCents: integer("book_ending_balance_cents").notNull(),
    outstandingDepositsCents: integer("outstanding_deposits_cents").notNull().default(0),
    outstandingPaymentsCents: integer("outstanding_payments_cents").notNull().default(0),
    adjustmentCents: integer("adjustment_cents").notNull().default(0),
    differenceCents: integer("difference_cents").notNull(),
    status: text("status").notNull().default("Draft"),
    preparedBy: text("prepared_by").notNull(),
    preparedEmail: text("prepared_email").notNull(),
    approvedBy: text("approved_by").notNull().default(""),
    approvedEmail: text("approved_email").notNull().default(""),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_bank_reconciliation_account_idx").on(
      table.cashAccountId,
      table.statementEnd,
      table.status,
    ),
  ],
);

export const accountingCashForecastItems = sqliteTable(
  "accounting_cash_forecast_items",
  {
    id: text("id").primaryKey(),
    weekStart: text("week_start").notNull(),
    direction: text("direction").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    projectId: text("project_id").notNull().default(""),
    confidence: text("confidence").notNull().default("Expected"),
    sourceType: text("source_type").notNull().default("Manual Forecast"),
    sourceRecordId: text("source_record_id").notNull().default(""),
    status: text("status").notNull().default("Active"),
    createdBy: text("created_by").notNull(),
    createdEmail: text("created_email").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_cash_forecast_week_idx").on(table.weekStart, table.status),
    index("accounting_cash_forecast_source_idx").on(table.sourceType, table.sourceRecordId),
  ],
);

export const accountingCloseTasks = sqliteTable(
  "accounting_close_tasks",
  {
    id: text("id").primaryKey(),
    periodId: text("period_id").notNull(),
    code: text("code").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    assignedRole: text("assigned_role").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status").notNull().default("Open"),
    evidence: text("evidence").notNull().default(""),
    completedBy: text("completed_by").notNull().default(""),
    completedEmail: text("completed_email").notNull().default(""),
    completedAt: text("completed_at"),
    reviewedBy: text("reviewed_by").notNull().default(""),
    reviewedEmail: text("reviewed_email").notNull().default(""),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_close_period_status_idx").on(table.periodId, table.status),
  ],
);

export const accountingCutoverControls = sqliteTable(
  "accounting_cutover_controls",
  {
    id: text("id").primaryKey(),
    cutoverDate: text("cutover_date").notNull(),
    sourceSystem: text("source_system").notNull(),
    openingBalanceEntryId: text("opening_balance_entry_id").notNull().default(""),
    apReconciled: integer("ap_reconciled", { mode: "boolean" }).notNull().default(false),
    arReconciled: integer("ar_reconciled", { mode: "boolean" }).notNull().default(false),
    cashReconciled: integer("cash_reconciled", { mode: "boolean" }).notNull().default(false),
    assetsReconciled: integer("assets_reconciled", { mode: "boolean" }).notNull().default(false),
    payrollReconciled: integer("payroll_reconciled", { mode: "boolean" }).notNull().default(false),
    equityReconciled: integer("equity_reconciled", { mode: "boolean" }).notNull().default(false),
    evidence: text("evidence").notNull().default(""),
    status: text("status").notNull().default("Draft"),
    preparedBy: text("prepared_by").notNull(),
    preparedEmail: text("prepared_email").notNull(),
    approvedBy: text("approved_by").notNull().default(""),
    approvedEmail: text("approved_email").notNull().default(""),
    approvedAt: text("approved_at"),
    lockedAt: text("locked_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const accountingCollectionActions = sqliteTable(
  "accounting_collection_actions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    billingId: text("billing_id").notNull(),
    actionDate: text("action_date").notNull(),
    method: text("method").notNull(),
    note: text("note").notNull(),
    promiseDate: text("promise_date").notNull().default(""),
    promisedAmountCents: integer("promised_amount_cents").notNull().default(0),
    createdBy: text("created_by").notNull(),
    createdEmail: text("created_email").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("accounting_collection_billing_idx").on(table.billingId, table.actionDate),
  ],
);

export const employeeServiceRequests = sqliteTable(
  "employee_service_requests",
  {
    id: text("id").primaryKey(),
    employeeEmail: text("employee_email").notNull(),
    employeeName: text("employee_name").notNull(),
    category: text("category").notNull(),
    subject: text("subject").notNull(),
    details: text("details").notNull(),
    priority: text("priority").notNull().default("Normal"),
    status: text("status").notNull().default("Open"),
    routedRole: text("routed_role").notNull(),
    assignedToEmail: text("assigned_to_email").notNull().default(""),
    assignedToName: text("assigned_to_name").notNull().default(""),
    secondaryApprovalRole: text("secondary_approval_role").notNull().default(""),
    primaryApprovedByEmail: text("primary_approved_by_email").notNull().default(""),
    primaryApprovedByName: text("primary_approved_by_name").notNull().default(""),
    primaryApprovedAt: text("primary_approved_at"),
    secondaryApprovedByEmail: text("secondary_approved_by_email").notNull().default(""),
    secondaryApprovedByName: text("secondary_approved_by_name").notNull().default(""),
    secondaryApprovedAt: text("secondary_approved_at"),
    resolution: text("resolution").notNull().default(""),
    confidential: integer("confidential", { mode: "boolean" }).notNull().default(false),
    dueAt: text("due_at").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("employee_service_request_employee_idx").on(table.employeeEmail, table.status),
    index("employee_service_request_assignee_idx").on(table.assignedToEmail, table.status),
    index("employee_service_request_role_idx").on(table.routedRole, table.status),
  ],
);

export const employeeLeaveRequests = sqliteTable(
  "employee_leave_requests",
  {
    id: text("id").primaryKey(),
    employeeEmail: text("employee_email").notNull(),
    employeeName: text("employee_name").notNull(),
    leaveType: text("leave_type").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    requestedHours: integer("requested_hours").notNull(),
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("Pending Review"),
    routedRole: text("routed_role").notNull().default("Company Owner / Administrator"),
    approverEmail: text("approver_email").notNull().default(""),
    approverName: text("approver_name").notNull().default(""),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note").notNull().default(""),
    calendarEventId: text("calendar_event_id").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("employee_leave_request_employee_idx").on(table.employeeEmail, table.startDate),
    index("employee_leave_request_status_idx").on(table.status, table.startDate),
  ],
);

export const employeeLeaveBalances = sqliteTable(
  "employee_leave_balances",
  {
    employeeEmail: text("employee_email").notNull(),
    planYear: integer("plan_year").notNull(),
    availableHours: integer("available_hours").notNull().default(0),
    usedHours: integer("used_hours").notNull().default(0),
    source: text("source").notNull().default("Administrator Entry"),
    updatedByEmail: text("updated_by_email").notNull(),
    updatedByName: text("updated_by_name").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.employeeEmail, table.planYear] }),
    index("employee_leave_balance_year_idx").on(table.planYear),
  ],
);

export const employeeProfiles = sqliteTable(
  "employee_profiles",
  {
    employeeEmail: text("employee_email").primaryKey(),
    preferredName: text("preferred_name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    address1: text("address_1").notNull().default(""),
    address2: text("address_2").notNull().default(""),
    city: text("city").notNull().default(""),
    state: text("state").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    emergencyContactName: text("emergency_contact_name").notNull().default(""),
    emergencyContactPhone: text("emergency_contact_phone").notNull().default(""),
    emergencyContactRelationship: text("emergency_contact_relationship").notNull().default(""),
    shirtSize: text("shirt_size").notNull().default(""),
    jacketSize: text("jacket_size").notNull().default(""),
    vestSize: text("vest_size").notNull().default(""),
    communicationPreference: text("communication_preference").notNull().default("Email"),
    professionalBio: text("professional_bio").notNull().default(""),
    updatedByEmail: text("updated_by_email").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const proposalProfiles = sqliteTable(
  "proposal_profiles",
  {
    employeeEmail: text("employee_email").primaryKey(),
    displayName: text("display_name").notNull().default(""),
    companyTitle: text("company_title").notNull().default(""),
    proposalRoleLabel: text("proposal_role_label").notNull().default(""),
    professionalSummary: text("professional_summary").notNull().default(""),
    credentialsJson: text("credentials_json").notNull().default("[]"),
    sectorsJson: text("sectors_json").notNull().default("[]"),
    deliveryMethodsJson: text("delivery_methods_json").notNull().default("[]"),
    priorExperienceJson: text("prior_experience_json").notNull().default("[]"),
    headshotFileId: integer("headshot_file_id"),
    leadershipProfile: integer("leadership_profile", { mode: "boolean" }).notNull().default(false),
    includeByDefault: integer("include_by_default", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("Draft"),
    submittedAt: text("submitted_at"),
    approvedByEmail: text("approved_by_email").notNull().default(""),
    approvedAt: text("approved_at"),
    updatedByEmail: text("updated_by_email").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("proposal_profiles_status_idx").on(table.status, table.leadershipProfile)],
);

export const proposalProjectExperience = sqliteTable(
  "proposal_project_experience",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    employeeEmail: text("employee_email").notNull(),
    role: text("role").notNull(),
    projectName: text("project_name").notNull(),
    projectLocation: text("project_location").notNull().default(""),
    projectType: text("project_type").notNull().default(""),
    deliveryMethod: text("delivery_method").notNull().default(""),
    completionDate: text("completion_date").notNull().default(""),
    summary: text("summary").notNull().default(""),
    metricsJson: text("metrics_json").notNull().default("{}"),
    photoFileIdsJson: text("photo_file_ids_json").notNull().default("[]"),
    source: text("source").notNull().default("Project Assignment"),
    customerPermission: text("customer_permission").notNull().default("Review Required"),
    status: text("status").notNull().default("Draft"),
    approvedByEmail: text("approved_by_email").notNull().default(""),
    approvedAt: text("approved_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("proposal_project_experience_identity_idx").on(table.projectId, table.employeeEmail, table.role),
    index("proposal_project_experience_employee_idx").on(table.employeeEmail, table.status),
  ],
);

export const proposalCustomerBranding = sqliteTable(
  "proposal_customer_branding",
  {
    companyKey: text("company_key").primaryKey(),
    companyName: text("company_name").notNull(),
    logoFileId: integer("logo_file_id"),
    status: text("status").notNull().default("Approved"),
    approvedByEmail: text("approved_by_email").notNull().default(""),
    approvedAt: text("approved_at"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("proposal_customer_branding_name_idx").on(table.companyName)],
);

export const employeeFeedback = sqliteTable(
  "employee_feedback",
  {
    id: text("id").primaryKey(),
    feedbackType: text("feedback_type").notNull(),
    employeeEmail: text("employee_email").notNull().default(""),
    employeeName: text("employee_name").notNull().default("Anonymous Employee"),
    recipientEmail: text("recipient_email").notNull().default(""),
    rating: integer("rating"),
    note: text("note").notNull(),
    status: text("status").notNull().default("Received"),
    routedRole: text("routed_role").notNull().default("Human Resources"),
    confidential: integer("confidential", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("employee_feedback_type_idx").on(table.feedbackType, table.createdAt),
    index("employee_feedback_recipient_idx").on(table.recipientEmail, table.createdAt),
  ],
);

export const schedulerTriggerReceipts = sqliteTable(
  "scheduler_trigger_receipts",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    cron: text("cron").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    receivedAt: text("received_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("scheduler_trigger_receipts_source_idx").on(table.source, table.scheduledAt)],
);

export const automationHeartbeatClaims = sqliteTable(
  "automation_heartbeat_claims",
  {
    bucket: text("bucket").primaryKey(),
    token: text("token").notNull(),
    actorEmail: text("actor_email").notNull(),
    claimedAt: text("claimed_at").notNull(),
  },
  (table) => [index("automation_heartbeat_claims_claimed_idx").on(table.claimedAt)],
);

export const schedulerCycleCursors = sqliteTable(
  "scheduler_cycle_cursors",
  {
    source: text("source").primaryKey(),
    nextGroupIndex: integer("next_group_index").notNull().default(0),
    lastGroupName: text("last_group_name").notNull().default(""),
    lastCheckpointAt: text("last_checkpoint_at").notNull().default(""),
    lastCycleId: text("last_cycle_id").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
);

export const schedulerCycleCheckpoints = sqliteTable(
  "scheduler_cycle_checkpoints",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    groupName: text("group_name").notNull(),
    groupIndex: integer("group_index").notNull(),
    status: text("status").notNull().default("Running"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at").notNull().default(""),
    durationMs: integer("duration_ms").notNull().default(0),
    resultJson: text("result_json").notNull().default("{}"),
    errorMessage: text("error_message").notNull().default(""),
    nextGroupIndex: integer("next_group_index").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scheduler_cycle_checkpoints_status_idx").on(table.status, table.startedAt),
    index("scheduler_cycle_checkpoints_source_idx").on(table.source, table.scheduledAt),
  ],
);

export const scheduledOperationRuns = sqliteTable(
  "scheduled_operation_runs",
  {
    id: text("id").primaryKey(),
    jobName: text("job_name").notNull(),
    cadence: text("cadence").notNull(),
    cron: text("cron").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at").notNull().default(""),
    status: text("status").notNull().default("Running"),
    attemptCount: integer("attempt_count").notNull().default(1),
    durationMs: integer("duration_ms").notNull().default(0),
    resultJson: text("result_json").notNull().default("{}"),
    errorMessage: text("error_message").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("scheduled_operation_runs_job_idx").on(table.jobName, table.scheduledAt),
    index("scheduled_operation_runs_status_idx").on(table.status, table.scheduledAt),
  ],
);

export const scheduledOperationLeases = sqliteTable(
  "scheduled_operation_leases",
  {
    runId: text("run_id").primaryKey(),
    jobName: text("job_name").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    leaseToken: text("lease_token").notNull(),
    leaseOwner: text("lease_owner").notNull(),
    leaseExpiresAt: text("lease_expires_at").notNull(),
    heartbeatAt: text("heartbeat_at").notNull(),
    state: text("state").notNull().default("Active"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("scheduled_operation_leases_expiry_idx").on(table.state, table.leaseExpiresAt)],
);

export const scheduledOperationDeadLetters = sqliteTable(
  "scheduled_operation_dead_letters",
  {
    runId: text("run_id").primaryKey(),
    jobName: text("job_name").notNull(),
    scheduledAt: text("scheduled_at").notNull(),
    failureType: text("failure_type").notNull(),
    errorMessage: text("error_message").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    openedAt: text("opened_at").notNull(),
    lastFailedAt: text("last_failed_at").notNull(),
    status: text("status").notNull().default("Open"),
    recoveredAt: text("recovered_at").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("scheduled_operation_dead_letters_status_idx").on(table.status, table.lastFailedAt)],
);

export const scheduledOperationGaps = sqliteTable(
  "scheduled_operation_gaps",
  {
    id: text("id").primaryKey(),
    jobName: text("job_name").notNull(),
    firstMissingAt: text("first_missing_at").notNull(),
    lastMissingAt: text("last_missing_at").notNull(),
    missingCount: integer("missing_count").notNull(),
    detectedAt: text("detected_at").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull().default("Open"),
    resolvedAt: text("resolved_at").notNull().default(""),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("scheduled_operation_gaps_status_idx").on(table.status, table.detectedAt)],
);

export const runtimeFailureEvents = sqliteTable(
  "runtime_failure_events",
  {
    id: text("id").primaryKey(),
    route: text("route").notNull(),
    status: integer("status").notNull(),
    failureKey: text("failure_key").notNull(),
    detail: text("detail").notNull().default(""),
    actorEmail: text("actor_email").notNull().default(""),
    occurredAt: text("occurred_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("runtime_failure_events_window_idx").on(table.failureKey, table.occurredAt),
    index("runtime_failure_events_route_idx").on(table.route, table.status, table.occurredAt),
  ],
);

export const templateGovernanceVersions = sqliteTable("template_governance_versions", {
  id: text("id").primaryKey(), templateId: text("template_id").notNull(), version: text("version").notNull(),
  jurisdiction: text("jurisdiction").notNull(), businessOwner: text("business_owner").notNull(), sourceFileId: integer("source_file_id").notNull(),
  sourceSha256: text("source_sha256").notNull(), effectiveDate: text("effective_date").notNull(), nextReviewDate: text("next_review_date").notNull(),
  requiredReviewersJson: text("required_reviewers_json").notNull(), status: text("status").notNull().default("Draft — Not Approved for Use"),
  supersededById: text("superseded_by_id").notNull().default(""), createdByEmail: text("created_by_email").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("template_governance_version_unique").on(table.templateId, table.version, table.jurisdiction), index("template_governance_current_idx").on(table.templateId, table.jurisdiction, table.status), index("template_governance_review_idx").on(table.status, table.nextReviewDate)]);

export const templateGovernanceApprovals = sqliteTable("template_governance_approvals", {
  id: text("id").primaryKey(), governanceVersionId: text("governance_version_id").notNull(), reviewerRole: text("reviewer_role").notNull(), reviewerName: text("reviewer_name").notNull(), reviewerEmail: text("reviewer_email").notNull(), decision: text("decision").notNull(), sourceSha256: text("source_sha256").notNull(), note: text("note").notNull().default(""), decidedAt: text("decided_at").notNull(),
}, (table) => [uniqueIndex("template_governance_approval_unique").on(table.governanceVersionId, table.reviewerRole, table.reviewerEmail), index("template_governance_approval_version_idx").on(table.governanceVersionId, table.decision)]);

export const templateOutputEvidence = sqliteTable("template_output_evidence", {
  id: text("id").primaryKey(), templateId: text("template_id").notNull(), governanceVersionId: text("governance_version_id").notNull(), templateVersion: text("template_version").notNull(), sourceSha256: text("source_sha256").notNull(), outputSha256: text("output_sha256").notNull(), jurisdiction: text("jurisdiction").notNull(), generator: text("generator").notNull(), generatedByEmail: text("generated_by_email").notNull(), requiredFieldsJson: text("required_fields_json").notNull().default("[]"), deviationsJson: text("deviations_json").notNull().default("[]"), generatedAt: text("generated_at").notNull(),
}, (table) => [index("template_output_evidence_template_idx").on(table.templateId, table.generatedAt)]);
export const accountingAccountNumberCrosswalk = sqliteTable("accounting_account_number_crosswalk", {
  legacyNumber: text("legacy_number").primaryKey(),
  accountNumber: text("account_number").notNull().unique(),
  policyVersion: text("policy_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// A transaction-local compare-and-save guard prevents stale Word imports.
export const proposalWriteGuards = sqliteTable("proposal_write_guards", {
  id: text("id").primaryKey(),
  valid: integer("valid").notNull(),
}, (table) => [check("proposal_write_guard_valid", sql`${table.valid} = 1`)]);

export const estimateWriteGuards = sqliteTable("estimate_write_guards", {
  id: text("id").primaryKey(),
  valid: integer("valid").notNull(),
}, (table) => [check("estimate_write_guard_valid", sql`${table.valid} = 1`)]);

export const meetingAgendaRefreshGuards = sqliteTable("meeting_agenda_refresh_guards", {
  occurrenceId: text("occurrence_id").primaryKey(),
  token: text("token").notNull(),
  expiresAt: text("expires_at").notNull(),
});

// The following tables were previously created only at runtime (`CREATE TABLE
// IF NOT EXISTS` in lib/dashboard-display-auth.ts, lib/sharepoint-storage.ts,
// lib/clean-start.ts, and app/api/owner-delete/route.ts) instead of through a
// numbered migration. Captured here from the live production schema so they
// follow the same append-only migration discipline as every other table.

export const dashboardDisplayCredentials = sqliteTable("dashboard_display_credentials", {
  email: text("email").primaryKey(),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  iterations: integer("iterations").notNull().default(100000),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull(),
});

export const dashboardDisplaySessions = sqliteTable(
  "dashboard_display_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("dashboard_display_sessions_expiry_idx").on(table.expiresAt)],
);

export const dashboardDisplayAudits = sqliteTable("dashboard_display_audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dashboardDisplayLoginFailures = sqliteTable(
  "dashboard_display_login_failures",
  {
    fingerprintHash: text("fingerprint_hash").notNull(),
    failedAt: text("failed_at").notNull(),
  },
  (table) => [index("dashboard_display_login_failures_lookup_idx").on(table.fingerprintHash, table.failedAt)],
);

export const systemDataResets = sqliteTable("system_data_resets", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedByEmail: text("requested_by_email").notNull(),
  preservationPolicy: text("preservation_policy").notNull(),
  claimToken: text("claim_token").notNull().default(""),
  leaseExpiresAt: text("lease_expires_at").notNull().default(""),
  inventoryJson: text("inventory_json").notNull().default("{}"),
  countsJson: text("counts_json").notNull().default("{}"),
  errorMessage: text("error_message").notNull().default(""),
  startedAt: text("started_at").notNull().default(""),
  completedAt: text("completed_at").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ownerDeletionReceipts = sqliteTable("owner_deletion_receipts", {
  id: text("id").primaryKey(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  targetName: text("target_name").notNull(),
  actorName: text("actor_name").notNull(),
  actorEmail: text("actor_email").notNull(),
  countsJson: text("counts_json").notNull().default("{}"),
  deletedAt: text("deleted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sharepointWorkspaces = sqliteTable(
  "sharepoint_workspaces",
  {
    id: text("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    displayName: text("display_name").notNull(),
    libraryKey: text("library_key").notNull(),
    logicalRootPath: text("logical_root_path").notNull(),
    sourceProjectId: text("source_project_id").notNull().default(""),
    sourceRecordId: text("source_record_id").notNull().default(""),
    status: text("status").notNull().default("Mapping Pending"),
    siteId: text("site_id").notNull().default(""),
    driveId: text("drive_id").notNull().default(""),
    rootItemId: text("root_item_id").notNull().default(""),
    webUrl: text("web_url").notNull().default(""),
    folderManifestJson: text("folder_manifest_json").notNull().default("[]"),
    noDeleteGuard: integer("no_delete_guard", { mode: "boolean" }).notNull().default(true),
    lastAttemptAt: text("last_attempt_at").notNull().default(""),
    verifiedAt: text("verified_at").notNull().default(""),
    errorMessage: text("error_message").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("sharepoint_workspace_entity_idx").on(table.entityType, table.entityId),
    index("sharepoint_workspace_status_idx").on(table.status, table.entityType),
  ],
);

export const sharepointFolderMappings = sqliteTable(
  "sharepoint_folder_mappings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    folderKey: text("folder_key").notNull(),
    label: text("label").notNull(),
    parentKey: text("parent_key").notNull().default(""),
    relativePath: text("relative_path").notNull(),
    permissionClass: text("permission_class").notNull(),
    driveItemId: text("drive_item_id").notNull().default(""),
    webUrl: text("web_url").notNull().default(""),
    status: text("status").notNull().default("Mapping Pending"),
    lastVerifiedAt: text("last_verified_at").notNull().default(""),
    errorMessage: text("error_message").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("sharepoint_folder_workspace_key_idx").on(table.workspaceId, table.folderKey),
    index("sharepoint_folder_status_idx").on(table.status, table.permissionClass),
  ],
);

export const sharepointFileMappings = sqliteTable(
  "sharepoint_file_mappings",
  {
    id: text("id").primaryKey(),
    projectFileId: integer("project_file_id").notNull().unique(),
    workspaceId: text("workspace_id").notNull(),
    folderKey: text("folder_key").notNull(),
    sourceProjectId: text("source_project_id").notNull(),
    sourceStorageKey: text("source_storage_key").notNull(),
    sourceName: text("source_name").notNull(),
    sourceSizeBytes: integer("source_size_bytes").notNull().default(0),
    driveItemId: text("drive_item_id").notNull().default(""),
    webUrl: text("web_url").notNull().default(""),
    eTag: text("e_tag").notNull().default(""),
    sha256: text("sha256").notNull().default(""),
    state: text("state").notNull().default("Local Primary · Mapping Pending"),
    noSourceDelete: integer("no_source_delete", { mode: "boolean" }).notNull().default(true),
    lastSyncedAt: text("last_synced_at").notNull().default(""),
    verifiedAt: text("verified_at").notNull().default(""),
    errorMessage: text("error_message").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("sharepoint_file_state_idx").on(table.state, table.workspaceId)],
);

export const sharepointSyncEvents = sqliteTable(
  "sharepoint_sync_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().default(""),
    fileMappingId: text("file_mapping_id").notNull().default(""),
    action: text("action").notNull(),
    status: text("status").notNull(),
    detail: text("detail").notNull().default(""),
    actorName: text("actor_name").notNull(),
    actorEmail: text("actor_email").notNull().default(""),
    providerId: text("provider_id").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("sharepoint_sync_event_status_idx").on(table.status, table.createdAt)],
);

// Found via a full-codebase sweep for CREATE TABLE IF NOT EXISTS (2026-09-22):
// the same runtime self-provisioning pattern fixed for dashboard_display_*/
// sharepoint_*/owner_deletion_receipts/system_data_resets in migration 0040,
// this time from lib/microsoft-entra-auth.ts's ensureMicrosoftEntraAuthSchema.
export const microsoftEntraAuthTransactions = sqliteTable(
  "microsoft_entra_auth_transactions",
  {
    stateHash: text("state_hash").primaryKey(),
    actorEmail: text("actor_email").notNull(),
    providerSubject: text("provider_subject").notNull(),
    microsoftEmail: text("microsoft_email").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at").notNull().default(""),
    outcome: text("outcome").notNull().default("Started"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("microsoft_entra_auth_expiry_idx").on(table.expiresAt, table.consumedAt)],
);

export const microsoftEntraIdentityProofs = sqliteTable(
  "microsoft_entra_identity_proofs",
  {
    providerSubject: text("provider_subject").primaryKey(),
    commandActorEmail: text("command_actor_email").notNull(),
    microsoftEmail: text("microsoft_email").notNull(),
    tenantId: text("tenant_id").notNull(),
    authMethod: text("auth_method").notNull().default("Authorization Code + PKCE"),
    verifiedAt: text("verified_at").notNull(),
    lastVerifiedAt: text("last_verified_at").notNull(),
    revokedAt: text("revoked_at").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("microsoft_entra_identity_actor_idx").on(table.commandActorEmail),
    uniqueIndex("microsoft_entra_identity_email_idx").on(table.microsoftEmail),
  ],
);

export const accountingPlaidItems = sqliteTable(
  "accounting_plaid_items",
  {
    id: text("id").primaryKey(),
    plaidItemId: text("plaid_item_id").notNull(),
    environment: text("environment").notNull(),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    institutionName: text("institution_name").notNull().default("Bank connection"),
    status: text("status").notNull().default("Connected"),
    cursor: text("cursor").notNull().default(""),
    lastSyncedAt: text("last_synced_at"),
    lastNotice: text("last_notice").notNull().default(""),
    lockId: text("lock_id").notNull().default(""),
    lockExpiresAt: text("lock_expires_at").notNull().default(""),
    createdEmail: text("created_email").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("accounting_plaid_item_provider_idx").on(table.environment, table.plaidItemId),
  ],
);

export const accountingPlaidAccounts = sqliteTable(
  "accounting_plaid_accounts",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull(),
    plaidAccountId: text("plaid_account_id").notNull(),
    cashAccountId: text("cash_account_id"),
    name: text("name").notNull(),
    mask: text("mask").notNull().default(""),
    accountType: text("account_type").notNull(),
    subtype: text("subtype").notNull().default(""),
    currency: text("currency").notNull().default("USD"),
    currentCents: integer("current_cents"),
    availableCents: integer("available_cents"),
    limitCents: integer("limit_cents"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("accounting_plaid_account_provider_idx").on(table.itemId, table.plaidAccountId),
    uniqueIndex("accounting_plaid_account_cash_idx").on(table.cashAccountId),
  ],
);

export const accountingPlaidSessions = sqliteTable(
  "accounting_plaid_sessions",
  {
    id: text("id").primaryKey(),
    actorEmail: text("actor_email").notNull(),
    environment: text("environment").notNull(),
    mode: text("mode").notNull(),
    itemId: text("item_id"),
    encryptedLinkToken: text("encrypted_link_token").notNull(),
    status: text("status").notNull().default("Open"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("accounting_plaid_session_actor_idx").on(table.actorEmail, table.createdAt),
  ],
);
