CREATE TABLE `owner_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target_name` text NOT NULL,
	`state` text DEFAULT 'Quarantined' NOT NULL,
	`phase` text DEFAULT 'Snapshot Verified' NOT NULL,
	`manifest_storage_key` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`manifest_counts_json` text DEFAULT '{}' NOT NULL,
	`requested_by_name` text NOT NULL,
	`requested_by_email` text NOT NULL,
	`requested_at` text NOT NULL,
	`purge_after` text NOT NULL,
	`restored_at` text,
	`restored_by_email` text DEFAULT '' NOT NULL,
	`purge_started_at` text,
	`database_purged_at` text,
	`storage_purged_at` text,
	`completed_at` text,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `owner_deletion_requests_target_idx` ON `owner_deletion_requests` (`target_kind`,`target_id`,`state`);--> statement-breakpoint
CREATE INDEX `owner_deletion_requests_purge_idx` ON `owner_deletion_requests` (`state`,`purge_after`);