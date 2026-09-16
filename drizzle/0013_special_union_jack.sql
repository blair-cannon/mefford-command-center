CREATE TABLE `accounting_bank_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`cash_account_id` text NOT NULL,
	`statement_start` text NOT NULL,
	`statement_end` text NOT NULL,
	`statement_ending_balance_cents` integer NOT NULL,
	`book_ending_balance_cents` integer NOT NULL,
	`outstanding_deposits_cents` integer DEFAULT 0 NOT NULL,
	`outstanding_payments_cents` integer DEFAULT 0 NOT NULL,
	`adjustment_cents` integer DEFAULT 0 NOT NULL,
	`difference_cents` integer NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`prepared_by` text NOT NULL,
	`prepared_email` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_email` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_bank_reconciliation_account_idx` ON `accounting_bank_reconciliations` (`cash_account_id`,`statement_end`,`status`);--> statement-breakpoint
CREATE TABLE `accounting_bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`cash_account_id` text NOT NULL,
	`transaction_date` text NOT NULL,
	`source` text NOT NULL,
	`reference` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`status` text DEFAULT 'Unmatched' NOT NULL,
	`matched_transaction_id` text DEFAULT '' NOT NULL,
	`imported_batch_id` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_bank_transaction_account_idx` ON `accounting_bank_transactions` (`cash_account_id`,`status`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `accounting_bank_transaction_batch_idx` ON `accounting_bank_transactions` (`imported_batch_id`);--> statement-breakpoint
CREATE TABLE `accounting_cash_forecast_items` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`confidence` text DEFAULT 'Expected' NOT NULL,
	`source_type` text DEFAULT 'Manual Forecast' NOT NULL,
	`source_record_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_by` text NOT NULL,
	`created_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_cash_forecast_week_idx` ON `accounting_cash_forecast_items` (`week_start`,`status`);--> statement-breakpoint
CREATE INDEX `accounting_cash_forecast_source_idx` ON `accounting_cash_forecast_items` (`source_type`,`source_record_id`);--> statement-breakpoint
CREATE TABLE `accounting_close_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`period_id` text NOT NULL,
	`code` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`assigned_role` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'Open' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`completed_by` text DEFAULT '' NOT NULL,
	`completed_email` text DEFAULT '' NOT NULL,
	`completed_at` text,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_email` text DEFAULT '' NOT NULL,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_close_period_status_idx` ON `accounting_close_tasks` (`period_id`,`status`);--> statement-breakpoint
CREATE TABLE `accounting_collection_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`billing_id` text NOT NULL,
	`action_date` text NOT NULL,
	`method` text NOT NULL,
	`note` text NOT NULL,
	`promise_date` text DEFAULT '' NOT NULL,
	`promised_amount_cents` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_email` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_collection_billing_idx` ON `accounting_collection_actions` (`billing_id`,`action_date`);--> statement-breakpoint
CREATE TABLE `accounting_cutover_controls` (
	`id` text PRIMARY KEY NOT NULL,
	`cutover_date` text NOT NULL,
	`source_system` text NOT NULL,
	`opening_balance_entry_id` text DEFAULT '' NOT NULL,
	`ap_reconciled` integer DEFAULT false NOT NULL,
	`ar_reconciled` integer DEFAULT false NOT NULL,
	`cash_reconciled` integer DEFAULT false NOT NULL,
	`assets_reconciled` integer DEFAULT false NOT NULL,
	`payroll_reconciled` integer DEFAULT false NOT NULL,
	`equity_reconciled` integer DEFAULT false NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`prepared_by` text NOT NULL,
	`prepared_email` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_email` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`locked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounting_wip_forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`period_id` text NOT NULL,
	`actual_cost_cents` integer DEFAULT 0 NOT NULL,
	`estimate_to_complete_cents` integer DEFAULT 0 NOT NULL,
	`risk_reserve_cents` integer DEFAULT 0 NOT NULL,
	`estimate_at_completion_cents` integer DEFAULT 0 NOT NULL,
	`forecast_profit_cents` integer DEFAULT 0 NOT NULL,
	`projected_margin_basis_points` integer DEFAULT 0 NOT NULL,
	`recognition_method` text DEFAULT 'Cost To Cost' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`prepared_by` text NOT NULL,
	`prepared_email` text NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_email` text DEFAULT '' NOT NULL,
	`reviewed_at` text,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_email` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`locked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounting_wip_project_period_idx` ON `accounting_wip_forecasts` (`project_id`,`period_id`);--> statement-breakpoint
CREATE INDEX `accounting_wip_period_status_idx` ON `accounting_wip_forecasts` (`period_id`,`status`);