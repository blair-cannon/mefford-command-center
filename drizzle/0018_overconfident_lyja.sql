CREATE TABLE `microsoft_access_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_subject` text NOT NULL,
	`microsoft_email` text NOT NULL,
	`action` text NOT NULL,
	`prior_status` text DEFAULT '' NOT NULL,
	`next_status` text DEFAULT '' NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_type` text DEFAULT 'Human' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`sync_run_id` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `microsoft_access_audits_subject_idx` ON `microsoft_access_audits` (`provider_subject`,`created_at`);--> statement-breakpoint
CREATE INDEX `microsoft_access_audits_actor_idx` ON `microsoft_access_audits` (`actor_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `microsoft_access_grants` (
	`provider_subject` text PRIMARY KEY NOT NULL,
	`microsoft_email` text NOT NULL,
	`access_status` text DEFAULT 'No Access' NOT NULL,
	`company_access_level` text DEFAULT 'Employee' NOT NULL,
	`designations_json` text DEFAULT '[]' NOT NULL,
	`project_scopes_json` text DEFAULT '[]' NOT NULL,
	`previous_access_status` text DEFAULT 'No Access' NOT NULL,
	`owner_approved_by_name` text DEFAULT '' NOT NULL,
	`owner_approved_by_email` text DEFAULT '' NOT NULL,
	`owner_approved_at` text,
	`activated_at` text,
	`last_sign_in_at` text,
	`suspended_at` text,
	`revoked_at` text,
	`decision_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microsoft_access_grants_email_idx` ON `microsoft_access_grants` (`microsoft_email`);--> statement-breakpoint
CREATE INDEX `microsoft_access_grants_status_idx` ON `microsoft_access_grants` (`access_status`);--> statement-breakpoint
CREATE TABLE `microsoft_activity_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_subject` text DEFAULT '' NOT NULL,
	`microsoft_email` text NOT NULL,
	`command_actor_email` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `microsoft_activity_audits_email_idx` ON `microsoft_activity_audits` (`microsoft_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `microsoft_activity_audits_status_idx` ON `microsoft_activity_audits` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `microsoft_directory_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text DEFAULT 'Running' NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`disabled_count` integer DEFAULT 0 NOT NULL,
	`missing_count` integer DEFAULT 0 NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `microsoft_directory_sync_runs_status_idx` ON `microsoft_directory_sync_runs` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `microsoft_directory_users` (
	`provider_subject` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`user_principal_name` text NOT NULL,
	`mail` text DEFAULT '' NOT NULL,
	`job_title` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`user_type` text DEFAULT 'Member' NOT NULL,
	`account_enabled` integer DEFAULT true NOT NULL,
	`directory_present` integer DEFAULT true NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_sync_run_id` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microsoft_directory_users_upn_idx` ON `microsoft_directory_users` (`user_principal_name`);--> statement-breakpoint
CREATE INDEX `microsoft_directory_users_access_idx` ON `microsoft_directory_users` (`directory_present`,`account_enabled`,`user_type`);