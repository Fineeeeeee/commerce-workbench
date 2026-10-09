import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateOpportunitiesV5(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 4) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-opportunity-v5-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE product_opportunities (
        id TEXT PRIMARY KEY,
        evidence_id TEXT NOT NULL UNIQUE REFERENCES market_evidence(id),
        category_id TEXT REFERENCES categories(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('DRAFT','READY','REJECTED')),
        summary TEXT NOT NULL,
        keywords_data TEXT NOT NULL,
        analysis_data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX product_opportunities_status ON product_opportunities(status,updated_at,id);
      CREATE TABLE opportunity_entries (
        opportunity_id TEXT NOT NULL REFERENCES product_opportunities(id),
        entry_id TEXT NOT NULL REFERENCES market_entries(id),
        role TEXT NOT NULL CHECK(role IN ('SUPPORTING','COMPARISON','EXCLUDED')),
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(opportunity_id,entry_id)
      ) STRICT;
      CREATE INDEX opportunity_entries_entry ON opportunity_entries(entry_id,opportunity_id);
      PRAGMA user_version=5;
      COMMIT;`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
