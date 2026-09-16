CREATE TABLE `meeting_turnover_recovery` (
	`source_id` text PRIMARY KEY NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`attempted_at` text NOT NULL,
	`retry_after` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meeting_turnovers` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_type` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`occurrence_id` text NOT NULL,
	`status` text DEFAULT 'Preparation' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`snapshot_json` text DEFAULT '{}' NOT NULL,
	`reviewed_json` text DEFAULT '[]' NOT NULL,
	`accepted_snapshot_json` text DEFAULT '{}' NOT NULL,
	`accepted_by` text DEFAULT '' NOT NULL,
	`accepted_at` text DEFAULT '' NOT NULL,
	`ntp_reference` text DEFAULT '' NOT NULL,
	`scheduled_confirmed` integer DEFAULT 0 NOT NULL,
	`checked_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_turnovers_occurrence_id_unique` ON `meeting_turnovers` (`occurrence_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_turnover_source_idx` ON `meeting_turnovers` (`meeting_type`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `meeting_turnover_queue_idx` ON `meeting_turnovers` (`checked_at`,`id`);