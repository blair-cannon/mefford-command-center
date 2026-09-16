CREATE TABLE `scheduled_operation_dead_letters` (
	`run_id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`failure_type` text NOT NULL,
	`error_message` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`opened_at` text NOT NULL,
	`last_failed_at` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`recovered_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_operation_dead_letters_status_idx` ON `scheduled_operation_dead_letters` (`status`,`last_failed_at`);--> statement-breakpoint
CREATE TABLE `scheduled_operation_gaps` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`first_missing_at` text NOT NULL,
	`last_missing_at` text NOT NULL,
	`missing_count` integer NOT NULL,
	`detected_at` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_operation_gaps_status_idx` ON `scheduled_operation_gaps` (`status`,`detected_at`);--> statement-breakpoint
CREATE TABLE `scheduled_operation_leases` (
	`run_id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`lease_token` text NOT NULL,
	`lease_owner` text NOT NULL,
	`lease_expires_at` text NOT NULL,
	`heartbeat_at` text NOT NULL,
	`state` text DEFAULT 'Active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_operation_leases_expiry_idx` ON `scheduled_operation_leases` (`state`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `scheduler_trigger_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`cron` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`received_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduler_trigger_receipts_source_idx` ON `scheduler_trigger_receipts` (`source`,`scheduled_at`);