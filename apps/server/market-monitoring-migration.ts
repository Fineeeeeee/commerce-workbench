import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateMarketMonitoringV12(db:DatabaseSync,directory:string){
  if(Number(db.prepare('PRAGMA user_version').get()!.user_version)!==11)return;
  db.prepare('VACUUM INTO ?').run(join(directory,`before-market-monitoring-v12-${randomUUID()}.sqlite`));
  try{
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE market_monitoring_runs (
        id TEXT PRIMARY KEY,
        source_platform TEXT NOT NULL,
        collection_profile TEXT NOT NULL,
        source_scope TEXT NOT NULL,
        pool_scope TEXT NOT NULL CHECK(json_valid(pool_scope)),
        page_size INTEGER NOT NULL CHECK(page_size>0),
        max_pages INTEGER NOT NULL CHECK(max_pages>0),
        trigger_type TEXT NOT NULL CHECK(trigger_type IN ('MANUAL','SCHEDULED','HISTORICAL')),
        state TEXT NOT NULL CHECK(state IN ('CREATED','COLLECTING','NORMALIZING','IMPORTING','DETECTING','COMPLETED','PARTIAL','FAILED')),
        market_batch_id TEXT UNIQUE REFERENCES market_batches(id),
        source_research_job_id TEXT UNIQUE REFERENCES market_research_jobs(id),
        captured_at TEXT,
        collection_data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(collection_data)),
        comparison_data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(comparison_data)),
        error_code TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count>=0),
        next_run_at INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_until INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX market_monitoring_queue ON market_monitoring_runs(state,next_run_at,created_at);
      CREATE INDEX market_monitoring_history ON market_monitoring_runs(source_platform,collection_profile,captured_at DESC);
      CREATE TABLE market_signals (
        id TEXT PRIMARY KEY,
        monitoring_run_id TEXT NOT NULL REFERENCES market_monitoring_runs(id),
        baseline_run_id TEXT NOT NULL REFERENCES market_monitoring_runs(id),
        signal_key TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        rule_version TEXT NOT NULL,
        fact_data TEXT NOT NULL CHECK(json_valid(fact_data)),
        evidence_data TEXT NOT NULL CHECK(json_valid(evidence_data)),
        priority TEXT NOT NULL CHECK(priority IN ('HIGH','NORMAL')),
        review_state TEXT NOT NULL DEFAULT 'OPEN' CHECK(review_state IN ('OPEN','REVIEWED')),
        inference_run_id TEXT REFERENCES ai_inference_runs(id),
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        UNIQUE(monitoring_run_id,baseline_run_id,signal_key,rule_version)
      ) STRICT;
      CREATE INDEX market_signals_open ON market_signals(review_state,priority,created_at DESC);
      PRAGMA user_version=12; COMMIT;`);
  }catch(error){db.exec('ROLLBACK');throw error;}
}
