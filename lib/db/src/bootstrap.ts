import { getMssqlPool } from "./mssql-pool.js";

let _bootstrapped: Promise<void> | null = null;

export function bootstrapDatabase(): Promise<void> {
  if (_bootstrapped) return _bootstrapped;
  // Cluster workers are forked with APPDB_BOOTSTRAPPED=1 AFTER the primary has
  // already run the full DDL bootstrap. Skipping it here matters: the ~60
  // serial IF-NOT-EXISTS round-trips take ~30 s against the remote server, and
  // every db call awaits bootstrapDatabase() — so without this skip, the FIRST
  // request each worker served after a restart (often a login) hung for ~30 s.
  if (process.env.APPDB_BOOTSTRAPPED === "1") {
    _bootstrapped = Promise.resolve();
    return _bootstrapped;
  }
  _bootstrapped = _run().catch((e) => { _bootstrapped = null; throw e; });
  return _bootstrapped;
}

/**
 * Mark the schema DDL as already applied without running it. The cluster
 * primary calls its own bootstrapDatabase() in the background at startup and
 * then notifies workers over IPC; workers forked before that finished (env
 * flag "0") call this on receipt so their FIRST app-DB call doesn't re-pay
 * the full IF-NOT-EXISTS sweep. A worker already mid-bootstrap keeps its
 * in-flight run (idempotent and harmless).
 */
export function markAppDbBootstrapped(): void {
  if (!_bootstrapped) _bootstrapped = Promise.resolve();
}

