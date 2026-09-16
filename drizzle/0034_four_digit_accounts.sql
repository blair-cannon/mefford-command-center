CREATE TABLE `accounting_account_number_crosswalk` (
	`legacy_number` text PRIMARY KEY NOT NULL,
	`account_number` text NOT NULL,
	`policy_version` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounting_account_number_crosswalk_account_number_unique` ON `accounting_account_number_crosswalk` (`account_number`);
--> statement-breakpoint
WITH RECURSIVE legacy(number) AS (SELECT 100 UNION ALL SELECT number + 1 FROM legacy WHERE number < 999)
INSERT INTO accounting_account_number_crosswalk (legacy_number, account_number, policy_version)
SELECT CAST(number AS TEXT), CAST(number * 10 AS TEXT), 'MEFFCON-4-DIGIT-2026-09' FROM legacy;
--> statement-breakpoint
-- Preserve record keys, approval status, financial entries, and existing audit links.
UPDATE command_records SET data_json = json_set(CASE WHEN json_valid(data_json) THEN data_json ELSE '{}' END,
  '$.accountNumber', id || '0', '$.legacyAccountNumber', id, '$.numberingPolicy', 'MEFFCON-4-DIGIT-2026-09')
WHERE project_id = 'MEFFORD-ACCOUNTING' AND record_type = 'Chart Of Accounts' AND id GLOB '[1-9][0-9][0-9]';
