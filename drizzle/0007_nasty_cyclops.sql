CREATE TABLE `meeting_action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`series_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`definition_of_done` text NOT NULL,
	`assignee_name` text NOT NULL,
	`assignee_email` text NOT NULL,
	`collaborators_json` text DEFAULT '[]' NOT NULL,
	`due_at` text NOT NULL,
	`priority` text DEFAULT 'Normal' NOT NULL,
	`status` text DEFAULT 'Assignment Not Confirmed' NOT NULL,
	`blocker` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'Meeting' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`carry_count` integer DEFAULT 0 NOT NULL,
	`carried_from_id` text DEFAULT '' NOT NULL,
	`cancelled_reason` text DEFAULT '' NOT NULL,
	`work_item_id` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_action_occurrence_idx` ON `meeting_action_items` (`occurrence_id`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_action_assignee_idx` ON `meeting_action_items` (`assignee_email`,`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `meeting_agenda_items` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`section_key` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	`timebox_minutes` integer NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'Standard Section' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`source_version` text DEFAULT '' NOT NULL,
	`source_reason` text DEFAULT '' NOT NULL,
	`ai_suggested` integer DEFAULT false NOT NULL,
	`ai_confidence` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'Attendees' NOT NULL,
	`addendum_number` integer DEFAULT 0 NOT NULL,
	`published_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_agenda_occurrence_idx` ON `meeting_agenda_items` (`occurrence_id`,`position`);--> statement-breakpoint
CREATE TABLE `meeting_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Meeting File' NOT NULL,
	`storage_key` text DEFAULT '' NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`source_type` text DEFAULT 'Command Center' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`source_version` text DEFAULT 'Current' NOT NULL,
	`access` text DEFAULT 'Attendees' NOT NULL,
	`include_with_minutes` integer DEFAULT false NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_attachment_occurrence_idx` ON `meeting_attachments` (`occurrence_id`);--> statement-breakpoint
CREATE TABLE `meeting_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`attendee_role` text DEFAULT 'Participant' NOT NULL,
	`attendance_requirement` text DEFAULT 'Required' NOT NULL,
	`external` integer DEFAULT false NOT NULL,
	`calendar_response` text DEFAULT 'Not Responded' NOT NULL,
	`attendance_status` text DEFAULT 'Unconfirmed' NOT NULL,
	`attendance_source` text DEFAULT '' NOT NULL,
	`check_in_at` text,
	`check_out_at` text,
	`end_confirmed_at` text,
	`rating` integer,
	`exception_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_attendee_occurrence_idx` ON `meeting_attendees` (`occurrence_id`,`email`);--> statement-breakpoint
CREATE TABLE `meeting_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` text DEFAULT '' NOT NULL,
	`occurrence_id` text DEFAULT '' NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text DEFAULT '{}' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_audit_occurrence_idx` ON `meeting_audits` (`occurrence_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `meeting_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`statement` text NOT NULL,
	`decision_maker_name` text NOT NULL,
	`decision_maker_email` text NOT NULL,
	`status` text DEFAULT 'Proposed' NOT NULL,
	`participants_json` text DEFAULT '[]' NOT NULL,
	`source_links_json` text DEFAULT '[]' NOT NULL,
	`impacts_json` text DEFAULT '[]' NOT NULL,
	`implementation_owner` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`proposed_by` text NOT NULL,
	`confirmed_by` text DEFAULT '' NOT NULL,
	`confirmed_at` text,
	`supersedes_id` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_decision_occurrence_idx` ON `meeting_decisions` (`occurrence_id`,`status`);--> statement-breakpoint
CREATE TABLE `meeting_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`meeting_number` text NOT NULL,
	`scheduled_start` text NOT NULL,
	`scheduled_end` text NOT NULL,
	`status` text DEFAULT 'Draft Agenda' NOT NULL,
	`recording_enabled` integer DEFAULT true NOT NULL,
	`recording_override_reason` text DEFAULT '' NOT NULL,
	`recording_override_by` text DEFAULT '' NOT NULL,
	`recording_override_at` text,
	`transcript_status` text DEFAULT 'Awaiting Meeting' NOT NULL,
	`graph_event_id` text DEFAULT '' NOT NULL,
	`teams_meeting_id` text DEFAULT '' NOT NULL,
	`published_at` text,
	`started_at` text,
	`held_at` text,
	`draft_minutes_at` text,
	`finalized_at` text,
	`distributed_at` text,
	`finalized_by` text DEFAULT '' NOT NULL,
	`minutes_revision` integer DEFAULT 0 NOT NULL,
	`minutes_summary` text DEFAULT '' NOT NULL,
	`financial_snapshot_json` text DEFAULT '{}' NOT NULL,
	`distribution_json` text DEFAULT '[]' NOT NULL,
	`agenda_pdf_key` text DEFAULT '' NOT NULL,
	`minutes_pdf_key` text DEFAULT '' NOT NULL,
	`leader_rating` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meeting_occurrences_meeting_number_unique` ON `meeting_occurrences` (`meeting_number`);--> statement-breakpoint
CREATE INDEX `meeting_occurrence_series_idx` ON `meeting_occurrences` (`series_id`,`scheduled_start`);--> statement-breakpoint
CREATE INDEX `meeting_occurrence_status_idx` ON `meeting_occurrences` (`status`,`scheduled_start`);--> statement-breakpoint
CREATE TABLE `meeting_series` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_type` text NOT NULL,
	`project_id` text DEFAULT 'MEFFORD-COMPANY' NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`cadence` text NOT NULL,
	`start_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`time_zone` text DEFAULT 'America/New_York' NOT NULL,
	`meeting_mode` text DEFAULT 'Teams Remote' NOT NULL,
	`location` text DEFAULT 'Microsoft Teams' NOT NULL,
	`leader_name` text NOT NULL,
	`leader_email` text NOT NULL,
	`organizer_email` text NOT NULL,
	`recording_default` integer DEFAULT true NOT NULL,
	`auto_publish_hours` integer DEFAULT 24 NOT NULL,
	`graph_event_id` text DEFAULT '' NOT NULL,
	`graph_change_key` text DEFAULT '' NOT NULL,
	`teams_join_url` text DEFAULT '' NOT NULL,
	`access_json` text DEFAULT '{}' NOT NULL,
	`not_required_reason` text DEFAULT '' NOT NULL,
	`not_required_by` text DEFAULT '' NOT NULL,
	`not_required_at` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_series_scope_idx` ON `meeting_series` (`project_id`,`meeting_type`,`status`);--> statement-breakpoint
CREATE INDEX `meeting_series_start_idx` ON `meeting_series` (`start_at`);--> statement-breakpoint
CREATE TABLE `meeting_sync_events` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text DEFAULT '' NOT NULL,
	`occurrence_id` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'Microsoft Graph' NOT NULL,
	`direction` text NOT NULL,
	`event_type` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_sync_status_idx` ON `meeting_sync_events` (`status`,`created_at`);