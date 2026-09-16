CREATE TABLE `owner_approval_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`approval_item_id` text NOT NULL,
	`project_id` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_record_type` text NOT NULL,
	`source_updated_at` text NOT NULL,
	`decision` text NOT NULL,
	`decision_note` text DEFAULT '' NOT NULL,
	`risk_level` text NOT NULL,
	`amount_cents` integer DEFAULT 0 NOT NULL,
	`packet_json` text NOT NULL,
	`packet_sha256` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`status` text DEFAULT 'Pending Dispatch' NOT NULL,
	`dispatch_result` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `owner_approval_snapshots_source_idx` ON `owner_approval_snapshots` (`project_id`,`source_record_id`);--> statement-breakpoint
CREATE INDEX `owner_approval_snapshots_actor_idx` ON `owner_approval_snapshots` (`actor_email`,`created_at`);