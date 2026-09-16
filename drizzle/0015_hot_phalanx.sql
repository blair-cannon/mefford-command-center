CREATE TABLE `owner_contract_change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`contract_record_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`clause_key` text NOT NULL,
	`request_type` text NOT NULL,
	`original_text` text DEFAULT '' NOT NULL,
	`proposed_text` text DEFAULT '' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`mefford_response` text DEFAULT '' NOT NULL,
	`created_by_name` text NOT NULL,
	`created_by_email` text NOT NULL,
	`resolved_by_name` text DEFAULT '' NOT NULL,
	`resolved_by_email` text DEFAULT '' NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `owner_contract_change_project_idx` ON `owner_contract_change_requests` (`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `owner_contract_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`contract_record_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`phase` text NOT NULL,
	`contract_type` text NOT NULL,
	`fields_json` text DEFAULT '{}' NOT NULL,
	`snapshot_hash` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by_type` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_by_email` text NOT NULL,
	`frozen_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owner_contract_revision_number_idx` ON `owner_contract_revisions` (`project_id`,`contract_record_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `owner_contract_revision_project_idx` ON `owner_contract_revisions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `owner_portal_access` (
	`project_id` text PRIMARY KEY NOT NULL,
	`contract_record_id` text NOT NULL,
	`status` text DEFAULT 'Dormant' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`contact_email` text DEFAULT '' NOT NULL,
	`approved_revision_id` text DEFAULT '' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`invited_at` text,
	`last_review_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `owner_portal_access_status_idx` ON `owner_portal_access` (`status`);--> statement-breakpoint
CREATE TABLE `owner_portal_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`contract_record_id` text DEFAULT '' NOT NULL,
	`actor_type` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `owner_portal_audit_project_idx` ON `owner_portal_audits` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `owner_portal_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`contract_record_id` text NOT NULL,
	`contact_name` text NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`status` text DEFAULT 'Issued' NOT NULL,
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
CREATE INDEX `owner_portal_invites_project_idx` ON `owner_portal_invites` (`project_id`);--> statement-breakpoint
CREATE INDEX `owner_portal_invites_email_idx` ON `owner_portal_invites` (`email`);