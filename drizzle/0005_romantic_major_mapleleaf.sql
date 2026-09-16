ALTER TABLE `projects` ADD `owner_contract_type` text DEFAULT 'Lump Sum' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `owner_contract_status` text DEFAULT 'Draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `owner_contract_record_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `payment_terms` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `retainage_initial_percent` text DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `retainage_after_half_percent` text DEFAULT '5' NOT NULL;