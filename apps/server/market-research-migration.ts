import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateMarketResearchV7(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 6) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-market-research-v7-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE market_research_jobs (
        id TEXT PRIMARY KEY,
        source_platform TEXT NOT NULL,
        collection_profile TEXT NOT NULL,
        target_count INTEGER NOT NULL CHECK(target_count BETWEEN 1 AND 100),
        max_pages INTEGER NOT NULL CHECK(max_pages BETWEEN 1 AND 20),
        state TEXT NOT NULL CHECK(state IN ('CREATED','COLLECTING','NORMALIZING','IMPORTING','ANALYZING','REVIEW_REQUIRED','COMPLETED','FAILED')),
        failed_stage TEXT CHECK(failed_stage IS NULL OR failed_stage IN ('COLLECTING','NORMALIZING','IMPORTING','ANALYZING')),
        scanned_count INTEGER NOT NULL DEFAULT 0 CHECK(scanned_count>=0),
        valid_count INTEGER NOT NULL DEFAULT 0 CHECK(valid_count>=0),
        opportunity_count INTEGER NOT NULL DEFAULT 0 CHECK(opportunity_count>=0),
        manifest_data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(manifest_data)),
        market_batch_id TEXT REFERENCES market_batches(id),
        error_code TEXT,
        safe_message TEXT,
        lease_owner TEXT,
        lease_until INTEGER,
        lease_epoch INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_run_at INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX market_research_queue ON market_research_jobs(state,next_run_at,created_at);
      PRAGMA user_version=7; COMMIT;`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
