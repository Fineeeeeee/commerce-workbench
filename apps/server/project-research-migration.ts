import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateProjectResearchV8(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 7) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-project-research-v8-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      ALTER TABLE market_research_jobs
        ADD COLUMN initiating_project_id TEXT REFERENCES product_projects(id);
      CREATE INDEX market_research_project_history
        ON market_research_jobs(initiating_project_id, created_at DESC, id);
      PRAGMA user_version=8;
      COMMIT;`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
