CREATE TABLE `runtime_failure_events` (
	`id` text PRIMARY KEY NOT NULL,
	`route` text NOT NULL,
	`status` integer NOT NULL,
	`failure_key` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`actor_email` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runtime_failure_events_window_idx` ON `runtime_failure_events` (`failure_key`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `runtime_failure_events_route_idx` ON `runtime_failure_events` (`route`,`status`,`occurred_at`);