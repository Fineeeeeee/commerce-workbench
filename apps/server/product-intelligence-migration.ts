import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateProductIntelligenceV11(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 10) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-product-intelligence-v11-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE ai_inference_runs (
        id TEXT PRIMARY KEY,
        task_type TEXT NOT NULL,
        capability TEXT NOT NULL CHECK(capability IN ('TEXT_FAST','TEXT_REASONING','VISION_INSPECT','IMAGE_GENERATION')),
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        model_version TEXT,
        input_fingerprint TEXT NOT NULL,
        input_data TEXT NOT NULL CHECK(json_valid(input_data)),
        output_data TEXT CHECK(output_data IS NULL OR json_valid(output_data)),
        status TEXT NOT NULL CHECK(status IN ('SUCCEEDED','FAILED','UNCERTAIN')),
        latency_ms INTEGER NOT NULL CHECK(latency_ms>=0),
        error_code TEXT,
        human_evaluation TEXT CHECK(human_evaluation IS NULL OR json_valid(human_evaluation)),
        adopted_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX ai_runs_subject ON ai_inference_runs(subject_type,subject_id,task_type,created_at DESC);
      CREATE TABLE product_briefs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES product_projects(id),
        version INTEGER NOT NULL CHECK(version>0),
        status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','SUPERSEDED')),
        source_inference_run_id TEXT REFERENCES ai_inference_runs(id),
        content_data TEXT NOT NULL CHECK(json_valid(content_data)),
        citations_data TEXT NOT NULL CHECK(json_valid(citations_data)),
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        UNIQUE(project_id,version)
      ) STRICT;
      CREATE UNIQUE INDEX product_brief_current ON product_briefs(project_id) WHERE status='CONFIRMED';
      CREATE TABLE listing_contents (
        id TEXT PRIMARY KEY,
        sku_id TEXT NOT NULL REFERENCES products(id),
        channel TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version>0),
        status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','SUPERSEDED')),
        source_inference_run_id TEXT REFERENCES ai_inference_runs(id),
        title TEXT NOT NULL,
        keywords_data TEXT NOT NULL CHECK(json_valid(keywords_data)),
        suggestions_data TEXT NOT NULL CHECK(json_valid(suggestions_data)),
        fact_refs_data TEXT NOT NULL CHECK(json_valid(fact_refs_data)),
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        UNIQUE(sku_id,channel,version)
      ) STRICT;
      CREATE UNIQUE INDEX listing_content_current ON listing_contents(sku_id,channel) WHERE status='CONFIRMED';
      PRAGMA user_version=11;
      COMMIT;`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
