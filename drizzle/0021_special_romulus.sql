CREATE TABLE `microsoft_graph_webhook_rate_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`source_hash` text DEFAULT '' NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`blocked_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `microsoft_graph_webhook_rate_window_idx` ON `microsoft_graph_webhook_rate_limits` (`window_started_at`);--> statement-breakpoint
CREATE TABLE `microsoft_graph_webhook_security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`outcome` text NOT NULL,
	`reason_code` text NOT NULL,
	`source_hash` text DEFAULT '' NOT NULL,
	`request_id` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`occurrence_count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `microsoft_graph_webhook_security_outcome_idx` ON `microsoft_graph_webhook_security_events` (`outcome`,`last_seen_at`);--> statement-breakpoint
CREATE INDEX `microsoft_graph_webhook_security_reason_idx` ON `microsoft_graph_webhook_security_events` (`reason_code`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `microsoft_graph_webhook_validation_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`closed_at` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `microsoft_graph_webhook_windows_status_idx` ON `microsoft_graph_webhook_validation_windows` (`status`,`expires_at`);