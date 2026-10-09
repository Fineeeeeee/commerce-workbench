import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function migrateImageTypesV15(db:DatabaseSync,directory:string){
  if(Number(db.prepare('PRAGMA user_version').get()!.user_version)!==14)return;
  db.prepare('VACUUM INTO ?').run(join(directory,`before-image-type-v15-${randomUUID()}.sqlite`));
  try{
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE image_type_guides (
        id TEXT PRIMARY KEY,template_key TEXT NOT NULL,slot_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version>0),
        status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','SUPERSEDED')),
        guide_data TEXT NOT NULL CHECK(json_valid(guide_data) AND json_type(guide_data)='object'),
        source_references TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_references) AND json_type(source_references)='array'),
        created_at TEXT NOT NULL,confirmed_at TEXT,
        UNIQUE(template_key,slot_id,version),CHECK(status='DRAFT' OR confirmed_at IS NOT NULL)
      ) STRICT;
      CREATE UNIQUE INDEX image_type_guide_confirmed ON image_type_guides(template_key,slot_id) WHERE status='CONFIRMED';`);
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('V15 外键检查失败');
    db.exec('PRAGMA user_version=15; COMMIT;');
  }catch(error){db.exec('ROLLBACK;');throw error;}
}
