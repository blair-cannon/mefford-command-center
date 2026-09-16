CREATE TABLE `command_identity_aliases` (
	`alias_email` text PRIMARY KEY NOT NULL,
	`canonical_email` text NOT NULL,
	`alias_purpose` text DEFAULT 'Temporary Authentication Bridge' NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL,
	`verified_by` text DEFAULT '' NOT NULL,
	`verified_at` text,
	`disable_after_microsoft_cutover` integer DEFAULT true NOT NULL,
	`disabled_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `command_identity_aliases_canonical_idx` ON `command_identity_aliases` (`canonical_email`,`is_verified`);
--> statement-breakpoint
INSERT INTO `command_identity_aliases` (`alias_email`, `canonical_email`, `alias_purpose`, `is_verified`, `verified_by`, `verified_at`, `disable_after_microsoft_cutover`)
VALUES ('djmeff22@gmail.com', 'jmefford@meffcon.com', 'Temporary ChatGPT And Sites Authentication Bridge Only', 1, 'Controlled F-08 Identity Migration', CURRENT_TIMESTAMP, 1)
ON CONFLICT(`alias_email`) DO UPDATE SET
  `canonical_email` = excluded.`canonical_email`,
  `alias_purpose` = excluded.`alias_purpose`,
  `is_verified` = 1,
  `verified_by` = excluded.`verified_by`,
  `verified_at` = excluded.`verified_at`,
  `disable_after_microsoft_cutover` = 1,
  `disabled_at` = NULL,
  `updated_at` = CURRENT_TIMESTAMP;
--> statement-breakpoint
UPDATE `command_work_items` SET `recipient_email` = 'jmefford@meffcon.com', `updated_at` = CURRENT_TIMESTAMP WHERE lower(`recipient_email`) = 'djmeff22@gmail.com';
--> statement-breakpoint
UPDATE `command_notifications` SET `recipient_email` = 'jmefford@meffcon.com' WHERE lower(`recipient_email`) = 'djmeff22@gmail.com';
--> statement-breakpoint
UPDATE `record_audits` SET `actor_email` = 'jmefford@meffcon.com' WHERE lower(`actor_email`) = 'djmeff22@gmail.com';
--> statement-breakpoint
UPDATE `work_item_audits` SET `actor_email` = 'jmefford@meffcon.com' WHERE lower(`actor_email`) = 'djmeff22@gmail.com';
--> statement-breakpoint
UPDATE `assistant_audits` SET `actor_email` = 'jmefford@meffcon.com' WHERE lower(`actor_email`) = 'djmeff22@gmail.com';
--> statement-breakpoint
UPDATE `microsoft_access_audits` SET `actor_email` = 'jmefford@meffcon.com' WHERE lower(`actor_email`) = 'djmeff22@gmail.com';
--> statement-breakpoint
UPDATE `microsoft_activity_audits` SET `command_actor_email` = 'jmefford@meffcon.com' WHERE lower(`command_actor_email`) = 'djmeff22@gmail.com';
--> statement-breakpoint
UPDATE `owner_contract_revisions` SET `created_by_email` = 'jmefford@meffcon.com' WHERE lower(`created_by_email`) = 'djmeff22@gmail.com';
--> statement-breakpoint
UPDATE `owner_portal_audits` SET `actor_email` = 'jmefford@meffcon.com' WHERE lower(`actor_email`) = 'djmeff22@gmail.com';
