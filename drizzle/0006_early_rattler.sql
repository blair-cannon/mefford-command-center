CREATE TABLE `assistant_audits` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_role` text NOT NULL,
	`active_target` text DEFAULT 'Dashboard' NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`request_text` text NOT NULL,
	`response_text` text DEFAULT '' NOT NULL,
	`source_ids_json` text DEFAULT '[]' NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`openai_request_id` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_audits_actor_created_idx` ON `assistant_audits` (`actor_email`,`created_at`);--> statement-breakpoint
CREATE INDEX `assistant_audits_conversation_idx` ON `assistant_audits` (`conversation_id`);