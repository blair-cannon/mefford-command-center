PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`number` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`site` text NOT NULL,
	`owner_name` text NOT NULL,
	`owner_contract_date` text NOT NULL,
	`owner_contract_type` text DEFAULT 'Plan & Spec Lump Sum' NOT NULL,
	`owner_contract_status` text DEFAULT 'Draft' NOT NULL,
	`owner_contract_record_id` text DEFAULT '' NOT NULL,
	`payment_terms` text DEFAULT '' NOT NULL,
	`retainage_initial_percent` text DEFAULT '10' NOT NULL,
	`retainage_after_half_percent` text DEFAULT '5' NOT NULL,
	`architect` text DEFAULT '' NOT NULL,
	`project_type` text NOT NULL,
	`contract_amount` text DEFAULT '' NOT NULL,
	`current_contract_amount` text DEFAULT '' NOT NULL,
	`start_date` text NOT NULL,
	`substantial_date` text NOT NULL,
	`final_date` text NOT NULL,
	`time_zone` text DEFAULT 'America/New_York' NOT NULL,
	`latitude_millionths` integer,
	`longitude_millionths` integer,
	`project_manager` text NOT NULL,
	`superintendent` text NOT NULL,
	`camera_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects`("number", "name", "status", "site", "owner_name", "owner_contract_date", "owner_contract_type", "owner_contract_status", "owner_contract_record_id", "payment_terms", "retainage_initial_percent", "retainage_after_half_percent", "architect", "project_type", "contract_amount", "current_contract_amount", "start_date", "substantial_date", "final_date", "time_zone", "latitude_millionths", "longitude_millionths", "project_manager", "superintendent", "camera_count", "created_at", "updated_at") SELECT "number", "name", "status", "site", "owner_name", "owner_contract_date", "owner_contract_type", "owner_contract_status", "owner_contract_record_id", "payment_terms", "retainage_initial_percent", "retainage_after_half_percent", "architect", "project_type", "contract_amount", "current_contract_amount", "start_date", "substantial_date", "final_date", "time_zone", "latitude_millionths", "longitude_millionths", "project_manager", "superintendent", "camera_count", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;