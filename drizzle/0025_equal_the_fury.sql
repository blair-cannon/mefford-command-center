ALTER TABLE `owner_deletion_requests` ADD `purge_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `owner_deletion_requests` ADD `purge_confirmed_by_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `owner_deletion_requests` ADD `manifest_purged_at` text;--> statement-breakpoint
ALTER TABLE `owner_deletion_requests` ADD `operation_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `owner_deletion_requests` ADD `operation_started_at` text;--> statement-breakpoint
ALTER TABLE `owner_deletion_requests` ADD `operation_actor_email` text DEFAULT '' NOT NULL;