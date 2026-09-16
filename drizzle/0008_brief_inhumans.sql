ALTER TABLE `command_work_items` ADD `item_kind` text DEFAULT 'To-Do' NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_occurrences` ADD `publication_hold` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_occurrences` ADD `publication_hold_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_occurrences` ADD `publication_hold_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `meeting_occurrences` ADD `publication_hold_at` text;