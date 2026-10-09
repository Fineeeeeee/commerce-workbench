import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateMarketMemoryV16(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 15) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-market-memory-v16-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE market_memory_embeddings (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT NOT NULL REFERENCES product_opportunities(id),
        content_fingerprint TEXT NOT NULL,
        summary_version TEXT NOT NULL,
        summary_data TEXT NOT NULL CHECK(json_valid(summary_data)),
        provider TEXT NOT NULL,model TEXT NOT NULL,model_version TEXT NOT NULL,
        dimension INTEGER NOT NULL CHECK(dimension>0),
        vector_data TEXT NOT NULL CHECK(json_valid(vector_data) AND json_type(vector_data)='array'),
        request_id TEXT,latency_ms INTEGER NOT NULL CHECK(latency_ms>=0),created_at TEXT NOT NULL,
        UNIQUE(opportunity_id,content_fingerprint,provider,model,model_version,dimension)
      ) STRICT;`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('V16 外键检查失败');
    db.exec('PRAGMA user_version=16; COMMIT;');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
