import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateProjectTypeV9(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 8) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-project-type-v9-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE product_projects ADD COLUMN project_type TEXT NULL
        CHECK (project_type IS NULL OR project_type IN ('NEW_PRODUCT', 'EXISTING_PRODUCT'));
      PRAGMA user_version=9;
      COMMIT;`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
