CREATE TABLE `accounting_events` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`event_type` text NOT NULL,
	`source_type` text NOT NULL,
	`source_project_id` text DEFAULT '' NOT NULL,
	`source_record_id` text NOT NULL,
	`event_date` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'Posted' NOT NULL,
	`amount_cents` integer NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_events_idempotency_key_unique` ON `accounting_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `accounting_events_source_idx` ON `accounting_events` (`source_type`,`source_project_id`,`source_record_id`);--> statement-breakpoint
CREATE INDEX `accounting_events_date_idx` ON `accounting_events` (`event_date`,`event_type`);--> statement-breakpoint
CREATE TABLE `accounting_journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`entry_date` text NOT NULL,
	`period_id` text NOT NULL,
	`entry_type` text NOT NULL,
	`reference` text NOT NULL,
	`description` text NOT NULL,
	`support_reference` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`source_type` text DEFAULT 'Manual Journal' NOT NULL,
	`source_project_id` text DEFAULT '' NOT NULL,
	`source_record_id` text DEFAULT '' NOT NULL,
	`prepared_by` text NOT NULL,
	`prepared_email` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_email` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`posted_by` text DEFAULT '' NOT NULL,
	`posted_email` text DEFAULT '' NOT NULL,
	`posted_at` text,
	`reverses_entry_id` text DEFAULT '' NOT NULL,
	`total_debit_cents` integer DEFAULT 0 NOT NULL,
	`total_credit_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_journal_entries_event_id_unique` ON `accounting_journal_entries` (`event_id`);--> statement-breakpoint
CREATE INDEX `accounting_journal_period_status_idx` ON `accounting_journal_entries` (`period_id`,`status`,`entry_date`);--> statement-breakpoint
CREATE INDEX `accounting_journal_source_idx` ON `accounting_journal_entries` (`source_type`,`source_project_id`,`source_record_id`);--> statement-breakpoint
CREATE TABLE `accounting_journal_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`account_number` text NOT NULL,
	`account_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`cost_code` text DEFAULT '' NOT NULL,
	`source_allocation_id` text DEFAULT '' NOT NULL,
	`debit_cents` integer DEFAULT 0 NOT NULL,
	`credit_cents` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_journal_lines_entry_idx` ON `accounting_journal_lines` (`entry_id`,`line_number`);--> statement-breakpoint
CREATE INDEX `accounting_journal_lines_account_idx` ON `accounting_journal_lines` (`account_number`,`project_id`);--> statement-breakpoint
CREATE TABLE `accounting_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`soft_closed_by` text DEFAULT '' NOT NULL,
	`soft_closed_email` text DEFAULT '' NOT NULL,
	`soft_closed_at` text,
	`hard_closed_by` text DEFAULT '' NOT NULL,
	`hard_closed_email` text DEFAULT '' NOT NULL,
	`hard_closed_at` text,
	`reopened_by` text DEFAULT '' NOT NULL,
	`reopened_email` text DEFAULT '' NOT NULL,
	`reopened_at` text,
	`reopen_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_periods_status_idx` ON `accounting_periods` (`status`,`period_end`);