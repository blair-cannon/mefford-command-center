CREATE TABLE `proposal_write_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "proposal_write_guard_valid" CHECK("proposal_write_guards"."valid" = 1)
);
