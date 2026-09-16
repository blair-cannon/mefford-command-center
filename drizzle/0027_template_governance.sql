CREATE TABLE `template_governance_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text NOT NULL,
  `version` text NOT NULL,
  `jurisdiction` text NOT NULL,
  `business_owner` text NOT NULL,
  `source_file_id` integer NOT NULL,
  `source_sha256` text NOT NULL,
  `effective_date` text NOT NULL,
  `next_review_date` text NOT NULL,
  `required_reviewers_json` text NOT NULL,
  `status` text DEFAULT 'Draft — Not Approved for Use' NOT NULL,
  `superseded_by_id` text DEFAULT '' NOT NULL,
  `created_by_email` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE(`template_id`,`version`,`jurisdiction`)
);
CREATE INDEX `template_governance_current_idx` ON `template_governance_versions` (`template_id`,`jurisdiction`,`status`);
CREATE INDEX `template_governance_review_idx` ON `template_governance_versions` (`status`,`next_review_date`);

CREATE TABLE `template_governance_approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `governance_version_id` text NOT NULL,
  `reviewer_role` text NOT NULL,
  `reviewer_name` text NOT NULL,
  `reviewer_email` text NOT NULL,
  `decision` text NOT NULL,
  `source_sha256` text NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `decided_at` text NOT NULL,
  UNIQUE(`governance_version_id`,`reviewer_role`,`reviewer_email`)
);
CREATE INDEX `template_governance_approval_version_idx` ON `template_governance_approvals` (`governance_version_id`,`decision`);

CREATE TABLE `template_output_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text NOT NULL,
  `governance_version_id` text NOT NULL,
  `template_version` text NOT NULL,
  `source_sha256` text NOT NULL,
  `output_sha256` text NOT NULL,
  `jurisdiction` text NOT NULL,
  `generator` text NOT NULL,
  `generated_by_email` text NOT NULL,
  `required_fields_json` text DEFAULT '[]' NOT NULL,
  `deviations_json` text DEFAULT '[]' NOT NULL,
  `generated_at` text NOT NULL
);
CREATE INDEX `template_output_evidence_template_idx` ON `template_output_evidence` (`template_id`,`generated_at`);
