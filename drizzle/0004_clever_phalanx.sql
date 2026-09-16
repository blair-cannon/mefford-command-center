CREATE TABLE `mobile_device_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`user_email` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mobile_device_audits_session_idx` ON `mobile_device_audits` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `mobile_device_audits_user_idx` ON `mobile_device_audits` (`user_email`);--> statement-breakpoint
CREATE TABLE `mobile_device_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_email` text NOT NULL,
	`user_name` text NOT NULL,
	`device_fingerprint` text NOT NULL,
	`device_name` text NOT NULL,
	`platform` text NOT NULL,
	`status` text DEFAULT 'Trusted' NOT NULL,
	`biometric_credential_id` text DEFAULT '' NOT NULL,
	`biometric_public_key` text DEFAULT '' NOT NULL,
	`biometric_algorithm` integer DEFAULT -7 NOT NULL,
	`biometric_sign_count` integer DEFAULT 0 NOT NULL,
	`biometric_rp_id` text DEFAULT '' NOT NULL,
	`pending_challenge` text DEFAULT '' NOT NULL,
	`challenge_expires_at` text,
	`push_subscription_json` text DEFAULT '' NOT NULL,
	`push_enabled` integer DEFAULT false NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`offline_expires_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mobile_device_sessions_user_idx` ON `mobile_device_sessions` (`user_email`,`status`);--> statement-breakpoint
CREATE INDEX `mobile_device_sessions_fingerprint_idx` ON `mobile_device_sessions` (`device_fingerprint`);
