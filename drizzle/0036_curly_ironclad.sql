CREATE TABLE `estimate_write_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "estimate_write_guard_valid" CHECK("estimate_write_guards"."valid" = 1)
);
