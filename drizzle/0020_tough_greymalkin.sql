ALTER TABLE `notification_delivery_events` ADD `next_attempt_at` text;--> statement-breakpoint
ALTER TABLE `notification_delivery_events` ADD `error_class` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_delivery_events` ADD `deferred_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_delivery_events` ADD `provider` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_delivery_events` ADD `provider_receipt_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_delivery_events` ADD `provider_status` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_delivery_events` ADD `accepted_at` text;--> statement-breakpoint
ALTER TABLE `notification_delivery_events` ADD `dead_lettered_at` text;