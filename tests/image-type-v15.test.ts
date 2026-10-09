import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../apps/server/app.js';
import { migrateImageTypesV15 } from '../apps/server/image-type-migration.js';
import { imageTypeDrafts } from '../packages/contracts/image-type-catalog.js';
import { imageTypeDataSchema,imageTypeBranch } from '../packages/contracts/image-type-guide.js';
import { jobInputSchema } from '../packages/contracts/tasks.js';
import { randomUUID } from 'node:crypto';
test('V15 migration backs up V14 without importing or rewriting knowledge',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'image-type-v15-')),db=new DatabaseSync(join(dir,'workbench.sqlite'));t.after(()=>db.close());
  db.exec("CREATE TABLE existing(id TEXT);INSERT INTO existing VALUES('kept');PRAGMA user_version=14;");migrateImageTypesV15(db,dir);
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,15);assert.equal(db.prepare('SELECT id FROM existing').get()!.id,'kept');assert.equal(db.prepare('SELECT count(*) n FROM image_type_guides').get()!.n,0);
  const file=(await readdir(dir)).find(file=>file.startsWith('before-image-type-v15'));assert.ok(file);
  const old=new DatabaseSync(join(dir,file));t.after(()=>old.close());assert.equal(old.prepare('PRAGMA user_version').get()!.user_version,14);
});
test('17 editorial slots are structured, unmapped types are explicit and unsupported channel stays disabled',()=>{
  assert.equal(imageTypeDrafts.length,17);assert.equal(new Set(imageTypeDrafts.map(item=>item.slotId)).size,17);
  for(const guide of imageTypeDrafts)assert.ok(imageTypeDataSchema.safeParse(guide.data).success);
  assert.match(imageTypeDrafts.find(item=>item.slotId==='F05')!.data.sourceMapping,/无直接参照/);
  assert.equal(imageTypeBranch('jd'),'domestic');assert.throws(()=>imageTypeBranch('amazon'),/未配置/);
  assert.ok(!jobInputSchema.safeParse({kitVersion:1,pageIds:[randomUUID()],operation:'image',imageMode:'quality',editStrategy:'LOW_LEVEL'}).success);
});
test('knowledge draft preparation is idempotent, confirmation and versions retain history',async t=>{
  const {app,store}=await createApp(await mkdtemp(join(tmpdir(),'image-type-api-')));t.after(()=>app.close());
  const headers={host:'127.0.0.1:4380',origin:'http://127.0.0.1:4380'},post=(url:string,payload:unknown)=>app.inject({method:'POST',url,headers,payload:payload as Record<string,unknown>});
  const prepared=await post('/api/image-type-guides/prepare-drafts',{confirmDraftPreparation:true});assert.equal(prepared.statusCode,200);assert.equal(prepared.json().length,17);
  await post('/api/image-type-guides/prepare-drafts',{confirmDraftPreparation:true});assert.equal(store.db.prepare('SELECT count(*) n FROM image_type_guides').get()!.n,17);
  const first=prepared.json()[0];assert.equal(first.status,'DRAFT');assert.equal((await post(`/api/image-type-guides/${first.id}/confirm`,{confirm:true})).statusCode,200);
  const next=await post('/api/image-type-guides',{...imageTypeDrafts[0],data:{...imageTypeDrafts[0]!.data,lighting:'右上柔光'}});assert.equal(next.statusCode,201);assert.equal(next.json().version,2);
  await post(`/api/image-type-guides/${next.json().id}/confirm`,{confirm:true});assert.equal(store.db.prepare('SELECT status FROM image_type_guides WHERE id=?').get(first.id)!.status,'SUPERSEDED');assert.equal((await post(`/api/image-type-guides/${first.id}/confirm`,{confirm:true})).statusCode,409);
  assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
