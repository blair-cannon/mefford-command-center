CREATE TABLE `vendor_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor_id` text NOT NULL,
	`submission_id` text DEFAULT '' NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_audits_vendor_idx` ON `vendor_audits` (`vendor_id`);--> statement-breakpoint
CREATE TABLE `vendor_compliance_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`kind` text NOT NULL,
	`effective_date` text,
	`expiration_date` text,
	`status` text DEFAULT 'Pending Review' NOT NULL,
	`storage_key` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` text,
	`review_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_compliance_vendor_kind_idx` ON `vendor_compliance_documents` (`vendor_id`,`kind`);--> statement-breakpoint
CREATE INDEX `vendor_compliance_expiration_idx` ON `vendor_compliance_documents` (`expiration_date`);--> statement-breakpoint
CREATE TABLE `vendor_compliance_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`project_id` text DEFAULT 'ALL' NOT NULL,
	`reason` text NOT NULL,
	`expires_at` text NOT NULL,
	`owner_name` text NOT NULL,
	`owner_email` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_overrides_vendor_idx` ON `vendor_compliance_overrides` (`vendor_id`);--> statement-breakpoint
CREATE TABLE `vendor_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`verified_at` text,
	`revoked_at` text,
	`session_hash` text,
	`session_expires_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_invites_vendor_idx` ON `vendor_invites` (`vendor_id`);--> statement-breakpoint
CREATE INDEX `vendor_invites_email_idx` ON `vendor_invites` (`email`);--> statement-breakpoint
CREATE TABLE `vendor_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`dba_name` text DEFAULT '' NOT NULL,
	`vendor_type` text DEFAULT 'Subcontractor' NOT NULL,
	`status` text DEFAULT 'Prospective' NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`contact_phone` text DEFAULT '' NOT NULL,
	`address_json` text DEFAULT '{}' NOT NULL,
	`trades_json` text DEFAULT '[]' NOT NULL,
	`service_areas_json` text DEFAULT '[]' NOT NULL,
	`payment_terms` text DEFAULT 'Net 30' NOT NULL,
	`tax_id_last_four` text DEFAULT '' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_profiles_status_idx` ON `vendor_profiles` (`status`);--> statement-breakpoint
CREATE TABLE `vendor_project_access` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`status` text DEFAULT 'Compliance Blocked' NOT NULL,
	`trade` text DEFAULT '' NOT NULL,
	`contract_reference` text DEFAULT '' NOT NULL,
	`cost_code` text DEFAULT '' NOT NULL,
	`committed_amount` text DEFAULT '0' NOT NULL,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`shared_records_json` text DEFAULT '[]' NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_project_access_vendor_idx` ON `vendor_project_access` (`vendor_id`);--> statement-breakpoint
CREATE INDEX `vendor_project_access_project_idx` ON `vendor_project_access` (`project_id`);--> statement-breakpoint
CREATE TABLE `vendor_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`project_id` text NOT NULL,
	`submission_type` text NOT NULL,
	`title` text NOT NULL,
	`amount` text DEFAULT '0' NOT NULL,
	`period_end` text,
	`status` text DEFAULT 'Submitted' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`attachment_storage_key` text DEFAULT '' NOT NULL,
	`attachment_name` text DEFAULT '' NOT NULL,
	`compliance_snapshot_json` text DEFAULT '{}' NOT NULL,
	`ap_record_id` text DEFAULT '' NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendor_submissions_vendor_idx` ON `vendor_submissions` (`vendor_id`);--> statement-breakpoint
CREATE INDEX `vendor_submissions_project_idx` ON `vendor_submissions` (`project_id`);--> statement-breakpoint
CREATE INDEX `vendor_submissions_status_idx` ON `vendor_submissions` (`status`);