CREATE TABLE `proposal_customer_branding` (
	`company_key` text PRIMARY KEY NOT NULL,
	`company_name` text NOT NULL,
	`logo_file_id` integer,
	`status` text DEFAULT 'Approved' NOT NULL,
	`approved_by_email` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proposal_customer_branding_name_idx` ON `proposal_customer_branding` (`company_name`);--> statement-breakpoint
CREATE TABLE `proposal_profiles` (
	`employee_email` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`company_title` text DEFAULT '' NOT NULL,
	`proposal_role_label` text DEFAULT '' NOT NULL,
	`professional_summary` text DEFAULT '' NOT NULL,
	`credentials_json` text DEFAULT '[]' NOT NULL,
	`sectors_json` text DEFAULT '[]' NOT NULL,
	`delivery_methods_json` text DEFAULT '[]' NOT NULL,
	`prior_experience_json` text DEFAULT '[]' NOT NULL,
	`headshot_file_id` integer,
	`leadership_profile` integer DEFAULT false NOT NULL,
	`include_by_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`submitted_at` text,
	`approved_by_email` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`updated_by_email` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `proposal_profiles_status_idx` ON `proposal_profiles` (`status`,`leadership_profile`);--> statement-breakpoint
CREATE TABLE `proposal_project_experience` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`employee_email` text NOT NULL,
	`role` text NOT NULL,
	`project_name` text NOT NULL,
	`project_location` text DEFAULT '' NOT NULL,
	`project_type` text DEFAULT '' NOT NULL,
	`delivery_method` text DEFAULT '' NOT NULL,
	`completion_date` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`photo_file_ids_json` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'Project Assignment' NOT NULL,
	`customer_permission` text DEFAULT 'Review Required' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`approved_by_email` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposal_project_experience_identity_idx` ON `proposal_project_experience` (`project_id`,`employee_email`,`role`);--> statement-breakpoint
CREATE INDEX `proposal_project_experience_employee_idx` ON `proposal_project_experience` (`employee_email`,`status`);