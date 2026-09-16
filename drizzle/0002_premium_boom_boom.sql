CREATE TABLE `command_work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`project_id` text DEFAULT 'MEFFORD-COMPANY' NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_email` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`priority` text DEFAULT 'Normal' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`source_type` text DEFAULT 'Notification' NOT NULL,
	`source_record_id` text DEFAULT '' NOT NULL,
	`action_target` text DEFAULT 'Dashboard' NOT NULL,
	`due_at` text,
	`snoozed_until` text,
	`read_at` text,
	`acknowledged_at` text,
	`completed_at` text,
	`escalated_at` text,
	`escalation_level` integer DEFAULT 0 NOT NULL,
	`created_by` text DEFAULT 'Command Center' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_work_items_dedupe_key_unique` ON `command_work_items` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `command_work_items_recipient_status_idx` ON `command_work_items` (`recipient_email`,`status`);--> statement-breakpoint
CREATE INDEX `command_work_items_due_idx` ON `command_work_items` (`due_at`);--> statement-breakpoint
CREATE TABLE `notification_delivery_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dedupe_key` text NOT NULL,
	`work_item_id` text NOT NULL,
	`recipient_email` text NOT NULL,
	`channel` text DEFAULT 'Email' NOT NULL,
	`event_type` text NOT NULL,
	`status` text DEFAULT 'Queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` text,
	`error` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_events_dedupe_key_unique` ON `notification_delivery_events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_delivery_status_idx` ON `notification_delivery_events` (`status`,`channel`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`recipient_email` text PRIMARY KEY NOT NULL,
	`in_app_enabled` integer DEFAULT true NOT NULL,
	`email_enabled` integer DEFAULT true NOT NULL,
	`quiet_hours_enabled` integer DEFAULT false NOT NULL,
	`quiet_start` text DEFAULT '19:00' NOT NULL,
	`quiet_end` text DEFAULT '07:00' NOT NULL,
	`digest_mode` text DEFAULT 'Immediate' NOT NULL,
	`time_zone` text DEFAULT 'America/New_York' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `work_item_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_item_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_item_audits_item_idx` ON `work_item_audits` (`work_item_id`);