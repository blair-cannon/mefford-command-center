INSERT INTO company_members (
  email, display_name, company_access_level, designations_json,
  is_active, identity_provider, updated_at
) VALUES (
  'janderson@meffcon.com', 'Jason Anderson', 'Employee', '["Estimator"]',
  1, 'microsoft_entra_pending', CURRENT_TIMESTAMP
)
ON CONFLICT(email) DO UPDATE SET
  display_name = excluded.display_name,
  company_access_level = excluded.company_access_level,
  designations_json = excluded.designations_json,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP;
--> statement-breakpoint
INSERT INTO company_members (
  email, display_name, company_access_level, designations_json,
  is_active, identity_provider, updated_at
) VALUES (
  'aneal@meffcon.com', 'Amanda Neal', 'Employee', '["Accountant"]',
  1, 'microsoft_entra_pending', CURRENT_TIMESTAMP
)
ON CONFLICT(email) DO UPDATE SET
  display_name = excluded.display_name,
  company_access_level = excluded.company_access_level,
  designations_json = excluded.designations_json,
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP;
--> statement-breakpoint
INSERT INTO command_records (
  project_id, id, record_type, title, owner, due, status, meta,
  record_date, record_time, date_locked, data_json, updated_at
) VALUES (
  'MEFFORD-PEOPLE', 'EMP-janderson@meffcon.com', 'Employee Onboarding',
  'Jason Anderson Employee Lifecycle', 'Jason Anderson', '2026-08-16',
  'Hire Date Required', 'Employee · Existing Employee', '2026-08-16', NULL, 0,
  '{"email":"janderson@meffcon.com","name":"Jason Anderson","hireDate":"","birthDate":"","position":"Estimator","department":"Office","supervisor":"Company Leadership","workLocation":"Mefford Company Operations","checklistOwner":"Company Administration","accessLevel":"Employee","designations":["Estimator"],"lifecycleStatus":"Active","grandfathered":true,"initialActivatedAt":"2026-08-16T23:55:00.000Z","completions":{}}',
  CURRENT_TIMESTAMP
)
ON CONFLICT(project_id, id) DO UPDATE SET
  title = excluded.title,
  owner = excluded.owner,
  meta = excluded.meta,
  data_json = excluded.data_json,
  updated_at = CURRENT_TIMESTAMP;
--> statement-breakpoint
INSERT INTO command_records (
  project_id, id, record_type, title, owner, due, status, meta,
  record_date, record_time, date_locked, data_json, updated_at
) VALUES (
  'MEFFORD-PEOPLE', 'EMP-aneal@meffcon.com', 'Employee Onboarding',
  'Amanda Neal Employee Lifecycle', 'Amanda Neal', '2026-08-16',
  'Hire Date Required', 'Employee · Existing Employee', '2026-08-16', NULL, 0,
  '{"email":"aneal@meffcon.com","name":"Amanda Neal","hireDate":"","birthDate":"","position":"Accountant","department":"Office","supervisor":"Company Leadership","workLocation":"Mefford Company Operations","checklistOwner":"Company Administration","accessLevel":"Employee","designations":["Accountant"],"lifecycleStatus":"Active","grandfathered":true,"initialActivatedAt":"2026-08-16T23:55:00.000Z","completions":{}}',
  CURRENT_TIMESTAMP
)
ON CONFLICT(project_id, id) DO UPDATE SET
  title = excluded.title,
  owner = excluded.owner,
  meta = excluded.meta,
  data_json = excluded.data_json,
  updated_at = CURRENT_TIMESTAMP;
