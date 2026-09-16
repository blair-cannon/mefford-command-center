CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`event_type` text NOT NULL,
	`schema_version` integer NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`occurred_at` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_events_idempotency_idx` ON `domain_events` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `domain_events_status_idx` ON `domain_events` (`status`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `domain_events_aggregate_idx` ON `domain_events` (`aggregate_type`,`aggregate_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `domain_event_consumers` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`consumer_key` text NOT NULL,
	`mandatory` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`lease_expires_at` text DEFAULT '' NOT NULL,
	`next_attempt_at` text DEFAULT '' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`last_attempt_at` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_event_consumers_event_key_idx` ON `domain_event_consumers` (`event_id`,`consumer_key`);--> statement-breakpoint
CREATE INDEX `domain_event_consumers_work_idx` ON `domain_event_consumers` (`status`,`next_attempt_at`,`lease_expires_at`,`event_id`);--> statement-breakpoint
CREATE TABLE `domain_event_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`consumer_key` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`prior_status` text NOT NULL,
	`next_status` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `domain_event_audits_event_idx` ON `domain_event_audits` (`event_id`,`created_at`);
