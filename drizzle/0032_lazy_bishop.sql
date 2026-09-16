CREATE TABLE IF NOT EXISTS `automation_heartbeat_claims` (
	`bucket` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`actor_email` text NOT NULL,
	`claimed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `automation_heartbeat_claims_claimed_idx` ON `automation_heartbeat_claims` (`claimed_at`);