async function _run(): Promise<void> {
  const pool = await getMssqlPool();

  const tables: string[] = [
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_users')
     CREATE TABLE dbo.rmone_users (
       id            NVARCHAR(50)  NOT NULL PRIMARY KEY,
       tenant_id     NVARCHAR(100) NOT NULL,
       username      NVARCHAR(200) NOT NULL,
       name          NVARCHAR(500) NOT NULL,
       email         NVARCHAR(200) NULL,
       password_hash NVARCHAR(MAX) NULL,
       role          NVARCHAR(200) NULL,
       role_id       NVARCHAR(50)  NULL,
       department_id NVARCHAR(50)  NULL,
       division_id   NVARCHAR(50)  NULL,
       job_title_id  NVARCHAR(50)  NULL,
       title         NVARCHAR(200) NULL,
       business_unit NVARCHAR(200) NULL,
       manager_user_id NVARCHAR(50) NULL,
       is_manager    BIT NOT NULL DEFAULT 0,
       is_site_admin BIT NOT NULL DEFAULT 0,
       access_level  NVARCHAR(20)  NULL,
       start_date    DATETIME2     NULL,
       end_date      DATETIME2     NULL,
       enabled       BIT NOT NULL DEFAULT 1,
       deleted       BIT NOT NULL DEFAULT 0,
       employee_type NVARCHAR(100) NULL,
       phone_number  NVARCHAR(50)  NULL,
       employee_id   NVARCHAR(100) NULL,
       office        NVARCHAR(200) NULL,
       job_profile   NVARCHAR(MAX) NULL,
       email_confirmed BIT NULL,
       created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_users') AND name='email_confirmed')
       ALTER TABLE dbo.rmone_users ADD email_confirmed BIT NULL`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_users_tenant_username_idx')
       CREATE UNIQUE INDEX rmone_users_tenant_username_idx ON dbo.rmone_users(tenant_id, username)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_users_username_idx')
       CREATE INDEX rmone_users_username_idx ON dbo.rmone_users(username)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_card_insights_cache')
     CREATE TABLE dbo.rmone_card_insights_cache (
       cache_key   NVARCHAR(500) NOT NULL PRIMARY KEY,
       kind        NVARCHAR(100) NOT NULL,
       record_id   NVARCHAR(200) NOT NULL,
       fields_hash NVARCHAR(200) NOT NULL,
       severity    NVARCHAR(20)  NOT NULL,
       text        NVARCHAR(MAX) NOT NULL,
       expires_at  DATETIME2     NOT NULL,
       created_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_insights_record_idx')
       CREATE INDEX rmone_insights_record_idx ON dbo.rmone_card_insights_cache(kind, record_id)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_insights_expires_idx')
       CREATE INDEX rmone_insights_expires_idx ON dbo.rmone_card_insights_cache(expires_at)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_forecast_snapshots')
     CREATE TABLE dbo.rmone_forecast_snapshots (
       id                   INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant               NVARCHAR(200) NOT NULL,
       snapshot_date        DATETIME2     NOT NULL,
       pipeline_count       INT NOT NULL DEFAULT 0,
       backlog_count        INT NOT NULL DEFAULT 0,
       open_demand_count    INT NOT NULL DEFAULT 0,
       bench_count          INT NOT NULL DEFAULT 0,
       over_allocated_count INT NOT NULL DEFAULT 0,
       revenue_pipeline     DECIMAL(18,2) NULL,
       revenue_backlog      DECIMAL(18,2) NULL,
       utilization_pct      DECIMAL(5,2)  NULL,
       created_at           DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_forecast_tenant_date_idx')
       CREATE UNIQUE INDEX rmone_forecast_tenant_date_idx ON dbo.rmone_forecast_snapshots(tenant, snapshot_date)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_ai_escalations')
     CREATE TABLE dbo.rmone_ai_escalations (
       id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant       NVARCHAR(200) NOT NULL,
       role         NVARCHAR(100) NULL,
       user_guid    NVARCHAR(50)  NULL,
       severity     NVARCHAR(20)  NOT NULL,
       title        NVARCHAR(500) NOT NULL,
       summary      NVARCHAR(MAX) NOT NULL,
       payload      NVARCHAR(MAX) NULL,
       status       NVARCHAR(20)  NOT NULL DEFAULT 'open',
       generated_at DATETIME2     NULL,
       expires_at   DATETIME2     NULL,
       created_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_escalations_tenant_gen_idx')
       CREATE INDEX rmone_escalations_tenant_gen_idx ON dbo.rmone_ai_escalations(tenant, generated_at)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_alert_state')
     CREATE TABLE dbo.rmone_alert_state (
       id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant        NVARCHAR(200) NOT NULL,
       user_guid     NVARCHAR(50)  NOT NULL,
       alert_key     NVARCHAR(300) NOT NULL,
       status        NVARCHAR(50)  NOT NULL,
       snoozed_until DATETIME2     NULL,
       note          NVARCHAR(MAX) NULL,
       updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_alert_state_key_idx')
       CREATE UNIQUE INDEX rmone_alert_state_key_idx ON dbo.rmone_alert_state(tenant, user_guid, alert_key)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_decision_acks')
     CREATE TABLE dbo.rmone_decision_acks (
       id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant     NVARCHAR(200) NULL,
       username   NVARCHAR(200) NOT NULL,
       kind       NVARCHAR(20)  NOT NULL,
       ref_id     NVARCHAR(300) NOT NULL,
       label      NVARCHAR(600) NOT NULL,
       note       NVARCHAR(MAX) NULL,
       payload    NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_decision_acks_user_idx')
       CREATE INDEX rmone_decision_acks_user_idx ON dbo.rmone_decision_acks(username, created_at)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_conversations')
     CREATE TABLE dbo.rmone_conversations (
       id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       title      NVARCHAR(MAX) NOT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_messages')
     CREATE TABLE dbo.rmone_messages (
       id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       conversation_id INT NOT NULL,
       role            NVARCHAR(50)  NOT NULL,
       content         NVARCHAR(MAX) NOT NULL,
       created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_onboarding_jobs')
     CREATE TABLE dbo.rmone_onboarding_jobs (
       upload_id      NVARCHAR(200) NOT NULL PRIMARY KEY,
       tenant_id      NVARCHAR(200) NOT NULL,
       file_name      NVARCHAR(500) NOT NULL,
       s3_key         NVARCHAR(MAX) NULL,
       status         NVARCHAR(50)  NOT NULL DEFAULT 'pending',
       created_by     NVARCHAR(200) NULL,
       created_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       total_inserted INT NULL,
       total_errors   INT NULL,
       import_mode    NVARCHAR(50)  NULL,
       file_data      NVARCHAR(MAX) NULL,
       error_detail   NVARCHAR(MAX) NULL,
       result         NVARCHAR(MAX) NULL,
       summary        NVARCHAR(MAX) NULL,
       column_mapping NVARCHAR(MAX) NULL,
       owner_token    NVARCHAR(100) NULL
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_onboarding_jobs') AND name='result')
       ALTER TABLE dbo.rmone_onboarding_jobs ADD result NVARCHAR(MAX) NULL`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_onboarding_jobs') AND name='sheets')
       ALTER TABLE dbo.rmone_onboarding_jobs ADD sheets NVARCHAR(MAX) NULL`,
    // Identity of the worker process running this job's pipeline (stamped by
    // /run). Lets the crash reconcile fail ONLY the dead worker's jobs instead
    // of staleness-sweeping every running job (which falsely failed live runs
    // whose best-effort heartbeat lapsed under memory duress).
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_onboarding_jobs') AND name='owner_token')
       ALTER TABLE dbo.rmone_onboarding_jobs ADD owner_token NVARCHAR(100) NULL`,
    // Upload-card intent (import page): which grid card / record type the user
    // submitted from. Persisted so /active's cross-worker DB fallback derives
    // the same "Importing…" sidebar badges as the worker that owns the run.
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_onboarding_jobs') AND name='forced_tab_type')
       ALTER TABLE dbo.rmone_onboarding_jobs ADD forced_tab_type NVARCHAR(32) NULL`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_onboarding_jobs') AND name='forced_record_type')
       ALTER TABLE dbo.rmone_onboarding_jobs ADD forced_record_type NVARCHAR(32) NULL`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_upload_chunks')
     CREATE TABLE dbo.rmone_upload_chunks (
       session_id NVARCHAR(100) NOT NULL,
       seq        INT NOT NULL,
       owner_key  NVARCHAR(400) NOT NULL,
       data       VARBINARY(MAX) NOT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT rmone_upload_chunks_pk PRIMARY KEY (session_id, seq)
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_onboarding_templates')
     CREATE TABLE dbo.rmone_onboarding_templates (
       id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_key   NVARCHAR(300) NOT NULL,
       tenant_label NVARCHAR(600) NOT NULL,
       name         NVARCHAR(300) NULL,
       mapping      NVARCHAR(MAX) NOT NULL DEFAULT '{}',
       created_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_onb_tmpl_key_idx')
       CREATE UNIQUE INDEX rmone_onb_tmpl_key_idx ON dbo.rmone_onboarding_templates(tenant_key)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_onboarding_extra_fields')
     CREATE TABLE dbo.rmone_onboarding_extra_fields (
       id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_key   NVARCHAR(300) NOT NULL,
       tenant_label NVARCHAR(600) NOT NULL,
       entity_type  NVARCHAR(100) NOT NULL,
       natural_key  NVARCHAR(500) NOT NULL,
       record_label NVARCHAR(500) NOT NULL,
       field_name   NVARCHAR(300) NOT NULL,
       value        NVARCHAR(MAX) NULL,
       sheet_name   NVARCHAR(300) NULL,
       created_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_extra_fields_key_idx')
       CREATE UNIQUE INDEX rmone_extra_fields_key_idx ON dbo.rmone_onboarding_extra_fields(tenant_key, entity_type, natural_key, field_name)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_onboarding_default_settings')
     CREATE TABLE dbo.rmone_onboarding_default_settings (
       id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       scope      NVARCHAR(300) NOT NULL,
       label      NVARCHAR(500) NULL,
       settings   NVARCHAR(MAX) NOT NULL DEFAULT '{}',
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_onb_settings_scope_idx')
       CREATE UNIQUE INDEX rmone_onb_settings_scope_idx ON dbo.rmone_onboarding_default_settings(scope)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_onboarding_assumed_fields')
     CREATE TABLE dbo.rmone_onboarding_assumed_fields (
       id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_key   NVARCHAR(300) NOT NULL,
       tenant_label NVARCHAR(600) NOT NULL,
       entity_type  NVARCHAR(100) NOT NULL,
       natural_key  NVARCHAR(500) NOT NULL,
       record_label NVARCHAR(500) NOT NULL,
       field_name   NVARCHAR(300) NOT NULL,
       value        NVARCHAR(MAX) NULL,
       confidence   NVARCHAR(100) NOT NULL DEFAULT 'system_defaulted',
       sheet_name   NVARCHAR(300) NULL,
       created_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_assumed_fields_key_idx')
       CREATE UNIQUE INDEX rmone_assumed_fields_key_idx ON dbo.rmone_onboarding_assumed_fields(tenant_key, entity_type, natural_key, field_name)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_onboarding_assumed_history')
     CREATE TABLE dbo.rmone_onboarding_assumed_history (
       id             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_key     NVARCHAR(300) NOT NULL,
       tenant_label   NVARCHAR(600) NOT NULL,
       entity_type    NVARCHAR(100) NOT NULL,
       natural_key    NVARCHAR(500) NOT NULL,
       record_label   NVARCHAR(500) NOT NULL,
       field_name     NVARCHAR(300) NOT NULL,
       action         NVARCHAR(100) NOT NULL,
       old_value      NVARCHAR(MAX) NULL,
       new_value      NVARCHAR(MAX) NULL,
       old_confidence NVARCHAR(100) NULL,
       new_confidence NVARCHAR(100) NULL,
       sheet_name     NVARCHAR(300) NULL,
       actor          NVARCHAR(300) NULL,
       created_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_assumed_hist_tenant_idx')
       CREATE INDEX rmone_assumed_hist_tenant_idx ON dbo.rmone_onboarding_assumed_history(tenant_key)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_skill_catalog')
     CREATE TABLE dbo.rmone_skill_catalog (
       id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id  NVARCHAR(100) NOT NULL,
       name       NVARCHAR(300) NOT NULL,
       category   NVARCHAR(200) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_skill_catalog_name_idx')
       CREATE UNIQUE INDEX rmone_skill_catalog_name_idx ON dbo.rmone_skill_catalog(tenant_id, name)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_resource_skills')
     CREATE TABLE dbo.rmone_resource_skills (
       id               INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id        NVARCHAR(100) NOT NULL,
       resource_guid    NVARCHAR(50)  NOT NULL,
       skill_id         INT           NULL,
       skill_name       NVARCHAR(300) NOT NULL,
       category         NVARCHAR(200) NULL,
       proficiency      INT           NULL,
       years_experience DECIMAL(5,1)  NULL,
       last_used_year   INT           NULL,
       is_primary       BIT NOT NULL DEFAULT 0,
       created_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_resource_skill_uniq_idx')
       CREATE UNIQUE INDEX rmone_resource_skill_uniq_idx ON dbo.rmone_resource_skills(tenant_id, resource_guid, skill_name)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_resource_skill_name_idx')
       CREATE INDEX rmone_resource_skill_name_idx ON dbo.rmone_resource_skills(tenant_id, skill_name)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_resource_certifications')
     CREATE TABLE dbo.rmone_resource_certifications (
       id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id       NVARCHAR(100) NOT NULL,
       resource_guid   NVARCHAR(50)  NOT NULL,
       name            NVARCHAR(300) NOT NULL,
       issuer          NVARCHAR(300) NULL,
       credential_id   NVARCHAR(200) NULL,
       issue_date      DATE          NULL,
       expiry_date     DATE          NULL,
       attachment_path NVARCHAR(MAX) NULL,
       is_verified     BIT NOT NULL DEFAULT 0,
       created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_resource_cert_guid_idx')
       CREATE INDEX rmone_resource_cert_guid_idx ON dbo.rmone_resource_certifications(tenant_id, resource_guid)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_resource_education')
     CREATE TABLE dbo.rmone_resource_education (
       id             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id      NVARCHAR(100) NOT NULL,
       resource_guid  NVARCHAR(50)  NOT NULL,
       institution    NVARCHAR(300) NOT NULL,
       degree         NVARCHAR(300) NULL,
       field_of_study NVARCHAR(300) NULL,
       start_year     INT           NULL,
       end_year       INT           NULL,
       is_current     BIT NOT NULL DEFAULT 0,
       created_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_resource_edu_guid_idx')
       CREATE INDEX rmone_resource_edu_guid_idx ON dbo.rmone_resource_education(tenant_id, resource_guid)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_resource_work_history')
     CREATE TABLE dbo.rmone_resource_work_history (
       id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id     NVARCHAR(100) NOT NULL,
       resource_guid NVARCHAR(50)  NOT NULL,
       company       NVARCHAR(300) NOT NULL,
       title         NVARCHAR(300) NULL,
       location      NVARCHAR(300) NULL,
       start_date    DATE          NULL,
       end_date      DATE          NULL,
       is_current    BIT NOT NULL DEFAULT 0,
       description   NVARCHAR(MAX) NULL,
       created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_resource_wh_guid_idx')
       CREATE INDEX rmone_resource_wh_guid_idx ON dbo.rmone_resource_work_history(tenant_id, resource_guid)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_resource_projects')
     CREATE TABLE dbo.rmone_resource_projects (
       id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id     NVARCHAR(100) NOT NULL,
       resource_guid NVARCHAR(50)  NOT NULL,
       project_name  NVARCHAR(300) NOT NULL,
       role          NVARCHAR(300) NULL,
       client        NVARCHAR(300) NULL,
       start_date    DATE          NULL,
       end_date      DATE          NULL,
       is_current    BIT NOT NULL DEFAULT 0,
       description   NVARCHAR(MAX) NULL,
       created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_resource_proj_guid_idx')
       CREATE INDEX rmone_resource_proj_guid_idx ON dbo.rmone_resource_projects(tenant_id, resource_guid)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_resource_resumes')
     CREATE TABLE dbo.rmone_resource_resumes (
       id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id     NVARCHAR(100) NOT NULL,
       resource_guid NVARCHAR(50)  NOT NULL,
       object_path   NVARCHAR(MAX) NOT NULL,
       file_name     NVARCHAR(500) NOT NULL,
       content_type  NVARCHAR(200) NULL,
       size_bytes    INT           NULL,
       summary       NVARCHAR(MAX) NULL,
       is_primary    BIT NOT NULL DEFAULT 0,
       uploaded_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_resource_resume_guid_idx')
       CREATE INDEX rmone_resource_resume_guid_idx ON dbo.rmone_resource_resumes(tenant_id, resource_guid)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_resource_profile')
     CREATE TABLE dbo.rmone_resource_profile (
       id               INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id        NVARCHAR(100) NOT NULL,
       resource_guid    NVARCHAR(50)  NOT NULL,
       headline         NVARCHAR(500) NULL,
       bio              NVARCHAR(MAX) NULL,
       location         NVARCHAR(300) NULL,
       years_experience DECIMAL(5,1)  NULL,
       available_from   DATE          NULL,
       preferred_roles  NVARCHAR(MAX) NULL,
       linkedin_url     NVARCHAR(500) NULL,
       billing_rate     DECIMAL(18,4) NULL,
       labor_rate       DECIMAL(18,4) NULL,
       cost_rate        DECIMAL(18,4) NULL,
       created_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_resource_profile_uniq_idx')
       CREATE UNIQUE INDEX rmone_resource_profile_uniq_idx ON dbo.rmone_resource_profile(tenant_id, resource_guid)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_experience_tag_catalog')
     CREATE TABLE dbo.rmone_experience_tag_catalog (
       id         INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id  NVARCHAR(100) NOT NULL,
       name       NVARCHAR(300) NOT NULL,
       category   NVARCHAR(200) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_exp_tag_name_idx')
       CREATE UNIQUE INDEX rmone_exp_tag_name_idx ON dbo.rmone_experience_tag_catalog(tenant_id, name)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_user_experience_tags')
     CREATE TABLE dbo.rmone_user_experience_tags (
       id            INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id     NVARCHAR(100) NOT NULL,
       resource_guid NVARCHAR(50)  NOT NULL,
       tag_name      NVARCHAR(300) NOT NULL,
       created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_user_exp_tag_uniq_idx')
       CREATE UNIQUE INDEX rmone_user_exp_tag_uniq_idx ON dbo.rmone_user_experience_tags(tenant_id, resource_guid, tag_name)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_resource_availability')
     CREATE TABLE dbo.rmone_resource_availability (
       id               INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id        NVARCHAR(100) NOT NULL,
       resource_guid    NVARCHAR(50)  NOT NULL,
       start_date       DATE NOT NULL,
       end_date         DATE NOT NULL,
       availability_pct INT NOT NULL DEFAULT 0,
       reason           NVARCHAR(400) NULL,
       created_by       NVARCHAR(255) NULL,
       created_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_res_avail_idx')
       CREATE INDEX rmone_res_avail_idx ON dbo.rmone_resource_availability(tenant_id, resource_guid)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_synonym_mappings')
     CREATE TABLE dbo.rmone_synonym_mappings (
       id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       alias           NVARCHAR(300) NOT NULL,
       canonical_field NVARCHAR(300) NOT NULL,
       tab_type        NVARCHAR(100) NULL,
       is_builtin      BIT NOT NULL DEFAULT 0,
       hit_count       INT NOT NULL DEFAULT 1,
       created_by      NVARCHAR(200) NULL,
       created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_superadmin_accounts')
     CREATE TABLE dbo.rmone_superadmin_accounts (
       email    NVARCHAR(200) NOT NULL PRIMARY KEY,
       added_by NVARCHAR(200) NULL,
       added_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_tenant_status')
     CREATE TABLE dbo.rmone_tenant_status (
       tenant_id  NVARCHAR(200) NOT NULL PRIMARY KEY,
       is_active  BIT NOT NULL DEFAULT 1,
       note       NVARCHAR(MAX) NULL,
       updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       updated_by NVARCHAR(200) NULL
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_chat_sessions')
     CREATE TABLE dbo.rmone_chat_sessions (
       id            INT IDENTITY(1,1) PRIMARY KEY,
       tenant        NVARCHAR(100) NOT NULL,
       username      NVARCHAR(255) NOT NULL,
       session_id    NVARCHAR(100) NOT NULL,
       title         NVARCHAR(500) NOT NULL DEFAULT '',
       messages      NVARCHAR(MAX) NOT NULL DEFAULT '[]',
       last_activity BIGINT NOT NULL DEFAULT 0,
       created_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT uq_rmone_chat_sessions UNIQUE (tenant, username, session_id)
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_allocation_templates')
     CREATE TABLE dbo.rmone_allocation_templates (
       id          INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id   NVARCHAR(100) NOT NULL,
       name        NVARCHAR(300) NOT NULL,
       created_by  NVARCHAR(255) NULL,
       created_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_alloc_tmpl_tenant_idx')
       CREATE INDEX rmone_alloc_tmpl_tenant_idx ON dbo.rmone_allocation_templates(tenant_id)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_allocation_template_slots')
     CREATE TABLE dbo.rmone_allocation_template_slots (
       id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       template_id     INT NOT NULL,
       bu_name         NVARCHAR(300) NULL,
       division_name   NVARCHAR(300) NULL,
       dept_name       NVARCHAR(300) NULL,
       role_name       NVARCHAR(300) NULL,
       job_title_name  NVARCHAR(300) NULL,
       default_pct     INT NOT NULL DEFAULT 100,
       sort_order      INT NOT NULL DEFAULT 0
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_allocation_template_slots') AND name='dept_name')
       ALTER TABLE dbo.rmone_allocation_template_slots ADD dept_name NVARCHAR(300) NULL`,
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('dbo.rmone_allocation_template_slots') AND name='resource_id')
       ALTER TABLE dbo.rmone_allocation_template_slots ADD resource_id NVARCHAR(450) NULL`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_alloc_tmpl_slot_tmpl_idx')
       CREATE INDEX rmone_alloc_tmpl_slot_tmpl_idx ON dbo.rmone_allocation_template_slots(template_id)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_active_tenants')
     CREATE TABLE dbo.rmone_active_tenants (
       tenant_id      NVARCHAR(100) NOT NULL PRIMARY KEY,
       tenant_label   NVARCHAR(200) NOT NULL,
       last_active_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF COL_LENGTH('dbo.rmone_active_tenants','hot_projects') IS NULL
       ALTER TABLE dbo.rmone_active_tenants ADD hot_projects NVARCHAR(MAX) NULL`,
    // Per-record status-list customizations (drag order, custom/removed statuses,
    // sub-statuses). Keyed per tenant + record + status-field so one record can
    // carry independent configs for "Status" vs "Phase". cfg is a JSON blob
    // matching the client-side StageCfg shape.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_stage_cfg')
     CREATE TABLE dbo.rmone_stage_cfg (
       id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id    NVARCHAR(200) NOT NULL,
       record_id    NVARCHAR(200) NOT NULL,
       status_field NVARCHAR(200) NOT NULL,
       cfg          NVARCHAR(MAX) NOT NULL DEFAULT '{}',
       updated_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_stage_cfg_key_idx')
       CREATE UNIQUE INDEX rmone_stage_cfg_key_idx ON dbo.rmone_stage_cfg(tenant_id, record_id, status_field)`,
    // Org-entity provenance: which uploaded file (or manual action) FIRST
    // introduced each Business Unit / Division / Department for a tenant.
    // First-seen wins — writers insert-if-absent, never overwrite. Keyed by
    // tenant GUID + type + name (SQL Server default CI collation makes the
    // PK effectively case-insensitive; column sizes stay within the 900-byte
    // clustered-key limit).
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_org_provenance')
     CREATE TABLE dbo.rmone_org_provenance (
       tenant_id   NVARCHAR(64)  NOT NULL,
       entity_type NVARCHAR(16)  NOT NULL,
       entity_name NVARCHAR(256) NOT NULL,
       source      NVARCHAR(30)  NOT NULL,
       file_name   NVARCHAR(500) NULL,
       upload_id   NVARCHAR(200) NULL,
       created_by  NVARCHAR(200) NULL,
       created_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       CONSTRAINT rmone_org_provenance_pk PRIMARY KEY (tenant_id, entity_type, entity_name)
     )`,
    // Import identity aliases: remembered "same person / same project?" answers.
    // When an upload carries a key (email/username/name for people, title for
    // projects) that an admin has already mapped, the import routes the rows to
    // target_key silently instead of asking again or minting a duplicate.
    // alias_key is stored pre-normalized (lowercase, trimmed, collapsed spaces)
    // by the caller. target_key = user GUID (person) or TicketId (project).
    // decision 'merge' = alias maps onto an existing record; 'new' = the admin
    // said "different person/project" and target_key is the separate record
    // created for the alias — either way, future uploads resolve without a prompt.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_identity_aliases')
     CREATE TABLE dbo.rmone_identity_aliases (
       id           INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id    NVARCHAR(64)  NOT NULL,
       kind         NVARCHAR(20)  NOT NULL,
       alias_key    NVARCHAR(400) NOT NULL,
       target_key   NVARCHAR(400) NOT NULL,
       target_label NVARCHAR(400) NULL,
       decision     NVARCHAR(20)  NOT NULL DEFAULT 'merge',
       created_by   NVARCHAR(200) NULL,
       created_at   DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_identity_aliases_key_idx')
       CREATE UNIQUE INDEX rmone_identity_aliases_key_idx ON dbo.rmone_identity_aliases(tenant_id, kind, alias_key)`,
    // Import "needs attention" list: rows an upload could NOT place safely
    // (near-match person, unknown/ambiguous project reference). The rows are
    // NOT imported; each item stores the original data + suggested candidates
    // so an admin can decide (merge / keep separate / map to existing /
    // create new / dismiss). Uploads never guess and never remove.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_import_review')
     CREATE TABLE dbo.rmone_import_review (
       id              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id       NVARCHAR(64)  NOT NULL,
       upload_id       NVARCHAR(200) NULL,
       kind            NVARCHAR(40)  NOT NULL,
       row_key         NVARCHAR(400) NOT NULL,
       display_label   NVARCHAR(400) NULL,
       reason          NVARCHAR(MAX) NULL,
       suggestion_json NVARCHAR(MAX) NULL,
       row_json        NVARCHAR(MAX) NULL,
       row_count       INT NOT NULL DEFAULT 1,
       sheet_name      NVARCHAR(400) NULL,
       status          NVARCHAR(20)  NOT NULL DEFAULT 'open',
       resolution_json NVARCHAR(MAX) NULL,
       resolved_by     NVARCHAR(200) NULL,
       resolved_at     DATETIME2 NULL,
       created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_import_review_tenant_idx')
       CREATE INDEX rmone_import_review_tenant_idx ON dbo.rmone_import_review(tenant_id, status)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_import_review_upload_idx')
       CREATE INDEX rmone_import_review_upload_idx ON dbo.rmone_import_review(upload_id)`,

    // ── Usage telemetry (#482) ────────────────────────────────────────────
    // Raw events, written asynchronously (batched) by the API's usage
    // recorder. Rows live here only until the hourly rollup folds COMPLETE
    // UTC days into rmone_usage_daily and deletes them in the same
    // transaction — so the raw table stays small by construction and
    // "daily + raw" aggregation never double-counts.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_usage_events')
     CREATE TABLE dbo.rmone_usage_events (
       id        BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id NVARCHAR(100) NOT NULL,
       user_id   NVARCHAR(100) NOT NULL,
       username  NVARCHAR(200) NOT NULL,
       [role]    NVARCHAR(200) NULL,
       kind      NVARCHAR(20)  NOT NULL,
       feature   NVARCHAR(120) NOT NULL DEFAULT '',
        context   NVARCHAR(200) NULL,
       is_system BIT NOT NULL DEFAULT 0,
       cnt       INT NOT NULL DEFAULT 1,
       at        DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_usage_events_tenant_at_idx')
       CREATE INDEX rmone_usage_events_tenant_at_idx ON dbo.rmone_usage_events(tenant_id, at)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_usage_events_at_idx')
       CREATE INDEX rmone_usage_events_at_idx ON dbo.rmone_usage_events(at)`,
    `IF COL_LENGTH('dbo.rmone_usage_events', 'context') IS NULL
        ALTER TABLE dbo.rmone_usage_events ADD context NVARCHAR(200) NULL`,
    // Daily rollups: one row per (tenant, day, user, kind, feature,
    // human/system). cnt is additive on MERGE so a late-flushed event that
    // lands after its day was rolled is still counted on the next pass.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_usage_daily')
     CREATE TABLE dbo.rmone_usage_daily (
       id        BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id NVARCHAR(100) NOT NULL,
       [day]     DATE NOT NULL,
       user_id   NVARCHAR(100) NOT NULL,
       username  NVARCHAR(200) NOT NULL,
       [role]    NVARCHAR(200) NULL,
       kind      NVARCHAR(20)  NOT NULL,
       feature   NVARCHAR(120) NOT NULL DEFAULT '',
        context   NVARCHAR(200) NULL,
       is_system BIT NOT NULL DEFAULT 0,
       cnt       INT NOT NULL DEFAULT 0
     )`,
    `IF COL_LENGTH('dbo.rmone_usage_daily', 'context') IS NULL
        ALTER TABLE dbo.rmone_usage_daily ADD context NVARCHAR(200) NULL`,
    // Context is part of the event identity. Older installations used a
    // context-less unique key, which rejects a rollup when two visits to the
    // same feature have different record/page contexts.
    `IF EXISTS (
          SELECT 1
          FROM sys.indexes i
          WHERE i.object_id = OBJECT_ID('dbo.rmone_usage_daily')
            AND i.name = 'rmone_usage_daily_key_idx'
       ) AND NOT EXISTS (
          SELECT 1
          FROM sys.indexes i
          JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
          JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
          WHERE i.object_id = OBJECT_ID('dbo.rmone_usage_daily')
            AND i.name = 'rmone_usage_daily_key_idx'
            AND c.name = 'context'
       )
       BEGIN
         DROP INDEX rmone_usage_daily_key_idx ON dbo.rmone_usage_daily;
         CREATE UNIQUE INDEX rmone_usage_daily_key_idx
         ON dbo.rmone_usage_daily(tenant_id, [day], user_id, kind, feature, context, is_system);
       END
       ELSE IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_usage_daily_key_idx')
         CREATE UNIQUE INDEX rmone_usage_daily_key_idx
         ON dbo.rmone_usage_daily(tenant_id, [day], user_id, kind, feature, context, is_system)`,
    // The dashboard reads at most 400 days but needs many columns from each
    // row. Cover tenant/date and all-tenant/date scans so a cold first paint
    // does not fall back to a table scan plus key lookups.
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_usage_events_tenant_at_cover_idx')
        CREATE INDEX rmone_usage_events_tenant_at_cover_idx ON dbo.rmone_usage_events(tenant_id, at)
        INCLUDE (user_id, username, [role], kind, feature, context, is_system, cnt)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_usage_events_at_cover_idx')
        CREATE INDEX rmone_usage_events_at_cover_idx ON dbo.rmone_usage_events(at)
        INCLUDE (tenant_id, user_id, username, [role], kind, feature, context, is_system, cnt)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_usage_daily_tenant_day_cover_idx')
        CREATE INDEX rmone_usage_daily_tenant_day_cover_idx ON dbo.rmone_usage_daily(tenant_id, [day])
        INCLUDE (user_id, username, [role], kind, feature, context, is_system, cnt)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_usage_daily_day_cover_idx')
        CREATE INDEX rmone_usage_daily_day_cover_idx ON dbo.rmone_usage_daily([day])
        INCLUDE (tenant_id, user_id, username, [role], kind, feature, context, is_system, cnt)`,
    // Cross-INSTANCE cache-bus events — the DB-polling fallback transport used
    // when 2+ load-balanced API instances run without a Redis URL configured
    // (api-server src/lib/cache-bus.ts). Each instance's cluster primary
    // INSERTs the same cache-bust envelope it relays over local IPC; sibling
    // instances poll for rows they didn't originate and fan them out to their
    // own workers. Rows are transient: the poller purges anything older than
    // ~15 minutes, so the table stays tiny.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_cache_bus_events')
     CREATE TABLE dbo.rmone_cache_bus_events (
       id         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       origin     NVARCHAR(64)  NOT NULL,
       payload    NVARCHAR(MAX) NOT NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    // The poller scans by recency every ~2s; without this index each poll is a
    // clustered scan of whatever hasn't been purged yet.
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_cache_bus_events_created_idx')
       CREATE INDEX rmone_cache_bus_events_created_idx ON dbo.rmone_cache_bus_events(created_at) INCLUDE (origin)`,

    // ── Actuals vs Forecast (client spec, Aug 2026) ───────────────────────
    // Imported actual worked hours. One row per (tenant, person, project,
    // week, role). Re-importing the same key REPLACES hours — the latest
    // file is the truth for the weeks it covers; other weeks are untouched.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_actual_hours')
     CREATE TABLE dbo.rmone_actual_hours (
       id            BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id     NVARCHAR(100) NOT NULL,
       ticket_id     NVARCHAR(100) NOT NULL,
       resource_guid NVARCHAR(100) NOT NULL,
       resource_name NVARCHAR(300) NOT NULL DEFAULT '',
       week_monday   DATE NOT NULL,
       hours         FLOAT NOT NULL,
       role_name     NVARCHAR(300) NOT NULL DEFAULT '',
       division      NVARCHAR(300) NOT NULL DEFAULT '',
       source_batch  BIGINT NULL,
       updated_at    DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_actual_hours_key_idx')
       CREATE UNIQUE INDEX rmone_actual_hours_key_idx ON dbo.rmone_actual_hours(tenant_id, ticket_id, resource_guid, week_monday, role_name)`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_actual_hours_person_idx')
       CREATE INDEX rmone_actual_hours_person_idx ON dbo.rmone_actual_hours(tenant_id, resource_guid, week_monday)`,

    // Weekly point-in-time snapshots (project × week) — the single source of
    // truth all three Actuals-vs-Forecast surfaces read. Forecast columns are
    // FROZEN once [final]=1 (the client's point-in-time rule: history is
    // never recomputed from today's plan); actual columns MAY be restated
    // when late timesheet files arrive. backfilled=1 marks rows whose
    // forecast side was reconstructed from the CURRENT plan (pre-launch
    // history), so every surface can disclose it.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_af_snapshots')
     CREATE TABLE dbo.rmone_af_snapshots (
       id                       BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id                NVARCHAR(100) NOT NULL,
       ticket_id                NVARCHAR(100) NOT NULL,
       week_monday              DATE NOT NULL,
       actual_hours_td          FLOAT NOT NULL DEFAULT 0,
       forecast_remaining_hours FLOAT NOT NULL DEFAULT 0,
       forecast_total_hours     FLOAT NOT NULL DEFAULT 0,
       forecast_hours_td        FLOAT NOT NULL DEFAULT 0,
       actual_cost_td           FLOAT NOT NULL DEFAULT 0,
       forecast_remaining_cost  FLOAT NOT NULL DEFAULT 0,
       forecast_total_cost      FLOAT NOT NULL DEFAULT 0,
       forecast_cost_td         FLOAT NOT NULL DEFAULT 0,
       actual_bill_td           FLOAT NOT NULL DEFAULT 0,
       forecast_remaining_bill  FLOAT NOT NULL DEFAULT 0,
       forecast_total_bill      FLOAT NOT NULL DEFAULT 0,
       forecast_bill_td         FLOAT NOT NULL DEFAULT 0,
       hours_variance           FLOAT NOT NULL DEFAULT 0,
       cost_variance            FLOAT NOT NULL DEFAULT 0,
       bill_variance            FLOAT NOT NULL DEFAULT 0,
       substituted_hours        FLOAT NOT NULL DEFAULT 0,
       unrated_actual_hours     FLOAT NOT NULL DEFAULT 0,
       [final]                  BIT NOT NULL DEFAULT 0,
       backfilled               BIT NOT NULL DEFAULT 0,
       engine_version           INT NOT NULL DEFAULT 1,
       computed_at              DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_af_snapshots_key_idx')
       CREATE UNIQUE INDEX rmone_af_snapshots_key_idx ON dbo.rmone_af_snapshots(tenant_id, ticket_id, week_monday)`,

    // Per person/role/division evidence behind each snapshot week — powers
    // the resource/division filters and the Project Forecast Report grouping.
    // Fully recomputable (unlike the frozen rollup above); rebuilt on
    // restatement.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_af_snapshot_detail')
     CREATE TABLE dbo.rmone_af_snapshot_detail (
       id                BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id         NVARCHAR(100) NOT NULL,
       ticket_id         NVARCHAR(100) NOT NULL,
       week_monday       DATE NOT NULL,
       resource_guid     NVARCHAR(100) NOT NULL DEFAULT '',
       resource_name     NVARCHAR(300) NOT NULL DEFAULT '',
       role_name         NVARCHAR(300) NOT NULL DEFAULT '',
       division          NVARCHAR(300) NOT NULL DEFAULT '',
       actual_hours      FLOAT NOT NULL DEFAULT 0,
       actual_cost       FLOAT NOT NULL DEFAULT 0,
       actual_bill       FLOAT NOT NULL DEFAULT 0,
       forecast_hours    FLOAT NOT NULL DEFAULT 0,
       forecast_cost     FLOAT NOT NULL DEFAULT 0,
       forecast_bill     FLOAT NOT NULL DEFAULT 0,
       remaining_hours   FLOAT NOT NULL DEFAULT 0,
       remaining_cost    FLOAT NOT NULL DEFAULT 0,
       remaining_bill    FLOAT NOT NULL DEFAULT 0,
       substituted       BIT NOT NULL DEFAULT 0,
       rate_approximated BIT NOT NULL DEFAULT 0,
       missing_division  BIT NOT NULL DEFAULT 0,
       computed_at       DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_af_detail_key_idx')
       CREATE INDEX rmone_af_detail_key_idx ON dbo.rmone_af_snapshot_detail(tenant_id, ticket_id, week_monday)`,

    // Actuals import history + per-row exceptions (unknown person/project
    // etc). Exceptions are quarantined rows: they are NEVER silently dropped
    // and NEVER auto-create people or projects.
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_actual_import_batches')
     CREATE TABLE dbo.rmone_actual_import_batches (
       id             BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       tenant_id      NVARCHAR(100) NOT NULL,
       filename       NVARCHAR(400) NOT NULL DEFAULT '',
       uploaded_by    NVARCHAR(200) NOT NULL DEFAULT '',
       rows_total     INT NOT NULL DEFAULT 0,
       rows_ok        INT NOT NULL DEFAULT 0,
       rows_exception INT NOT NULL DEFAULT 0,
       status         NVARCHAR(20) NOT NULL DEFAULT 'open',
       created_at     DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
       completed_at   DATETIME2 NULL
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_actual_batches_tenant_idx')
       CREATE INDEX rmone_actual_batches_tenant_idx ON dbo.rmone_actual_import_batches(tenant_id, created_at)`,
    // status shipped as NVARCHAR(20) — too narrow for 'completed_with_exceptions'
    // (25 chars, truncation error at commit). Widen in place; sys.columns
    // max_length is BYTES (2× chars for NVARCHAR), so 20 chars = 40.
    `IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id
                WHERE t.name='rmone_actual_import_batches' AND c.name='status' AND c.max_length < 80)
       ALTER TABLE dbo.rmone_actual_import_batches ALTER COLUMN status NVARCHAR(40) NOT NULL`,
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='rmone_actual_import_exceptions')
     CREATE TABLE dbo.rmone_actual_import_exceptions (
       id         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
       batch_id   BIGINT NOT NULL,
       tenant_id  NVARCHAR(100) NOT NULL,
       reason     NVARCHAR(60) NOT NULL,
       detail     NVARCHAR(1000) NOT NULL DEFAULT '',
       row_json   NVARCHAR(MAX) NULL,
       created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
     )`,
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='rmone_actual_exc_batch_idx')
       CREATE INDEX rmone_actual_exc_batch_idx ON dbo.rmone_actual_import_exceptions(batch_id)`,
  ];

  const runStmt = async (stmt: string) => {
    try {
      await pool.request().query(stmt);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (!msg.includes("already exists") && !msg.includes("There is already")) {
        console.warn("[appdb] DDL warn:", msg.slice(0, 300));
      }
    }
  };

  // The old one-statement-at-a-time loop cost ~60 serial round-trips — ~30-47 s
  // through the QuotaGuard proxy — and every worker that bootstrapped paid it
  // as a user-visible first-request hang. The statements are only order-
  // dependent WITHIN a table's block (CREATE TABLE, then its ALTER/INDEX
  // statements; there are no cross-table FKs), so:
  //   Phase 1 — every sys.tables-gated CREATE TABLE runs concurrently.
  //   Phase 2 — the follow-up statements run grouped by the table block they
  //   follow in source order: serial inside a group (an index may depend on a
  //   column added just above it), groups concurrent (their tables all exist
  //   after phase 1).
  // The pool caps real concurrency at its `max` (5), so this is ~5 in flight
  // — total wall time drops to a few seconds while fresh-DB ordering stays
  // exactly as safe as the serial loop. Per-statement failures are still
  // caught individually, and the next boot re-asserts anything that lost a
  // transient race.
  const isTableGate = (s: string) => /FROM sys\.tables WHERE name=/.test(s);
  const creates: string[] = [];
  const followUpGroups: string[][] = [];
  let current: string[] | null = null;
  for (const stmt of tables) {
    if (isTableGate(stmt)) {
      creates.push(stmt);
      current = [];
      followUpGroups.push(current);
    } else {
      if (!current) { current = []; followUpGroups.push(current); }
      current.push(stmt);
    }
  }
  await Promise.all(creates.map(runStmt));
  await Promise.all(
    followUpGroups
      .filter((g) => g.length > 0)
      .map(async (g) => { for (const stmt of g) await runStmt(stmt); }),
  );

  console.log("[appdb] SQL Server app schema ready");
}
