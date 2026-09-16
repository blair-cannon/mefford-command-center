CREATE TABLE `scheduler_cycle_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`group_name` text NOT NULL,
	`group_index` integer NOT NULL,
	`status` text DEFAULT 'Running' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`next_group_index` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduler_cycle_checkpoints_status_idx` ON `scheduler_cycle_checkpoints` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `scheduler_cycle_checkpoints_source_idx` ON `scheduler_cycle_checkpoints` (`source`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `scheduler_cycle_cursors` (
	`source` text PRIMARY KEY NOT NULL,
	`next_group_index` integer DEFAULT 0 NOT NULL,
	`last_group_name` text DEFAULT '' NOT NULL,
	`last_checkpoint_at` text DEFAULT '' NOT NULL,
	`last_cycle_id` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
