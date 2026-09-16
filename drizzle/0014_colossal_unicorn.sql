CREATE TABLE `employee_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`feedback_type` text NOT NULL,
	`employee_email` text DEFAULT '' NOT NULL,
	`employee_name` text DEFAULT 'Anonymous Employee' NOT NULL,
	`recipient_email` text DEFAULT '' NOT NULL,
	`rating` integer,
	`note` text NOT NULL,
	`status` text DEFAULT 'Received' NOT NULL,
	`routed_role` text DEFAULT 'Human Resources' NOT NULL,
	`confidential` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `employee_feedback_type_idx` ON `employee_feedback` (`feedback_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `employee_feedback_recipient_idx` ON `employee_feedback` (`recipient_email`,`created_at`);--> statement-breakpoint
CREATE TABLE `employee_leave_balances` (
	`employee_email` text NOT NULL,
	`plan_year` integer NOT NULL,
	`available_hours` integer DEFAULT 0 NOT NULL,
	`used_hours` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'Administrator Entry' NOT NULL,
	`updated_by_email` text NOT NULL,
	`updated_by_name` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`employee_email`, `plan_year`)
);
--> statement-breakpoint
CREATE INDEX `employee_leave_balance_year_idx` ON `employee_leave_balances` (`plan_year`);--> statement-breakpoint
CREATE TABLE `employee_leave_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_email` text NOT NULL,
	`employee_name` text NOT NULL,
	`leave_type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`requested_hours` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Pending Review' NOT NULL,
	`routed_role` text DEFAULT 'Company Owner / Administrator' NOT NULL,
	`approver_email` text DEFAULT '' NOT NULL,
	`approver_name` text DEFAULT '' NOT NULL,
	`decided_at` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`calendar_event_id` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `employee_leave_request_employee_idx` ON `employee_leave_requests` (`employee_email`,`start_date`);--> statement-breakpoint
CREATE INDEX `employee_leave_request_status_idx` ON `employee_leave_requests` (`status`,`start_date`);--> statement-breakpoint
CREATE TABLE `employee_profiles` (
	`employee_email` text PRIMARY KEY NOT NULL,
	`preferred_name` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address_1` text DEFAULT '' NOT NULL,
	`address_2` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`emergency_contact_name` text DEFAULT '' NOT NULL,
	`emergency_contact_phone` text DEFAULT '' NOT NULL,
	`emergency_contact_relationship` text DEFAULT '' NOT NULL,
	`shirt_size` text DEFAULT '' NOT NULL,
	`jacket_size` text DEFAULT '' NOT NULL,
	`vest_size` text DEFAULT '' NOT NULL,
	`communication_preference` text DEFAULT 'Email' NOT NULL,
	`professional_bio` text DEFAULT '' NOT NULL,
	`updated_by_email` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employee_service_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_email` text NOT NULL,
	`employee_name` text NOT NULL,
	`category` text NOT NULL,
	`subject` text NOT NULL,
	`details` text NOT NULL,
	`priority` text DEFAULT 'Normal' NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`routed_role` text NOT NULL,
	`assigned_to_email` text DEFAULT '' NOT NULL,
	`assigned_to_name` text DEFAULT '' NOT NULL,
	`secondary_approval_role` text DEFAULT '' NOT NULL,
	`primary_approved_by_email` text DEFAULT '' NOT NULL,
	`primary_approved_by_name` text DEFAULT '' NOT NULL,
	`primary_approved_at` text,
	`secondary_approved_by_email` text DEFAULT '' NOT NULL,
	`secondary_approved_by_name` text DEFAULT '' NOT NULL,
	`secondary_approved_at` text,
	`resolution` text DEFAULT '' NOT NULL,
	`confidential` integer DEFAULT false NOT NULL,
	`due_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `employee_service_request_employee_idx` ON `employee_service_requests` (`employee_email`,`status`);--> statement-breakpoint
CREATE INDEX `employee_service_request_assignee_idx` ON `employee_service_requests` (`assigned_to_email`,`status`);--> statement-breakpoint
CREATE INDEX `employee_service_request_role_idx` ON `employee_service_requests` (`routed_role`,`status`);