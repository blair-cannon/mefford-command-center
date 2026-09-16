CREATE TABLE IF NOT EXISTS `scheduled_operation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`cadence` text NOT NULL,
	`cron` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Running' NOT NULL,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scheduled_operation_runs_job_idx` ON `scheduled_operation_runs` (`job_name`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scheduled_operation_runs_status_idx` ON `scheduled_operation_runs` (`status`,`scheduled_at`);
