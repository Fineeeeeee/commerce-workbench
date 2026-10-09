import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateVisualGuidesV14(db: DatabaseSync, directory: string) {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 13) return;
  db.prepare('VACUUM INTO ?').run(join(directory, `before-visual-guide-v14-${randomUUID()}.sqlite`));
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE category_visual_guides (
        id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id),
        version INTEGER NOT NULL CHECK(version>0),
        status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','SUPERSEDED')),
        guide_data TEXT NOT NULL CHECK(json_valid(guide_data) AND json_type(guide_data)='object'),
        source_references TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_references) AND json_type(source_references)='array'),
        created_at TEXT NOT NULL, confirmed_at TEXT,
        UNIQUE(category_id,version), CHECK(status='DRAFT' OR confirmed_at IS NOT NULL)
      ) STRICT;
      CREATE UNIQUE INDEX category_visual_guide_confirmed ON category_visual_guides(category_id) WHERE status='CONFIRMED';`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('V14 外键检查失败');
    db.exec('PRAGMA user_version=14; COMMIT;');
  } catch (error) { db.exec('ROLLBACK;'); throw error; }
}
