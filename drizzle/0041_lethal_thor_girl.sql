CREATE TABLE IF NOT EXISTS `microsoft_entra_auth_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`actor_email` text NOT NULL,
	`provider_subject` text NOT NULL,
	`microsoft_email` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT 'Started' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `microsoft_entra_auth_expiry_idx` ON `microsoft_entra_auth_transactions` (`expires_at`,`consumed_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `microsoft_entra_identity_proofs` (
	`provider_subject` text PRIMARY KEY NOT NULL,
	`command_actor_email` text NOT NULL,
	`microsoft_email` text NOT NULL,
	`tenant_id` text NOT NULL,
	`auth_method` text DEFAULT 'Authorization Code + PKCE' NOT NULL,
	`verified_at` text NOT NULL,
	`last_verified_at` text NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `microsoft_entra_identity_actor_idx` ON `microsoft_entra_identity_proofs` (`command_actor_email`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `microsoft_entra_identity_email_idx` ON `microsoft_entra_identity_proofs` (`microsoft_email`);