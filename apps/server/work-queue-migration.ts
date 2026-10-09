import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateWorkQueueV13(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 12) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-work-queue-v13-${randomUUID()}.sqlite`));
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_inference_runs'").get();
  const original = String(row?.sql ?? '');
  const oldCheck = "CHECK(capability IN ('TEXT_FAST','TEXT_REASONING','VISION_INSPECT','IMAGE_GENERATION'))";
  if (!original.includes(oldCheck)) throw new Error('AI 运行记录结构不符合 V12，拒绝迁移');
  const replacement = original.replace('CREATE TABLE ai_inference_runs', 'CREATE TABLE ai_inference_runs_v13')
    .replace(oldCheck, "CHECK(capability IN ('TEXT_FAST','TEXT_REASONING','VISION_INSPECT','IMAGE_GENERATION','SYSTEM_REASONING'))");
  db.exec('PRAGMA foreign_keys=OFF;');
  try {
    db.exec('BEGIN IMMEDIATE;');
    db.exec(`CREATE TABLE manual_work_items (
      id TEXT PRIMARY KEY,
      request_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
      source TEXT NOT NULL CHECK(source IN ('MANAGER_ASSIGNED','SELF_CREATED','AI_RECOMMENDED')),
      priority TEXT NOT NULL CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
      deadline TEXT,
      objective TEXT NOT NULL CHECK(length(trim(objective))>0),
      acceptance_criteria TEXT NOT NULL CHECK(json_valid(acceptance_criteria)),
      related_entity_type TEXT NOT NULL CHECK(related_entity_type IN ('PROJECT','SKU','OPPORTUNITY','CONTENT_KIT','CONTENT_PAGE')),
      related_entity_id TEXT NOT NULL,
      target_data TEXT NOT NULL CHECK(json_valid(target_data)),
      status TEXT NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX manual_work_queue ON manual_work_items(status,deadline,created_at);`);
    db.exec(replacement);
    db.exec('INSERT INTO ai_inference_runs_v13 SELECT * FROM ai_inference_runs;');
    db.exec('DROP TABLE ai_inference_runs; ALTER TABLE ai_inference_runs_v13 RENAME TO ai_inference_runs;');
    db.exec('CREATE INDEX ai_runs_subject ON ai_inference_runs(subject_type,subject_id,task_type,created_at DESC);');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('V13 外键检查失败');
    db.exec('PRAGMA user_version=13; COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON;');
  }
}
