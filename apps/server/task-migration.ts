import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateTasks(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 2) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-tasks-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE jobs (id TEXT PRIMARY KEY, kit_id TEXT NOT NULL, kit_version INTEGER NOT NULL, product_id TEXT NOT NULL, product_version INTEGER NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('copy','image','export')), input_snapshot TEXT NOT NULL, profile_snapshot TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(kit_id,kit_version) REFERENCES kit_versions(kit_id,version), FOREIGN KEY(product_id,product_version) REFERENCES product_versions(product_id,version)) STRICT;
      CREATE TABLE tasks (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), page_id TEXT, ordinal INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('queued','running','waiting_external','saving_result','needs_reconciliation','succeeded','failed','cancelled')), stage TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, lease_owner TEXT, lease_until INTEGER, lease_epoch INTEGER NOT NULL DEFAULT 0, next_run_at INTEGER NOT NULL DEFAULT 0, recovery_action TEXT, error_code TEXT, safe_message TEXT, progress INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, export_id TEXT UNIQUE REFERENCES exports(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(job_id,ordinal)) STRICT;
      CREATE INDEX tasks_queue ON tasks(state,next_run_at,created_at);
      CREATE INDEX jobs_kit ON jobs(kit_id,created_at,id);
      CREATE TABLE task_attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), sequence INTEGER NOT NULL, lease_epoch INTEGER NOT NULL, phase TEXT NOT NULL, provider_request_id TEXT, provider_job_id TEXT, response_descriptor TEXT, started_at TEXT NOT NULL, finished_at TEXT, safe_error TEXT, UNIQUE(task_id,sequence)) STRICT;
      CREATE TABLE artifacts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), output_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('copy','image','export','page')), relative_path TEXT, sha256 TEXT, mime TEXT, bytes INTEGER, validated_data TEXT, created_at TEXT NOT NULL, UNIQUE(task_id,output_key)) STRICT;
      CREATE TABLE operation_keys (scope TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, resource_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(scope,key)) STRICT;
      CREATE TABLE usage_ledger (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), attempt_id TEXT REFERENCES task_attempts(id), event_key TEXT NOT NULL UNIQUE, entry_type TEXT NOT NULL CHECK(entry_type IN ('reserve','release','settle')), amount_minor INTEGER, currency TEXT, quantity REAL, unit TEXT, price_version TEXT, cost_status TEXT NOT NULL CHECK(cost_status IN ('actual','estimated','unavailable')), created_at TEXT NOT NULL) STRICT;
      UPDATE exports SET state='failed',error='旧版同步导出中断，请重新提交' WHERE state='running';
      PRAGMA user_version=3; COMMIT;`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
