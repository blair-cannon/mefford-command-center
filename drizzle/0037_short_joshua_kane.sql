CREATE TABLE `meeting_agenda_refresh_guards` (
	`occurrence_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL
);
