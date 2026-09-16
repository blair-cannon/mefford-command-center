CREATE TABLE `project_bonus_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`snapshot_json` text NOT NULL,
	`source_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`pm_signature_json` text DEFAULT 'null' NOT NULL,
	`superintendent_signature_json` text DEFAULT 'null' NOT NULL,
	`file_id` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_bonus_revision_idx` ON `project_bonus_agreements` (`project_id`,`revision`);--> statement-breakpoint
CREATE TABLE `project_bonus_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`agreement_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_email` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_bonus_audit_agreement_idx` ON `project_bonus_audits` (`agreement_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_bonus_controls` (
	`project_id` text PRIMARY KEY NOT NULL,
	`current_id` text NOT NULL,
	`revision` integer NOT NULL,
	`occurrence_id` text NOT NULL,
	`closeout_at` text DEFAULT '' NOT NULL,
	`payment_status` text DEFAULT 'Awaiting Closeout' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_bonus_payment_idx` ON `project_bonus_controls` (`payment_status`,`project_id`);