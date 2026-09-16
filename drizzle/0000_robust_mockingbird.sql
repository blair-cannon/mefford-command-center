CREATE TABLE `command_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_email` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `command_notifications_recipient_idx` ON `command_notifications` (`project_id`,`recipient_name`,`is_read`);--> statement-breakpoint
CREATE TABLE `command_records` (
	`project_id` text NOT NULL,
	`id` text NOT NULL,
	`record_type` text NOT NULL,
	`title` text NOT NULL,
	`owner` text NOT NULL,
	`due` text NOT NULL,
	`status` text NOT NULL,
	`meta` text DEFAULT '' NOT NULL,
	`record_date` text,
	`record_time` text,
	`date_locked` integer DEFAULT false NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`project_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `command_records_project_type_idx` ON `command_records` (`project_id`,`record_type`);--> statement-breakpoint
CREATE TABLE `company_members` (
	`email` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`company_access_level` text NOT NULL,
	`designations_json` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`identity_provider` text DEFAULT 'microsoft_entra_pending' NOT NULL,
	`provider_subject` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`revision` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`access` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_files_storage_key_unique` ON `project_files` (`storage_key`);--> statement-breakpoint
CREATE INDEX `project_files_project_idx` ON `project_files` (`project_id`);--> statement-breakpoint
CREATE TABLE `record_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`record_id` text NOT NULL,
	`field_name` text NOT NULL,
	`old_value` text NOT NULL,
	`new_value` text NOT NULL,
	`reason` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `record_audits_record_idx` ON `record_audits` (`project_id`,`record_id`);