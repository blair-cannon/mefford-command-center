CREATE TABLE `dashboard_display_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_display_credentials` (
	`email` text PRIMARY KEY NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`iterations` integer DEFAULT 100000 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_display_login_failures` (
	`fingerprint_hash` text NOT NULL,
	`failed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dashboard_display_login_failures_lookup_idx` ON `dashboard_display_login_failures` (`fingerprint_hash`,`failed_at`);--> statement-breakpoint
CREATE TABLE `dashboard_display_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dashboard_display_sessions_expiry_idx` ON `dashboard_display_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `owner_deletion_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target_name` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`counts_json` text DEFAULT '{}' NOT NULL,
	`deleted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sharepoint_file_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_file_id` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_key` text NOT NULL,
	`source_project_id` text NOT NULL,
	`source_storage_key` text NOT NULL,
	`source_name` text NOT NULL,
	`source_size_bytes` integer DEFAULT 0 NOT NULL,
	`drive_item_id` text DEFAULT '' NOT NULL,
	`web_url` text DEFAULT '' NOT NULL,
	`e_tag` text DEFAULT '' NOT NULL,
	`sha256` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'Local Primary · Mapping Pending' NOT NULL,
	`no_source_delete` integer DEFAULT true NOT NULL,
	`last_synced_at` text DEFAULT '' NOT NULL,
	`verified_at` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sharepoint_file_mappings_project_file_id_unique` ON `sharepoint_file_mappings` (`project_file_id`);--> statement-breakpoint
CREATE INDEX `sharepoint_file_state_idx` ON `sharepoint_file_mappings` (`state`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `sharepoint_folder_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`folder_key` text NOT NULL,
	`label` text NOT NULL,
	`parent_key` text DEFAULT '' NOT NULL,
	`relative_path` text NOT NULL,
	`permission_class` text NOT NULL,
	`drive_item_id` text DEFAULT '' NOT NULL,
	`web_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Mapping Pending' NOT NULL,
	`last_verified_at` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sharepoint_folder_workspace_key_idx` ON `sharepoint_folder_mappings` (`workspace_id`,`folder_key`);--> statement-breakpoint
CREATE INDEX `sharepoint_folder_status_idx` ON `sharepoint_folder_mappings` (`status`,`permission_class`);--> statement-breakpoint
CREATE TABLE `sharepoint_sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT '' NOT NULL,
	`file_mapping_id` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text DEFAULT '' NOT NULL,
	`provider_id` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sharepoint_sync_event_status_idx` ON `sharepoint_sync_events` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `sharepoint_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`display_name` text NOT NULL,
	`library_key` text NOT NULL,
	`logical_root_path` text NOT NULL,
	`source_project_id` text DEFAULT '' NOT NULL,
	`source_record_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Mapping Pending' NOT NULL,
	`site_id` text DEFAULT '' NOT NULL,
	`drive_id` text DEFAULT '' NOT NULL,
	`root_item_id` text DEFAULT '' NOT NULL,
	`web_url` text DEFAULT '' NOT NULL,
	`folder_manifest_json` text DEFAULT '[]' NOT NULL,
	`no_delete_guard` integer DEFAULT true NOT NULL,
	`last_attempt_at` text DEFAULT '' NOT NULL,
	`verified_at` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sharepoint_workspace_entity_idx` ON `sharepoint_workspaces` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `sharepoint_workspace_status_idx` ON `sharepoint_workspaces` (`status`,`entity_type`);--> statement-breakpoint
CREATE TABLE `system_data_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_by_email` text NOT NULL,
	`preservation_policy` text NOT NULL,
	`claim_token` text DEFAULT '' NOT NULL,
	`lease_expires_at` text DEFAULT '' NOT NULL,
	`inventory_json` text DEFAULT '{}' NOT NULL,
	`counts_json` text DEFAULT '{}' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`started_at` text DEFAULT '' NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
