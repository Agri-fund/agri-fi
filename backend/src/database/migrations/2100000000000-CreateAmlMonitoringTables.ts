import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Issue #1217 — AML/KYC transaction monitoring.
 *
 * Nine tables: the rule set that drives detection, the alerts it raises, the
 * investigation cases those alerts roll up into, the sanctions/PEP list we hold
 * locally, per-subject screening results, drafted SARs, the regulatory filings
 * of those SARs, the monitoring run log, and the analyst-disposition feedback
 * that retrains rule sensitivity.
 *
 * Deliberately no foreign keys onto `users`: alerts and cases outlive a subject
 * and regulators require the evidence to stay readable, so the user id is kept
 * as a plain uuid reference. Hard relations that are genuinely owned — a rule's
 * alerts, a case's reports — use ON DELETE SET NULL / CASCADE as marked.
 */
export class CreateAmlMonitoringTables2100000000000 implements MigrationInterface {
  name = 'CreateAmlMonitoringTables2100000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aml_monitoring_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "rule_code" varchar(64) NOT NULL,
        "name" varchar(160) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "pattern_type" varchar(32) NOT NULL,
        "risk_level" varchar(16) NOT NULL DEFAULT 'MEDIUM',
        "action" varchar(40) NOT NULL DEFAULT 'FLAG_REVIEW',
        "enabled" boolean NOT NULL DEFAULT true,
        "jurisdiction" varchar(16) NOT NULL DEFAULT 'GLOBAL',
        "window_hours" integer NOT NULL DEFAULT 24,
        "parameters" jsonb NOT NULL DEFAULT '{}',
        "base_risk_score" numeric(5,2) NOT NULL DEFAULT 50,
        "alert_threshold_score" numeric(5,2) NOT NULL DEFAULT 40,
        "sensitivity_multiplier" numeric(4,2) NOT NULL DEFAULT 1,
        "false_positive_count" integer NOT NULL DEFAULT 0,
        "true_positive_count" integer NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 1,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_aml_monitoring_rules_rule_code" ON "aml_monitoring_rules" ("rule_code")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_monitoring_rules_pattern_enabled" ON "aml_monitoring_rules" ("pattern_type", "enabled")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_monitoring_rules_risk_enabled" ON "aml_monitoring_rules" ("risk_level", "enabled")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aml_cases" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "case_number" varchar(40) NOT NULL,
        "title" varchar(255) NOT NULL,
        "summary" text NOT NULL DEFAULT '',
        "subject_user_id" uuid,
        "priority" varchar(16) NOT NULL DEFAULT 'MEDIUM',
        "status" varchar(32) NOT NULL DEFAULT 'open',
        "assigned_to" uuid,
        "opened_by" uuid,
        "alert_ids" jsonb NOT NULL DEFAULT '[]',
        "risk_score" numeric(5,2) NOT NULL DEFAULT 0,
        "exposure_usd" numeric(36,7) NOT NULL DEFAULT 0,
        "subject_snapshot" jsonb NOT NULL DEFAULT '{}',
        "timeline" jsonb NOT NULL DEFAULT '[]',
        "disposition" varchar(32),
        "notes" text,
        "due_at" timestamptz,
        "closed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_aml_cases_case_number" ON "aml_cases" ("case_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_cases_status_priority" ON "aml_cases" ("status", "priority")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_cases_assigned_status" ON "aml_cases" ("assigned_to", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aml_alerts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "pattern_type" varchar(32) NOT NULL,
        "rule_id" uuid REFERENCES "aml_monitoring_rules"("id") ON DELETE SET NULL,
        "rule_code" varchar(64) NOT NULL,
        "user_id" uuid,
        "deal_id" uuid,
        "severity" varchar(16) NOT NULL DEFAULT 'MEDIUM',
        "action" varchar(40) NOT NULL DEFAULT 'FLAG_REVIEW',
        "risk_score" numeric(5,2) NOT NULL,
        "amount_usd" numeric(36,7),
        "title" varchar(255) NOT NULL,
        "match_reason" text NOT NULL,
        "evidence" jsonb NOT NULL DEFAULT '{}',
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "case_id" uuid REFERENCES "aml_cases"("id") ON DELETE SET NULL,
        "run_id" uuid,
        "dedupe_key" varchar(255) NOT NULL,
        "reviewed_by" uuid,
        "reviewed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_aml_alerts_dedupe_key" ON "aml_alerts" ("dedupe_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_alerts_user_created" ON "aml_alerts" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_alerts_status_score" ON "aml_alerts" ("status", "risk_score")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_alerts_case" ON "aml_alerts" ("case_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sanctions_list_entries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "list_source" varchar(16) NOT NULL,
        "external_id" varchar(64),
        "entry_type" varchar(16) NOT NULL DEFAULT 'PERSON',
        "name" varchar(255) NOT NULL,
        "normalised_name" varchar(255) NOT NULL,
        "aliases" jsonb NOT NULL DEFAULT '[]',
        "country" varchar(16),
        "id_numbers" jsonb NOT NULL DEFAULT '[]',
        "date_of_birth" varchar(32),
        "is_pep" boolean NOT NULL DEFAULT false,
        "pep_role" varchar(160),
        "programme" varchar(120) NOT NULL DEFAULT '',
        "remarks" varchar(64) NOT NULL DEFAULT '',
        "enabled" boolean NOT NULL DEFAULT true,
        "list_version" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sanctions_entries_source_type" ON "sanctions_list_entries" ("list_source", "entry_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sanctions_entries_normalised_name" ON "sanctions_list_entries" ("normalised_name")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_sanctions_entries_pep_enabled" ON "sanctions_list_entries" ("is_pep", "enabled")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aml_screening_results" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "subject_type" varchar(24) NOT NULL,
        "subject_id" varchar(64) NOT NULL,
        "subject_label" varchar(255) NOT NULL DEFAULT '',
        "list_source" varchar(16) NOT NULL,
        "decision" varchar(16) NOT NULL,
        "score" numeric(5,2) NOT NULL DEFAULT 0,
        "matched_entry_id" uuid,
        "matched_name" varchar(255),
        "details" jsonb NOT NULL DEFAULT '{}',
        "screened_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_screening_results_subject" ON "aml_screening_results" ("subject_type", "subject_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_screening_results_decision_created" ON "aml_screening_results" ("decision", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aml_sar_reports" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sar_number" varchar(40) NOT NULL,
        "case_id" uuid NOT NULL REFERENCES "aml_cases"("id") ON DELETE CASCADE,
        "jurisdiction" varchar(32) NOT NULL DEFAULT 'US',
        "authority" varchar(64) NOT NULL DEFAULT 'FinCEN',
        "filing_type" varchar(32) NOT NULL DEFAULT 'initial',
        "subjects" jsonb NOT NULL DEFAULT '[]',
        "activities" jsonb NOT NULL DEFAULT '[]',
        "suspicious_amount_usd" numeric(36,7) NOT NULL DEFAULT 0,
        "activity_from" timestamptz,
        "activity_to" timestamptz,
        "narrative" text NOT NULL DEFAULT '',
        "structured_data" jsonb NOT NULL DEFAULT '{}',
        "status" varchar(20) NOT NULL DEFAULT 'draft',
        "sha256_hash" varchar(64) NOT NULL DEFAULT '',
        "version" integer NOT NULL DEFAULT 1,
        "generated_by" uuid,
        "reviewed_by" uuid,
        "reviewed_at" timestamptz,
        "filed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_aml_sar_reports_sar_number" ON "aml_sar_reports" ("sar_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_sar_reports_status_filed" ON "aml_sar_reports" ("status", "filed_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aml_regulatory_submissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "submission_number" varchar(40) NOT NULL,
        "report_type" varchar(32) NOT NULL,
        "report_id" uuid NOT NULL,
        "authority" varchar(64) NOT NULL,
        "channel" varchar(32) NOT NULL DEFAULT 'api',
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "attempt" integer NOT NULL DEFAULT 1,
        "authority_reference" varchar(120),
        "request_summary" jsonb NOT NULL DEFAULT '{}',
        "response" jsonb NOT NULL DEFAULT '{}',
        "submitted_at" timestamptz,
        "submitted_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_reg_submissions_type_status" ON "aml_regulatory_submissions" ("report_type", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_reg_submissions_report_attempt" ON "aml_regulatory_submissions" ("report_id", "attempt")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aml_monitoring_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trigger_type" varchar(16) NOT NULL DEFAULT 'cron',
        "window_start" timestamptz NOT NULL,
        "window_end" timestamptz NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'running',
        "users_evaluated" integer NOT NULL DEFAULT 0,
        "flows_evaluated" integer NOT NULL DEFAULT 0,
        "rules_applied" integer NOT NULL DEFAULT 0,
        "alerts_raised" integer NOT NULL DEFAULT 0,
        "cases_opened" integer NOT NULL DEFAULT 0,
        "duration_ms" integer NOT NULL DEFAULT 0,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_monitoring_runs_status_created" ON "aml_monitoring_runs" ("status", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aml_disposition_feedback" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "alert_id" uuid,
        "case_id" uuid,
        "rule_code" varchar(64) NOT NULL,
        "disposition" varchar(32) NOT NULL,
        "rule_id" uuid,
        "pattern_type" varchar(32) NOT NULL DEFAULT '',
        "recorded_by" uuid,
        "reason" text,
        "sensitivity_before" numeric(4,2),
        "sensitivity_after" numeric(4,2),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_disposition_feedback_rule_created" ON "aml_disposition_feedback" ("rule_code", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_aml_disposition_feedback_alert" ON "aml_disposition_feedback" ("alert_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "aml_disposition_feedback"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "aml_monitoring_runs"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "aml_regulatory_submissions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "aml_sar_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "aml_screening_results"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sanctions_list_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "aml_alerts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "aml_cases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "aml_monitoring_rules"`);
  }
}
