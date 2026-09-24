CREATE TABLE `accounting_plaid_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`plaid_account_id` text NOT NULL,
	`cash_account_id` text,
	`name` text NOT NULL,
	`mask` text DEFAULT '' NOT NULL,
	`account_type` text NOT NULL,
	`subtype` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`current_cents` integer,
	`available_cents` integer,
	`limit_cents` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_plaid_account_provider_idx` ON `accounting_plaid_accounts` (`item_id`,`plaid_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_plaid_account_cash_idx` ON `accounting_plaid_accounts` (`cash_account_id`);--> statement-breakpoint
CREATE TABLE `accounting_plaid_items` (
	`id` text PRIMARY KEY NOT NULL,
	`plaid_item_id` text NOT NULL,
	`environment` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`institution_name` text DEFAULT 'Bank connection' NOT NULL,
	`status` text DEFAULT 'Connected' NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`last_synced_at` text,
	`last_notice` text DEFAULT '' NOT NULL,
	`lock_id` text DEFAULT '' NOT NULL,
	`lock_expires_at` text DEFAULT '' NOT NULL,
	`created_email` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_plaid_item_provider_idx` ON `accounting_plaid_items` (`environment`,`plaid_item_id`);--> statement-breakpoint
CREATE TABLE `accounting_plaid_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`environment` text NOT NULL,
	`mode` text NOT NULL,
	`item_id` text,
	`encrypted_link_token` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_plaid_session_actor_idx` ON `accounting_plaid_sessions` (`actor_email`,`created_at`);