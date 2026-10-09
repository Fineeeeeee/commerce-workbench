import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateMarketSourcesV6(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 5) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-market-source-v6-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE market_entries ADD COLUMN source_product_id TEXT;
      ALTER TABLE market_entries ADD COLUMN source_metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(source_metadata));
      CREATE INDEX market_entries_source_product_id ON market_entries(source_product_id);
      PRAGMA user_version=6;
      COMMIT;`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
