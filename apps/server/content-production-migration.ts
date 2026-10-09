import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateContentProductionV10(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 9) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-content-production-v10-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE project_independent_skus (
        sku_id TEXT PRIMARY KEY REFERENCES products(id),
        project_id TEXT NOT NULL REFERENCES product_projects(id),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE content_direction_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES product_projects(id),
        sku_id TEXT NOT NULL REFERENCES products(id),
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        fact_refs TEXT NOT NULL CHECK(json_valid(fact_refs)),
        market_refs TEXT NOT NULL CHECK(json_valid(market_refs)),
        ai_suggestion TEXT CHECK(ai_suggestion IS NULL OR json_valid(ai_suggestion)),
        selected_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE content_production_batches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES product_projects(id),
        sku_id TEXT NOT NULL REFERENCES products(id),
        kit_id TEXT NOT NULL REFERENCES kits(id),
        direction_id TEXT NOT NULL REFERENCES content_direction_candidates(id),
        planned_page_ids TEXT NOT NULL CHECK(json_valid(planned_page_ids)),
        created_at TEXT NOT NULL
      ) STRICT;
      ALTER TABLE jobs ADD COLUMN production_batch_id TEXT REFERENCES content_production_batches(id);
      CREATE TABLE content_quality_results (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES content_production_batches(id),
        kit_id TEXT NOT NULL,
        kit_version INTEGER NOT NULL,
        page_id TEXT NOT NULL,
        rule_status TEXT NOT NULL CHECK(rule_status IN ('PASS','FAIL')),
        rule_issues TEXT NOT NULL CHECK(json_valid(rule_issues)),
        ai_status TEXT NOT NULL CHECK(ai_status IN ('NOT_RUN','PASS','REVIEW','FAILED')),
        ai_issues TEXT NOT NULL CHECK(json_valid(ai_issues)),
        human_decision TEXT CHECK(human_decision IS NULL OR human_decision IN ('APPROVE','REJECT')),
        reviewed_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(batch_id,page_id,kit_version),
        FOREIGN KEY(kit_id,kit_version) REFERENCES kit_versions(kit_id,version)
      ) STRICT;
      PRAGMA user_version=10;
      COMMIT;`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
