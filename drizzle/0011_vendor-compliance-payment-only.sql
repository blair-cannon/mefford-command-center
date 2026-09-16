PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_vendor_project_access` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`trade` text DEFAULT '' NOT NULL,
	`contract_reference` text DEFAULT '' NOT NULL,
	`cost_code` text DEFAULT '' NOT NULL,
	`committed_amount` text DEFAULT '0' NOT NULL,
	`permissions_json` text DEFAULT '[]' NOT NULL,
	`shared_records_json` text DEFAULT '[]' NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_vendor_project_access`("id", "vendor_id", "project_id", "project_name", "status", "trade", "contract_reference", "cost_code", "committed_amount", "permissions_json", "shared_records_json", "granted_by", "created_at", "updated_at") SELECT "id", "vendor_id", "project_id", "project_name", "status", "trade", "contract_reference", "cost_code", "committed_amount", "permissions_json", "shared_records_json", "granted_by", "created_at", "updated_at" FROM `vendor_project_access`;--> statement-breakpoint
DROP TABLE `vendor_project_access`;--> statement-breakpoint
ALTER TABLE `__new_vendor_project_access` RENAME TO `vendor_project_access`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `vendor_project_access_vendor_idx` ON `vendor_project_access` (`vendor_id`);--> statement-breakpoint
CREATE INDEX `vendor_project_access_project_idx` ON `vendor_project_access` (`project_id`);--> statement-breakpoint
UPDATE `vendor_project_access`
SET `status` = 'Active', `updated_at` = CURRENT_TIMESTAMP
WHERE `status` = 'Compliance Blocked';
