CREATE TABLE `change_order_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`root_id` text NOT NULL,
	`record_id` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`snapshot_json` text DEFAULT '{}' NOT NULL,
	`request_json` text DEFAULT '{}' NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_order_evidence_case_idx` ON `change_order_evidence` (`project_id`,`root_id`,`created_at`);