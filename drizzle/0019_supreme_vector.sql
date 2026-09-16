CREATE TABLE `microsoft_graph_subscription_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`expiration_date_time` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `microsoft_graph_subscription_audits_subscription_idx` ON `microsoft_graph_subscription_audits` (`subscription_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `microsoft_graph_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`resource` text NOT NULL,
	`change_type` text NOT NULL,
	`notification_url` text NOT NULL,
	`expiration_date_time` text NOT NULL,
	`client_state_hash` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`last_renewed_at` text DEFAULT '' NOT NULL,
	`last_notification_at` text DEFAULT '' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `microsoft_graph_subscriptions_resource_idx` ON `microsoft_graph_subscriptions` (`resource`);--> statement-breakpoint
CREATE INDEX `microsoft_graph_subscriptions_expiry_idx` ON `microsoft_graph_subscriptions` (`status`,`expiration_date_time`);