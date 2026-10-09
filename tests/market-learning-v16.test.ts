import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateMarketMemoryV16 } from '../apps/server/market-memory-migration.js';
import { Store } from '../apps/server/store.js';
import { indexMarketMemory,retrieveMarketHistory,learningRows } from '../apps/server/market-learning.js';
import { deadlineNotice } from '../packages/contracts/deadline.js';
import { summarizeOpportunityReviews,opportunityReviewSchema,cosineSimilarity } from '../packages/contracts/market-learning.js';
import type { OpportunityPreview } from '../packages/contracts/market-opportunity.js';

test('V16 backs up all old rows, adds only an empty memory table, and rolls back invalid FK',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'memory-migration-')),db=new DatabaseSync(join(dir,'workbench.sqlite'));t.after(()=>db.close());
  db.exec("PRAGMA foreign_keys=ON;CREATE TABLE product_opportunities(id TEXT PRIMARY KEY);INSERT INTO product_opportunities VALUES('kept');PRAGMA user_version=15");
  migrateMarketMemoryV16(db,dir);assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,16);assert.equal(db.prepare('SELECT id FROM product_opportunities').get()!.id,'kept');assert.equal(db.prepare('SELECT count(*) n FROM market_memory_embeddings').get()!.n,0);
  assert.throws(()=>db.prepare('INSERT INTO market_memory_embeddings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('id','missing','hash','v1','{}','bailian','model','',2,'[1,0]',null,1,'now'));
  const backup=(await readdir(dir)).find(f=>f.startsWith('before-market-memory-v16'));assert.ok(backup);const old=new DatabaseSync(join(dir,backup!));t.after(()=>old.close());assert.equal(old.prepare('PRAGMA user_version').get()!.user_version,15);
});
test('review metrics exclude pending from adoption denominator, retain unclassified rejection and separate model prompt/category',()=>{
  const base={id:'a',title:'a',categoryId:'category',batchId:'batch',batchName:'sample',model:'max',modelVersion:null,promptVersion:'v1',decision:null,note:'',reasonCodes:[],reviewedAt:null} as const;
  const result=summarizeOpportunityReviews([{...base,reasonCodes:[],decision:'APPROVED'},{...base,reasonCodes:[],decision:'REJECTED'},{...base,reasonCodes:[]},{...base,reasonCodes:['BUSINESS_NOT_NEEDED'],model:'plus',promptVersion:'v2',decision:'REJECTED'}]);
  assert.equal(result.total,4);assert.equal(result.reviewed,3);assert.equal(result.adoptionRate,1/3);assert.equal(result.coverage,3/4);assert.equal(result.models.length,2);assert.equal(result.reasons.find(r=>r.code==='UNCLASSIFIED')!.count,1);assert.equal(result.reasons.find(r=>r.code==='BUSINESS_NOT_NEEDED')!.count,1);
  assert.ok(!opportunityReviewSchema.safeParse({decision:'APPROVED',reviewer:'人',note:'ok',reasonCodes:['FACT_ERROR']}).success);
  assert.ok(opportunityReviewSchema.safeParse({decision:'REJECTED',reviewer:'人',note:'old client'}).success);
  assert.throws(()=>cosineSimilarity([0,0],[1,0]));assert.throws(()=>cosineSimilarity([1],[1,0]));
});
test('semantic retrieval isolates category/batch/time, reuses unchanged index, excludes stale and foreign-model vectors',async t=>{
  const store=new Store(await mkdtemp(join(tmpdir(),'memory-retrieval-')));t.after(()=>store.db.close());
  const category=randomUUID(),other=randomUUID();for(const id of [category,other])store.db.prepare('INSERT INTO categories VALUES (?,?,?,?,?,?)').run(id,null,id,'测试','2026-10-01','2026-10-01');
  const currentBatch=randomUUID(),oldBatch=randomUUID();
  function add(categoryId:string,batchId:string,sourceDate='2026-10-01',reviewedAt='2026-10-01T00:00:00Z'){
    const id=randomUUID(),evidence=randomUUID(),analysis={batch:{id:batchId,name:'历史批次',periodEnd:sourceDate},risks:['有限样本'],modelMetadata:{modelId:'max',modelVersion:'max',promptVersion:'v3'},review:{decision:'REJECTED',note:'业务不需要',reviewer:'测试',reviewedAt}};
    store.db.prepare('INSERT INTO market_evidence VALUES(?,?,?,?,?,?,?)').run(evidence,'测试','AI候选',null,'摘要','{}','2026-10-01');
    store.db.prepare('INSERT INTO product_opportunities VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,evidence,categoryId,'历史香氛机会','REJECTED','历史建议',JSON.stringify([{term:'香氛'}]),JSON.stringify(analysis),'2026-10-01','2026-10-01');return id;
  }
  const eligible=add(category,oldBatch);add(category,currentBatch);add(other,oldBatch);add(category,randomUUID(),'2026-10-07');add(category,randomUUID(),'2026-10-01','2026-10-07T00:00:00Z');
  const config={provider:'bailian' as const,model:'test-vector',version:'v1',dimension:2,workspace:'test'};let calls=0;
  const embed=async(texts:string[])=>{calls++;return {vectors:texts.map(()=>[1,0]),requestId:'test-request',latencyMs:2};};
  assert.equal((await indexMarketMemory(store,category,embed,config)).indexed,4);assert.equal((await indexMarketMemory(store,category,embed,config)).calls,0);assert.equal(calls,1);
  const preview={batch:{id:currentBatch,periodEnd:'2026-10-06'},stats:{sellingPoints:[{term:'香氛'}]},included:[]} as unknown as OpportunityPreview;
  const result=await retrieveMarketHistory(store,preview,category,embed,config);assert.equal(result.status,'USED');assert.equal(result.hits.length,1);assert.equal(result.hits[0]!.reference.opportunityId,eligible);assert.equal(result.hits[0]!.reference.decision,'REJECTED');
  const foreign=await retrieveMarketHistory(store,preview,other,embed,config);assert.ok(foreign.hits.every(hit=>hit.reference.categoryId===other));
  assert.equal((await retrieveMarketHistory(store,preview,category,embed,{...config,model:'other-model'})).status,'NO_INDEX');
  const row=store.db.prepare('SELECT analysis_data FROM product_opportunities WHERE id=?').get(eligible)!;const analysis=JSON.parse(String(row.analysis_data));analysis.review.note='已变更';store.db.prepare('UPDATE product_opportunities SET analysis_data=? WHERE id=?').run(JSON.stringify(analysis),eligible);
  const before=calls;assert.equal((await retrieveMarketHistory(store,preview,category,embed,config)).status,'NO_INDEX');assert.equal(calls,before);assert.equal(learningRows(store).length,5);assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('deadline reminder ignores terminal states and invalid dates without changing task state',()=>{
  const now=Date.parse('2026-10-06T00:00:00Z');assert.equal(deadlineNotice('2026-09-30T00:00:00Z','进行中',now),'已逾期 6 天');assert.equal(deadlineNotice('2026-09-30T00:00:00Z','COMPLETED',now),null);assert.equal(deadlineNotice('bad','OPEN',now),null);assert.equal(deadlineNotice('2026-10-07T00:00:00Z','OPEN',now),null);
});
