CREATE TABLE `dashboard_change_revisions` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`changed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `dashboard_change_revisions` (`id`, `revision`, `changed_at`)
VALUES (1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--> statement-breakpoint
CREATE TRIGGER `dashboard_projects_insert_revision`
AFTER INSERT ON `projects`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_projects_update_revision`
AFTER UPDATE ON `projects`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_projects_delete_revision`
AFTER DELETE ON `projects`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_records_insert_revision`
AFTER INSERT ON `command_records`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_records_update_revision`
AFTER UPDATE ON `command_records`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_records_delete_revision`
AFTER DELETE ON `command_records`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_files_insert_revision`
AFTER INSERT ON `project_files`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_files_update_revision`
AFTER UPDATE ON `project_files`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_files_delete_revision`
AFTER DELETE ON `project_files`
BEGIN
  UPDATE `dashboard_change_revisions`
  SET `revision` = `revision` + 1, `changed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `id` = 1;
END;
